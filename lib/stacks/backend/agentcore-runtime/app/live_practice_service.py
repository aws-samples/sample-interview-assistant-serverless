"""
Live Practice Service
Voice and audio configurations for speech-to-speech interview practice sessions
Model configurations and prompts are in live_practice_prompts.py
"""

import asyncio
import json
import os
import re
from pydantic import ValidationError
import logging
from typing import Dict, Any
from live_practice_models import InterviewAgentResponse, InterviewTurnResponse
from strands import Agent
from strands.models import BedrockModel
from utils.retry_utils import bedrock_retry_handler, retry_config


# Import prompts and model configurations
from live_practice_prompts import (
    DEFAULT_INFERENCE_CONFIG,
    LIVE_PRACTICE_SYSTEM_PROMPT,
    STRUCTURED_INTERVIEW_SYSTEM_PROMPT,
    SMART_MODE_INTERVIEW_SYSTEM_PROMPT,
    SMART_MODE_AGENT_PROMPT,
    SMART_MODE_MODEL_ID,
    SMART_MODE_INFERENCE_CONFIG,
    get_system_prompt,
    get_inference_config,
)


def strip_markdown_json(text: str) -> str:
    """
    Strip markdown code block wrappers from JSON text.

    Handles cases where LLMs return JSON wrapped in markdown:
    ```json
    { ... }
    ```

    Args:
        text: Text that may contain markdown-wrapped JSON

    Returns:
        Clean JSON string without markdown wrappers
    """
    if not text:
        return text

    # Remove markdown code block wrappers
    # Pattern: ```json\n{...}\n``` or ```\n{...}\n```
    text = text.strip()

    # Remove opening code block
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)

    # Remove closing code block
    text = re.sub(r"\n?```\s*$", "", text)

    return text.strip()


# Import web search tool for Smart Mode agent
from tools.web_search import ddg_search

logger = logging.getLogger(__name__)

# Available Voice Options for Nova Sonic
# Official list from AWS documentation
AVAILABLE_VOICES = {
    # English (US)
    "tiffany": {
        "name": "Tiffany",
        "language": "English (US)",
        "gender": "Feminine",
        "description": "Feminine-sounding US English voice",
    },
    "matthew": {
        "name": "Matthew",
        "language": "English (US)",
        "gender": "Masculine",
        "description": "Masculine-sounding US English voice",
    },
    # English (GB)
    "amy": {
        "name": "Amy",
        "language": "English (GB)",
        "gender": "Feminine",
        "description": "Feminine-sounding British English voice",
    },
    # French
    "ambre": {
        "name": "Ambre",
        "language": "French",
        "gender": "Feminine",
        "description": "Feminine-sounding French voice",
    },
    "florian": {
        "name": "Florian",
        "language": "French",
        "gender": "Masculine",
        "description": "Masculine-sounding French voice",
    },
    # Italian
    "beatrice": {
        "name": "Beatrice",
        "language": "Italian",
        "gender": "Feminine",
        "description": "Feminine-sounding Italian voice",
    },
    "lorenzo": {
        "name": "Lorenzo",
        "language": "Italian",
        "gender": "Masculine",
        "description": "Masculine-sounding Italian voice",
    },
    # German
    "greta": {
        "name": "Greta",
        "language": "German",
        "gender": "Feminine",
        "description": "Feminine-sounding German voice",
    },
    "lennart": {
        "name": "Lennart",
        "language": "German",
        "gender": "Masculine",
        "description": "Masculine-sounding German voice",
    },
    # Spanish
    "lupe": {
        "name": "Lupe",
        "language": "Spanish",
        "gender": "Feminine",
        "description": "Feminine-sounding Spanish voice",
    },
    "carlos": {
        "name": "Carlos",
        "language": "Spanish",
        "gender": "Masculine",
        "description": "Masculine-sounding Spanish voice",
    },
}

DEFAULT_VOICE = "matthew"

# Audio Input Configuration (from candidate)
AUDIO_INPUT_CONFIG = {
    "mediaType": "audio/lpcm",
    "sampleRateHertz": 16000,
    "sampleSizeBits": 16,
    "channelCount": 1,
    "audioType": "SPEECH",
    "encoding": "base64",
}


