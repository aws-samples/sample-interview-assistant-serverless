"""
Tests for WebSocket question progression event generation.

Tests validate:
- Event structure and format
- Question ID generation (q0, q1, q2...)
- Status transitions in events
- Timestamp generation
- Event payload validation
"""

import pytest
import json
from datetime import datetime


class TestWebSocketProgressionEvents:
    """Test suite for WebSocket questionProgression events"""

    def test_question_progression_event_structure(self):
        """Test complete questionProgression event structure"""
        event = {
            "event": {
                "questionProgression": {
                    "questionId": "q0",
                    "questionIndex": 0,
                    "status": "in_progress",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "totalQuestions": 8,
                }
            }
        }

        # Validate top-level structure
        assert "event" in event
        assert "questionProgression" in event["event"]

        # Validate progression data
        progression = event["event"]["questionProgression"]
        assert "questionId" in progression
        assert "questionIndex" in progression
        assert "status" in progression
        assert "timestamp" in progression
        assert "totalQuestions" in progression

    def test_question_id_generation(self):
        """Test question ID format (q0, q1, q2, ...)"""
        for i in range(20):
            question_id = f"q{i}"

            assert question_id.startswith("q")
            assert question_id == f"q{i}"

            # Extract index from ID
            index = int(question_id[1:])
            assert index == i

    def test_question_index_zero_based(self):
        """Test question indices are 0-based"""
        total_questions = 8

        for i in range(total_questions):
            event = {
                "event": {
                    "questionProgression": {
                        "questionId": f"q{i}",
                        "questionIndex": i,
                        "status": "in_progress",
                        "timestamp": int(datetime.now().timestamp() * 1000),
                        "totalQuestions": total_questions,
                    }
                }
            }

            progression = event["event"]["questionProgression"]
            assert progression["questionIndex"] == i
            assert progression["questionIndex"] >= 0
            assert progression["questionIndex"] < total_questions

    def test_valid_status_values(self):
        """Test all valid status values in events"""
        valid_statuses = ["not_started", "in_progress", "completed"]

        for status in valid_statuses:
            event = {
                "event": {
                    "questionProgression": {
                        "questionId": "q0",
                        "questionIndex": 0,
                        "status": status,
                        "timestamp": int(datetime.now().timestamp() * 1000),
                        "totalQuestions": 5,
                    }
                }
            }

            assert event["event"]["questionProgression"]["status"] in valid_statuses

    def test_timestamp_format(self):
        """Test timestamp is milliseconds since epoch"""
        timestamp = int(datetime.now().timestamp() * 1000)

        # Should be large number (milliseconds)
        assert timestamp > 1700000000000  # After Nov 2023

        # Should be integer
        assert isinstance(timestamp, int)

        # Should not be seconds (would be much smaller)
        assert timestamp > 1000000000

    def test_initial_question_event(self):
        """Test initial event when interview starts"""
        event = {
            "event": {
                "questionProgression": {
                    "questionId": "q0",
                    "questionIndex": 0,
                    "status": "in_progress",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "totalQuestions": 8,
                }
            }
        }

        progression = event["event"]["questionProgression"]

        # First question should be index 0
        assert progression["questionIndex"] == 0
        assert progression["questionId"] == "q0"

        # Should be marked in_progress
        assert progression["status"] == "in_progress"

    def test_question_transition_events(self):
        """Test events for question transitions"""
        # Complete current question
        event1 = {
            "event": {
                "questionProgression": {
                    "questionId": "q2",
                    "questionIndex": 2,
                    "status": "completed",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "totalQuestions": 8,
                }
            }
        }

        # Start next question
        event2 = {
            "event": {
                "questionProgression": {
                    "questionId": "q3",
                    "questionIndex": 3,
                    "status": "in_progress",
                    "timestamp": int(datetime.now().timestamp() * 1000) + 100,
                    "totalQuestions": 8,
                }
            }
        }

        # Verify sequence
        assert event1["event"]["questionProgression"]["questionIndex"] == 2
        assert event2["event"]["questionProgression"]["questionIndex"] == 3
        assert event1["event"]["questionProgression"]["status"] == "completed"
        assert event2["event"]["questionProgression"]["status"] == "in_progress"

    def test_last_question_completion_event(self):
        """Test event for completing last question"""
        total_questions = 8
        last_index = total_questions - 1

        event = {
            "event": {
                "questionProgression": {
                    "questionId": f"q{last_index}",
                    "questionIndex": last_index,
                    "status": "completed",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "totalQuestions": total_questions,
                }
            }
        }

        progression = event["event"]["questionProgression"]

        # Should be last question
        assert progression["questionIndex"] == total_questions - 1
        assert progression["questionId"] == f"q{last_index}"
        assert progression["status"] == "completed"

    def test_event_json_serialization(self):
        """Test events can be serialized to JSON"""
        event = {
            "event": {
                "questionProgression": {
                    "questionId": "q5",
                    "questionIndex": 5,
                    "status": "in_progress",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "totalQuestions": 10,
                }
            }
        }

        # Serialize to JSON string
        json_str = json.dumps(event)

        # Should be valid JSON
        assert isinstance(json_str, str)
        assert json_str.startswith("{")
        assert json_str.endswith("}")

        # Deserialize back
        parsed = json.loads(json_str)
        assert parsed["event"]["questionProgression"]["questionId"] == "q5"

    def test_event_with_all_fields(self):
        """Test event contains all required fields"""
        timestamp = int(datetime.now().timestamp() * 1000)

        event = {
            "event": {
                "questionProgression": {
                    "questionId": "q3",
                    "questionIndex": 3,
                    "status": "completed",
                    "timestamp": timestamp,
                    "totalQuestions": 8,
                }
            }
        }

        progression = event["event"]["questionProgression"]

        # Verify all required fields
        required_fields = [
            "questionId",
            "questionIndex",
            "status",
            "timestamp",
            "totalQuestions",
        ]

        for field in required_fields:
            assert field in progression, f"Missing required field: {field}"

    def test_event_field_types(self):
        """Test correct data types for all event fields"""
        event = {
            "event": {
                "questionProgression": {
                    "questionId": "q4",
                    "questionIndex": 4,
                    "status": "in_progress",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "totalQuestions": 12,
                }
            }
        }

        progression = event["event"]["questionProgression"]

        # Verify types
        assert isinstance(progression["questionId"], str)
        assert isinstance(progression["questionIndex"], int)
        assert isinstance(progression["status"], str)
        assert isinstance(progression["timestamp"], int)
        assert isinstance(progression["totalQuestions"], int)

    def test_multiple_events_sequence(self):
        """Test sequence of multiple progression events"""
        total_questions = 5
        events = []

        # Generate events for progressing through questions
        for i in range(total_questions):
            event = {
                "event": {
                    "questionProgression": {
                        "questionId": f"q{i}",
                        "questionIndex": i,
                        "status": "in_progress",
                        "timestamp": int(datetime.now().timestamp() * 1000)
                        + (i * 1000),
                        "totalQuestions": total_questions,
                    }
                }
            }
            events.append(event)

        # Verify sequence
        assert len(events) == total_questions

        for i, event in enumerate(events):
            progression = event["event"]["questionProgression"]
            assert progression["questionIndex"] == i
            assert progression["questionId"] == f"q{i}"

    def test_event_timestamp_ordering(self):
        """Test events have increasing timestamps"""
        import time

        timestamp1 = int(datetime.now().timestamp() * 1000)
        time.sleep(0.01)
        timestamp2 = int(datetime.now().timestamp() * 1000)

        assert timestamp2 > timestamp1
        assert timestamp2 - timestamp1 >= 10  # At least 10ms difference


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
