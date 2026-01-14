"""
Tests for InterviewQuestion model with question progression tracking fields.

Tests validate:
- Model initialization with progression tracking fields
- Default values for status, startTime, endTime, sequenceOrder
- Field validation and constraints
- JSON serialization/deserialization with new fields
"""

import sys
from pathlib import Path
import pytest
from datetime import datetime

# Add Lambda app directory to path
project_root = Path(__file__).parent.parent.parent
lambda_app_path = (
    project_root / "lib" / "stacks" / "backend" / "lambda-rest-api" / "app"
)
sys.path.insert(0, str(lambda_app_path))

from interview_planner_models import InterviewQuestion


class TestInterviewQuestionModel:
    """Test suite for InterviewQuestion model with progression tracking"""

    def test_default_initialization(self):
        """Test InterviewQuestion initializes with correct default values"""
        question = InterviewQuestion(
            questionId="q0",
            questionText="What is your experience with Python?",
            category="Technical Skills",
            difficulty="medium",
            reasoning="Based on JD requirement for Python development",
        )

        assert question.questionId == "q0"
        assert question.questionText == "What is your experience with Python?"
        assert question.category == "Technical Skills"
        assert question.difficulty == "medium"
        assert question.reasoning == "Based on JD requirement for Python development"

        # Verify progression tracking defaults
        assert question.status == "not_started"
        assert question.startTime is None
        assert question.endTime is None
        assert question.sequenceOrder is None
        assert question.source == "ai"

    def test_initialization_with_progression_fields(self):
        """Test InterviewQuestion with all progression tracking fields set"""
        timestamp_start = int(datetime.now().timestamp() * 1000)
        timestamp_end = timestamp_start + 300000  # +5 minutes

        question = InterviewQuestion(
            questionId="q1",
            questionText="Describe a challenging project",
            category="Behavioral",
            difficulty="hard",
            reasoning="Assesses problem-solving skills from JD requirements",
            status="completed",
            startTime=timestamp_start,
            endTime=timestamp_end,
            sequenceOrder=0,
        )

        assert question.questionText == "Describe a challenging project"
        assert question.status == "completed"
        assert question.startTime == timestamp_start
        assert question.endTime == timestamp_end
        assert question.sequenceOrder == 0

    def test_status_values(self):
        """Test all valid status values can be set"""
        valid_statuses = ["not_started", "in_progress", "completed"]

        for status in valid_statuses:
            question = InterviewQuestion(
                questionId="q0",
                questionText="Test question",
                category="Technical",
                difficulty="easy",
                reasoning="Test reasoning",
                status=status,
            )
            assert question.status == status

    def test_sequence_order_values(self):
        """Test sequenceOrder accepts valid 0-indexed values"""
        for i in range(20):
            question = InterviewQuestion(
                questionId=f"q{i}",
                questionText=f"Question {i + 1}",
                category="Technical",
                difficulty="easy",
                reasoning="Test reasoning",
                sequenceOrder=i,
            )
            assert question.sequenceOrder == i

    def test_timestamp_validation(self):
        """Test timestamp fields accept millisecond epoch values"""
        now_ms = int(datetime.now().timestamp() * 1000)

        question = InterviewQuestion(
            questionId="q0",
            questionText="Test",
            category="Tech",
            difficulty="easy",
            reasoning="Test reasoning",
            startTime=now_ms,
            endTime=now_ms + 60000,  # +1 minute
        )

        assert question.startTime == now_ms
        assert question.endTime == now_ms + 60000
        assert question.endTime > question.startTime

    def test_json_serialization(self):
        """Test InterviewQuestion serializes to JSON with progression fields"""
        timestamp = int(datetime.now().timestamp() * 1000)

        question = InterviewQuestion(
            questionId="q2",
            questionText="What is AWS Lambda?",
            category="Technical Skills",
            difficulty="medium",
            reasoning="Based on JD requirement for serverless knowledge",
            evaluationChecklist="- Understands serverless\n- Knows use cases",
            status="in_progress",
            startTime=timestamp,
            endTime=None,
            sequenceOrder=2,
        )

        # Serialize to dict
        question_dict = question.model_dump()

        # Verify all fields present
        assert question_dict["questionText"] == "What is AWS Lambda?"
        assert question_dict["category"] == "Technical Skills"
        assert question_dict["difficulty"] == "medium"
        assert question_dict["status"] == "in_progress"
        assert question_dict["startTime"] == timestamp
        assert question_dict["endTime"] is None
        assert question_dict["sequenceOrder"] == 2
        assert question_dict["evaluationChecklist"] is not None

    def test_json_deserialization(self):
        """Test InterviewQuestion can be created from JSON dict"""
        timestamp = int(datetime.now().timestamp() * 1000)

        question_data = {
            "questionId": "q5",
            "questionText": "How do you handle errors in Python?",
            "category": "Technical Skills",
            "difficulty": "medium",
            "reasoning": "Based on JD requirement for error handling",
            "source": "ai",
            "status": "completed",
            "startTime": timestamp,
            "endTime": timestamp + 180000,  # +3 minutes
            "sequenceOrder": 5,
        }

        question = InterviewQuestion(**question_data)

        assert question.questionText == "How do you handle errors in Python?"
        assert question.status == "completed"
        assert question.startTime == timestamp
        assert question.endTime == timestamp + 180000
        assert question.sequenceOrder == 5

    def test_optional_fields_can_be_none(self):
        """Test that progression tracking fields can be None"""
        question = InterviewQuestion(
            questionId="q0",
            questionText="Test question",
            category="Test",
            difficulty="easy",
            reasoning="Test reasoning",
            status="not_started",
            startTime=None,
            endTime=None,
            sequenceOrder=None,
        )

        assert question.startTime is None
        assert question.endTime is None
        assert question.sequenceOrder is None

    def test_partial_progression_data(self):
        """Test question with only startTime set (in_progress state)"""
        timestamp = int(datetime.now().timestamp() * 1000)

        question = InterviewQuestion(
            questionId="q0",
            questionText="Tell me about yourself",
            category="Introduction",
            difficulty="easy",
            reasoning="Standard opening question",
            status="in_progress",
            startTime=timestamp,
            endTime=None,  # Not finished yet
            sequenceOrder=0,
        )

        assert question.status == "in_progress"
        assert question.startTime == timestamp
        assert question.endTime is None
        assert question.sequenceOrder == 0

    def test_completed_question_has_both_timestamps(self):
        """Test completed question has both start and end timestamps"""
        start_time = int(datetime.now().timestamp() * 1000)
        end_time = start_time + 420000  # +7 minutes

        question = InterviewQuestion(
            questionId="q3",
            questionText="Describe your AWS experience",
            category="Technical",
            difficulty="medium",
            reasoning="Based on JD requirement for cloud experience",
            status="completed",
            startTime=start_time,
            endTime=end_time,
            sequenceOrder=3,
        )

        assert question.status == "completed"
        assert question.startTime is not None
        assert question.endTime is not None
        assert question.endTime > question.startTime

        # Calculate duration
        duration_ms = question.endTime - question.startTime
        duration_minutes = duration_ms / 60000
        assert duration_minutes == pytest.approx(7.0)

    def test_multiple_questions_with_sequence_order(self):
        """Test creating multiple questions with proper sequence ordering"""
        questions = [
            InterviewQuestion(
                questionId=f"q{i}",
                questionText=f"Question {i + 1}",
                category="Technical",
                difficulty="easy",
                reasoning="Test reasoning",
                sequenceOrder=i,
                status="not_started",
            )
            for i in range(8)
        ]

        # Verify all questions have correct sequence
        for i, question in enumerate(questions):
            assert question.sequenceOrder == i
            assert question.status == "not_started"

    def test_backwards_compatibility(self):
        """Test that questions without progression fields still work"""
        # Old-style question without new progression fields
        question_data = {
            "questionId": "q0",
            "questionText": "Legacy question without progression tracking",
            "category": "Technical",
            "difficulty": "easy",
            "reasoning": "Legacy test question",
        }

        question = InterviewQuestion(**question_data)

        # Should use default values for progression fields
        assert question.questionText == "Legacy question without progression tracking"
        assert question.status == "not_started"
        assert question.startTime is None
        assert question.endTime is None
        assert question.sequenceOrder is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
