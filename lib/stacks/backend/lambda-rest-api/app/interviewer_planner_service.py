"""Interviewer Planner Service - Generates interview plans for interviewers conducting interviews"""

import json
import logging
import os
import re
from typing import Dict, Any, Optional, List
import boto3
from utils.retry_utils import retry_config, bedrock_retry_handler
from strands import Agent, tool
from strands_tools import calculator
from strands.models import BedrockModel
from interview_planner_models import (
    
    InterviewQuestion,
    InterviewerPlan,
    JobDetails,
    QuestionsResponse,
    ParsedQuestion,
    ParsedQuestionsResponse,
    ValidatedQuestionsResponse,
)
from interviewer_planner_prompts import (
    # Configuration
    INTERVIEW_PLANNER_MODEL_ID,
    INTERVIEW_PLANNER_SUMMARIZE_MODEL_ID,
    INTERVIEW_PLANNER_REGION,
    TEMPERATURE_SUMMARIZATION,
    TEMPERATURE_GENERATION,
    MAX_TOKENS_SUMMARIZATION,
    MAX_TOKENS_GENERATION,
    # Prompts
    RESUME_SUMMARY_SYSTEM_PROMPT,
    RESUME_SUMMARY_USER_PROMPT,
    JD_SUMMARY_SYSTEM_PROMPT,
    JD_SUMMARY_USER_PROMPT_TEMPLATE,
    # Multi-step prompts (Phase 2)
    EXTRACTION_SYSTEM_PROMPT,
    get_extraction_user_prompt,
    KB_QUERY_EXTRACTION_SYSTEM_PROMPT,
    QUESTION_SELECTION_SYSTEM_PROMPT,
    get_question_selection_user_prompt,
    PARSE_QUESTIONS_SYSTEM_PROMPT,
    get_parse_questions_user_prompt,
)

logger = logging.getLogger(__name__)



