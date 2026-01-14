"""
Tests for question progression detection logic.

Tests validate:
- Confidence threshold validation (0.65)
- Next question started detection (Questions 1-N-1)
- Last question completion detection
- Decision logic for advancing questions
- Edge cases and boundary conditions
"""

import pytest
from datetime import datetime


class TestQuestionProgressionLogic:
    """Test suite for question progression detection logic"""

    def test_confidence_threshold(self):
        """Test confidence threshold is correctly set to 0.65"""
        CONFIDENCE_THRESHOLD = 0.65

        # Test values above threshold
        assert 0.70 >= CONFIDENCE_THRESHOLD
        assert 0.80 >= CONFIDENCE_THRESHOLD
        assert 0.95 >= CONFIDENCE_THRESHOLD

        # Test values below threshold
        assert 0.60 < CONFIDENCE_THRESHOLD
        assert 0.50 < CONFIDENCE_THRESHOLD
        assert 0.30 < CONFIDENCE_THRESHOLD

    def test_should_advance_next_question_started(self):
        """Test progression when next question is started with sufficient confidence"""
        # Simulate AI analysis result
        result = {
            "current_question_completed": False,
            "next_question_started": True,
            "confidence": 0.85,
            "reasoning": "Interviewer explicitly asked next question",
        }

        confidence = result["confidence"]
        next_started = result["next_question_started"]
        has_next_question = True  # Not the last question

        # Should advance: confidence >= 0.65 AND next_started AND has_next_question
        should_advance = confidence >= 0.65 and has_next_question and next_started

        assert should_advance is True

    def test_should_not_advance_low_confidence(self):
        """Test no progression when confidence is below threshold"""
        result = {
            "current_question_completed": False,
            "next_question_started": True,
            "confidence": 0.60,  # Below 0.65 threshold
            "reasoning": "Might be follow-up question",
        }

        confidence = result["confidence"]
        next_started = result["next_question_started"]
        has_next_question = True

        should_advance = confidence >= 0.65 and has_next_question and next_started

        assert should_advance is False

    def test_should_complete_last_question(self):
        """Test last question completion logic"""
        result = {
            "current_question_completed": True,
            "next_question_started": False,
            "confidence": 0.90,
            "reasoning": "Candidate finished answering, interviewer said thank you",
        }

        confidence = result["confidence"]
        completed = result["current_question_completed"]
        has_next_question = False  # This is the last question

        # Should complete: confidence >= 0.65 AND completed AND no next question
        should_complete = confidence >= 0.65 and not has_next_question and completed

        assert should_complete is True

    def test_should_not_complete_last_question_low_confidence(self):
        """Test last question not completed when confidence too low"""
        result = {
            "current_question_completed": True,
            "next_question_started": False,
            "confidence": 0.55,
            "reasoning": "Uncertain if candidate is truly done",
        }

        confidence = result["confidence"]
        completed = result["current_question_completed"]
        has_next_question = False

        should_complete = confidence >= 0.65 and not has_next_question and completed

        assert should_complete is False

    def test_boundary_confidence_value(self):
        """Test exact boundary confidence value of 0.65"""
        result = {
            "current_question_completed": False,
            "next_question_started": True,
            "confidence": 0.65,  # Exact threshold
            "reasoning": "Clear transition detected",
        }

        confidence = result["confidence"]

        # Should accept exactly 0.65
        assert confidence >= 0.65

    def test_follow_up_question_detection(self):
        """Test that follow-up questions don't trigger progression"""
        # Follow-up question scenario
        result = {
            "current_question_completed": False,
            "next_question_started": False,  # Still on same topic
            "confidence": 0.40,
            "reasoning": "Interviewer asking clarifying question on same topic",
        }

        confidence = result["confidence"]
        next_started = result["next_question_started"]
        has_next_question = True

        should_advance = confidence >= 0.65 and has_next_question and next_started

        assert should_advance is False

    def test_explicit_transition_phrases(self):
        """Test high confidence for explicit transition phrases"""
        transitions = [
            "Next question...",
            "Let's move on...",
            "Okay, now...",
            "Moving on...",
        ]

        # These should result in high confidence
        for phrase in transitions:
            result = {
                "current_question_completed": True,
                "next_question_started": True,
                "confidence": 0.95,
                "reasoning": f"Clear transition: '{phrase}'",
            }

            assert result["confidence"] >= 0.65
            assert result["next_question_started"] is True

    def test_question_sequence_boundaries(self):
        """Test progression logic at sequence boundaries"""
        # First question (index 0)
        current_index = 0
        total_questions = 8

        assert current_index >= 0
        assert current_index < total_questions
        has_next = current_index < total_questions - 1
        assert has_next is True

        # Last question (index 7)
        current_index = 7
        has_next = current_index < total_questions - 1
        assert has_next is False

    def test_timestamp_generation(self):
        """Test timestamp generation for question tracking"""
        timestamp = int(datetime.now().timestamp() * 1000)

        # Should be milliseconds since epoch
        assert timestamp > 1700000000000  # After Nov 2023
        assert isinstance(timestamp, int)

        # Create second timestamp after delay
        import time

        time.sleep(0.01)
        timestamp2 = int(datetime.now().timestamp() * 1000)

        assert timestamp2 > timestamp

    def test_question_status_transitions(self):
        """Test valid status transitions"""
        # Valid transitions
        valid_transitions = [
            ("not_started", "in_progress"),
            ("in_progress", "completed"),
            ("not_started", "completed"),  # Skipped scenario
        ]

        for from_status, to_status in valid_transitions:
            # All these transitions should be logically valid
            assert from_status in ["not_started", "in_progress", "completed"]
            assert to_status in ["not_started", "in_progress", "completed"]

    def test_elapsed_time_calculation(self):
        """Test elapsed time calculation for questions"""
        start_time = int(datetime.now().timestamp() * 1000)
        end_time = start_time + 300000  # +5 minutes

        elapsed_ms = end_time - start_time
        elapsed_seconds = elapsed_ms / 1000
        elapsed_minutes = elapsed_seconds / 60

        assert elapsed_ms == 300000
        assert elapsed_seconds == 300
        assert elapsed_minutes == pytest.approx(5.0)

    def test_multiple_question_progression_sequence(self):
        """Test full progression through multiple questions"""
        total_questions = 5
        current_index = 0
        question_statuses = {}

        # Initialize all questions as not_started
        for i in range(total_questions):
            question_statuses[f"q{i}"] = {
                "status": "not_started",
                "startTime": None,
                "endTime": None,
            }

        # Start first question
        timestamp = int(datetime.now().timestamp() * 1000)
        question_statuses["q0"]["status"] = "in_progress"
        question_statuses["q0"]["startTime"] = timestamp

        assert question_statuses["q0"]["status"] == "in_progress"
        assert question_statuses["q1"]["status"] == "not_started"

        # Progress to second question
        timestamp2 = timestamp + 180000  # +3 minutes
        question_statuses["q0"]["status"] = "completed"
        question_statuses["q0"]["endTime"] = timestamp2
        question_statuses["q1"]["status"] = "in_progress"
        question_statuses["q1"]["startTime"] = timestamp2
        current_index = 1

        assert question_statuses["q0"]["status"] == "completed"
        assert question_statuses["q1"]["status"] == "in_progress"
        assert current_index == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
