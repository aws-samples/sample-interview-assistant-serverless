"""Candidate Interview Planner Service - Generates interview questions for candidates preparing for interviews"""

import json
import logging
import os
import re
from typing import Dict, Any, Optional

from strands import Agent
from strands.models import BedrockModel
from tools.web_search import ddg_search, nova_grounding_search
from interview_planner_models import InterviewPlan, InterviewQuestion, CompanyResearch
from candidate_planner_prompts import (
    # Configuration
    CANDIDATE_PLANNER_MODEL_ID,
    CANDIDATE_PLANNER_SUMMARIZE_MODEL_ID,
    CANDIDATE_PLANNER_REGION,
    TEMPERATURE_SUMMARIZATION,
    TEMPERATURE_GENERATION,
    MAX_TOKENS_SUMMARIZATION,
    MAX_TOKENS_GENERATION,
    RESUME_SUMMARY_SYSTEM_PROMPT,
    RESUME_SUMMARY_USER_PROMPT,
    JD_SUMMARY_SYSTEM_PROMPT,
    JD_SUMMARY_USER_PROMPT_TEMPLATE,
    RESEARCH_SYSTEM_PROMPT,
    get_research_user_prompt,
    get_interview_plan_system_prompt,
    get_interview_plan_user_prompt,
)
from config.feature_flags import feature_flags
from utils.retry_utils import retry_config, bedrock_retry_handler
from services.memory_service import MemoryService

logger = logging.getLogger(__name__)