class InterviewerPlannerService:
    """
    Service that creates interview plans for interviewers:
    1. Summarizes resume using LLM (no tools)
    2. Summarizes job description using LLM (no tools)
    3. Generates structured interview plan with question flow (no web search)
    """

    def __init__(self, model_id: str = None, region_name: str = None):
        # Use configuration from prompts.py, with environment variable override, then fallback to prompts default
        self.interview_planner_model_id = model_id or INTERVIEW_PLANNER_MODEL_ID
        self.interview_planner_summarize_model_id = INTERVIEW_PLANNER_SUMMARIZE_MODEL_ID
        self.region_name = region_name or INTERVIEW_PLANNER_REGION

        # Create reusable BedrockModel instances with max_tokens limits
        self.bedrock_summarize_model = BedrockModel(
            model_id=self.interview_planner_summarize_model_id,
            temperature=TEMPERATURE_SUMMARIZATION,
            region_name=self.region_name,
            boto_client_config=retry_config,
            max_tokens=MAX_TOKENS_SUMMARIZATION,
        )

        # Model WITHOUT reasoning (for simple steps: KB query, time validation, assembly)
        self.bedrock_interview_plan_model = BedrockModel(
            model_id=self.interview_planner_model_id,
            temperature=TEMPERATURE_GENERATION,
            region_name=self.region_name,
            boto_client_config=retry_config,
            max_tokens=MAX_TOKENS_GENERATION,
        )

        # Model WITH reasoning (for Step 2A: question selection)
        self.bedrock_interview_plan_model_reasoning = BedrockModel(
            model_id=self.interview_planner_model_id,
            additional_request_fields={
                "reasoningConfig": {
                    "type": "enabled",
                    "maxReasoningEffort": "high"  # High reasoning for selection logic
                }
            },
            region_name=self.region_name,
            boto_client_config=retry_config,
        )

        # Initialize Bedrock Agent Runtime client for Knowledge Base queries
        self.knowledge_base_id = os.environ.get("KNOWLEDGE_BASE_ID")
        self.bedrock_agent_runtime_client = boto3.client(
            "bedrock-agent-runtime", region_name=self.region_name, config=retry_config
        )

        logger.info(
            f"InterviewerPlannerService initialized:"
        )
        logger.info(
            f"  - Summarize model: {self.interview_planner_summarize_model_id} (temp={TEMPERATURE_SUMMARIZATION}, max_tokens={MAX_TOKENS_SUMMARIZATION})"
        )
        logger.info(
            f"  - Standard model: {self.interview_planner_model_id} (temp={TEMPERATURE_GENERATION}, max_tokens={MAX_TOKENS_GENERATION})"
        )
        logger.info(
            f"  - Reasoning model: {self.interview_planner_model_id} reasoning=high)"
        )
        logger.info(f"  - Region: {self.region_name}")

        if self.knowledge_base_id:
            logger.info(f"  - Knowledge Base ID: {self.knowledge_base_id}")
        else:
            logger.warning("  - KNOWLEDGE_BASE_ID not set - KB queries will be disabled")

    def _calculate_total_time(self, questions: List[Any]) -> float:
        """
        Calculate total interview time in minutes from question estimatedTime fields.

        Parses time strings like:
        - "5 minutes" -> 5
        - "10-12 minutes" -> 11 (average)
        - "30-40 minutes" -> 35 (average)

        Returns total in minutes (float).
        """
        import re

        total = 0.0
        for q in questions:
            time_str = (
                q.estimatedTime
                if hasattr(q, "estimatedTime")
                else q.get("estimatedTime", "")
            )
            if not time_str:
                continue

            # Extract numbers from time string
            numbers = re.findall(r"\d+", time_str)
            if not numbers:
                continue

            if len(numbers) == 1:
                # Single number: "5 minutes"
                total += float(numbers[0])
            else:
                # Range: "10-12 minutes" -> take average
                total += (float(numbers[0]) + float(numbers[1])) / 2

        return total

    @tool
    def query_knowledge_base(
        self, query: str, category: Optional[str] = None, max_results: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Query Bedrock Knowledge Base for relevant interview questions.

        Args:
            query: Search query (e.g., combination of resume, JD, interview type)
            category: Optional category filter (e.g., "Technical Skills", "Behavioral")
            max_results: Maximum number of results to return (default: 10)

        Returns:
            List of question dictionaries with text, metadata, and score
        """
        logger.info("=" * 80)
        logger.info(
            "🔍 [KB TOOL INVOKED] query_knowledge_base tool was called by agent!"
        )
        logger.info(f"🔍 [KB TOOL INVOKED] Query: {query}")
        logger.info(f"🔍 [KB TOOL INVOKED] Category: {category}")
        logger.info(f"🔍 [KB TOOL INVOKED] Max results: {max_results}")
        logger.info("=" * 80)

        if not self.knowledge_base_id:
            logger.warning(
                "⚠️ [KB TOOL] Knowledge Base ID not configured - returning empty results"
            )
            logger.warning(
                f"⚠️ [KB TOOL] KNOWLEDGE_BASE_ID env var: {os.environ.get('KNOWLEDGE_BASE_ID', 'NOT SET')}"
            )
            return []

        try:
            # Build retrieval configuration
            retrieval_config = {
                "vectorSearchConfiguration": {"numberOfResults": max_results}
            }

            # Add metadata filter if category is provided

            # Map interview types to KB categories (must match frontend InterviewerNew.jsx values)
            category_map = {
                "technical": "Technical Skills",
                "behavioral": "Behavioral",
                "system_design": "System Design",
                "phone_screening": "Behavioral",  # Phone screening questions are typically behavioral
                "case": "Technical Skills",  # Case interviews are technical problem-solving
                "general": None,  # General interviews search without category filter
            }
            category_filter = category_map.get(category.lower() if category else None)

            # Use "in" operator to match AWS Console behavior (category : ["Technical Skills"])
            # Only apply filter if category mapping succeeded and returned a valid value
            if category and category_filter:
                retrieval_config["vectorSearchConfiguration"]["filter"] = {
                    "in": {
                        "key": "category",
                        "value": [
                            category_filter
                        ],  # Value must be a list for "in" operator
                    }
                }
                logger.info(
                    f'🔍 [KB Query] Category filter applied using "in" operator: {category} -> {category_filter}'
                )
            elif category and not category_filter:
                logger.info(
                    f'🔍 [KB Query] Category "{category}" mapped to no filter (searching all categories)'
                )

            # Log the exact query and configuration
            logger.info(f"🔍 [KB Query] Knowledge Base ID: {self.knowledge_base_id}")
            logger.info(f'🔍 [KB Query] Query text: "{query}"')
            logger.info(
                f"🔍 [KB Query] Retrieval config: {json.dumps(retrieval_config, indent=2)}"
            )

            # Query the knowledge base using Retrieve API
            logger.info(
                "🔍 [KB Query] Calling bedrock_agent_runtime_client.retrieve()..."
            )
            response = self.bedrock_agent_runtime_client.retrieve(
                knowledgeBaseId=self.knowledge_base_id,
                retrievalQuery={"text": query},
                retrievalConfiguration=retrieval_config,
            )
            logger.info(
                f"🔍 [KB Query] Retrieve API responded with {len(response.get('retrievalResults', []))} results"
            )

            # Parse and return results
            results = []
            for idx, result in enumerate(response.get("retrievalResults", [])):
                question_data = {
                    "text": result.get("content", {}).get("text", ""),
                    "score": result.get("score", 0.0),
                    "metadata": result.get("metadata", {}),
                    "location": result.get("location", {}),
                }
                results.append(question_data)

                # Log first 3 results in detail
                if idx < 3:
                    logger.info(f"🔍 [KB Query] Result {idx + 1}:")
                    logger.info(f"  - Score: {question_data['score']}")
                    logger.info(f"  - Metadata: {question_data['metadata']}")
                    logger.info(f"  - Text preview: {question_data['text'][:200]}...")

            logger.info(f"✅ [KB Query] Returning {len(results)} results to agent")
            if results:
                # Log first result metadata for debugging
                logger.info(
                    f"📊 [KB Query] First result metadata: {results[0]['metadata']}"
                )
                logger.info(
                    f"📊 [KB Query] First result score: {results[0]['score']:.4f}"
                )

            return results

        except Exception as e:
            logger.error(f"Error querying Knowledge Base: {str(e)}", exc_info=True)
            return []

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
            logger.info(f"Resume summarization completed")

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
            # Calculate hash of JD text for verification (to detect if it changes unexpectedly)
            import hashlib

            jd_hash = hashlib.sha256(jd_text.encode()).hexdigest()[:16]

            # Log the incoming JD text for debugging
            logger.info(
                f"📄 [JD Summarization START] ========================================"
            )
            logger.info(
                f"📄 [JD Summarization] Method called with text length: {len(jd_text)} characters"
            )
            logger.info(f"📄 [JD Summarization] JD Hash (for verification): {jd_hash}")
            logger.info(f"📄 [JD Summarization] FULL JD TEXT:\n{jd_text}")
            logger.info(
                f"📄 [JD Summarization] ========================================"
            )

            # Log the system prompt being used
            logger.info(
                f"📄 [JD Summarization] System Prompt: {JD_SUMMARY_SYSTEM_PROMPT}"
            )

            # Create agent without tools for summarization
            agent = Agent(
                model=self.bedrock_summarize_model,
                tools=[],  # No tools needed for summarization
                system_prompt=JD_SUMMARY_SYSTEM_PROMPT,
                hooks=[bedrock_retry_handler],
            )

            logger.info(
                f"📄 [JD Summarization] Agent created with model: {self.interview_planner_summarize_model_id}"
            )

            # Create prompt
            prompt = JD_SUMMARY_USER_PROMPT_TEMPLATE.format(jd_text=jd_text)
            logger.info(f"📄 [JD Summarization] FULL User Prompt:\n{prompt}")
            logger.info(f"📄 [JD Summarization] Invoking Bedrock model...")

            # Invoke agent
            response = await agent.invoke_async(prompt)
            logger.info(f"📄 [JD Summarization] Bedrock response received")
            logger.info(
                f"📄 [JD Summarization] Raw Bedrock response type: {type(response)}"
            )
            logger.info(f"📄 [JD Summarization] Raw Bedrock response: {response}")

            # Log the JD summary result
            jd_summary = str(response)
            logger.info(f"📄 [JD Summarization] Generated summary (FULL): {jd_summary}")
            logger.info(
                f"📄 [JD Summarization END] ========================================"
            )

            return jd_summary

        except Exception as e:
            logger.error(f"📄 [JD Summarization ERROR] {e}", exc_info=True)
            return f"Error summarizing JD: {str(e)}"

    async def _extract_job_details(self, job_description: str) -> JobDetails:
        """
        Extract basic job details from raw JD (Step 1 of multi-step generation).

        This is a simple extraction task with a small schema, much easier for the model
        than generating the entire interview plan at once.

        Args:
            job_description: Raw job description text

        Returns:
            JobDetails object with company_name, position, industry
        """
        try:
            logger.info("📋 [Step 1] Extracting job details from JD...")

            # Create agent for extraction
            agent = Agent(
                model=self.bedrock_interview_plan_model,
                tools=[],  # No tools needed for simple extraction
                system_prompt=EXTRACTION_SYSTEM_PROMPT,
                hooks=[bedrock_retry_handler],
            )

            # Build extraction prompt
            extraction_prompt = get_extraction_user_prompt(job_description)

            logger.info(
                f"📋 [Step 1] Extraction prompt length: {len(extraction_prompt)} chars"
            )

            # Invoke agent with structured output
            job_details = await agent.structured_output_async(
                JobDetails, extraction_prompt
            )

            # Convert dict to JobDetails if needed
            if not isinstance(job_details, JobDetails):
                job_details = JobDetails(**job_details)

            logger.info(
                f"✅ [Step 1] Extracted details: Company={job_details.company_name}, "
                f"Position={job_details.position}, Industry={job_details.industry}"
            )

            return job_details

        except Exception as e:
            logger.error(
                f"❌ [Step 1] Error extracting job details: {e}", exc_info=True
            )
            # Return minimal job details as fallback
            return JobDetails(
                company_name="Unknown Company",
                position="Unknown Position",
                industry=None,
            )

    async def _step1_query_kb(
        self,
        resume_summary: str,
        jd_summary: str,
        job_details: JobDetails,
        interview_type: str,
    ) -> List[Dict[str, Any]]:
        """
        Step 2.1: Query Knowledge Base for relevant interview questions.

        Args:
            resume_summary: Summarized resume
            jd_summary: Summarized job description
            job_details: Job details extracted from JD
            interview_type: Interview type filter

        Returns:
            List of raw KB results (dicts with text, score, metadata)
        """
        try:
            logger.info("🔍 [Step 2.1] Building intelligent KB query...")
            logger.info(f"🔍 [Step 2.1] Interview type: {interview_type}")

            # Use LLM to extract key terms for targeted KB search
            # This ensures we retrieve questions relevant to THIS specific candidate and role

            # Simple prompt to extract key search terms
            extraction_prompt = f"""Analyze the candidate's resume and job description to extract key terms for interview question search.

CANDIDATE RESUME SUMMARY:
{resume_summary}

JOB DESCRIPTION SUMMARY:
{jd_summary}

POSITION: {job_details.position}
INTERVIEW TYPE: {interview_type}

Task: Extract 3-5 key technical skills, qualifications, or topics that should be the focus of {interview_type} interview questions for this candidate applying for this role.

Return only a comma-separated list of key terms (no explanations).
Example: "Python, REST APIs, AWS Lambda, microservices, system design"
"""

            # Use standard model to extract key terms
            agent = Agent(
                model=self.bedrock_interview_plan_model,
                tools=[],
                system_prompt=KB_QUERY_EXTRACTION_SYSTEM_PROMPT,
                hooks=[bedrock_retry_handler],
            )

            logger.info("🔍 [Step 2.1] Extracting key terms from resume and JD...")
            key_terms_result = await agent.invoke_async(extraction_prompt)
            key_terms = str(key_terms_result).strip()

            logger.info(f"🔍 [Step 2.1] Extracted key terms: {key_terms}")

            # Build targeted search query
            query = f"{interview_type} interview questions for {job_details.position} focusing on: {key_terms}"

            logger.info(f"🔍 [Step 2.1] Search query: {query[:200]}...")

            # Query KB with intelligent search
            kb_results = self.query_knowledge_base(
                query=query,
                category=interview_type,
                max_results=15,
            )

            logger.info(f"✅ [Step 2.1] Retrieved {len(kb_results)} questions from KB")
            return kb_results

        except Exception as e:
            logger.error(f"❌ [Step 2.1] Error querying KB: {e}", exc_info=True)
            return []

    async def _step2a_select_questions(
        self,
        kb_results: List[Dict[str, Any]],
        resume_summary: str,
        jd_summary: str,
        job_details: JobDetails,
        interview_type: str,
    ) -> List[Dict[str, Any]]:
        """
        Step 2.2A: Select 3-6 best questions from KB results (USES REASONING MODE).

        This step does selection AND generates reasoning for each selected question.
        Returns selected KB results with added "reasoning" field.

        Args:
            kb_results: Raw KB query results
            resume_summary: Summarized resume
            jd_summary: Summarized job description
            job_details: Job details
            interview_type: Interview type

        Returns:
            List of dicts with {kb_result, reasoning} for each selected question
        """
        try:
            logger.info("🧠 [Step 2.2A] Selecting questions (reasoning mode)...")

            # Generate selection prompt using centralized function
            selection_prompt = get_question_selection_user_prompt(
                kb_results=kb_results,
                resume_summary=resume_summary,
                jd_summary=jd_summary,
                job_details=job_details.model_dump(),  # Convert Pydantic model to dict
                interview_type=interview_type,
            )

            # Create agent with reasoning model + calculator
            agent = Agent(
                model=self.bedrock_interview_plan_model_reasoning,
                tools=[calculator],
                system_prompt=QUESTION_SELECTION_SYSTEM_PROMPT,
                hooks=[bedrock_retry_handler],
            )

            logger.info(f"🧠 [Step 2.2A] Selection prompt length: {len(selection_prompt)} chars")

            # Define Pydantic model for selection response
            from pydantic import BaseModel

            class QuestionSelection(BaseModel):
                result_number: int
                reasoning: str

            class SelectionResponse(BaseModel):
                selections: List[QuestionSelection]

            # Invoke agent with structured output
            selection_result = await agent.structured_output_async(
                SelectionResponse, selection_prompt
            )

            if not isinstance(selection_result, SelectionResponse):
                selection_result = SelectionResponse(**selection_result)

            logger.info(f"🧠 [Step 2.2A] Agent selected {len(selection_result.selections)} questions")

            # Build result list with KB results + reasoning
            selected_with_reasoning = []
            for selection in selection_result.selections:
                idx = selection.result_number - 1  # Convert to 0-indexed
                if 0 <= idx < len(kb_results):
                    selected_with_reasoning.append({
                        "kb_result": kb_results[idx],
                        "reasoning": selection.reasoning
                    })
                    text = kb_results[idx].get("text", "")[:80]
                    logger.info(f"  {selection.result_number}. {text}... | Reasoning: {selection.reasoning[:100]}...")

            logger.info(f"✅ [Step 2.2A] Selected {len(selected_with_reasoning)} questions with reasoning")

            return selected_with_reasoning

        except Exception as e:
            logger.error(f"❌ [Step 2.2A] Error selecting questions: {e}", exc_info=True)
            return []

    async def _step2b_parse_output(
        self,
        selected_kb_results: List[Dict[str, Any]],
    ) -> List[InterviewQuestion]:
        """
        Step 2.2B: Parse selected KB results into structured InterviewQuestion objects.

        This step uses an LLM to parse the markdown format from KB and extract all fields.

        Args:
            selected_kb_results: List of {kb_result, reasoning} dicts from Step 2.2A

        Returns:
            List of InterviewQuestion objects with all fields populated including reasoning
        """
        try:
            logger.info("📝 [Step 2.2B] Parsing KB results into structured questions...")

            # Extract just the KB results for parsing
            kb_results_only = [item["kb_result"] for item in selected_kb_results]

            # Build parsing prompt - ONLY for parsing markdown, not for selection
            parse_prompt = get_parse_questions_user_prompt(
                kb_results=kb_results_only
            )

            # Use standard model (not reasoning) for parsing
            agent = Agent(
                model=self.bedrock_interview_plan_model,
                tools=[],
                system_prompt=PARSE_QUESTIONS_SYSTEM_PROMPT,
                hooks=[bedrock_retry_handler],
            )

            logger.info(f"📝 [Step 2.2B] Parsing prompt length: {len(parse_prompt)} chars")

            # Invoke agent with structured output (returns ParsedQuestionsResponse)
            parsed_response = await agent.structured_output_async(
                ParsedQuestionsResponse, parse_prompt
            )

            # Convert dict to ParsedQuestionsResponse if needed
            if not isinstance(parsed_response, ParsedQuestionsResponse):
                parsed_response = ParsedQuestionsResponse(**parsed_response)

            logger.info(f"📝 [Step 2.2B] Parsed {len(parsed_response.questions)} questions from KB markdown")

            # Convert ParsedQuestion objects to InterviewQuestion objects
            # Add missing fields: questionId, reasoning (from Step 2.2A), source
            interview_questions = []

            for idx, parsed_q in enumerate(parsed_response.questions):
                # Create InterviewQuestion with all fields
                interview_q = InterviewQuestion(
                    questionId=f"q{idx + 1}",  # Generate sequential IDs
                    category=parsed_q.category,
                    questionText=parsed_q.questionText,
                    instructions=parsed_q.instructions,
                    expectedAnswer=parsed_q.expectedAnswer,
                    evaluationChecklist=parsed_q.evaluationChecklist,
                    estimatedTime=parsed_q.estimatedTime,
                    difficulty=parsed_q.difficulty,
                    reasoning=selected_kb_results[idx]["reasoning"] if idx < len(selected_kb_results) else "Selected from knowledge base",
                    source="question_bank",  # All questions from KB
                )
                interview_questions.append(interview_q)

                # Log each converted question
                logger.info(
                    f"  {idx + 1}. {interview_q.questionText[:80]}... "
                    f"| Time: {interview_q.estimatedTime} | Reasoning: {interview_q.reasoning[:60]}..."
                )

            logger.info(f"✅ [Step 2.2B] Converted {len(interview_questions)} questions to InterviewQuestion format with reasoning attached")

            return interview_questions

        except Exception as e:
            logger.error(f"❌ [Step 2.2B] Error parsing questions: {e}", exc_info=True)
            return []

    async def _step2c_validate_time(
        self,
        selected_questions: List[InterviewQuestion],
        max_duration: int = 60,
    ) -> ValidatedQuestionsResponse:
        """
        Step 2.2C: Validate total time and adjust if needed.

        SIMPLIFIED: Direct calculation without LLM (more reliable).

        Args:
            selected_questions: Questions from selection step
            max_duration: Maximum allowed duration in minutes

        Returns:
            ValidatedQuestionsResponse with validated questions and total time
        """
        try:
            logger.info("⏱️ [Step 2.2C] Validating total time...")
            logger.info(f"⏱️ [Step 2.2C] Max duration: {max_duration} minutes")

            # Calculate total time directly and validate estimatedTime fields
            total_time = 0.0
            questions_with_time = []
            import re

            for q in selected_questions:
                if not q.estimatedTime:
                    logger.warning(
                        f"⚠️ [Step 2.2C] Question missing estimatedTime: {q.questionText[:60]}..."
                    )
                    # Assign default time if missing
                    q.estimatedTime = "10 minutes"
                    time_val = 10.0
                else:
                    # Parse time string
                    numbers = re.findall(r"\d+", q.estimatedTime)
                    if len(numbers) == 1:
                        time_val = float(numbers[0])
                    elif len(numbers) > 1:
                        time_val = (float(numbers[0]) + float(numbers[1])) / 2
                    else:
                        logger.warning(
                            f"⚠️ [Step 2.2C] Could not parse time '{q.estimatedTime}' for question: {q.questionText[:60]}..."
                        )
                        q.estimatedTime = "10 minutes"
                        time_val = 10.0

                questions_with_time.append((q, time_val))
                total_time += time_val

            logger.info(f"⏱️ [Step 2.2C] Initial total time: {total_time} minutes")

            removed_questions = []

            # If over budget, remove longest questions until under budget
            if total_time > max_duration:
                logger.warning(
                    f"⚠️ [Step 2.2C] Total time {total_time} minutes exceeds {max_duration} minute limit"
                )

                # Sort by time (longest first)
                questions_with_time.sort(key=lambda x: x[1], reverse=True)

                # Remove longest questions until under budget
                remaining_questions = []
                cumulative_time = 0.0
                for q, time_val in questions_with_time:
                    if cumulative_time + time_val <= max_duration:
                        remaining_questions.append(q)
                        cumulative_time += time_val
                    else:
                        removed_questions.append(q.questionId)
                        logger.warning(
                            f"⚠️ [Step 2.2C] Removed question: {q.questionText[:60]}... ({time_val} min)"
                        )

                selected_questions = remaining_questions
                total_time = cumulative_time

                logger.info(
                    f"✅ [Step 2.2C] Reduced to {len(selected_questions)} questions, Total time: {total_time} minutes"
                )

            logger.info(
                f"✅ [Step 2.2C] Validated: {len(selected_questions)} questions, "
                f"Total time: {total_time} minutes"
            )

            return ValidatedQuestionsResponse(
                questions=selected_questions,
                totalTimeMinutes=total_time,
                removedQuestions=removed_questions,
            )

        except Exception as e:
            logger.error(f"❌ [Step 2.2C] Error validating time: {e}", exc_info=True)
            # Fallback: return selected questions as-is with calculated time
            total_time = self._calculate_total_time(selected_questions)
            return ValidatedQuestionsResponse(
                questions=selected_questions,
                totalTimeMinutes=total_time,
                removedQuestions=[],
            )

    async def _step3_assemble_output(
        self,
        validated_response: ValidatedQuestionsResponse,
    ) -> QuestionsResponse:
        """
        Step 2.3: Format and assemble final output.

        SIMPLIFIED: Direct model conversion (no LLM needed).

        Args:
            validated_response: Validated questions from Step 2.2B

        Returns:
            QuestionsResponse with formatted output
        """
        try:
            logger.info("📦 [Step 2.3] Assembling final output...")

            # Direct conversion - no LLM needed
            final_response = QuestionsResponse(
                questions=validated_response.questions,
                totalQuestions=len(validated_response.questions),
                totalTimeMinutes=validated_response.totalTimeMinutes,
            )

            logger.info(
                f"✅ [Step 2.3] Assembled final output: {final_response.totalQuestions} questions, "
                f"{final_response.totalTimeMinutes} minutes"
            )

            return final_response

        except Exception as e:
            logger.error(f"❌ [Step 2.3] Error assembling output: {e}", exc_info=True)
            # Fallback: manually create QuestionsResponse
            return QuestionsResponse(
                questions=validated_response.questions,
                totalQuestions=len(validated_response.questions),
                totalTimeMinutes=validated_response.totalTimeMinutes,
            )

    async def _generate_questions(
        self,
        resume_summary: str,
        jd_summary: str,
        job_details: JobDetails,
        interview_type: Optional[str],
        duration_minutes: int = 60,
    ) -> List[InterviewQuestion]:
        """
        Generate interview questions using 5-step multi-prompt approach.

        This method orchestrates:
        1. Step 2.1: Query Knowledge Base for candidate questions (LLM extracts terms + queries KB)
        2. Step 2.2A: Select 3-6 best questions (reasoning mode) - returns selected KB results
        3. Step 2.2B: Parse output - parses markdown to InterviewQuestion structures (LLM)
        4. Step 2.2C: Validate total time ≤ 60 minutes (Python calculation)
        5. Step 2.3: Format and assemble final output (Python conversion)

        Args:
            resume_summary: Summarized resume
            jd_summary: Summarized job description
            job_details: JobDetails from Step 1
            interview_type: Interview type (technical, behavioral, etc.)
            duration_minutes: Target interview duration

        Returns:
            List of selected InterviewQuestion objects
        """
        try:
            logger.info("🚀 [Multi-Step] Starting 5-step question generation...")
            logger.info(f"🚀 [Multi-Step] Interview type: {interview_type or 'general'}")
            logger.info(f"🚀 [Multi-Step] Duration: {duration_minutes} minutes")
            logger.info(f"🚀 [Multi-Step] KB ID: {self.knowledge_base_id or 'NOT SET'}")

            # Step 2.1: Query Knowledge Base (extracts key terms + queries)
            kb_results = await self._step1_query_kb(
                resume_summary=resume_summary,
                jd_summary=jd_summary,
                job_details=job_details,
                interview_type=interview_type or "general",
            )

            if not kb_results:
                logger.error("❌ [Multi-Step] No KB results returned, cannot proceed")
                return []

            # Step 2.2A: Select best questions (reasoning mode) - returns selected KB results + reasoning
            selected_with_reasoning = await self._step2a_select_questions(
                kb_results=kb_results,
                resume_summary=resume_summary,
                jd_summary=jd_summary,
                job_details=job_details,
                interview_type=interview_type or "general",
            )

            if not selected_with_reasoning:
                logger.error("❌ [Multi-Step] No questions selected, cannot proceed")
                return []

            # Step 2.2B: Parse output - convert KB results to InterviewQuestion structures + attach reasoning
            parsed_questions = await self._step2b_parse_output(
                selected_kb_results=selected_with_reasoning
            )

            if not parsed_questions:
                logger.error("❌ [Multi-Step] Failed to parse questions, cannot proceed")
                return []

            # Step 2.2C: Validate time (Python calculation)
            validated_response = await self._step2c_validate_time(
                selected_questions=parsed_questions,
                max_duration=duration_minutes,
            )

            # Step 2.3: Assemble final output (Python conversion)
            final_response = await self._step3_assemble_output(
                validated_response=validated_response,
            )

            # Auto-assign sequence order and renumber question IDs
            for index, question in enumerate(final_response.questions):
                question.sequenceOrder = index
                question.questionId = f"q{index + 1}"  # Renumber to q1, q2, q3, etc.

            logger.info(
                f"✅ [Multi-Step] Question generation complete: {final_response.totalQuestions} questions, "
                f"{final_response.totalTimeMinutes} minutes"
            )

            return final_response.questions

        except Exception as e:
            logger.error(f"❌ [Multi-Step] Error in question generation: {e}", exc_info=True)
            import traceback
            logger.error(f"❌ [Multi-Step] Traceback:\n{traceback.format_exc()}")
            return []

    def _assemble_final_plan(
        self,
        job_details: JobDetails,
        questions: List[InterviewQuestion],
        duration_minutes: int,
    ) -> InterviewerPlan:
        """
        Assemble the final InterviewerPlan from components (Step 3 of multi-step generation).

        This is a simple assembly step - no LLM needed, just combining the components.

        Args:
            job_details: JobDetails from Step 1
            questions: List of InterviewQuestion from Step 2
            duration_minutes: Target interview duration

        Returns:
            Complete InterviewerPlan object
        """
        try:
            logger.info("🎯 [Step 3] Assembling final interview plan...")

            # Create InterviewerPlan
            plan = InterviewerPlan(
                plan_id=None,  # Will be assigned by database layer
                company_name=job_details.company_name,
                position=job_details.position,
                industry=job_details.industry,
                interview_duration_minutes=duration_minutes,
                questions=questions,
                totalQuestions=len(questions),
            )

            logger.info(
                f"✅ [Step 3] Assembled plan: {plan.totalQuestions} questions, "
                f"duration: {plan.interview_duration_minutes} min"
            )

            return plan

        except Exception as e:
            logger.error(f"❌ [Step 3] Error assembling plan: {e}", exc_info=True)
            raise

    async def generate_interview_plan(
        self,
        resume_summary: str,
        jd_summary: str,
        job_details: JobDetails,
        interview_type: Optional[str] = None,
    ) -> InterviewerPlan:
        """
        Generate interview plan using multi-step generation.

        This method orchestrates Steps 2-3 of the multi-step pipeline:
        - Generate questions using KB retrieval and selection
        - Assemble final InterviewerPlan

        Args:
            resume_summary: Summarized resume
            jd_summary: Summarized job description
            job_details: JobDetails extracted from JD
            interview_type: Interview type (technical, behavioral, system_design, etc.)

        Returns:
            InterviewerPlan object with structured questions

        Raises:
            ValueError: If no questions generated
            NotImplementedError: If question_bank is provided (manual mode not supported)
        """
        try:
            logger.info("🚀 [Multi-Step] Generating interview plan...")

            # Generate questions with KB retrieval and selection
            questions = await self._generate_questions(
                resume_summary=resume_summary,
                jd_summary=jd_summary,
                job_details=job_details,
                interview_type=interview_type,
                duration_minutes=60,
            )

            # Assemble final plan
            if not questions:
                logger.error("❌ [Multi-Step] No questions generated")
                raise ValueError("Failed to generate interview questions")

            interview_plan = self._assemble_final_plan(
                job_details=job_details,
                questions=questions,
                duration_minutes=60,
            )

            logger.info("✅ [Multi-Step] Interview plan generated successfully")
            return interview_plan

        except Exception as e:
            logger.error(f"Error generating interview plan: {e}")
            raise

    async def create_interview_plan(
        self,
        resume_file_bytes: bytes,
        file_name: str,
        jd_text: str,
        interview_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Complete end-to-end interview plan generation workflow for interviewers.

        Args:
            resume_file_bytes: Resume file bytes
            file_name: Original filename
            jd_text: Job description text
            interview_type: Interview type (technical, behavioral, system_design, etc.)

        Returns:
            Dictionary with summaries and interview plan
        """
        logger.info(
            f"Starting interview plan generation for interviewer (interview_type: {interview_type})"
        )

        # Phase 0: Extract job details from raw JD
        logger.info("Phase 0: Extracting job details from JD...")
        job_details = await self._extract_job_details(jd_text)

        # Phase 1: Summarize resume
        logger.info("Phase 1: Summarizing resume...")
        resume_summary = await self.summarize_resume(resume_file_bytes, file_name)

        # Phase 2: Summarize JD
        logger.info("Phase 2: Summarizing job description...")
        jd_summary = await self.summarize_job_description(jd_text)

        # Phase 3: Generate interview plan with questions
        logger.info("Phase 3: Generating interview plan with questions...")
        interview_plan = await self.generate_interview_plan(
            resume_summary=resume_summary,
            jd_summary=jd_summary,
            job_details=job_details,
            interview_type=interview_type,
        )

        logger.info("Interview plan generation completed")

        return {
            "resumeSummary": resume_summary,
            "jdSummary": jd_summary,
            "interviewPlan": interview_plan.model_dump(),
        }
