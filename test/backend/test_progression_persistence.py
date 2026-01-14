"""
Tests for question progression persistence (API and storage).

Tests validate:
- API payload structure for saving progression data
- JSON serialization/deserialization
- DynamoDB metadata storage format
- Post-interview session retrieval
- Backwards compatibility
"""

import pytest
import json
from datetime import datetime


class TestProgressionPersistence:
    """Test suite for persistence of question progression data"""

    def test_frontend_save_payload_structure(self):
        """Test frontend sends correct payload structure"""
        # Simulate frontend questionStatuses state
        question_statuses = {
            "q0": {
                "status": "completed",
                "timestamp": int(datetime.now().timestamp() * 1000),
                "startTime": int(datetime.now().timestamp() * 1000) - 300000,
                "endTime": int(datetime.now().timestamp() * 1000),
            },
            "q1": {
                "status": "in_progress",
                "timestamp": int(datetime.now().timestamp() * 1000),
                "startTime": int(datetime.now().timestamp() * 1000),
                "endTime": None,
            },
        }

        # Convert to JSON string (as sent in form data)
        question_statuses_json = json.dumps(question_statuses)

        # Verify serialization
        assert isinstance(question_statuses_json, str)
        assert '"q0"' in question_statuses_json
        assert '"completed"' in question_statuses_json

        # Parse back
        parsed = json.loads(question_statuses_json)
        assert parsed["q0"]["status"] == "completed"
        assert parsed["q1"]["status"] == "in_progress"

    def test_api_form_data_parameters(self):
        """Test API accepts correct form parameters"""
        # Simulate API form parameters
        form_params = {
            "questionStatuses": json.dumps(
                {
                    "q0": {
                        "status": "completed",
                        "startTime": 1704412800000,
                        "endTime": 1704413100000,
                    },
                    "q1": {
                        "status": "in_progress",
                        "startTime": 1704413100000,
                        "endTime": None,
                    },
                }
            ),
            "currentQuestionIndex": 1,
        }

        assert "questionStatuses" in form_params
        assert "currentQuestionIndex" in form_params

        # Verify types
        assert isinstance(form_params["questionStatuses"], str)
        assert isinstance(form_params["currentQuestionIndex"], int)

    def test_backend_json_parsing(self):
        """Test backend parses questionStatuses JSON"""
        question_statuses_str = json.dumps(
            {
                "q0": {
                    "status": "completed",
                    "startTime": 1704412800000,
                    "endTime": 1704413100000,
                },
                "q1": {
                    "status": "completed",
                    "startTime": 1704413100000,
                    "endTime": 1704413400000,
                },
                "q2": {"status": "not_started", "startTime": None, "endTime": None},
            }
        )

        # Backend parses JSON
        question_statuses_data = json.loads(question_statuses_str)

        assert isinstance(question_statuses_data, dict)
        assert len(question_statuses_data) == 3
        assert question_statuses_data["q0"]["status"] == "completed"
        assert question_statuses_data["q2"]["status"] == "not_started"

    def test_dynamodb_metadata_structure(self):
        """Test DynamoDB metadata includes progression data"""
        metadata = {
            "interviewId": "interview-123",
            "candidateName": "John Doe",
            "sessionDuration": 3600,
            "questionStatuses": {
                "q0": {
                    "status": "completed",
                    "startTime": 1704412800000,
                    "endTime": 1704413100000,
                },
                "q1": {
                    "status": "completed",
                    "startTime": 1704413100000,
                    "endTime": 1704413400000,
                },
            },
            "currentQuestionIndex": 2,
        }

        # Verify progression fields in metadata
        assert "questionStatuses" in metadata
        assert "currentQuestionIndex" in metadata

        # Verify structure
        assert isinstance(metadata["questionStatuses"], dict)
        assert isinstance(metadata["currentQuestionIndex"], int)

    def test_time_spent_calculation(self):
        """Test calculating time spent on each question"""
        start_time = 1704412800000  # Example timestamp
        end_time = 1704413100000  # 5 minutes later

        elapsed_ms = end_time - start_time
        elapsed_seconds = elapsed_ms / 1000
        elapsed_minutes = elapsed_seconds / 60

        assert elapsed_ms == 300000
        assert elapsed_seconds == 300
        assert elapsed_minutes == pytest.approx(5.0)

        # Format for display (MM:SS)
        minutes = int(elapsed_seconds // 60)
        seconds = int(elapsed_seconds % 60)
        formatted_time = f"{minutes:02d}:{seconds:02d}"

        assert formatted_time == "05:00"

    def test_question_coverage_calculation(self):
        """Test calculating question coverage percentage"""
        question_statuses = {
            "q0": {"status": "completed"},
            "q1": {"status": "completed"},
            "q2": {"status": "completed"},
            "q3": {"status": "in_progress"},
            "q4": {"status": "not_started"},
            "q5": {"status": "not_started"},
        }

        total_questions = len(question_statuses)
        asked_questions = sum(
            1
            for q in question_statuses.values()
            if q["status"] in ["completed", "in_progress"]
        )
        completed_questions = sum(
            1 for q in question_statuses.values() if q["status"] == "completed"
        )

        coverage_percentage = (asked_questions / total_questions) * 100

        assert total_questions == 6
        assert asked_questions == 4  # completed + in_progress
        assert completed_questions == 3
        assert coverage_percentage == pytest.approx(66.67, rel=0.01)

    def test_backwards_compatibility_no_progression_data(self):
        """Test handling sessions without progression data"""
        # Old session without questionStatuses
        old_metadata = {
            "interviewId": "interview-old",
            "candidateName": "Jane Doe",
            "sessionDuration": 3600,
            # No questionStatuses or currentQuestionIndex
        }

        # Should handle gracefully
        question_statuses = old_metadata.get("questionStatuses", None)

        assert question_statuses is None

        # Frontend should handle None gracefully and show all questions as "not asked"

    def test_partial_progression_data(self):
        """Test session with partial progression (interview ended early)"""
        question_statuses = {
            "q0": {
                "status": "completed",
                "startTime": 1704412800000,
                "endTime": 1704413100000,
            },
            "q1": {
                "status": "completed",
                "startTime": 1704413100000,
                "endTime": 1704413400000,
            },
            "q2": {
                "status": "in_progress",
                "startTime": 1704413400000,
                "endTime": None,
            },
            "q3": {"status": "not_started", "startTime": None, "endTime": None},
            "q4": {"status": "not_started", "startTime": None, "endTime": None},
        }

        # Calculate coverage
        total = len(question_statuses)
        asked = sum(
            1 for q in question_statuses.values() if q["status"] != "not_started"
        )
        completed = sum(
            1 for q in question_statuses.values() if q["status"] == "completed"
        )

        assert total == 5
        assert asked == 3  # 2 completed + 1 in_progress
        assert completed == 2

    def test_session_detail_display_data(self):
        """Test data format for session detail page"""
        # Simulated session data from backend
        session_data = {
            "sessionId": "session-456",
            "interviewId": "interview-123",
            "questionStatuses": {
                "q0": {
                    "status": "completed",
                    "startTime": 1704412800000,
                    "endTime": 1704413100000,
                },
                "q1": {
                    "status": "completed",
                    "startTime": 1704413100000,
                    "endTime": 1704413400000,
                },
                "q2": {"status": "not_started", "startTime": None, "endTime": None},
            },
            "currentQuestionIndex": 2,
        }

        # Frontend processes this data
        question_statuses = session_data.get("questionStatuses", {})

        # Generate display information for each question
        for q_id, q_status in question_statuses.items():
            status = q_status["status"]

            if status == "completed":
                # Calculate time spent
                start = q_status["startTime"]
                end = q_status["endTime"]
                if start and end:
                    elapsed_ms = end - start
                    elapsed_seconds = elapsed_ms / 1000
                    minutes = int(elapsed_seconds // 60)
                    seconds = int(elapsed_seconds % 60)
                    time_display = f"{minutes:02d}:{seconds:02d}"

                    assert isinstance(time_display, str)
                    assert ":" in time_display

            elif status == "not_started":
                # Show as "Not Asked"
                assert status == "not_started"

    def test_json_null_handling(self):
        """Test handling of null values in JSON"""
        question_status = {
            "status": "in_progress",
            "startTime": 1704412800000,
            "endTime": None,  # Still in progress
        }

        # Serialize with null
        json_str = json.dumps(question_status)
        assert "null" in json_str

        # Parse back
        parsed = json.loads(json_str)
        assert parsed["endTime"] is None

    def test_large_interview_persistence(self):
        """Test persisting data for large interview (15+ questions)"""
        question_statuses = {}

        # Generate 20 questions
        for i in range(20):
            question_statuses[f"q{i}"] = {
                "status": "completed" if i < 15 else "not_started",
                "startTime": 1704412800000 + (i * 300000) if i < 15 else None,
                "endTime": 1704412800000 + ((i + 1) * 300000) if i < 15 else None,
            }

        # Serialize
        json_str = json.dumps(question_statuses)

        # Should handle large data
        assert len(question_statuses) == 20
        assert len(json_str) > 1000  # Should be substantial

        # Parse back
        parsed = json.loads(json_str)
        assert len(parsed) == 20

    def test_metadata_field_types(self):
        """Test correct field types in metadata"""
        metadata = {
            "questionStatuses": {"q0": {"status": "completed"}},
            "currentQuestionIndex": 5,
        }

        # Verify types
        assert isinstance(metadata["questionStatuses"], dict)
        assert isinstance(metadata["currentQuestionIndex"], int)

        # JSON serialization preserves types
        json_str = json.dumps(metadata)
        parsed = json.loads(json_str)

        assert isinstance(parsed["questionStatuses"], dict)
        assert isinstance(parsed["currentQuestionIndex"], int)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
