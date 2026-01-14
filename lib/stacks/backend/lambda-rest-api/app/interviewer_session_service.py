"""Service for generating structured interview session summaries using LLM"""

import json
import logging
from typing import Optional, Dict, Any
from utils.retry_utils import retry_config, bedrock_retry_handler
from strands import Agent
from strands.models import BedrockModel

from interviewer_session_prompts import (
    get_session_summary_system_prompt,
    get_session_summary_user_prompt,
    INTERVIEWER_SESSION_MODEL_ID,
    INTERVIEWER_SESSION_REGION,
    TEMPERATURE,
)

# Initialize logger
logger = logging.getLogger("interviewer_session_service")


class InterviewerSessionService:
    """
    Service that generates structured interview assessments from transcripts.
    Uses LLM to analyze interview transcripts and create:
    - Summary (overall impression)
    - Interview Notes (detailed question-by-question analysis)
    - Competency assessment (strengths, skills)
    - Concerns (weaknesses, red flags)
    """

    def __init__(
        self,
        model_id: str = INTERVIEWER_SESSION_MODEL_ID,
        region: str = INTERVIEWER_SESSION_REGION,
    ):
        self.model_id = model_id
        self.region = region
        logger.info(
            f"InterviewerSessionService using ModelId:{self.model_id} in region: {self.region}"
        )

    async def generate_interview_summary(
        self,
        transcript: str,
        interview_plan: Optional[Dict] = None,
        interview_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate structured interview summary from transcript.

        Args:
            transcript: Full interview transcript text
            interview_plan: Optional interview plan with questions (from scheduled interview)
            interview_name: Optional interview/candidate name

        Returns:
            Dictionary with summary, interviewNotes, competency, and concern
        """
        try:
            logger.info("Generating interview summary from transcript")
            logger.info(f"Transcript length: {len(transcript)} characters")
            if interview_plan:
                logger.info(
                    f"Interview plan provided with {len(interview_plan.get('questions', []))} questions"
                )

            # Create Bedrock model
            bedrock_model = BedrockModel(
                model_id=self.model_id,
                region_name=self.region,
                temperature=TEMPERATURE,
                boto_client_config=retry_config,
            )

            # Create agent without tools (summary generation only)
            agent = Agent(
                model=bedrock_model,
                tools=[],
                system_prompt=get_session_summary_system_prompt(),
                hooks=[bedrock_retry_handler],
            )

            # Generate user prompt
            user_prompt = get_session_summary_user_prompt(
                transcript=transcript,
                interview_plan=interview_plan,
                interview_name=interview_name,
            )

            logger.info("Calling LLM to generate interview summary...")

            # Run agent
            response = await agent.invoke_async(user_prompt)
            logger.info("LLM response received")

            # Parse response
            response_text = str(response)
            logger.debug(f"Raw LLM response: {response_text[:500]}...")

            # Try to extract JSON from response
            try:
                # Remove markdown code blocks if present
                if "```json" in response_text:
                    start = response_text.find("```json") + 7
                    end = response_text.find("```", start)
                    response_text = response_text[start:end].strip()
                elif "```" in response_text:
                    start = response_text.find("```") + 3
                    end = response_text.find("```", start)
                    response_text = response_text[start:end].strip()

                summary_data = json.loads(response_text)
                logger.info("Successfully parsed interview summary JSON")

                # Validate required fields
                required_fields = ["summary", "interviewNotes", "competency", "concern"]
                for field in required_fields:
                    if field not in summary_data:
                        logger.warning(f"Missing required field: {field}")
                        summary_data[field] = self._get_default_value(field)

                return summary_data

            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse LLM response as JSON: {e}")
                logger.error(f"Response text: {response_text}")
                raise ValueError(f"Failed to parse interview summary: {str(e)}")

        except Exception as e:
            logger.error(f"Error generating interview summary: {e}")
            import traceback

            logger.error(traceback.format_exc())
            raise

    def _get_default_value(self, field: str) -> Any:
        """Get default value for missing fields"""
        defaults = {
            "summary": "Summary not available",
            "interviewNotes": "Interview notes not available",
            "competency": {"strengths": [], "technicalSkills": [], "softSkills": []},
            "concern": {"weaknesses": [], "redFlags": [], "areasForImprovement": []},
        }
        return defaults.get(field, {})
