"""
Tests for Candidate Interview Plan data models.

Tests validate:
- InterviewQuestion model with expectedAnswer field (for candidates)
- InterviewPlan model structure and validation
- CompanyResearch model for company context
- JSON serialization/deserialization
- Field validation and constraints
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

from interview_planner_models import InterviewQuestion, InterviewPlan, CompanyResearch


class TestCandidateInterviewQuestion:
    """Test suite for candidate interview questions with expectedAnswer"""

    def test_candidate_question_with_expected_answer(self):
        """Test candidate question includes expectedAnswer field"""
        question = InterviewQuestion(
            questionId="q0",
            questionText="Tell me about your Python experience",
            category="Technical Skills",
            difficulty="medium",
            reasoning="Based on resume showing 5 years of Python development",
            expectedAnswer="Current role at Company X → Past projects with Django/Flask → Key achievements with metrics",
        )

        assert question.questionId == "q0"
        assert question.questionText == "Tell me about your Python experience"
        assert question.expectedAnswer is not None
        assert "Company X" in question.expectedAnswer
        assert question.difficulty == "medium"

    def test_candidate_question_without_expected_answer(self):
        """Test expectedAnswer is optional"""
        question = InterviewQuestion(
            questionId="q1",
            questionText="Describe a challenging project",
            category="Behavioral",
            difficulty="hard",
            reasoning="Tests problem-solving skills",
            expectedAnswer=None,
        )

        assert question.expectedAnswer is None

    def test_question_with_evaluation_criteria_candidate_view(self):
        """Test questions can have evaluation criteria for self-assessment"""
        question = InterviewQuestion(
            questionId="q2",
            questionText="Design a scalable URL shortener",
            category="System Design",
            difficulty="hard",
            reasoning="Common system design question for backend roles",
            expectedAnswer="1) Requirements: URL shortening and redirection\n2) Components: API server, Database, Cache\n3) Scale considerations: Read-heavy, need caching",
            evaluationChecklist="- Identified functional requirements\n- Discussed scale considerations\n- Proposed caching strategy\n- Addressed database choice",
        )

        assert question.evaluationChecklist is not None
        assert "caching" in question.evaluationChecklist.lower()
        assert question.expectedAnswer is not None

    def test_behavioral_question_with_star_format(self):
        """Test behavioral questions guide STAR format responses"""
        question = InterviewQuestion(
            questionId="q3",
            questionText="Describe a time you resolved a conflict with a team member",
            category="Behavioral",
            difficulty="medium",
            reasoning="Assesses interpersonal skills critical for team collaboration",
            expectedAnswer="Situation: Working on feature X with conflicting opinions\nTask: Needed to reach consensus for sprint deadline\nAction: Scheduled 1:1 discussion, presented data analysis\nResult: Agreed on approach, delivered on time with 95% test coverage",
        )

        expected = question.expectedAnswer
        assert "Situation:" in expected
        assert "Task:" in expected
        assert "Action:" in expected
        assert "Result:" in expected

    def test_company_specific_question_with_research(self):
        """Test company-specific questions reference company research"""
        question = InterviewQuestion(
            questionId="q4",
            questionText="Why do you want to work at Amazon?",
            category="Company-Specific",
            difficulty="easy",
            reasoning="Standard company fit question",
            expectedAnswer="1) Leadership Principles alignment (especially Customer Obsession)\n2) Scale: Work on systems serving millions\n3) Innovation: Recent AWS launches in AI/ML\n4) Career growth: Strong internal mobility",
        )

        assert "Leadership Principles" in question.expectedAnswer
        assert question.category == "Company-Specific"


class TestInterviewPlan:
    """Test suite for InterviewPlan model (candidate preparation plans)"""

    def test_interview_plan_creation(self):
        """Test creating a complete interview plan"""
        questions = [
            InterviewQuestion(
                questionId="q0",
                questionText="What is your Python experience?",
                category="Technical",
                difficulty="medium",
                reasoning="Based on resume",
                expectedAnswer="5 years of Python development",
            ),
            InterviewQuestion(
                questionId="q1",
                questionText="Describe a challenging project",
                category="Behavioral",
                difficulty="hard",
                reasoning="Problem-solving assessment",
                expectedAnswer="STAR format response",
            ),
        ]

        plan = InterviewPlan(
            questions=questions,
            totalQuestions=len(questions),
            preparationTips=[
                "Review AWS services mentioned in JD",
                "Practice STAR format for behavioral questions",
                "Prepare questions about team structure",
            ],
        )

        assert len(plan.questions) == 2
        assert plan.totalQuestions == 2
        assert len(plan.preparationTips) == 3
        assert "AWS services" in plan.preparationTips[0]

    def test_interview_plan_serialization(self):
        """Test InterviewPlan serializes to JSON correctly"""
        questions = [
            InterviewQuestion(
                questionId="q0",
                questionText="Test question",
                category="Technical",
                difficulty="easy",
                reasoning="Test",
                expectedAnswer="Test answer",
            )
        ]

        plan = InterviewPlan(
            questions=questions,
            totalQuestions=len(questions),
            preparationTips=["Tip 1", "Tip 2"],
        )

        plan_dict = plan.model_dump()

        assert "questions" in plan_dict
        assert len(plan_dict["questions"]) == 1
        assert plan_dict["questions"][0]["expectedAnswer"] == "Test answer"
        assert len(plan_dict["preparationTips"]) == 2
        assert plan_dict["totalQuestions"] == 1


class TestCompanyResearch:
    """Test suite for CompanyResearch model"""

    def test_company_research_structure(self):
        """Test CompanyResearch model captures company context"""
        research = CompanyResearch(
            companyName="Amazon",
            industry="Technology / E-commerce",
            culture=[
                "Customer Obsession",
                "Ownership",
                "Invent and Simplify",
            ],
            interviewProcess=[
                "Phone screen",
                "Technical rounds (2-3)",
                "Behavioral interview with Bar Raiser",
                "Final decision and offer",
            ],
        )

        assert research.companyName == "Amazon"
        assert len(research.culture) == 3
        assert "Customer Obsession" in research.culture
        assert len(research.interviewProcess) == 4
        assert isinstance(research.interviewProcess, list)

    def test_company_research_optional_fields(self):
        """Test CompanyResearch with minimal information"""
        research = CompanyResearch(
            companyName="Startup XYZ",
            industry=None,
            culture=[],
            recentNews=[],
            keyProducts=[],
        )

        assert research.companyName == "Startup XYZ"
        assert research.industry is None
        assert len(research.culture) == 0

    def test_company_research_json_serialization(self):
        """Test CompanyResearch serializes properly"""
        research = CompanyResearch(
            companyName="Google",
            industry="Technology",
            culture=["Innovation", "Collaboration"],
            interviewProcess=[
                "Phone screen",
                "Multiple technical rounds",
                "Team fit interview",
            ],
        )

        research_dict = research.model_dump()

        assert research_dict["companyName"] == "Google"
        assert len(research_dict["culture"]) == 2
        assert len(research_dict["interviewProcess"]) == 3
        assert "Phone screen" in research_dict["interviewProcess"]


class TestCandidatePlanIntegration:
    """Integration tests for complete candidate preparation plan"""

    def test_complete_candidate_plan(self):
        """Test a complete candidate preparation plan with all components"""
        # Company research
        company = CompanyResearch(
            companyName="Microsoft",
            industry="Technology",
            culture=["Growth Mindset", "Customer Focus", "Diversity & Inclusion"],
            recentNews=["Azure AI expansion", "GitHub Copilot updates"],
            keyProducts=["Azure", "Office 365", "GitHub"],
        )

        # Questions with expected answers
        questions = [
            InterviewQuestion(
                questionId="q0",
                questionText="Explain your cloud computing experience",
                category="Technical Skills",
                difficulty="medium",
                reasoning="Position requires Azure knowledge",
                expectedAnswer="3 years with AWS, learning Azure for this role. Experience with EC2, S3, Lambda. Understanding of cloud architecture patterns.",
            ),
            InterviewQuestion(
                questionId="q1",
                questionText="Tell me about a time you failed and what you learned",
                category="Behavioral",
                difficulty="medium",
                reasoning="Growth Mindset is a core value",
                expectedAnswer="Situation: Missed sprint deadline\nTask: Deliver feature on time\nAction: Underestimated complexity, didn't ask for help\nResult: Learned to break down tasks better and communicate blockers early",
            ),
            InterviewQuestion(
                questionId="q2",
                questionText="Why Microsoft?",
                category="Company-Specific",
                difficulty="easy",
                reasoning="Standard motivation question",
                expectedAnswer="Impressed by Growth Mindset culture. Excited about Azure's AI capabilities. Want to work on products used by billions.",
            ),
        ]

        # Preparation tips
        tips = [
            "Review Azure fundamentals (compute, storage, networking)",
            "Practice STAR format for behavioral questions focusing on growth mindset",
            "Prepare 2-3 thoughtful questions about team culture and growth opportunities",
            "Research recent Azure AI announcements",
        ]

        # Complete plan
        plan = InterviewPlan(
            questions=questions,
            totalQuestions=len(questions),
            preparationTips=tips,
        )

        # Validate complete plan
        assert len(plan.questions) == 3
        assert plan.totalQuestions == 3
        assert len(plan.preparationTips) == 4

        # Verify questions have expected answers
        for question in plan.questions:
            assert question.expectedAnswer is not None
            assert len(question.expectedAnswer) > 0

        # Verify question categories
        categories = [q.category for q in plan.questions]
        assert "Technical Skills" in categories
        assert "Behavioral" in categories
        assert "Company-Specific" in categories

    def test_plan_with_difficulty_levels(self):
        """Test plan includes varied difficulty levels"""
        questions = [
            InterviewQuestion(
                questionId="q0",
                questionText="Easy question",
                category="General",
                difficulty="easy",
                reasoning="Warm-up",
                expectedAnswer="Simple answer",
            ),
            InterviewQuestion(
                questionId="q1",
                questionText="Medium question",
                category="Technical",
                difficulty="medium",
                reasoning="Core skills",
                expectedAnswer="Detailed technical answer",
            ),
            InterviewQuestion(
                questionId="q2",
                questionText="Hard question",
                category="System Design",
                difficulty="hard",
                reasoning="Senior-level assessment",
                expectedAnswer="Comprehensive system design discussion",
            ),
        ]

        plan = InterviewPlan(
            questions=questions, totalQuestions=len(questions), preparationTips=[]
        )

        difficulties = [q.difficulty for q in plan.questions]
        assert "easy" in difficulties
        assert "medium" in difficulties
        assert "hard" in difficulties
        assert plan.totalQuestions == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
