"""
Live Assistant Agent
Provides AI coaching for live interview sessions with web search capabilities
"""

import asyncio
import logging
from typing import Dict, Any, Optional
from tools.web_search import ddg_search, nova_grounding_search
from config.feature_flags import feature_flags
from utils.retry_utils import bedrock_retry_handler
import os

logger = logging.getLogger(__name__)

# Model configuration
COACHING_MODEL_ID = os.getenv("COACHING_MODEL_ID", "global.amazon.nova-2-lite-v1:0")
COACHING_MODEL_REGION = os.getenv("AWS_REGION", "us-east-1")

# System prompts
SUMMARY_SYSTEM_PROMPT = """You are an expert interview transcription summarizer.

Your task is to create concise, actionable summaries of interview conversations.

GUIDELINES:
1. Focus on key topics discussed
2. Identify questions asked by the interviewer
3. Note the candidate's main points and responses
4. Highlight any technical terms, company names, or specific technologies mentioned
5. Keep the summary concise (3-5 bullet points)

Format your summary clearly with bullet points."""

CANDIDATE_COACHING_SYSTEM_PROMPT = """You are an expert interview coach providing quick reference answers during live interviews.

Your role:
- Provide a SHORT, CONCISE model answer to the current interview question
- Give the candidate key points to mention (2-4 bullet points maximum)
- Use web search when needed for specific technical topics or company information

CRITICAL GUIDELINES:
- Keep responses under 100 words
- Format as brief bullet points
- Focus on WHAT to say, not how to say it
- Be direct and specific
- No meta-commentary or coaching advice - just the answer points

Example format:
**Key Points:**
- Point 1 (specific technical detail or example)
- Point 2 (another key aspect)
- Point 3 (if needed)

Your goal is to give the candidate a quick cheat sheet they can reference mid-interview."""

INTERVIEWER_COACHING_SYSTEM_PROMPT = """You are an expert interview coach assisting interviewers during live interviews.

Your role:
- Suggest effective follow-up questions based on the conversation
- Identify areas that need deeper exploration
- Highlight red flags or strong signals in candidate responses
- Provide quick tips for evaluation criteria
- Use web search when needed for technical topics or company-specific information

CRITICAL GUIDELINES:
- Keep responses under 100 words
- Format as brief bullet points
- Focus on actionable guidance for the interviewer
- Be direct and specific
- No lengthy explanations

Example format:
**Suggested Follow-ups:**
- Probe deeper on [specific topic]
- Ask for concrete example of [skill/experience]

**Key Observations:**
- [Red flag or positive signal]

Your goal is to help the interviewer conduct a more effective interview in real-time."""

# Backward compatibility alias
COACHING_SYSTEM_PROMPT = CANDIDATE_COACHING_SYSTEM_PROMPT

# System prompts for automatic coaching tips (shorter, more tactical)
CANDIDATE_TIP_SYSTEM_PROMPT = """You are an expert interview coach providing quick, actionable tips to candidates during live interviews.

Your role:
- Analyze the recent conversation and provide ONE specific, actionable tip
- Focus on what the candidate should emphasize or improve in their NEXT response
- Be concise (2-3 sentences maximum)
- Provide specific, tactical advice

CRITICAL GUIDELINES:
- Keep tips under 50 words
- Be specific and actionable
- No generic advice - focus on the actual conversation
- One tip per message
- Format clearly with bullet points if needed

Example tip formats:
"Emphasize your specific experience with [technology] when answering this question. Mention the [project] you worked on and quantify the results."

"The interviewer is probing for leadership examples. Share a concrete story where you led a team through a challenge."

Your goal is to give the candidate a quick, specific tip they can act on immediately."""

INTERVIEWER_TIP_SYSTEM_PROMPT = """You are an expert interview coach assisting interviewers during live interviews.

Your role:
- Analyze the recent conversation and provide ONE specific, actionable tip
- Evaluate answer quality and depth against the allocated time for the question
- Advise whether to move on to the next question or probe further
- Suggest what the interviewer should probe next or what to watch for
- Be concise (3-4 sentences maximum)
- Provide specific, tactical guidance with timing awareness

CRITICAL GUIDELINES:
- Keep tips under 100 words
- Be specific and actionable
- Always include progression guidance (e.g., "Ready to move on" or "Probe further")
- Consider time allocated vs time spent
- No generic advice - focus on the actual conversation
- Format clearly with structure:
  1. Answer quality assessment
  2. Time/depth evaluation
  3. Clear recommendation (Move on / Probe further / Wrap up soon)
  4. Specific follow-up question (if probing further)

Example tip formats:
"**Adequate answer** - Candidate covered basics of system design. With 8 of 12 minutes used, you're on track. **✓ Ready to move on** to next question."

"**Shallow response** - Candidate avoided specifics on metrics. With 3 of 10 minutes used, time permits deeper exploration. **→ Probe further:** 'What was the measurable impact of your solution?'"

"**Strong depth** but exceeding allocated time (14 of 10 minutes). **⚠ Wrap up** and transition to next question to stay on schedule."

Your goal is to help the interviewer balance depth with time management and make efficient progression decisions."""


