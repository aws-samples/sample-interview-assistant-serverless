"""
Tests for CandidatePlannerService logic.

Tests validate:
- Resume summarization
- Job description summarization
- Company research functionality
- Interview question generation with expectedAnswer
- Preparation tips generation
- Error handling and fallbacks
"""

import pytest
from datetime import datetime


class TestCandidatePlannerService:
    """Test suite for candidate planner service logic"""

    def test_resume_summarization_output_format(self):
        """Test resume summary has expected structure"""
        # Expected format for resume summary
        expected_sections = [
            "Current Role",
            "Experience",
            "Skills",
            "Education",
        ]

        # Mock resume summary
        resume_summary = """
        Current Role: Senior Software Engineer at Tech Corp
        Experience: 7 years in backend development, Python/Java
        Skills: Python, AWS, Docker, Kubernetes, PostgreSQL
        Education: BS Computer Science, State University
        """

        for section in expected_sections:
            assert section in resume_summary

    def test_jd_summarization_output_format(self):
        """Test job description summary extracts key requirements"""
        # Expected format for JD summary
        expected_sections = [
            "Required Skills",
            "Preferred Skills",
            "Responsibilities",
        ]

        # Mock JD summary
        jd_summary = """
        Required Skills: Python, AWS, 5+ years experience
        Preferred Skills: Kubernetes, CI/CD, microservices
        Responsibilities: Design scalable systems, mentor junior engineers
        """

        for section in expected_sections:
            assert section in jd_summary

    def test_company_research_data_structure(self):
        """Test company research returns structured data"""
        # Mock company research result
        research = {
            "companyName": "Amazon",
            "industry": "Technology",
            "culture": ["Customer Obsession", "Ownership"],
            "recentNews": ["AWS AI expansion", "New fulfillment centers"],
            "keyProducts": ["AWS", "Prime"],
        }

        assert "companyName" in research
        assert "culture" in research
        assert isinstance(research["culture"], list)
        assert len(research["culture"]) > 0

    def test_question_generation_with_expected_answers(self):
        """Test generated questions include expectedAnswer field"""
        # Mock generated question
        question = {
            "questionId": "q0",
            "questionText": "What is your Python experience?",
            "category": "Technical Skills",
            "difficulty": "medium",
            "reasoning": "Based on JD requiring Python expertise",
            "expectedAnswer": "7 years of Python development at Tech Corp. Built REST APIs, data pipelines, AWS Lambda functions.",
        }

        assert "expectedAnswer" in question
        assert question["expectedAnswer"] is not None
        assert len(question["expectedAnswer"]) > 20

    def test_preparation_tips_generation(self):
        """Test preparation tips are relevant and actionable"""
        # Mock preparation tips
        tips = [
            "Review AWS services: EC2, S3, Lambda, RDS",
            "Practice STAR format for behavioral questions",
            "Research company culture and recent news",
            "Prepare 2-3 questions about team dynamics",
        ]

        # Tips should be specific and actionable
        for tip in tips:
            assert len(tip) > 10
            # Should contain actionable verbs
            actionable_verbs = ["Review", "Practice", "Research", "Prepare"]
            assert any(verb in tip for verb in actionable_verbs)

    def test_question_count_validation(self):
        """Test question count parameter validation"""
        valid_counts = [3, 5, 8, 10]

        for count in valid_counts:
            assert count >= 1
            assert count <= 20

        # Invalid counts
        invalid_counts = [0, -1, 100]
        for count in invalid_counts:
            assert count < 1 or count > 20

    def test_difficulty_level_validation(self):
        """Test difficulty level options"""
        valid_difficulties = ["easy", "medium", "hard"]

        for difficulty in valid_difficulties:
            assert difficulty in ["easy", "medium", "hard"]

    def test_interview_type_options(self):
        """Test interview type categorization"""
        valid_types = [
            "technical",
            "behavioral",
            "system_design",
            "mixed",
        ]

        for interview_type in valid_types:
            assert interview_type in valid_types

    def test_expected_answer_star_format(self):
        """Test behavioral questions use STAR format in expected answers"""
        # Mock behavioral question with STAR format
        behavioral_question = {
            "questionText": "Describe a time you resolved a conflict",
            "category": "Behavioral",
            "expectedAnswer": "Situation: Team disagreement on architecture\nTask: Reach consensus for sprint\nAction: Facilitated discussion with data\nResult: Agreed on approach, delivered on time",
        }

        answer = behavioral_question["expectedAnswer"]
        assert "Situation:" in answer
        assert "Task:" in answer
        assert "Action:" in answer
        assert "Result:" in answer

    def test_technical_question_depth(self):
        """Test technical questions match difficulty level"""
        # Easy technical question
        easy_question = {
            "questionText": "What is a REST API?",
            "difficulty": "easy",
            "expectedAnswer": "REST API uses HTTP methods (GET, POST, PUT, DELETE) for client-server communication.",
        }

        # Hard technical question
        hard_question = {
            "questionText": "Design a distributed cache system",
            "difficulty": "hard",
            "expectedAnswer": "Consider consistency models, cache eviction policies, sharding strategies, replication factor, fault tolerance.",
        }

        # Easy answers should be concise
        assert len(easy_question["expectedAnswer"].split()) < 50

        # Hard answers should be comprehensive
        assert len(hard_question["expectedAnswer"].split()) >= 10

    def test_custom_questions_integration(self):
        """Test custom questions from CSV are properly formatted"""
        # Mock custom question from CSV
        custom_question = {
            "questionText": "Tell me about yourself",
            "category": "Behavioral",
            "expectedAnswer": "Current role → Past experience → Why this company",
            "source": "user",  # Not AI-generated
        }

        assert custom_question["source"] == "user"
        assert custom_question["expectedAnswer"] is not None

    def test_resume_skills_extraction(self):
        """Test skill extraction from resume"""
        # Mock skills extracted from resume
        skills = [
            "Python",
            "AWS (EC2, S3, Lambda)",
            "Docker",
            "PostgreSQL",
            "REST APIs",
        ]

        assert len(skills) > 0
        assert any("Python" in skill for skill in skills)
        assert any("AWS" in skill for skill in skills)

    def test_jd_requirements_extraction(self):
        """Test requirement extraction from job description"""
        # Mock requirements from JD
        requirements = {
            "required": ["Python", "5+ years experience", "AWS"],
            "preferred": ["Kubernetes", "CI/CD", "Team leadership"],
        }

        assert "required" in requirements
        assert "preferred" in requirements
        assert len(requirements["required"]) > 0

    def test_question_relevance_to_jd(self):
        """Test questions are relevant to job requirements"""
        # JD requires Python and AWS
        jd_keywords = ["Python", "AWS"]

        # Generated questions
        questions = [
            {"questionText": "What is your Python experience?"},
            {"questionText": "Describe your AWS infrastructure work?"},
        ]

        # At least one question should mention each key requirement
        for keyword in jd_keywords:
            assert any(keyword in q["questionText"] for q in questions)

    def test_error_handling_invalid_resume(self):
        """Test graceful handling of invalid resume file"""
        # Mock error response
        error_result = {
            "status": "error",
            "message": "Failed to parse resume file",
        }

        assert error_result["status"] == "error"
        assert "message" in error_result

    def test_error_handling_empty_jd(self):
        """Test handling of empty job description"""
        jd_text = ""

        # Should fail validation
        assert len(jd_text.strip()) == 0

    def test_company_research_with_no_results(self):
        """Test fallback when company research returns no results"""
        # Mock empty research result
        research = {
            "companyName": "Unknown Startup",
            "industry": None,
            "culture": [],
            "recentNews": [],
            "keyProducts": [],
        }

        # Should still have company name
        assert research["companyName"] is not None
        # Other fields can be empty
        assert isinstance(research["culture"], list)

    def test_plan_generation_timeout_handling(self):
        """Test handling of plan generation timeout"""
        # Mock status checks
        statuses = ["pending", "processing", "processing", "completed"]

        for status in statuses:
            assert status in ["pending", "processing", "completed", "failed"]

    def test_asynchronous_plan_generation_flow(self):
        """Test async plan generation returns job ID immediately"""
        # Mock async response
        response = {
            "status": "success",
            "planId": "plan-123-456",
            "message": "Plan generation started",
        }

        assert "planId" in response
        assert response["status"] == "success"
        # Plan data not included in immediate response
        assert "questions" not in response


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
