from pydantic import BaseModel, Field, create_model
import inspect
import logging
import os
from services.database_service import LocalDBService
from interview_session_memory import get_session_memory
import json

logger = logging.getLogger("toolList")

STACK_PREFIX = os.environ["STACK_NAME"]
print(f"STACK_PREFIX: {STACK_PREFIX}")
STACK_SUFFIX = os.environ["STACK_ENVIRONMENT"]
print(f"STACK_SUFFIX: {STACK_SUFFIX}")
db = LocalDBService(
    profile_name=None, stack_prefix=STACK_PREFIX, stack_suffix=STACK_SUFFIX
)


def bedrock_tool(name, description):
    def decorator(func):
        input_model = create_model(
            func.__name__ + "_input",
            **{
                name: (param.annotation, param.default)
                for name, param in inspect.signature(func).parameters.items()
                if param.default is not inspect.Parameter.empty
            },
        )

        func.bedrock_schema = {
            "toolSpec": {
                "name": name,
                "description": description,
                "inputSchema": {"json": input_model.schema()},
            }
        }
        return func

    return decorator


class ToolsList:
    @bedrock_tool(
        name="get_next_interview_question",
        description="Get the next interview question to ask the candidate",
    )
    def get_next_interview_question(
        self,
        sessionId: str = Field(..., description="sessionId of the current interview"),
    ):
        """
        Get the next interview question from the session plan.
        Returns empty string if all questions completed.
        """
        try:
            print(f"Getting next question for session {sessionId}")
            memory = get_session_memory(sessionId)
            print(f"Memory: {memory}")
            next_question = memory.get_next_question()
            print(f"Next question: {next_question}")

            if next_question is None:
                return "No more questions."  # All questions completed

            return next_question

        except Exception as e:
            logger.error(f"Error getting next question: {e}")
            return ""

    @bedrock_tool(
        name="get_interview_context",
        description="Get complete interview plan and current progress for conversation flow",
    )
    def get_interview_context(
        self,
        sessionId: str = Field(..., description="sessionId of the current interview"),
    ):
        """
        Get full interview context including all questions, progress, and current state.
        Use this to understand what's been covered and what's next.
        """
        try:
            print(f"Getting interview context for session {sessionId}")
            memory = get_session_memory(sessionId)
            print(f"Memory: {memory}")
            context = memory.get_full_context()
            print(f"Context: {context}")

            # Return formatted context
            return json.dumps(context, indent=2)

        except Exception as e:
            logger.error(f"Error getting interview context: {e}")
            return "{}"

    @bedrock_tool(
        name="conduct_interview_turn",
        description="Manage interview flow: evaluate last answer, provide feedback, and return next question or follow-up",
    )
    def conduct_interview_turn(
        self,
        sessionId: str = Field(..., description="Session ID of the current interview"),
        candidateResponse: str = Field(
            None, description="Candidate's last response (if any)"
        ),
    ) -> str:
        """
        Handles one interview turn using the same agent logic as Smart Mode.
        Evaluates response, generates tips, and decides on follow-up or next question.

        Returns only the question text that Nova Sonic will speak.
        The candidate tip is handled separately via candidateTip event in s2s_session_manager.

        Delegates to live_practice_service.evaluate_and_get_next_question()
        """
        try:
            from live_practice_service import evaluate_and_get_next_question

            # Call the service function that uses SMART_MODE_AGENT_PROMPT
            result = evaluate_and_get_next_question(
                session_id=sessionId, candidate_response=candidateResponse
            )

            question = result.get("question", "")
            tip = result.get("tip", "None")
            is_followup = result.get("isFollowUp", False)

            logger.info(
                f"Interview turn result: question={question[:50]}..., tip={tip}, followUp={is_followup}"
            )

            # Return only the question text (Nova Sonic will speak this)
            # The tip is sent separately via candidateTip event
            return question

        except Exception as e:
            logger.error(f"Error in conduct_interview_turn: {e}")
            import traceback

            logger.error(traceback.format_exc())

            # Return safe default question
            return "Can you tell me more about that?"
