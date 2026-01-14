"""Interview Planner Service - Generates interview questions based on resume and JD"""

import json
import logging
import os
import re
from typing import Dict, Any, Optional, List
from utils.retry_utils import retry_config, bedrock_retry_handler
from strands import Agent
from strands.models import BedrockModel
from tools.web_search import ddg_search, nova_grounding_search
from interview_planner_models import InterviewPlan, InterviewQuestion, CompanyResearch
from interview_planner_prompts import (
    # Configuration
    INTERVIEW_PLANNER_MODEL_ID,
    INTERVIEW_PLANNER_REGION,
    TEMPERATURE_SUMMARIZATION,
    TEMPERATURE_GENERATION,
    RESUME_SUMMARY_SYSTEM_PROMPT,
    RESUME_SUMMARY_USER_PROMPT,
    JD_SUMMARY_SYSTEM_PROMPT,
    JD_SUMMARY_USER_PROMPT_TEMPLATE,
    get_interview_plan_system_prompt,
    get_interview_plan_user_prompt,
)
from config.feature_flags import feature_flags
from services.memory_service import MemoryService

logger = logging.getLogger(__name__)


class InterviewPlannerService:
    """
    Service that creates interview preparation plans:
    1. Summarizes resume using LLM (no tools)
    2. Summarizes job description using LLM (no tools)
    3. Researches company using web search
    4. Generates interview questions with expected answers
    """

    def __init__(self, model_id: str = None, region_name: str = None):
        # Use configuration from prompts.py, with environment variable override, then fallback to prompts default
        self.model_id = model_id or INTERVIEW_PLANNER_MODEL_ID
        self.region_name = region_name or INTERVIEW_PLANNER_REGION
        logger.info(
            f"InterviewPlannerService using ModelId:{self.model_id} in region: {self.region_name}"
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
            # Create Bedrock model
            bedrock_model = BedrockModel(
                model_id=self.model_id,
                temperature=TEMPERATURE_SUMMARIZATION,
                region_name=self.region_name,
                boto_client_config=retry_config,
            )

            # Create agent without tools for summarization
            agent = Agent(
                model=bedrock_model,
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
            # Create Bedrock model
            bedrock_model = BedrockModel(
                model_id=self.model_id,
                temperature=TEMPERATURE_SUMMARIZATION,
                region_name=self.region_name,
                boto_client_config=retry_config,
            )

            # Create agent without tools for summarization
            agent = Agent(
                model=bedrock_model,
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
        Generate interview preparation plan with web research and questions.

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
            # Create Bedrock model
            bedrock_model = BedrockModel(
                model_id=self.model_id,
                temperature=TEMPERATURE_GENERATION,
                region_name=self.region_name,
                boto_client_config=retry_config,
            )

            # Select web search tool based on feature flag
            use_nova_grounding = feature_flags.get("USE_NOVA_GROUNDING", False)
            web_search_tool = (
                nova_grounding_search if use_nova_grounding else ddg_search
            )

            search_method = "Nova Grounding" if use_nova_grounding else "DuckDuckGo"
            logger.info(f"Using {search_method} for web search")

            # Create agent WITH web search tool
            # Note: The Strands Agent framework automatically handles parallel tool execution
            # when the LLM determines multiple searches are needed (e.g., company info + recent news).
            # The agent will make multiple calls to the web_search_tool with different queries as needed.
            agent = Agent(
                model=bedrock_model,
                tools=[web_search_tool],  # Web search tool (DDG or Nova Grounding)
                system_prompt=get_interview_plan_system_prompt(
                    interview_type, difficulty, question_count
                ),
                hooks=[bedrock_retry_handler],
            )

            # Build research prompt with user memory
            research_prompt = get_interview_plan_user_prompt(
                resume_summary=resume_summary,
                jd_summary=jd_summary,
                company_name=company_name,
                interview_type=interview_type,
                question_count=question_count,
                difficulty=difficulty,
                custom_questions=custom_questions,
                user_memory=user_memory,
            )

            # Invoke agent
            response = await agent.invoke_async(research_prompt)
            logger.info("Interview plan generation completed")

            # Parse JSON response
            response_text = str(response)

            # Try to extract JSON if wrapped in markdown
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()
            elif "```" in response_text:
                json_start = response_text.find("```") + 3
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()

            # Parse JSON
            plan_data = json.loads(response_text)

            # Validate and create InterviewPlan
            interview_plan = InterviewPlan(**plan_data)

            return interview_plan

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON response: {e}")
            logger.error(f"Response text: {response_text}")

            # Return a fallback plan
            return InterviewPlan(
                companyResearch=CompanyResearch(companyName=company_name),
                questions=[
                    InterviewQuestion(
                        questionId="error",
                        category="general",
                        questionText="Error generating questions - please try again",
                        expectedAnswer="N/A",
                        difficulty="medium",
                        reasoning="JSON parsing failed",
                    )
                ],
                preparationTips=["Please try generating the plan again"],
                totalQuestions=0,
            )

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
