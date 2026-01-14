"""
Interview Analysis Service
Analyzes interview practice sessions and provides structured feedback
"""

import json
import logging
import os
import time
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError
from strands import Agent
from strands.models import BedrockModel
from interview_analysis_models import InterviewAnalysis
from interview_analysis_prompts import (
    INTERVIEW_ANALYSIS_SYSTEM_PROMPT,
    ANALYSIS_MODEL_ID,
    ANALYSIS_REGION,
    ANALYSIS_TEMPERATURE,
)
from services.database_service import LocalDBService

from utils.retry_utils import retry_config, bedrock_retry_handler

logger = logging.getLogger(__name__)

# Retry configuration for transient Bedrock failures
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 1  # seconds
MAX_RETRY_DELAY = 32  # seconds
EXPONENTIAL_BASE = 2


class InterviewAnalysisService:
    """Service for analyzing interview practice sessions"""

    def __init__(
        self,
        model_id: str = None,
        region_name: str = None,
        temperature: float = None,
        db_service: LocalDBService = None,
        max_retries: int = MAX_RETRIES,
    ):
        self.model_id = model_id or ANALYSIS_MODEL_ID
        self.region_name = region_name or ANALYSIS_REGION

        logger.info(
            f"InterviewAnalysisService using ModelId:{self.model_id} in region: {self.region_name}"
        )

        self.temperature = temperature or ANALYSIS_TEMPERATURE
        self.db_service = db_service or LocalDBService(
            stack_prefix=os.environ.get("STACK_NAME", "sonic-int"),
            stack_suffix=os.environ.get("STACK_ENVIRONMENT", "dev"),
            profile_name=os.environ.get("AWS_PROFILE"),
        )
        self.max_retries = max_retries

    def _is_transient_error(self, error: Exception) -> bool:
        """Check if error is transient and should be retried"""
        if isinstance(error, ClientError):
            error_code = error.response.get("Error", {}).get("Code", "")
            return error_code in [
                "serviceUnavailableException",
                "ThrottlingException",
                "RequestLimitExceededException",
                "InternalServerException",
            ]
        return False

    def _calculate_backoff_delay(self, attempt: int) -> float:
        """Calculate exponential backoff delay with jitter"""
        delay = min(INITIAL_RETRY_DELAY * (EXPONENTIAL_BASE**attempt), MAX_RETRY_DELAY)
        # Add small jitter to prevent thundering herd
        # Using random for timing jitter is acceptable (not cryptographic)
        import random  # nosec B311

        jitter = random.uniform(0, delay * 0.1)  # nosec B311
        return delay + jitter

    async def analyze_interview_session(
        self,
        session_id: str,
        user_id: str,
        prep_id: Optional[str],
        transcription: list,
        duration: int,
    ) -> InterviewAnalysis:
        """
        Analyze an interview practice session with retry logic.

        Args:
            session_id: Session identifier
            user_id: User identifier
            prep_id: Preparation plan ID (if available)
            transcription: List of conversation messages
            duration: Session duration in seconds

        Returns:
            InterviewAnalysis with structured feedback
        """
        try:
            logger.info(f"Starting interview analysis for session: {session_id}")

            # Validate input
            if not transcription:
                logger.warning(f"Empty transcription for session {session_id}")
            if duration <= 0:
                logger.warning(f"Invalid duration {duration} for session {session_id}")

            # Load preparation data if available
            preparation_data = None
            if prep_id:
                preparation_data = self._load_preparation_data(user_id, prep_id)

            # Create analysis prompt
            analysis_prompt = self._build_analysis_prompt(
                transcription=transcription,
                preparation_data=preparation_data,
                duration=duration,
            )

            # Attempt analysis with retry logic
            analysis = await self._invoke_analysis_with_retry(analysis_prompt)

            logger.info(f"Analysis completed successfully for session: {session_id}")
            logger.info(f"Overall score: {analysis.overall_score}/10")

            return analysis

        except Exception as e:
            logger.error(f"Error analyzing interview session {session_id}: {e}")
            raise

    async def _invoke_analysis_with_retry(
        self, analysis_prompt: str
    ) -> InterviewAnalysis:
        """Invoke analysis with exponential backoff retry logic"""
        last_exception = None

        for attempt in range(self.max_retries):
            try:
                logger.info(
                    f"Invoking analysis agent (attempt {attempt + 1}/{self.max_retries})..."
                )

                # Create Bedrock model
                bedrock_model = BedrockModel(
                    model_id=self.model_id,
                    temperature=self.temperature,
                    region_name=self.region_name,
                    boto_client_config=retry_config,
                )

                # Create agent without tools (analysis only)
                agent = Agent(
                    model=bedrock_model,
                    tools=[],
                    system_prompt=INTERVIEW_ANALYSIS_SYSTEM_PROMPT,
                    hooks=[bedrock_retry_handler],
                )

                # Get structured output
                analysis = agent.structured_output(InterviewAnalysis, analysis_prompt)

                return analysis

            except Exception as e:
                last_exception = e

                if self._is_transient_error(e):
                    if attempt < self.max_retries - 1:
                        backoff_delay = self._calculate_backoff_delay(attempt)
                        logger.warning(
                            f"Transient error on attempt {attempt + 1}: {e}. "
                            f"Retrying in {backoff_delay:.2f} seconds..."
                        )
                        time.sleep(backoff_delay)
                        continue
                    else:
                        logger.error(f"Failed after {self.max_retries} attempts: {e}")
                        raise
                else:
                    # Non-transient error, fail immediately
                    logger.error(f"Non-transient error, failing immediately: {e}")
                    raise

        # This should not be reached, but just in case
        raise last_exception or Exception("Analysis failed after all retries")

    def _load_preparation_data(
        self, user_id: str, prep_id: str
    ) -> Optional[Dict[str, Any]]:
        """Load preparation data from DynamoDB"""
        try:
            # Query the preparation data from DynamoDB via db_service
            prep_data = self.db_service.session_prep_table.get_item(
                Key={"userId": user_id, "itemId": f"PLAN#{prep_id}"}
            )

            if "Item" in prep_data:
                logger.info(
                    f"Loaded preparation data from DynamoDB for prep_id: {prep_id}"
                )
                return prep_data["Item"]

            logger.warning(
                f"No preparation data found in DynamoDB for prep_id: {prep_id}"
            )
            return None

        except Exception as e:
            logger.error(f"Error loading preparation data from DynamoDB: {e}")
            import traceback

            logger.error(f"Traceback: {traceback.format_exc()}")
            return None

    def _build_analysis_prompt(
        self,
        transcription: list,
        preparation_data: Optional[Dict[str, Any]],
        duration: int,
    ) -> str:
        """Build the analysis prompt with all context"""

        # Format transcription
        conversation_text = self._format_transcription(transcription)

        # Format preparation data if available
        preparation_text = ""
        if preparation_data:
            preparation_text = self._format_preparation_data(preparation_data)

        # Build prompt
        prompt = f"""Analyze this interview practice session and provide structured feedback.

SESSION INFORMATION:
- Duration: {duration} seconds ({duration // 60} minutes)
- Total messages: {len(transcription)}

"""

        if preparation_text:
            prompt += f"""PREPARED INTERVIEW PLAN:
{preparation_text}

"""

        prompt += f"""ACTUAL INTERVIEW CONVERSATION:
{conversation_text}

ANALYSIS TASK:
Evaluate this interview practice session using the 5 evaluation criteria (Content Quality, Communication, Preparation Alignment, Depth & Detail, Confidence & Engagement).

For each criterion:
1. Assign a score from 1-10
2. Provide specific feedback
3. List 2-3 strengths observed
4. List 2-3 suggestions for improvement

Then provide:
- Overall score (1-10)
- Top 3-5 key strengths across the entire interview
- Top 3-5 priority areas for improvement
- A concise 2-3 sentence summary

Be constructive, specific, and actionable in your feedback."""

        return prompt

    def _format_transcription(self, transcription: list) -> str:
        """Format transcription for analysis"""
        formatted = []
        for i, msg in enumerate(transcription, 1):
            role = msg.get("role", "UNKNOWN")
            content = msg.get("content", "")
            formatted.append(f"[{i}] {role}: {content}")

        return "\n\n".join(formatted)

    def _format_preparation_data(self, prep_data: Dict[str, Any]) -> str:
        """Format preparation data for analysis"""
        formatted = []

        # Company and job info
        company_name = prep_data.get("companyName", "N/A")
        job_title = prep_data.get("jobTitle", "N/A")
        interview_type = prep_data.get("interviewType", "N/A")

        formatted.append(f"Company: {company_name}")
        formatted.append(f"Job Title: {job_title}")
        formatted.append(f"Interview Type: {interview_type}")
        formatted.append("")

        # Questions and expected answers
        questions = prep_data.get("questions", [])
        if questions:
            formatted.append("PREPARED QUESTIONS & EXPECTED ANSWERS:")
            for i, q in enumerate(questions, 1):
                question_text = q.get("questionText", "N/A")
                expected_answer = q.get("expectedAnswer", "")
                category = q.get("category", "General")

                formatted.append(f"\nQ{i} [{category}]: {question_text}")
                if expected_answer:
                    formatted.append(f"Expected Answer: {expected_answer}")

        return "\n".join(formatted)


