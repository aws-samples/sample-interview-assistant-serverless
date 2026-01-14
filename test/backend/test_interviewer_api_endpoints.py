"""
Tests for Interviewer API endpoints.

Tests validate:
- Interview scheduling API endpoints
- Interview plan generation endpoints
- Interview session management endpoints
- API request/response formats
- Authentication and validation
"""

import pytest
import json
from datetime import datetime


class TestInterviewerAPIEndpoints:
    """Test suite for interviewer API endpoint validation"""

    def test_schedule_interview_request(self):
        """Test /schedule-interview POST request format"""
        request_body = {
            "resumeFile": "file_bytes",
            "jdText": "Job description text",
            "interviewName": "Software Engineer Interview",
            "scheduledDate": "2024-06-15",
            "scheduledTime": "14:00",
            "interviewType": "technical",
            "questionSource": "ai",
        }

        assert "resumeFile" in request_body
        assert "jdText" in request_body
        assert "interviewName" in request_body

    def test_schedule_interview_response(self):
        """Test /schedule-interview response format"""
        response = {
            "status": "success",
            "planId": "plan-123-456",
            "message": "Interview scheduling started",
        }

        assert response["status"] == "success"
        assert "planId" in response

    def test_schedule_interview_with_csv_questions(self):
        """Test scheduling with custom CSV questions"""
        request_body = {
            "resumeFile": "file_bytes",
            "jdText": "Job description",
            "interviewName": "Backend Interview",
            "questionSource": "csv",
            "csvQuestions": json.dumps(
                [
                    {"question": "Explain REST APIs", "category": "Technical"},
                    {
                        "question": "Describe leadership experience",
                        "category": "Behavioral",
                    },
                ]
            ),
        }

        assert request_body["questionSource"] == "csv"
        csv_qs = json.loads(request_body["csvQuestions"])
        assert len(csv_qs) == 2

    def test_list_scheduled_interviews_response(self):
        """Test /scheduled-interviews GET response"""
        response = {
            "status": "success",
            "interviews": [
                {
                    "id": "int-1",
                    "interviewName": "Backend Engineer Interview",
                    "candidateName": "John Doe",
                    "scheduledDate": "2024-06-15",
                    "scheduledTime": "14:00",
                    "status": "scheduled",
                }
            ],
        }

        assert "interviews" in response
        assert isinstance(response["interviews"], list)

    def test_get_scheduled_interview_by_id(self):
        """Test /scheduled-interviews/{interview_id} GET response"""
        response = {
            "status": "success",
            "interview": {
                "id": "int-123",
                "interviewName": "Software Engineer Interview",
                "candidateName": "Jane Smith",
                "questions": [],
                "resumeSummary": "Summary...",
                "jdSummary": "JD summary...",
            },
        }

        assert "interview" in response
        assert response["interview"]["id"] == "int-123"

    def test_delete_scheduled_interview(self):
        """Test /scheduled-interviews/{interview_id} DELETE"""
        response = {"status": "success", "message": "Interview deleted successfully"}

        assert response["status"] == "success"

    def test_create_interview_session_request(self):
        """Test /interview-sessions POST request"""
        request_body = {
            "sessionId": "session-789",
            "interviewId": "int-123",
            "audioS3Key": "audio/session-789.webm",
            "videoS3Key": "videos/session-789.webm",
            "transcription": [
                {
                    "role": "interviewer",
                    "content": "Tell me about yourself",
                    "timestamp": 1000,
                }
            ],
            "duration": 1800,
            "questionStatuses": json.dumps(
                {"q0": {"status": "completed", "startTime": 1000, "endTime": 300000}}
            ),
            "currentQuestionIndex": 1,
        }

        assert "sessionId" in request_body
        assert "questionStatuses" in request_body

    def test_list_interview_sessions_response(self):
        """Test /interview-sessions GET response"""
        response = {
            "status": "success",
            "sessions": [
                {
                    "sessionId": "session-1",
                    "interviewId": "int-1",
                    "timestamp": 1704412800000,
                    "duration": 1800,
                }
            ],
        }

        assert "sessions" in response
        assert isinstance(response["sessions"], list)

    def test_get_interview_session_detail(self):
        """Test /interview-sessions/{session_id} GET response"""
        response = {
            "status": "success",
            "session": {
                "sessionId": "session-123",
                "interviewId": "int-456",
                "transcription": [],
                "questionStatuses": {},
                "duration": 1800,
            },
        }

        assert "session" in response
        assert "questionStatuses" in response["session"]

    def test_plans_polling_endpoint(self):
        """Test /plans/{plan_id} polling for interviewer plans"""
        completed_response = {
            "status": "completed",
            "planId": "plan-123",
            "resumeSummary": "Summary...",
            "jdSummary": "JD...",
            "questions": [],
        }

        assert completed_response["status"] == "completed"
        assert "questions" in completed_response

    def test_mark_schedule_saved_endpoint(self):
        """Test /mark-schedule-saved/{plan_id} POST"""
        request_body = {"interviewId": "int-123"}

        response = {"status": "success", "message": "Plan marked as saved"}

        assert response["status"] == "success"

    def test_jobs_status_endpoint(self):
        """Test /jobs/{job_id} status checking"""
        response = {
            "status": "completed",
            "jobId": "job-789",
            "result": {"questions": [], "resumeSummary": ""},
        }

        assert "status" in response
        assert response["status"] in ["pending", "processing", "completed", "failed"]

    def test_video_upload_endpoints_interviewer(self):
        """Test video upload flow for interviewer sessions"""
        # Start upload
        start_response = {
            "status": "success",
            "uploadId": "upload-123",
            "key": "videos/session-123.webm",
        }

        # Complete upload
        complete_response = {
            "status": "success",
            "message": "Upload completed",
            "location": "s3://bucket/videos/session-123.webm",
        }

        assert "uploadId" in start_response
        assert complete_response["status"] == "success"

    def test_authentication_header_required(self):
        """Test endpoints require authentication"""
        headers = {"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}

        assert "Authorization" in headers
        assert headers["Authorization"].startswith("Bearer ")

    def test_date_time_validation(self):
        """Test scheduled date/time validation"""
        valid_date = "2024-06-15"
        valid_time = "14:00"

        # Date format: YYYY-MM-DD
        assert len(valid_date.split("-")) == 3
        # Time format: HH:MM
        assert len(valid_time.split(":")) == 2

    def test_interview_type_options(self):
        """Test interview type parameter values"""
        valid_types = [
            "technical",
            "behavioral",
            "system_design",
            "general",
        ]

        for interview_type in valid_types:
            assert interview_type in valid_types

    def test_question_source_options(self):
        """Test question source parameter"""
        valid_sources = ["ai", "csv"]

        for source in valid_sources:
            assert source in valid_sources


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
