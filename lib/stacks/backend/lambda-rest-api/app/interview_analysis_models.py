"""
Interview Analysis Models
Structured output models for interview performance analysis
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class CriterionEvaluation(BaseModel):
    """Evaluation for a single criterion"""

    criterion_name: str = Field(description="Name of the evaluation criterion")
    score: int = Field(ge=1, le=10, description="Score from 1-10")
    feedback: str = Field(description="Detailed feedback for this criterion")
    strengths: List[str] = Field(description="Specific strengths observed in this area")
    improvements: List[str] = Field(description="Specific suggestions for improvement")


class InterviewAnalysis(BaseModel):
    """
    Complete interview performance analysis with structured evaluation.

    Evaluation Criteria (EXACTLY 5):
    1. Content Quality: How well the candidate answered the questions
    2. Communication: Clarity and effectiveness of delivery
    3. Preparation Alignment: How well they used their prepared content
    4. Depth & Detail: Specificity and concrete examples provided
    5. Confidence & Engagement: Professional demeanor and interaction quality
    """

    overall_score: int = Field(
        ge=1, le=10, description="Overall interview performance score (1-10)"
    )

    evaluation_criteria: List[CriterionEvaluation] = Field(
        min_length=5,
        max_length=5,
        description="Exactly 5 detailed evaluations for: (1) Content Quality, (2) Communication, (3) Preparation Alignment, (4) Depth & Detail, (5) Confidence & Engagement",
    )

    key_strengths: List[str] = Field(
        description="Top 3-5 overall strengths across the entire interview",
        max_length=5,
    )

    areas_for_improvement: List[str] = Field(
        description="Top 3-5 priority areas for improvement", max_length=5
    )

    summary: str = Field(
        description="Concise 2-3 sentence summary of overall performance and readiness"
    )

    question_by_question_feedback: Optional[List[dict]] = Field(
        default=None,
        description="Optional detailed feedback for each question if available",
    )