def create_summary_agent():
    """
    Create a Strands Agent for generating conversation summaries.
    No tools needed.
    """
    try:
        from strands import Agent

        agent = Agent(
            model=COACHING_MODEL_ID,
            tools=[],  # No tools for summary
            system_prompt=SUMMARY_SYSTEM_PROMPT,
            hooks=[bedrock_retry_handler],
        )

        logger.info("Summary agent created successfully")
        return agent

    except ImportError as e:
        logger.error(f"Failed to import strands: {e}")
        raise ImportError(
            "Strands library not available. Install with: pip install strands"
        )
    except Exception as e:
        logger.error(f"Failed to create summary agent: {e}")
        raise


def create_coaching_agent(system_prompt: str = None):
    """
    Create a Strands Agent for providing interview coaching.

    This is a stateless agent - each coaching request is independent.
    Includes web search tool for researching companies, technologies, etc.

    Args:
        system_prompt: Custom system prompt (defaults to CANDIDATE_COACHING_SYSTEM_PROMPT)

    Returns:
        Agent instance configured for coaching with web search
    """
    try:
        from strands import Agent

        # Use provided prompt or default to candidate coaching
        if system_prompt is None:
            system_prompt = CANDIDATE_COACHING_SYSTEM_PROMPT

        # Select web search tool based on feature flag
        use_nova_grounding = feature_flags.get("USE_NOVA_GROUNDING", False)
        web_search_tool = nova_grounding_search if use_nova_grounding else ddg_search

        search_method = "Nova Grounding" if use_nova_grounding else "DuckDuckGo"
        logger.info(f"Creating coaching agent with {search_method} web search tool")

        # Create agent WITH web search tool
        # Note: The Strands Agent framework automatically handles parallel tool execution
        # when the LLM determines multiple searches are needed.
        agent = Agent(
            model=COACHING_MODEL_ID,
            tools=[web_search_tool],  # Web search tool (DDG or Nova Grounding)
            system_prompt=system_prompt,
            hooks=[bedrock_retry_handler],
        )

        logger.info(
            f"Coaching agent created successfully with {search_method} web search tool"
        )
        return agent

    except ImportError as e:
        logger.error(f"Failed to import strands: {e}")
        raise ImportError(
            "Strands library not available. Install with: pip install strands"
        )
    except Exception as e:
        logger.error(f"Failed to create coaching agent: {e}")
        raise


async def generate_summary(previous_summary: Optional[str], new_transcript: str) -> str:
    """
    Generate a cumulative summary of the interview conversation.

    If previous_summary exists: combines it with new transcript to create updated summary
    If no previous summary: creates initial summary from new transcript

    Args:
        previous_summary: Previous cumulative summary (None if first time)
        new_transcript: New transcript text from recent conversation (last 5 minutes)

    Returns:
        Updated cumulative summary
    """
    try:
        agent = create_summary_agent()

        # Build prompt based on whether we have a previous summary
        if previous_summary:
            prompt = f"""You have an existing summary of an interview conversation so far, and new transcript from the last 5 minutes.

EXISTING SUMMARY:
{previous_summary}

NEW TRANSCRIPT (last 5 minutes):
{new_transcript}

Please create an UPDATED SUMMARY that combines the existing summary with the new information.
Keep it concise (5-7 bullet points maximum) and focus on the most important points."""
        else:
            prompt = f"""Here is a transcript from an interview conversation (first 5 minutes):

TRANSCRIPT:
{new_transcript}

Please create a SUMMARY of this conversation.
Keep it concise (3-5 bullet points) and focus on the most important points."""

        logger.info(f"Generating summary (has previous: {bool(previous_summary)})")

        # Invoke agent (no tools)
        # IMPORTANT: agent() is synchronous, so run in thread pool to avoid blocking event loop
        result = await asyncio.to_thread(agent, prompt)

        # Extract output from AgentResult
        summary = result.output if hasattr(result, "output") else str(result)
        logger.info(f"Summary generated successfully ({len(summary)} chars)")

        return summary

    except Exception as e:
        logger.error(f"Failed to generate summary: {e}")
        raise


