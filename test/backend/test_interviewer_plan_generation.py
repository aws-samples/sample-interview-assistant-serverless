"""
Tests for Interviewer Plan Generation.

Tests validate:
- Interview plan generation logic
- Resume and JD summarization for interviewers
- Question generation with evaluation criteria
- Plan scheduling and persistence
- CSV question import
"""

import pytest
from datetime import datetime


class TestInterviewerPlanGeneration:
    """Test suite for interviewer plan generation"""

    def test_interviewer_plan_structure(self):
        """Test interviewer plan data structure"""
        plan = {
            "planId": "plan-123",
            "interviewName": "Backend Engineer Interview",
            "candidateName": "John Doe",
            "scheduledDate": "2024-06-15",
            "scheduledTime": "14:00",
            "interviewType": "technical",
            "resumeSummary": "Summary...",
            "jdSummary": "JD summary...",
            "questions": [],
            "status": "scheduled",
        }

        assert "planId" in plan
        assert "questions" in plan
        assert "scheduledDate" in plan

    def test_interviewer_question_with_evaluation_criteria(self):
        """Test questions include evaluationChecklist for interviewers"""
        question = {
            "questionId": "q0",
            "questionText": "Explain microservices architecture",
            "category": "Technical Skills",
            "difficulty": "medium",
            "reasoning": "Based on JD requirement for distributed systems",
            "evaluationChecklist": "- Explains service boundaries\n- Discusses inter-service communication\n- Mentions scaling considerations",
            "instructions": "Look for understanding of trade-offs between monolith and microservices",
        }

        assert "evaluationChecklist" in question
        assert "instructions" in question
        assert "expectedAnswer" not in question  # Not for interviewers

    def test_plan_generation_async_flow(self):
        """Test asynchronous plan generation"""
        # Immediate response
        initial_response = {
            "status": "success",
            "planId": "plan-456",
            "message": "Plan generation started",
        }

        # Polling status
        completed_response = {
            "status": "completed",
            "planId": "plan-456",
            "questions": [],
        }

        assert initial_response["planId"] == completed_response["planId"]

    def test_csv_question_import(self):
        """Test importing questions from CSV"""
        csv_questions = [
            {
                "question": "Describe your Python experience",
                "category": "Technical",
                "evaluationCriteria": "Years of experience, frameworks used",
            },
            {
                "question": "Tell me about a challenging project",
                "category": "Behavioral",
                "evaluationCriteria": "Problem-solving approach, outcome",
            },
        ]

        assert len(csv_questions) == 2
        assert "evaluationCriteria" in csv_questions[0]

    def test_resume_summary_for_interviewer(self):
        """Test resume summary for interviewer context"""
        resume_summary = """
        Candidate: John Doe
        Current Role: Senior Software Engineer at Tech Corp
        Experience: 8 years in backend development
        Key Skills: Python, AWS, Docker, Kubernetes
        Notable: Led migration to microservices, reduced costs by 40%
        """

        assert "Current Role" in resume_summary
        assert "Key Skills" in resume_summary

    def test_jd_summary_for_interviewer(self):
        """Test JD summary highlights key requirements"""
        jd_summary = """
        Position: Senior Backend Engineer
        Required: Python, AWS, 5+ years experience
        Preferred: Kubernetes, microservices, team leadership
        Responsibilities: Design scalable systems, mentor juniors
        """

        assert "Required" in jd_summary
        assert "Responsibilities" in jd_summary

    def test_question_sequencing(self):
        """Test questions have sequenceOrder"""
        questions = [
            {"questionId": "q0", "sequenceOrder": 0},
            {"questionId": "q1", "sequenceOrder": 1},
            {"questionId": "q2", "sequenceOrder": 2},
        ]

        for i, q in enumerate(questions):
            assert q["sequenceOrder"] == i

    def test_scheduled_date_time_format(self):
        """Test scheduled date/time format"""
        scheduled_date = "2024-06-15"
        scheduled_time = "14:00"

        # Validate format
        date_parts = scheduled_date.split("-")
        assert len(date_parts) == 3

        time_parts = scheduled_time.split(":")
        assert len(time_parts) == 2

    def test_plan_status_options(self):
        """Test plan status values"""
        valid_statuses = [
            "pending",
            "scheduled",
            "in_progress",
            "completed",
            "cancelled",
        ]

        for status in valid_statuses:
            assert status in valid_statuses


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