# Audio Output Configuration (to candidate)
def get_audio_output_config(voice_id=None):
    """Get audio output configuration with specified voice"""
    if voice_id is None:
        voice_id = DEFAULT_VOICE

    # Validate voice_id
    if voice_id not in AVAILABLE_VOICES:
        voice_id = DEFAULT_VOICE

    return {
        "mediaType": "audio/lpcm",
        "sampleRateHertz": 16000,
        "sampleSizeBits": 16,
        "channelCount": 1,
        "voiceId": voice_id,
        "encoding": "base64",
        "audioType": "SPEECH",
    }


# Default audio output config for backward compatibility
AUDIO_OUTPUT_CONFIG = get_audio_output_config()

# Tool Configuration (no tools for now)
TOOL_CONFIG = {"tools": []}


# ============================================
# Smart Mode - Agent Integration
# ============================================


def create_interview_agent(session_id: str, interview_context: Dict[str, Any] = None):
    """
    Create the Strands Agent for Smart Mode interview reasoning.

    Conversation history is persisted via interview_session_memory

    This agent handles:
    - Complex interview question analysis
    - Deep answer evaluation
    - Strategic follow-up question generation
    - Comprehensive feedback provision
    - Web research for fact-checking and latest information

    Args:
        session_id: Unique session identifier for persisting agent state
        interview_context: Interview plan and context (provided on each call)

    Returns:
        Agent instance configured for interview coaching
    """
    try:
        # Build system prompt with interview context (if provided)
        system_prompt = SMART_MODE_AGENT_PROMPT

        if interview_context:
            # Format interview context clearly for system prompt
            company = interview_context.get("company_name", "the company")
            job = interview_context.get("job_title", "this position")
            interview_type = interview_context.get("interview_type", "interview")
            questions = interview_context.get("questions", "")

            interview_plan_text = f"""

═══════════════════════════════════════════════════════════
YOUR INTERVIEW ASSIGNMENT FOR THIS SESSION
═══════════════════════════════════════════════════════════

You are representing: {company}
Position you're hiring for: {job}
Interview format: {interview_type}

QUESTIONS TO COVER (with expected answer criteria):
{questions}

INSTRUCTIONS:
1. Act as {company}'s interviewer for this {job} {interview_type}
2. Use the questions above as your guide, but adapt naturally to conversation
3. Each question includes expected answer criteria - use this to evaluate responses
4. Provide helpful coaching tips for each response
5. Don't rush - follow up when answers need more depth

You have the full interview plan. Begin naturally when the candidate joins.
═══════════════════════════════════════════════════════════
"""
            system_prompt = SMART_MODE_AGENT_PROMPT + interview_plan_text
            logger.info(
                f"Created agent as {company} interviewer for {job} role with {interview_context.get('total_questions', 0)} questions"
            )

        # Create Bedrock model with retry configuration for robustness
        bedrock_model = BedrockModel(
            model_id=SMART_MODE_MODEL_ID,
            temperature=SMART_MODE_INFERENCE_CONFIG.get("temperature", 0.7),
            region_name=os.getenv("AWS_REGION", "us-east-1"),
            boto_client_config=retry_config,  # Enable automatic retries for 50x errors
        )

        agent = Agent(
            model=bedrock_model,
            tools=[ddg_search],  # Web search for fact-checking and latest information
            system_prompt=system_prompt,
            hooks=[bedrock_retry_handler],
        )

        logger.info(
            f"Smart Mode interview agent created for session {session_id} (session history managed via DynamoDB)"
        )
        return agent

    except ImportError as e:
        logger.error(f"Failed to import strands: {e}")
        raise ImportError(
            "Strands library not available. Install with: pip install strands"
        )
    except Exception as e:
        logger.error(f"Failed to create interview agent: {e}")
        raise