# Async function to run analysis in background
async def analyze_session_async(
    user_id: str,
    session_id: str,
    prep_id: Optional[str],
    transcription: list,
    duration: int,
    max_retries: int = MAX_RETRIES,
):
    """
    Run interview analysis asynchronously and save results to DynamoDB.
    This is called in the background after session save.

    Args:
        user_id: User identifier
        session_id: Session identifier
        prep_id: Preparation plan ID (if available)
        transcription: List of conversation messages
        duration: Session duration in seconds
        max_retries: Maximum number of retries for transient failures
    """
    try:
        logger.info(f"Background analysis started for session: {session_id}")

        # Create analysis service with database service
        db_service = LocalDBService(
            stack_prefix=os.environ.get("STACK_NAME", "sonic-int"),
            stack_suffix=os.environ.get("STACK_ENVIRONMENT", "dev"),
            profile_name=os.environ.get("AWS_PROFILE"),
        )
        service = InterviewAnalysisService(
            db_service=db_service, max_retries=max_retries
        )

        # Perform analysis with retry logic
        analysis = await service.analyze_interview_session(
            session_id=session_id,
            user_id=user_id,
            prep_id=prep_id,
            transcription=transcription,
            duration=duration,
        )

        # Save analysis results to DynamoDB
        analysis_dict = analysis.model_dump()
        db_service.save_interview_analysis(
            user_id=user_id, session_id=session_id, analysis_data=analysis_dict
        )

        logger.info(
            f"Analysis saved successfully to DynamoDB for session: {session_id}"
        )
        logger.info(f"Overall score: {analysis.overall_score}/10")

    except Exception as e:
        logger.error(f"Background analysis failed for session {session_id}: {e}")
        import traceback

        logger.error(traceback.format_exc())