async def provide_coaching(
    summary: Optional[str],
    recent_transcript: str,
    interview_prep: Optional[Dict[str, Any]],
    user_request: Optional[str],
    session_type: str = "candidateAssistant",
) -> str:
    """
    Provide AI coaching guidance for candidate or interviewer.

    This is stateless - each coaching request is independent.

    Args:
        summary: Cumulative summary of conversation so far (None if not available)
        recent_transcript: Recent transcript (last 5 minutes)
        interview_prep: Interview preparation info (company, position, JD, resume)
        user_request: Optional user-specific request or question
        session_type: "candidateAssistant" or "interviewerAssistant"

    Returns:
        Coaching advice for the candidate or interviewer
    """
    try:
        # Select appropriate system prompt based on session type
        if session_type == "interviewerAssistant":
            system_prompt = INTERVIEWER_COACHING_SYSTEM_PROMPT
            default_request = (
                "Suggest effective follow-up questions based on the conversation."
            )
        else:  # candidateAssistant
            system_prompt = CANDIDATE_COACHING_SYSTEM_PROMPT
            default_request = (
                "Provide key points for the candidate to answer the current question."
            )

        agent = create_coaching_agent(system_prompt=system_prompt)

        # Build concise coaching prompt
        prompt_parts = []

        # Add minimal context
        if interview_prep:
            company = interview_prep.get("companyName")
            position = interview_prep.get("positionTitle")
            if company and position:
                prompt_parts.append(f"Interview: {company} - {position}")
                prompt_parts.append("")

        # Add conversation summary if available (provides longer-term context)
        if summary and summary.strip():
            prompt_parts.append("CONVERSATION SUMMARY (so far):")
            prompt_parts.append(summary)
            prompt_parts.append("")

        # Add recent conversation (most immediate context)
        prompt_parts.append("RECENT CONVERSATION (last 5 minutes):")
        prompt_parts.append(recent_transcript)
        prompt_parts.append("")

        # Add specific request if provided
        if user_request:
            prompt_parts.append(f"Question: {user_request}")
        else:
            prompt_parts.append(default_request)

        prompt = "\n".join(prompt_parts)

        logger.info(
            f"Providing coaching (summary: {bool(summary)}, prep: {bool(interview_prep)}, request: {bool(user_request)})"
        )
        logger.info(f"Coaching prompt ({len(prompt)} chars):")
        logger.info("--- PROMPT START ---")
        logger.info(prompt[:500] + ("..." if len(prompt) > 500 else ""))
        logger.info("--- PROMPT END ---")

        # Invoke agent
        # IMPORTANT: agent() is synchronous and blocks on Bedrock API calls
        # Run in thread pool to avoid blocking the asyncio event loop
        result = await asyncio.to_thread(agent, prompt)

        # Extract output from AgentResult
        coaching_advice = result.output if hasattr(result, "output") else str(result)
        logger.info(f"Coaching provided successfully ({len(coaching_advice)} chars)")
        logger.info(f"Coaching response: {coaching_advice[:200]}...")

        return coaching_advice

    except Exception as e:
        logger.error(f"Failed to provide coaching: {e}")
        raise