def evaluate_and_get_next_question(
    session_id: str, candidate_response: str = None
) -> Dict[str, Any]:
    """
    Evaluate candidate response and return next question or follow-up (Light Mode).
    Uses SMART_MODE_AGENT_PROMPT with Strands SDK for consistent model invocation.

    Args:
        session_id: Session identifier
        candidate_response: Candidate's last response (if any)

    Returns:
        Dict with:
        - question: Next question or follow-up to ask
        - tip: Coaching tip for candidate (or None)
        - isFollowUp: Whether this is a follow-up question
        - questionNumber: Current question number
    """
    from interview_session_memory import get_session_memory
    import json

    try:
        memory = get_session_memory(session_id)
        full_context = memory.get_full_context()

        # Get interview context
        interview_context = full_context.get("interview_context", {})
        company = interview_context.get("company_name", "the company")
        job = interview_context.get("job_title", "this position")
        interview_type = interview_context.get("interview_type", "interview")

        # Get current question and progress
        current_question = memory.get_current_question()
        progress = memory.get_progress()
        questions_with_details = full_context.get("interview_plan", {}).get(
            "questions_with_details", []
        )

        # Format interview plan for prompt
        questions_text = ""
        for i, q in enumerate(questions_with_details, 1):
            questions_text += f"\nQuestion {i}: {q.get('questionText', '')}\n"
            questions_text += f"Expected Answer: {q.get('expectedAnswer', '')}\n"

        # Build system prompt with interview context
        system_prompt = (
            SMART_MODE_AGENT_PROMPT
            + f"""

YOUR INTERVIEW ASSIGNMENT FOR THIS SESSION
═══════════════════════════════════════════════════════════

You are representing: {company}
Position you're hiring for: {job}
Interview format: {interview_type}

QUESTIONS TO COVER (with expected answer criteria):
{questions_text}

INSTRUCTIONS:
1. Act as {company}'s interviewer for this {job} {interview_type}
2. Use the questions above as your guide, but adapt naturally to conversation
3. Each question includes expected answer criteria - use this to evaluate responses
4. Provide helpful coaching tips for each response
5. Don't rush - follow up when answers need more depth
"""
        )

        # Build user message based on context
        if candidate_response and current_question:
            user_message = f"""CURRENT QUESTION: {current_question}

CANDIDATE'S RESPONSE: {candidate_response}

Evaluate this response using STAR criteria. Decide whether to ask a follow-up question for more depth, or move to the next question."""
        else:
            user_message = "Begin the interview with the first question."

        # Create Bedrock model with Strands SDK
        bedrock_model = BedrockModel(
            model_id=SMART_MODE_MODEL_ID,
            temperature=SMART_MODE_INFERENCE_CONFIG.get("temperature", 0.5),
            region_name=os.getenv("AWS_REGION", "us-east-1"),
            boto_client_config=retry_config,  # Enable automatic retries
        )

        # Create agent without tools (just for evaluation)
        agent = Agent(
            model=bedrock_model,
            tools=[],  # No tools needed for evaluation
            system_prompt=system_prompt,
            hooks=[bedrock_retry_handler],
        )

        # Use structured output with Pydantic model for automatic parsing and validation
        response = agent.structured_output(
            output_model=InterviewTurnResponse, prompt=user_message
        )

        # Extract validated fields from Pydantic model
        what_to_say = response.what_to_say
        candidate_tip = response.candidate_tip

        # Store tip in memory
        if candidate_tip:
            memory.add_candidate_tip(candidate_tip)

        # Determine if follow-up or new question
        is_followup = bool(candidate_response and current_question)

        # If not a follow-up, mark complete and get next
        if candidate_response and not is_followup:
            memory.mark_question_complete()
            next_q = memory.get_next_question()
            if not next_q:
                what_to_say = "That completes our interview. Thank you!"
        elif not candidate_response:
            # First question
            first_q = memory.get_next_question()

        if is_followup:
            memory.increment_follow_up_count()

        return {
            "question": what_to_say,
            "tip": candidate_tip,
            "isFollowUp": is_followup,
            "questionNumber": progress.get("current_question_number", 0),
        }

    except Exception as e:
        logger.error(f"Error in evaluate_and_get_next_question: {e}")
        import traceback

        logger.error(traceback.format_exc())
        return {
            "question": "Can you tell me more about that?",
            "tip": None,
            "isFollowUp": False,
            "questionNumber": 0,
        }


