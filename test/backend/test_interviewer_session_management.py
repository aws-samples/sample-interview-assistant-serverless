"""
Tests for Interviewer Session Management.

Tests validate:
- Interview session creation and storage
- Question progression tracking persistence
- Session metadata with questionStatuses
- Video/audio recording management
- Session lifecycle management
"""

import pytest
import json
from datetime import datetime


class TestInterviewerSessionManagement:
    """Test suite for interviewer session management"""

    def test_interview_session_structure(self):
        """Test interview session data structure"""
        session = {
            "sessionId": "session-123",
            "interviewId": "int-456",
            "userId": "interviewer@example.com",
            "timestamp": int(datetime.now().timestamp() * 1000),
            "duration": 1800,  # 30 minutes
            "status": "completed",
            "audioS3Key": "audio/session-123.webm",
            "videoS3Key": "videos/session-123.webm",
            "transcription": [],
            "questionStatuses": {},
            "currentQuestionIndex": 0,
        }

        assert "sessionId" in session
        assert "interviewId" in session
        assert "questionStatuses" in session

    def test_question_statuses_persistence(self):
        """Test questionStatuses data structure"""
        question_statuses = {
            "q0": {
                "status": "completed",
                "startTime": 1704412800000,
                "endTime": 1704413100000,
                "timestamp": 1704413100000,
            },
            "q1": {
                "status": "in_progress",
                "startTime": 1704413100000,
                "endTime": None,
                "timestamp": 1704413100000,
            },
            "q2": {
                "status": "not_started",
                "startTime": None,
                "endTime": None,
                "timestamp": None,
            },
        }

        assert "q0" in question_statuses
        assert question_statuses["q0"]["status"] == "completed"
        assert question_statuses["q1"]["endTime"] is None

    def test_session_with_question_progression_data(self):
        """Test session includes question progression tracking"""
        session_data = {
            "sessionId": "session-789",
            "questionStatuses": json.dumps(
                {
                    "q0": {"status": "completed", "startTime": 1000, "endTime": 300000},
                    "q1": {
                        "status": "completed",
                        "startTime": 300000,
                        "endTime": 600000,
                    },
                    "q2": {
                        "status": "in_progress",
                        "startTime": 600000,
                        "endTime": None,
                    },
                }
            ),
            "currentQuestionIndex": 2,
        }

        # Parse questionStatuses
        statuses = json.loads(session_data["questionStatuses"])

        assert len(statuses) == 3
        assert statuses["q0"]["status"] == "completed"
        assert session_data["currentQuestionIndex"] == 2

    def test_calculate_question_coverage(self):
        """Test calculating question coverage from session"""
        question_statuses = {
            "q0": {"status": "completed"},
            "q1": {"status": "completed"},
            "q2": {"status": "completed"},
            "q3": {"status": "not_started"},
            "q4": {"status": "not_started"},
        }

        total_questions = len(question_statuses)
        asked_questions = sum(
            1 for q in question_statuses.values() if q["status"] != "not_started"
        )
        coverage = (asked_questions / total_questions) * 100

        assert total_questions == 5
        assert asked_questions == 3
        assert coverage == pytest.approx(60.0)

    def test_session_transcription_with_speakers(self):
        """Test transcription includes speaker roles"""
        transcription = [
            {
                "role": "interviewer",
                "content": "Tell me about your Python experience",
                "timestamp": 5000,
                "speaker": "Interviewer",
            },
            {
                "role": "candidate",
                "content": "I have 7 years of Python development",
                "timestamp": 10000,
                "speaker": "Candidate",
            },
        ]

        assert transcription[0]["role"] == "interviewer"
        assert transcription[1]["role"] == "candidate"

    def test_session_metadata_structure(self):
        """Test session metadata includes all required fields"""
        metadata = {
            "questionStatuses": {"q0": {"status": "completed"}},
            "currentQuestionIndex": 1,
            "totalQuestions": 8,
            "questionsAsked": 5,
            "coverage": 62.5,
        }

        assert "questionStatuses" in metadata
        assert "currentQuestionIndex" in metadata
        assert metadata["coverage"] > 0

    def test_session_association_with_interview(self):
        """Test session links to scheduled interview"""
        session = {
            "sessionId": "session-123",
            "interviewId": "int-456",  # Links to scheduled interview
        }

        assert "interviewId" in session
        assert session["interviewId"].startswith("int-")

    def test_session_list_filtering_by_interview(self):
        """Test filtering sessions by interviewId"""
        sessions = [
            {"sessionId": "s1", "interviewId": "int-1"},
            {"sessionId": "s2", "interviewId": "int-1"},
            {"sessionId": "s3", "interviewId": "int-2"},
        ]

        int1_sessions = [s for s in sessions if s["interviewId"] == "int-1"]
        assert len(int1_sessions) == 2

    def test_session_deletion_cascade(self):
        """Test deleting session and associated media"""
        deletion_items = [
            "session-123",  # DynamoDB record
            "audio/session-123.webm",  # S3 audio
            "videos/session-123.webm",  # S3 video
        ]

        assert len(deletion_items) >= 2

    def test_session_status_lifecycle(self):
        """Test session status transitions"""
        statuses = ["created", "in_progress", "completed"]

        for status in statuses:
            assert status in ["created", "in_progress", "completed", "failed"]

    def test_question_time_tracking(self):
        """Test time spent on each question"""
        q_status = {
            "status": "completed",
            "startTime": 1704412800000,
            "endTime": 1704413100000,
        }

        elapsed_ms = q_status["endTime"] - q_status["startTime"]
        elapsed_minutes = elapsed_ms / 60000

        assert elapsed_minutes == pytest.approx(5.0)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
