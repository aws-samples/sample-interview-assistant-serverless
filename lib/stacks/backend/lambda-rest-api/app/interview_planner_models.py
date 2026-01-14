"""Pydantic models for Interview Planner output"""

from typing import List, Optional
from pydantic import BaseModel, Field


class InterviewQuestion(BaseModel):
    """Single interview question with expected answer or evaluation checklist"""

    questionId: str = Field(
        description="Unique identifier for the question (e.g., 'q1', 'q2')"
    )
    category: str = Field(
        description="Question category (e.g., 'technical', 'behavioral', 'company_specific')"
    )
    questionText: str = Field(description="The interview question text")
    instructions: Optional[str] = Field(
        default=None,
        description="Interviewer instructions on how to conduct this question (what to look for, how to probe)",
    )
    expectedAnswer: Optional[str] = Field(
        default=None,
        description="Detailed expected answer based on resume and job description (for candidates)",
    )
    evaluationChecklist: Optional[str] = Field(
        default=None,
        description="Evaluation criteria as markdown string (for interviewers)",
    )
    estimatedTime: Optional[str] = Field(
        default=None,
        description="Estimated time for this question (e.g., '5 minutes', '8-10 minutes')",
    )
    difficulty: str = Field(
        description="Question difficulty level: 'easy', 'medium', or 'hard'"
    )
    reasoning: str = Field(
        description="Why this question is relevant (e.g., 'Based on JD requirement for...', 'Company culture emphasizes...')"
    )
    source: Optional[str] = Field(
        default="ai",
        description="Question source: 'ai' (LLM generated) or 'user' (from question bank)",
    )

    # Question progression tracking fields (for live interviews)
    status: Optional[str] = Field(
        default="not_started",
        description="Question status during interview: 'not_started', 'in_progress', or 'completed'",
    )
    startTime: Optional[int] = Field(
        default=None,
        description="Timestamp when question started (milliseconds since epoch)",
    )
    endTime: Optional[int] = Field(
        default=None,
        description="Timestamp when question completed (milliseconds since epoch)",
    )
    sequenceOrder: Optional[int] = Field(
        default=None, description="0-indexed position in interview question sequence"
    )


class CompanyResearch(BaseModel):
    """Company research findings from web search"""

    companyName: Optional[str] = Field(default=None, description="Company name")
    industry: Optional[str] = Field(default=None, description="Company industry")
    culture: List[str] = Field(
        default_factory=list, description="Company culture insights"
    )
    interviewProcess: List[str] = Field(
        default_factory=list, description="Interview process insights"
    )


class InterviewPlan(BaseModel):
    """Complete interview preparation plan with questions and research"""

    companyResearch: Optional[CompanyResearch] = Field(
        default_factory=lambda: CompanyResearch(),
        description="Company research findings",
    )
    questions: List[InterviewQuestion] = Field(
        description="Generated interview questions"
    )
    preparationTips: List[str] = Field(
        default_factory=list,
        description="General preparation tips based on role and company",
    )
    totalQuestions: int = Field(description="Total number of questions generated")


class JobDetails(BaseModel):
    """Basic job details extracted from JD

    Used in multi-step interview plan generation (Phase 2).
    This is Step 1 output - simple extraction without complex generation.
    """

    company_name: str = Field(description="Company name extracted from job description")
    position: str = Field(description="Job position/title from job description")
    industry: Optional[str] = Field(
        default=None, description="Company industry (if mentioned in JD)"
    )


class QuestionsResponse(BaseModel):
    """Response from question selection step (Step 2 of multi-step generation)"""

    questions: List[InterviewQuestion] = Field(
        description="Selected interview questions"
    )
    totalQuestions: int = Field(description="Total number of questions")
    totalTimeMinutes: float = Field(
        description="Calculated total interview time in minutes"
    )


class KBQueryResult(BaseModel):
    """Knowledge base query result (Step 2.1 output)"""

    text: str = Field(description="Question text from KB in markdown format")
    score: float = Field(description="Relevance score from KB search")
    metadata: dict = Field(
        default_factory=dict, description="Metadata from KB (category, difficulty, etc.)"
    )
    location: dict = Field(
        default_factory=dict, description="Source location information from KB"
    )


class ParsedQuestion(BaseModel):
    """Question parsed from KB markdown (Step 2.2B intermediate format)

    This is used during parsing - questionId and reasoning are added later.
    """

    category: str = Field(description="Question category")
    questionText: str = Field(description="The interview question text")
    instructions: Optional[str] = Field(default=None, description="Interviewer instructions")
    expectedAnswer: Optional[str] = Field(default=None, description="Expected answer")
    evaluationChecklist: Optional[str] = Field(default=None, description="Evaluation criteria")
    estimatedTime: Optional[str] = Field(default=None, description="Estimated time")
    difficulty: str = Field(description="Question difficulty level")


class ParsedQuestionsResponse(BaseModel):
    """Response from parsing step (Step 2.2B output before adding questionId/reasoning)"""

    questions: List[ParsedQuestion] = Field(
        description="Parsed questions from KB markdown"
    )


class SelectedQuestionsResponse(BaseModel):
    """Response from question selection step (Step 2.2A output)

    This represents the selected questions BEFORE time validation.
    """

    questions: List[InterviewQuestion] = Field(
        description="Selected interview questions with all KB fields preserved"
    )


class ValidatedQuestionsResponse(BaseModel):
    """Response from time validation step (Step 2.2B output)

    This represents questions AFTER time validation and potential removal.
    """

    questions: List[InterviewQuestion] = Field(
        description="Time-validated interview questions"
    )
    totalTimeMinutes: float = Field(
        description="Calculated total interview time in minutes (must be ≤ 60)"
    )
    removedQuestions: List[str] = Field(
        default_factory=list,
        description="List of questionIds that were removed during validation",
    )


class InterviewerPlan(BaseModel):
    """Simplified interview plan for interviewers conducting interviews

    Key differences from InterviewPlan:
    - No nested CompanyResearch object (uses flat fields instead)
    - No preparationTips (only relevant for candidates)
    - No candidate_name (not needed for interviewer plans)
    - Simpler schema reduces JSON nesting depth
    """

    plan_id: Optional[str] = Field(
        default=None, description="Unique identifier for the interview plan"
    )
    company_name: str = Field(description="Company name extracted from job description")
    position: str = Field(description="Job position/title")
    industry: Optional[str] = Field(
        default=None, description="Company industry (if available)"
    )
    interview_duration_minutes: int = Field(
        default=60,
        description="Target interview duration in minutes (typically 45-60 minutes)",
    )
    questions: List[InterviewQuestion] = Field(
        description="Generated interview questions with evaluation criteria"
    )
    totalQuestions: int = Field(description="Total number of questions generated")