def create_interview_agent_tool() -> Dict[str, Any]:
    """
    Create the agent tool definition for Nova Sonic integration.

    This wraps the Strands Agent as a tool that Nova Sonic can call
    for complex reasoning tasks in Smart Mode.

    Returns:
        Tool definition in Bedrock format
    """

    def _agent_tool_handler_sync(content: Dict[str, Any]) -> Dict[str, Any]:
        """
        Synchronous handler for agent tool invocations.
        This runs in a thread pool to avoid blocking the event loop.

        Args:
            content: Tool invocation parameters with sessionId

        Returns:
            Agent response in dict format
        """
        try:
            session_id = content.get("sessionId")

            if not session_id:
                return {"error": "Missing 'sessionId' parameter"}

            logger.info(f"Agent tool invoked for session: {session_id}")

            # Get session memory and context (replaces file system checks)
            from interview_session_memory import get_session_memory

            memory = get_session_memory(session_id)
            context = memory.get_full_context()

            # Determine if this is the first agent call by checking conversation history
            # If conversation_history is empty, this is the first call
            conversation_history = context.get("conversation_history", [])
            is_first_call = len(conversation_history) == 0

            logger.info(
                f"Session {session_id}: is_first_call={is_first_call}, conversation_messages={len(conversation_history)}"
            )

            # Prepare comprehensive interview context for system prompt
            # NOTE: Must include interview context on EVERY call, not just first call
            # Strands FileSessionManager only saves conversation history, not system prompt
            interview_context_info = context.get("interview_context", {})
            interview_plan = context.get("interview_plan", {})

            # Format questions with full details for agent
            questions_with_details = interview_plan.get("questions_with_details", [])
            formatted_questions = []
            for i, q in enumerate(questions_with_details, 1):
                formatted_q = f"""
Question {i} ({q.get("category", "general")} - {q.get("difficulty", "medium")}):
  Text: {q.get("questionText", "")}
  Expected Answer: {q.get("expectedAnswer", "")}
  Reasoning: {q.get("reasoning", "")}
"""
                formatted_questions.append(formatted_q.strip())

            interview_plan_context = {
                "company_name": interview_context_info.get(
                    "company_name", "the company"
                ),
                "job_title": interview_context_info.get("job_title", "this position"),
                "interview_type": interview_context_info.get(
                    "interview_type", "interview"
                ),
                "total_questions": interview_plan.get(
                    "total_questions", len(formatted_questions)
                ),
                "questions": "\n\n".join(formatted_questions)
                if formatted_questions
                else "No questions available",
                "preparation_details": context.get("preparation_details", {}),
            }

            logger.info(
                f"Passing interview context to agent: {interview_context_info.get('company_name')} - {interview_context_info.get('job_title')} ({interview_context_info.get('interview_type')}) with {len(formatted_questions)} detailed questions"
            )

            # Create agent with full interview context (every time, not just first call)
            agent = create_interview_agent(
                session_id, interview_context=interview_plan_context
            )

            if is_first_call:
                logger.info("First agent call - starting interview")
                # First call - signal that interview is starting
                request = "The candidate has joined the call."
            else:
                logger.info("Subsequent agent call - using existing agent session")

                # Get last turn from interview session memory
                # Strands session only saves Agent's own I/O, not the actual conversation
                conversation_history = context.get("conversation_history", [])

                # DEBUG: Log the full conversation history
                logger.info(
                    f"=== CONVERSATION HISTORY ({len(conversation_history)} messages) ==="
                )
                for i, msg in enumerate(conversation_history):
                    role = msg.get("role", "UNKNOWN")
                    content = msg.get("content", "")
                    logger.info(f"  [{i}] {role}: {content[:100]}...")
                logger.info("=== END CONVERSATION HISTORY ===")

                # Merge consecutive messages with same role (Nova Sonic splits messages into chunks)
                merged_history = []
                for msg in conversation_history:
                    role = msg.get("role")
                    content = msg.get("content", "")

                    # If last message in merged_history has same role, append content
                    if merged_history and merged_history[-1]["role"] == role:
                        merged_history[-1]["content"] += " " + content
                    else:
                        merged_history.append({"role": role, "content": content})

                logger.info(f"=== MERGED HISTORY ({len(merged_history)} messages) ===")
                for i, msg in enumerate(merged_history):
                    role = msg.get("role", "UNKNOWN")
                    content = msg.get("content", "")
                    logger.info(f"  [{i}] {role}: {content[:100]}...")
                logger.info("=== END MERGED HISTORY ===")

                # Get last ASSISTANT and USER messages (one turn) from merged history
                last_assistant = None
                last_user = None

                for msg in reversed(merged_history):
                    if msg.get("role") == "USER" and not last_user:
                        last_user = msg.get("content", "")
                    elif msg.get("role") == "ASSISTANT" and not last_assistant:
                        last_assistant = msg.get("content", "")
                    if last_user and last_assistant:
                        break

                # Format last turn - just provide the conversation, no meta-instructions
                if last_assistant and last_user:
                    request = f"""You: {last_assistant}

Candidate: {last_user}"""
                elif last_user:
                    request = f"""Candidate: {last_user}"""
                else:
                    request = "[Silence]"

            # DEBUG: Log the full request being sent to agent
            logger.info(f"=== AGENT REQUEST ===")
            logger.info(f"Request: {request}")
            logger.info(f"=== END AGENT REQUEST ===")

            # Invoke agent with regular invocation (for session persistence)
            # NOTE: Must use agent() instead of agent.structured_output() to trigger session persistence
            try:
                # Use regular agent invocation which triggers session persistence
                agent_result = agent(request)

                # Extract text from AgentResult object
                # AgentResult has .output attribute containing the text response
                raw_response = (
                    agent_result.output
                    if hasattr(agent_result, "output")
                    else str(agent_result)
                )

                logger.info(f"Received agent response: {raw_response[:200]}...")

                # Parse the response as JSON
                try:
                    # Strip markdown code blocks if present (LLMs sometimes wrap JSON in ```json...```)
                    response_text = strip_markdown_json(raw_response)

                    # Parse JSON
                    response_dict = json.loads(response_text)

                    # Validate using Pydantic model
                    agent_response = InterviewAgentResponse(**response_dict)

                    logger.info(f"Successfully parsed agent response")
                    logger.info(
                        f"  - What to say: {agent_response.what_to_say[:100]}..."
                    )
                    logger.info(
                        f"  - Candidate tip: {agent_response.candidate_tip[:100]}..."
                    )

                except json.JSONDecodeError as json_error:
                    logger.error(
                        f"Failed to parse agent response as JSON: {json_error}"
                    )
                    logger.error(f"Raw response: {raw_response}")
                    return {"error": f"Agent returned invalid JSON: {str(json_error)}"}

                except ValidationError as validation_error:
                    logger.error(
                        f"Agent response validation failed: {validation_error}"
                    )
                    logger.error(
                        f"Response did not match InterviewAgentResponse schema"
                    )
                    return {
                        "error": f"Invalid agent response format: {str(validation_error)}"
                    }

                # Store candidate tip in session memory
                if session_id and agent_response.candidate_tip:
                    try:
                        from interview_session_memory import get_session_memory

                        memory = get_session_memory(session_id)
                        memory.add_candidate_tip(agent_response.candidate_tip)
                        logger.info(f"Stored candidate tip in session memory")
                    except Exception as tip_error:
                        logger.warning(f"Could not store candidate tip: {tip_error}")

                # Return what interviewer should say (Nova Sonic will speak this word-for-word)
                logger.info(f"Agent tool completed successfully")
                return {"response": agent_response.what_to_say}

            except Exception as e:
                # Other errors (network, model errors, etc.)
                logger.error(f"Agent invocation failed: {e}")
                import traceback

                logger.error(traceback.format_exc())
                return {"error": f"Agent execution failed: {str(e)}"}

        except Exception as e:
            error_msg = f"Agent tool execution failed: {str(e)}"
            logger.error(error_msg)
            import traceback

            logger.error(traceback.format_exc())
            return {"error": error_msg}

    async def agent_tool_handler(content: Dict[str, Any]) -> Dict[str, Any]:
        """
        Async wrapper for agent tool handler.
        Runs the synchronous handler in a thread pool.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _agent_tool_handler_sync, content)

    # Tool definition in Bedrock format
    tool_definition = {
        "toolSpec": {
            "name": "interviewAgentTool",
            "description": "Call this after every candidate response to get guidance on what to say or ask next. The advisor automatically has access to the full conversation and interview plan.",
            "inputSchema": {
                "json": json.dumps({"type": "object", "properties": {}, "required": []})
            },
        }
    }

    # Store handler function as an attribute for later access
    tool_definition["_handler"] = agent_tool_handler

    return tool_definition


def get_smart_mode_tools() -> list:
    """
    Get tool configurations for Smart Mode.

    Returns:
        List of tool definitions including the interview agent tool
    """
    return [create_interview_agent_tool()]
