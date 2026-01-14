"""
Interview Session Memory - Context management for interview practice sessions

Manages interview plan, current progress, and session state for the agent.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
import threading
import logging

logger = logging.getLogger(__name__)


class InterviewSessionMemory:
    """Thread-safe session memory for interview practice"""

    def __init__(self):
        self._memory: Dict[str, Any] = {}
        self._lock = (
            threading.RLock()
        )  # Use RLock for reentrant locking (allows nested lock acquisition)
        self._session_id = None

    def initialize_session(
        self,
        session_id: str,
        user_id: str,
        interview_questions: List[str],
        prep_id: str,
        preparation_details: List[str],
        company_name: Optional[str] = None,
        job_title: Optional[str] = None,
        interview_type: Optional[str] = None,
        questions_with_details: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """
        Initialize a new interview session

        Args:
            session_id: Unique session identifier
            user_id: User identifier
            interview_questions: List of interview questions to ask (simple strings)
            prep_id: Interview preparation ID (required)
            preparation_details: User's prepared answers (required)
            company_name: Target company name
            job_title: Target job position
            interview_type: Type of interview (e.g., 'phone_screening', 'technical', 'behavioral')
            questions_with_details: Full question objects with category, expectedAnswer, difficulty, etc.
        """
        with self._lock:
            self._session_id = session_id

            self._memory = {
                "session_info": {
                    "session_id": session_id,
                    "user_id": user_id,
                    "prep_id": prep_id,
                    "created_at": datetime.now().isoformat(),
                    "last_updated": datetime.now().isoformat(),
                },
                "interview_context": {
                    "company_name": company_name or "the company",
                    "job_title": job_title or "this position",
                    "interview_type": interview_type or "interview",
                },
                "interview_plan": {
                    "questions": interview_questions,
                    "questions_with_details": questions_with_details or [],
                    "total_questions": len(interview_questions),
                    "current_question_index": -1,  # Start at -1, will increment to 0
                    "completed_questions": [],
                },
                "preparation_details": {
                    "prepared_answers": preparation_details,
                    "total_prepared": len(preparation_details),
                },
                "current_state": {
                    "current_question": None,
                    "awaiting_answer": False,
                    "follow_up_count": 0,
                },
                "conversation_history": [],
            }

            logger.info(
                f"Initialized interview session {session_id} for {company_name} - {job_title} ({interview_type}) with {len(interview_questions)} questions and {len(preparation_details)} preparation answers"
            )

    def get_interview_plan(self) -> Dict[str, Any]:
        """Get the complete interview plan"""
        with self._lock:
            return self._memory.get("interview_plan", {})

    def get_next_question(self) -> Optional[str]:
        """
        Get the next interview question

        Returns:
            Next question string, or None if all questions completed
        """
        with self._lock:
            plan = self._memory.get("interview_plan", {})
            current_index = plan.get("current_question_index", -1)
            questions = plan.get("questions", [])

            # Increment to next question
            next_index = current_index + 1

            if next_index >= len(questions):
                logger.info("All interview questions completed")
                return None

            # Update current question index
            plan["current_question_index"] = next_index
            next_question = questions[next_index]

            # Update current state
            self._memory["current_state"] = {
                "current_question": next_question,
                "question_number": next_index + 1,
                "awaiting_answer": True,
                "follow_up_count": 0,
            }

            self._update_timestamp()

            logger.info(
                f"Moving to question {next_index + 1}/{len(questions)}: {next_question[:50]}..."
            )
            return next_question

    def get_current_question(self) -> Optional[str]:
        """Get the current question being discussed"""
        with self._lock:
            return self._memory.get("current_state", {}).get("current_question")

    def get_progress(self) -> Dict[str, Any]:
        """
        Get current progress through the interview

        Returns:
            Dict with current question number, total, and progress info
        """
        with self._lock:
            plan = self._memory.get("interview_plan", {})
            state = self._memory.get("current_state", {})

            current_index = plan.get("current_question_index", -1)
            total = plan.get("total_questions", 0)

            return {
                "current_question_number": current_index + 1
                if current_index >= 0
                else 0,
                "total_questions": total,
                "questions_completed": len(plan.get("completed_questions", [])),
                "questions_remaining": total - (current_index + 1),
                "current_question": state.get("current_question"),
                "follow_up_count": state.get("follow_up_count", 0),
            }

    def mark_question_complete(self) -> None:
        """Mark the current question as complete"""
        with self._lock:
            plan = self._memory.get("interview_plan", {})
            state = self._memory.get("current_state", {})

            current_question = state.get("current_question")
            if current_question:
                plan["completed_questions"].append(current_question)
                logger.info(f"Question completed: {current_question[:50]}...")

            # Reset state
            state["awaiting_answer"] = False
            state["follow_up_count"] = 0

            self._update_timestamp()

    def increment_follow_up_count(self) -> int:
        """Increment follow-up question counter and return new count"""
        with self._lock:
            state = self._memory.get("current_state", {})
            count = state.get("follow_up_count", 0) + 1
            state["follow_up_count"] = count
            self._update_timestamp()
            return count

    def add_to_history(self, role: str, content: str) -> None:
        """Add a message to conversation history"""
        with self._lock:
            history = self._memory.get("conversation_history", [])
            history.append(
                {
                    "role": role,
                    "content": content,
                    "timestamp": datetime.now().isoformat(),
                }
            )
            self._update_timestamp()

    def add_candidate_tip(self, tip: str) -> None:
        """
        Store a candidate tip for frontend display

        Args:
            tip: The coaching tip for the candidate
        """
        with self._lock:
            if "candidate_tips" not in self._memory:
                self._memory["candidate_tips"] = []

            self._memory["candidate_tips"].append(
                {
                    "tip": tip,
                    "timestamp": datetime.now().isoformat(),
                    "question_number": self.get_progress().get(
                        "current_question_number", 0
                    ),
                }
            )

            # Keep only the last 20 tips to avoid memory bloat
            if len(self._memory["candidate_tips"]) > 20:
                self._memory["candidate_tips"] = self._memory["candidate_tips"][-20:]

            self._update_timestamp()
            logger.info(
                f"Stored candidate tip for question {self.get_progress().get('current_question_number', 0)}"
            )

    def get_latest_candidate_tip(self) -> Optional[Dict[str, Any]]:
        """Get the most recent candidate tip"""
        with self._lock:
            tips = self._memory.get("candidate_tips", [])
            return tips[-1] if tips else None

    def get_all_candidate_tips(self) -> List[Dict[str, Any]]:
        """Get all stored candidate tips"""
        with self._lock:
            return self._memory.get("candidate_tips", [])

    def get_full_context(self) -> Dict[str, Any]:
        """
        Get complete interview context for the agent

        Returns:
            Full context including interview context, plan, progress, state, preparation details, and conversation history
        """
        with self._lock:
            return {
                "session_info": self._memory.get("session_info", {}),
                "interview_context": self._memory.get("interview_context", {}),
                "interview_plan": self._memory.get("interview_plan", {}),
                "preparation_details": self._memory.get("preparation_details", {}),
                "progress": self.get_progress(),
                "current_state": self._memory.get("current_state", {}),
                "conversation_history": self._memory.get("conversation_history", []),
            }

    def _update_timestamp(self) -> None:
        """Update last modified timestamp"""
        if "session_info" in self._memory:
            self._memory["session_info"]["last_updated"] = datetime.now().isoformat()

    def clear(self) -> None:
        """Clear all session memory"""
        with self._lock:
            self._memory = {}
            self._session_id = None
            logger.info("Session memory cleared")


# Global session memory instances (one per session)
_session_memories: Dict[str, InterviewSessionMemory] = {}
_memory_lock = threading.Lock()


def get_session_memory(session_id: str) -> InterviewSessionMemory:
    """
    Get or create session memory for a session

    Args:
        session_id: Session identifier

    Returns:
        InterviewSessionMemory instance for this session
    """
    with _memory_lock:
        if session_id not in _session_memories:
            _session_memories[session_id] = InterviewSessionMemory()
        return _session_memories[session_id]


def clear_session_memory(session_id: str) -> None:
    """Clear memory for a specific session"""
    with _memory_lock:
        if session_id in _session_memories:
            _session_memories[session_id].clear()
            del _session_memories[session_id]
            logger.info(f"Cleared session memory for {session_id}")
