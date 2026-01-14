"""Pydantic models for Live Practice Interview Agent output"""

from pydantic import BaseModel, Field


class InterviewAgentResponse(BaseModel):
    """
    Structured response from the interview agent.

    The agent provides two pieces of information:
    1. what_to_say - Exactly what the interviewer says (spoken by Nova Sonic)
    2. candidate_tip - Real-time coaching tip for the candidate (displayed in UI)
    """

    what_to_say: str = Field(
        description="Exactly what the interviewer should say. This will be spoken word-for-word by Nova Sonic. "
        "Write as if you ARE the interviewer speaking directly to the candidate. "
        "Examples: 'Tell me about a time when...' or 'That's interesting. What specifically did you do when...'"
    )

    candidate_tip: str = Field(
        description="Helpful real-time coaching tip for the candidate. "
        "This is displayed in the UI (NOT spoken). "
        "Should be concise, actionable advice on how to improve their answer. "
        "Examples: 'Be specific about YOUR individual actions, not the team' or "
        "'Use the STAR method: Situation, Task, Action, Result'"
    )


class InterviewTurnResponse(BaseModel):
    """
    Structured response for a single interview turn evaluation.

    Used by the conduct_interview_turn tool to evaluate the candidate's response
    and determine the next question or follow-up.
    """

    what_to_say: str = Field(
        description="The interviewer's next statement or question. "
        "Could be a follow-up question, the next planned question, or feedback. "
        "Examples: 'Can you tell me more about that?' or 'Let's move to the next question...'"
    )

    candidate_tip: str = Field(
        description="Real-time coaching tip for the candidate based on their last response. "
        "Specific, actionable feedback on how to improve. "
        "Examples: 'Provide more specific metrics' or 'Focus on your individual contributions'"
    )