class CandidatePlannerService:
    """
    Service that creates interview preparation plans:
    1. Summarizes resume using LLM (no tools)
    2. Summarizes job description using LLM (no tools)
    3. Researches company using web search
    4. Generates interview questions with expected answers
    """

    def __init__(self, model_id: str = None, region_name: str = None):
        # Use configuration from prompts.py, with environment variable override, then fallback to prompts default
        self.interview_planner_model_id = model_id or CANDIDATE_PLANNER_MODEL_ID
        self.interview_planner_summarize_model_id = CANDIDATE_PLANNER_SUMMARIZE_MODEL_ID
        self.region_name = region_name or CANDIDATE_PLANNER_REGION

        self.bedrock_summarize_model = BedrockModel(
            model_id=self.interview_planner_summarize_model_id,
            temperature=TEMPERATURE_SUMMARIZATION,
            region_name=self.region_name,
            boto_client_config=retry_config,
            max_tokens=MAX_TOKENS_SUMMARIZATION,
        )

        self.bedrock_interview_plan_model = BedrockModel(
            model_id=self.interview_planner_model_id,
            temperature=TEMPERATURE_GENERATION,
            region_name=self.region_name,
            boto_client_config=retry_config,
            max_tokens=MAX_TOKENS_GENERATION,
        )

        logger.info(
            f"CandidatePlannerService using interview_planner_model_id:{self.interview_planner_model_id} and interview_planner_summarize_model_id: {self.interview_planner_summarize_model_id}  in region: {self.region_name}"
        )

        # Initialize Memory Service
        self.memory_service = MemoryService(region_name=self.region_name)

    async def summarize_resume(self, resume_file_bytes: bytes, file_name: str) -> str:
        """
        Summarize resume using Strands Agent without tools.

        Args:
            resume_file_bytes: Resume file bytes
            file_name: Original filename

        Returns:
            Resume summary as string
        """
        try:
            # Create agent without tools for summarization
            agent = Agent(
                model=self.bedrock_summarize_model,
                tools=[],  # No tools needed for summarization
                system_prompt=RESUME_SUMMARY_SYSTEM_PROMPT,
                hooks=[bedrock_retry_handler],
            )

            # Sanitize filename for Bedrock
            name_without_ext = (
                file_name.rsplit(".", 1)[0] if "." in file_name else file_name
            )
            sanitized = name_without_ext.replace("_", "-")
            sanitized = re.sub(r"[^a-zA-Z0-9\s\-\(\)\[\]]", "", sanitized)
            sanitized = re.sub(r"\s+", " ", sanitized)
            clean_name = sanitized.strip() or "resume"

            # Determine file format
            file_format = (
                "pdf"
                if file_name.lower().endswith(".pdf")
                else "docx"
                if file_name.lower().endswith((".docx", ".doc"))
                else "txt"
            )

            # Create multimodal message with file
            message = [
                {"text": RESUME_SUMMARY_USER_PROMPT},
                {
                    "document": {
                        "name": clean_name,
                        "format": file_format,
                        "source": {"bytes": resume_file_bytes},
                    }
                },
            ]

            # Invoke agent
            response = await agent.invoke_async(message)
            logger.info("Resume summarization completed")

            return str(response)

        except Exception as e:
            logger.error(f"Error summarizing resume: {e}")
            return f"Error summarizing resume: {str(e)}"

    async def summarize_job_description(self, jd_text: str) -> str:
        """
        Summarize job description using Strands Agent without tools.

        Args:
            jd_text: Job description text

        Returns:
            JD summary as string
        """
        try:
            # Create agent without tools for summarization
            agent = Agent(
                model=self.bedrock_summarize_model,
                tools=[],  # No tools needed for summarization
                system_prompt=JD_SUMMARY_SYSTEM_PROMPT,
                hooks=[bedrock_retry_handler],
            )

            # Invoke agent with text message
            response = await agent.invoke_async(
                JD_SUMMARY_USER_PROMPT_TEMPLATE.format(jd_text=jd_text)
            )
            logger.info("Job description summarization completed")

            return str(response)

        except Exception as e:
            logger.error(f"Error summarizing JD: {e}")
            return f"Error summarizing JD: {str(e)}"

    def retrieve_user_memory(self, user_id: str) -> Optional[str]:
        """
        Retrieve user's long-term memory from AgentCore Memory.

        Args:
            user_id: User email or identifier

        Returns:
            Formatted string with user preferences and communication style, or None
        """
        return self.memory_service.retrieve_user_memory(user_id)

    async def research_company_and_patterns(
        self,
        company_name: Optional[str],
        interview_type: str,
        jd_summary: str,
    ) -> str:
        """
        Research company culture and interview patterns using web search.
        Phase 1: Uses agent WITH tools to gather information.

        Args:
            company_name: Company name (optional)
            interview_type: Type of interview (technical, behavioral, etc.)
            jd_summary: Summarized job description

        Returns:
            String with research findings
        """
        try:
            # Select web search tool based on feature flag
            use_nova_grounding = feature_flags.get("USE_NOVA_GROUNDING", False)
            web_search_tool = (
                nova_grounding_search if use_nova_grounding else ddg_search
            )
            tool_name = "nova_grounding_search" if use_nova_grounding else "ddg_search"

            search_method = "Nova Grounding" if use_nova_grounding else "DuckDuckGo"
            logger.info(
                f"[Phase 1: Research] Using {search_method} for web search (tool: {tool_name})"
            )

            # Create agent WITH web search tool (no structured output)
            agent = Agent(
                model=self.bedrock_interview_plan_model,
                tools=[web_search_tool],
                system_prompt=RESEARCH_SYSTEM_PROMPT,
                hooks=[bedrock_retry_handler],
            )

            # Build research prompt
            research_prompt = get_research_user_prompt(
                company_name=company_name or "Not specified",
                interview_type=interview_type,
                jd_summary=jd_summary,
                tool_name=tool_name,
            )

            logger.info(f"📝 [Phase 1: Research] Sending research prompt to model")

            # Invoke agent (NOT structured_output - just regular invoke)
            response = await agent.invoke_async(research_prompt)

            research_findings = str(response)
            logger.info(
                f"✅ [Phase 1: Research] Completed. Findings length: {len(research_findings)} chars"
            )

            return research_findings

        except Exception as e:
            logger.error(f"Error researching company and patterns: {e}")
            # Return empty string on error so generation can continue
            return "Research unavailable due to error. Proceeding with general interview questions."

    async def generate_interview_plan(
        self,
        resume_summary: str,
        jd_summary: str,
        company_name: Optional[str] = None,
        interview_type: str = "technical",
        question_count: int = 5,
        difficulty: str = "medium",
        custom_questions: Optional[list] = None,
        user_id: Optional[str] = None,
    ) -> InterviewPlan:
        """
        Generate interview preparation plan using two-phase approach:
        Phase 1: Research (with tools) - already completed, passed as research_findings
        Phase 2: Generate (no tools) - uses structured_output_async

        Args:
            resume_summary: Summarized resume
            jd_summary: Summarized job description
            company_name: Company name (optional)
            interview_type: Type of interview (technical, behavioral, etc.)
            question_count: Number of questions to generate
            difficulty: Question difficulty level
            custom_questions: Optional list of custom questions
            user_id: User identifier for memory retrieval (optional)

        Returns:
            InterviewPlan object with questions and research
        """
        try:
            # Retrieve user's long-term memory if user_id provided
            user_memory = None
            if user_id:
                logger.info(f"Retrieving long-term memory for user: {user_id}")
                user_memory = self.retrieve_user_memory(user_id)
                if user_memory:
                    logger.info(
                        f"Successfully retrieved user memory for personalization"
                    )
                else:
                    logger.info(
                        f"No user memory found, proceeding without personalization"
                    )

            # Phase 1: Research company and interview patterns
            logger.info("Phase 1: Researching company and interview patterns...")
            research_findings = await self.research_company_and_patterns(
                company_name=company_name,
                interview_type=interview_type,
                jd_summary=jd_summary,
            )

            # Phase 2: Generate interview plan WITHOUT tools (uses research findings)
            logger.info(
                "[Phase 2: Generation] Creating agent without tools for structured output"
            )

            # Create agent WITHOUT tools for structured output
            agent = Agent(
                model=self.bedrock_interview_plan_model,
                tools=[],  # No tools - uses research findings instead
                system_prompt=get_interview_plan_system_prompt(
                    interview_type, difficulty, question_count
                ),
                hooks=[bedrock_retry_handler],
            )

            # Build generation prompt with research findings and user memory
            generation_prompt = get_interview_plan_user_prompt(
                resume_summary=resume_summary,
                jd_summary=jd_summary,
                company_name=company_name,
                interview_type=interview_type,
                question_count=question_count,
                difficulty=difficulty,
                research_findings=research_findings,
                custom_questions=custom_questions,
                user_memory=user_memory,
            )

            # Log the prompt being sent to the model
            logger.info(
                f"📝 [Phase 2: Generation] Sending prompt to model ({self.interview_planner_model_id})"
            )

            # Invoke agent with structured output enforcement (works reliably without tools)
            logger.info(
                "🤖 [Phase 2: Generation] Invoking agent.structured_output_async()..."
            )
            interview_plan = await agent.structured_output_async(
                InterviewPlan, generation_prompt
            )

            # Log what was returned
            logger.info(
                f"✅ [Phase 2: Generation] Agent returned: {type(interview_plan).__name__}"
            )
            if isinstance(interview_plan, dict):
                logger.info(
                    f"[Phase 2: Generation] Response keys: {list(interview_plan.keys())}"
                )
            elif isinstance(interview_plan, InterviewPlan):
                logger.info(
                    f"[Phase 2: Generation] InterviewPlan fields - totalQuestions: {interview_plan.totalQuestions}, "
                    f"questions count: {len(interview_plan.questions)}, "
                    f"companyResearch: {interview_plan.companyResearch is not None}"
                )
            else:
                logger.info(
                    f"[Phase 2: Generation] Unexpected response type: {interview_plan}"
                )

            logger.info("✅ Two-phase interview plan generation completed")

            # If it returns a dict, validate it:
            if not isinstance(interview_plan, InterviewPlan):
                logger.info("Converting dict to InterviewPlan object...")
                interview_plan = InterviewPlan(**interview_plan)

            return interview_plan

        except Exception as e:
            logger.error(f"Error generating interview plan: {e}")
            raise

    async def create_full_interview_plan(
        self,
        resume_file_bytes: bytes,
        file_name: str,
        jd_text: str,
        company_name: Optional[str] = None,
        interview_type: str = "technical",
        question_count: int = 5,
        difficulty: str = "medium",
        custom_questions: Optional[list] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Complete end-to-end interview preparation workflow.

        Args:
            resume_file_bytes: Resume file bytes
            file_name: Original filename
            jd_text: Job description text
            company_name: Company name (optional)
            interview_type: Type of interview
            question_count: Number of questions
            difficulty: Difficulty level
            custom_questions: Optional list of custom questions
            user_id: User identifier for memory retrieval (optional)

        Returns:
            Dictionary with summaries and interview plan
        """
        logger.info("Starting interview preparation workflow")

        # Phase 1: Summarize resume
        logger.info("Phase 1: Summarizing resume...")
        resume_summary = await self.summarize_resume(resume_file_bytes, file_name)

        # Phase 2: Summarize JD
        logger.info("Phase 2: Summarizing job description...")
        jd_summary = await self.summarize_job_description(jd_text)

        # Phase 3: Generate plan with research
        logger.info("Phase 3: Generating interview plan with research...")
        interview_plan = await self.generate_interview_plan(
            resume_summary=resume_summary,
            jd_summary=jd_summary,
            company_name=company_name,
            interview_type=interview_type,
            question_count=question_count,
            difficulty=difficulty,
            custom_questions=custom_questions,
            user_id=user_id,
        )

        logger.info("Interview preparation workflow completed")

        return {
            "resumeSummary": resume_summary,
            "jdSummary": jd_summary,
            "interviewPlan": interview_plan.model_dump(),
        }