async def generate_coaching_tip(
    recent_transcript: str,
    interview_prep: Optional[Dict[str, Any]],
    session_type: str = "candidateAssistant",
    summary: Optional[str] = None,
    current_question_info: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Generate a quick, automatic coaching tip based on recent conversation.

    This is called periodically during the interview to provide proactive guidance.
    Similar to LivePracticeSession's candidate_tip but for Transcribe-based sessions.

    Args:
        recent_transcript: Recent transcript (last 2-3 minutes recommended)
        interview_prep: Interview preparation info (company, position, JD, resume)
        session_type: "candidateAssistant" or "interviewerAssistant"
        summary: Cumulative summary of conversation so far (None if not available)
        current_question_info: Current question context for interviewers (optional):
            {
                "questionText": str,
                "category": str,
                "estimatedTime": str (e.g., "10-12 minutes"),
                "timeSpentMinutes": float,
                "evaluationChecklist": str (optional),
                "questionIndex": int (e.g., 1 for Q1),
                "totalQuestions": int
            }

    Returns:
        Brief coaching tip (under 100 words for interviewers, under 50 words for candidates)
    """
    try:
        # Select appropriate system prompt based on session type
        if session_type == "interviewerAssistant":
            system_prompt = INTERVIEWER_TIP_SYSTEM_PROMPT
            tip_request = """Based on the recent conversation and time allocation, provide guidance to the interviewer:
1. Evaluate the depth and quality of the candidate's response
2. Assess if the time allocation is appropriate
3. Recommend whether to move on to the next question or probe further
4. If probing further, suggest a specific follow-up or deep-dive question to ask"""
        else:  # candidateAssistant
            system_prompt = CANDIDATE_TIP_SYSTEM_PROMPT
            tip_request = "Based on the recent conversation, what should the candidate emphasize or focus on in their next response?"

        agent = create_coaching_agent(system_prompt=system_prompt)

        # Build concise tip prompt with context
        prompt_parts = []

        # Add interview context if available
        if interview_prep:
            company = interview_prep.get("companyName")
            position = interview_prep.get("positionTitle")
            if company and position:
                prompt_parts.append(f"Interview: {company} - {position}")
                prompt_parts.append("")

        # Add current question context for interviewers
        if session_type == "interviewerAssistant" and current_question_info:
            q_index = current_question_info.get("questionIndex", 0)
            total_q = current_question_info.get("totalQuestions", 0)
            question_text = current_question_info.get("questionText", "")
            category = current_question_info.get("category", "")
            estimated_time = current_question_info.get("estimatedTime", "")
            time_spent = current_question_info.get("timeSpentMinutes", 0)
            evaluation = current_question_info.get("evaluationChecklist", "")

            prompt_parts.append(f"**CURRENT QUESTION (Q{q_index + 1} of {total_q}):**")
            prompt_parts.append(f'"{question_text}"')
            if category:
                prompt_parts.append(f"Category: {category}")
            prompt_parts.append(f"Allocated Time: {estimated_time}")
            prompt_parts.append(
                f"Time Spent So Far: {time_spent:.1f} minutes"
            )
            if evaluation:
                prompt_parts.append(f"\n**EVALUATION CRITERIA:**\n{evaluation}")
            prompt_parts.append("")

        # Add conversation summary if available (provides longer-term context)
        if summary and summary.strip():
            prompt_parts.append("CONVERSATION SUMMARY (so far):")
            prompt_parts.append(summary)
            prompt_parts.append("")

        # Add recent conversation (most immediate context for tips)
        prompt_parts.append("RECENT CONVERSATION (last 2-3 minutes):")
        prompt_parts.append(recent_transcript)
        prompt_parts.append("")

        # Add tip request
        prompt_parts.append(tip_request)

        prompt = "\n".join(prompt_parts)

        logger.info(f"Generating automatic coaching tip ({session_type})")
        logger.debug(f"Tip prompt ({len(prompt)} chars): {prompt[:300]}...")

        # Invoke agent
        # IMPORTANT: agent() is synchronous and blocks on Bedrock API calls
        # Run in thread pool to avoid blocking the asyncio event loop
        result = await asyncio.to_thread(agent, prompt)

        # Extract output from AgentResult
        tip = result.output if hasattr(result, "output") else str(result)

        # Ensure tip is concise (trim if needed)
        # Interviewers get more space (100 words ~500 chars) due to timing analysis
        # Candidates get shorter tips (50 words ~250 chars)
        max_length = 500 if session_type == "interviewerAssistant" else 250
        if len(tip) > max_length:
            logger.warning(f"Tip too long ({len(tip)} chars), trimming to {max_length}...")
            tip = tip[:max_length].rsplit(".", 1)[0] + "."

        logger.info(
            f"Coaching tip generated successfully ({len(tip)} chars): {tip[:100]}..."
        )

        return tip

    except Exception as e:
        logger.error(f"Failed to generate coaching tip: {e}")
        raise


async def analyze_question_progression(
    recent_transcript: str,
    current_question: str,
    next_question: Optional[str] = None,
    current_question_category: Optional[str] = None,
    next_question_category: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Analyze conversation transcript to detect if the interviewer has moved to the next question.

    Args:
        recent_transcript: Recent conversation transcript text
        current_question: The current question being discussed
        next_question: The next question in the interview plan (or None if this is the last question)
        current_question_category: Category of current question (e.g., "Technical Skills", "Behavioral")
        next_question_category: Category of next question (or None if this is the last question)

    Returns:
        Dictionary with analysis results:
        {
            "current_question_completed": bool,
            "next_question_started": bool,
            "confidence": float (0.0-1.0),
            "reasoning": str
        }
    """
    try:
        import json
        from strands import Agent

        # Create a simple agent for question progression analysis (no tools needed)
        progression_agent = Agent(
            model=COACHING_MODEL_ID,
            tools=[],  # No tools needed for progression analysis
            system_prompt="You are an expert at analyzing interview conversations to detect question transitions.",
            hooks=[bedrock_retry_handler],
        )

        # Build the analysis prompt
        if next_question:
            # Include category context to help LLM understand topic shifts
            current_category_info = (
                f" (Category: {current_question_category})"
                if current_question_category
                else ""
            )
            next_category_info = (
                f" (Category: {next_question_category})"
                if next_question_category
                else ""
            )

            prompt = f"""You are analyzing an interview conversation. The interviewer is asking questions from a predefined list.

**Current question being discussed:** "{current_question}"{current_category_info}

**Next question in plan:** "{next_question}"{next_category_info}

**Recent conversation transcript:**
{recent_transcript}

**Task:** Determine if the interviewer has moved to the next question.

**PRIMARY FOCUS:** Has the interviewer asked the next question or moved on to a new topic?

**Detection signals (look for ANY of these):**
- Interviewer explicitly asks the next question (exact wording or close paraphrase)
- Clear transition phrases: "Next question...", "Let's move on...", "Okay, now...", "Moving on..."
- Topic clearly shifts from current question to next question's topic (use the category info to understand topic boundaries)
- Interviewer introduces a new problem/scenario that matches the next question
- Category shift: conversation moves from one category topic to another (e.g., Technical Skills → Behavioral)

**Important:**
- Follow-up questions or clarifications about the SAME topic do NOT count as moving to the next question
- Once the next question is detected, the previous question is automatically considered complete
- Confidence >=0.65 is sufficient for detection - be reasonably confident but not overly strict
- Don't worry about whether the candidate "finished" answering - focus on the INTERVIEWER's transition

**Respond ONLY with valid JSON in this exact format:**
{{
    "current_question_completed": true/false,
    "next_question_started": true/false,
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation - focus on what signals indicated the next question started"
}}"""
        else:
            # Last question - only check if it's been answered
            current_category_info = (
                f" (Category: {current_question_category})"
                if current_question_category
                else ""
            )

            prompt = f"""You are analyzing an interview conversation. The interviewer is on the LAST question of the interview.

**Current (last) question being discussed:** "{current_question}"{current_category_info}

**Recent conversation transcript:**
{recent_transcript}

**Task:** Determine if the candidate has finished answering this final question.

**Analysis criteria:**
- Has the candidate completed their response?
- Are there clear completion signals (e.g., "That's all", "Does that answer your question?", interviewer says "Great", "Thank you")?
- Has there been a natural conclusion to the discussion?

**Important:**
- Follow-up questions or clarifications about the SAME topic do NOT count as completion
- Confidence >=0.65 is sufficient for detection - be reasonably confident but not overly strict

**Respond ONLY with valid JSON in this exact format:**
{{
    "current_question_completed": true/false,
    "next_question_started": false,
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation of your decision"
}}"""

        logger.info("Analyzing question progression with AI...")
        logger.debug(f"Analysis prompt ({len(prompt)} chars)")

        # Invoke agent in thread pool (agent() is synchronous)
        result = await asyncio.to_thread(progression_agent, prompt)

        # Extract output from AgentResult
        output = result.output if hasattr(result, "output") else str(result)

        # Parse JSON response
        # Clean up the output - extract JSON from markdown code blocks if present
        output_clean = output.strip()
        if output_clean.startswith("```json"):
            output_clean = output_clean[7:]  # Remove ```json
        if output_clean.startswith("```"):
            output_clean = output_clean[3:]  # Remove ```
        if output_clean.endswith("```"):
            output_clean = output_clean[:-3]  # Remove trailing ```
        output_clean = output_clean.strip()

        try:
            analysis_result = json.loads(output_clean)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON, trying to extract from text: {e}")
            # Fallback: return low confidence if we can't parse
            analysis_result = {
                "current_question_completed": False,
                "next_question_started": False,
                "confidence": 0.0,
                "reasoning": f"Failed to parse AI response: {output[:100]}",
            }

        logger.info(f"Question progression analysis complete: {analysis_result}")

        return analysis_result

    except Exception as e:
        logger.error(f"Failed to analyze question progression: {e}")
        # Return safe default on error
        return {
            "current_question_completed": False,
            "next_question_started": False,
            "confidence": 0.0,
            "reasoning": f"Error during analysis: {str(e)}",
        }
