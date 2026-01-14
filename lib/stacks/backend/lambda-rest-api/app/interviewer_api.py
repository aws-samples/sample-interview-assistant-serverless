"""
Interviewer API - AI-powered interviewer agent endpoints

This module will handle:
- AI interviewer agent configuration
- Interview session management from interviewer perspective
- Question generation and adaptation
- Real-time interview feedback
- Interview evaluation and scoring
"""

import json
import os
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import boto3
from botocore.exceptions import ClientError
import asyncio
import re
from botocore.client import Config
from pydantic import BaseModel, Field
from fastapi import (
    FastAPI,
    APIRouter,
    HTTPException,
    Security,
    Depends,
    File,
    Form,
    UploadFile,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
import uuid
import io
from PyPDF2 import PdfReader

# Load environment variables
load_dotenv()

# Import auth and feature flags
from auth import validate_token
from config.feature_flags import feature_flags

# Import Interviewer Planner Service
from interviewer_planner_service import InterviewerPlannerService
from interviewer_session_service import InterviewerSessionService

# Import database service
from services.database_service import LocalDBService

# Import retry utilities
from utils.retry_utils import with_retry, AGGRESSIVE_RETRY_CONFIG, _calculate_backoff

# Import Strands and botocore exceptions for specific error handling
try:
    from strands.types.exceptions import EventLoopException
except ImportError:
    EventLoopException = Exception  # Fallback if Strands not available

from botocore.exceptions import EventStreamError

# Initialize logger
logger = logging.getLogger("interviewer_api")

# Environment variables
STACK_PREFIX = os.environ.get("STACK_NAME", "INTERVIEW-ASSISTANT")
STACK_SUFFIX = os.environ.get("STACK_ENVIRONMENT", "DEV")
DOMAIN_NAME = os.getenv("DOMAIN_NAME", "*")
S3_BUCKET_NAME = os.getenv("DATA_BUCKET", "ASSISTANT-DataBucket")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
LAMBDA_FUNCTION_NAME = os.getenv("AWS_LAMBDA_FUNCTION_NAME")  # Auto-provided by Lambda

logger.info(f"STACK_PREFIX: {STACK_PREFIX}")
logger.info(f"STACK_SUFFIX: {STACK_SUFFIX}")
logger.info(f"DOMAIN_NAME: {DOMAIN_NAME}")
logger.info(f"S3_BUCKET_NAME: {S3_BUCKET_NAME}")

# Initialize database service
db_service = LocalDBService(
    stack_prefix=STACK_PREFIX, stack_suffix=STACK_SUFFIX, profile_name=None
)

# Initialize Lambda client for async invocations
lambda_client = boto3.client("lambda", region_name=AWS_REGION)

# Initialize FastAPI app
app = FastAPI(title="Interviewer API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:8000",
        f"https://{DOMAIN_NAME}",
        f"https://backend.{DOMAIN_NAME}",
        f"https://backend.{DOMAIN_NAME}/api",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

# JWT Token security setup
security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
):
    """
    Extract and validate JWT token from Authorization header.
    """
    # Check if NO_AUTH feature flag is enabled
    if feature_flags["NO_AUTH"]:
        logger.info("NO_AUTH mode enabled, bypassing token validation")
        return {
            "user_id": "local-dev-user",
            "email": "local-dev-user@example.com",
            "username": "local-dev-user",
            "aws_credentials": {
                "access_key": os.environ.get("AWS_ACCESS_KEY_ID", ""),
                "secret_key": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
                "session_token": os.environ.get("AWS_SESSION_TOKEN", ""),
            },
        }

    if not credentials:
        raise HTTPException(status_code=403, detail="Authorization token required")

    try:
        user_info = validate_token(credentials.credentials)
        logger.info(f"User authenticated: {user_info.get('user_id', 'unknown')}")
        return user_info
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during token validation: {e}")
        raise HTTPException(
            status_code=403, detail="Could not validate authentication token"
        )


# ============================================================================
# Pydantic Models
# ============================================================================


class InterviewerConfig(BaseModel):
    """Configuration for AI interviewer behavior"""

    personality: str = Field(
        default="professional", description="Interviewer personality type"
    )
    difficulty_level: str = Field(
        default="medium", description="Interview difficulty level"
    )
    focus_areas: List[str] = Field(
        default_factory=list, description="Areas to focus on during interview"
    )
    voice_id: Optional[str] = Field(default=None, description="Voice ID for TTS")


class InterviewFeedback(BaseModel):
    """Real-time interview feedback"""

    session_id: str
    question_id: str
    feedback_type: str = Field(
        description="Type of feedback: hint, clarification, followup"
    )
    content: str = Field(description="Feedback content")


class Question(BaseModel):
    """Interview question"""

    id: int
    question: str
    category: str
    answer: Optional[str] = None


class ScheduleInterviewRequest(BaseModel):
    """Request to schedule a new interview"""

    interviewName: str
    scheduledDate: str
    scheduledTime: str
    resumeSummary: str
    jdSummary: str
    questions: List[Question]


# ============================================================================
# Health Check
# ============================================================================


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "interviewer_api"}


# ============================================================================
# Interviewer API Endpoints (To be implemented)
# ============================================================================


@app.get("/interviewer/status")
async def get_interviewer_status(current_user: dict = Depends(get_current_user)):
    """
    Get current interviewer agent status.
    TODO: Implement interviewer agent status tracking
    """
    return {
        "status": "not_implemented",
        "message": "Interviewer status endpoint - to be implemented",
    }


@app.post("/interviewer/configure")
async def configure_interviewer(
    config: InterviewerConfig, current_user: dict = Depends(get_current_user)
):
    """
    Configure AI interviewer behavior.
    TODO: Implement interviewer configuration
    """
    return {
        "status": "not_implemented",
        "message": "Interviewer configuration endpoint - to be implemented",
        "received_config": config.dict(),
    }


@app.post("/interviewer/feedback")
async def provide_feedback(
    feedback: InterviewFeedback, current_user: dict = Depends(get_current_user)
):
    """
    Provide real-time feedback during interview.
    TODO: Implement real-time feedback system
    """
    return {
        "status": "not_implemented",
        "message": "Interviewer feedback endpoint - to be implemented",
        "received_feedback": feedback.dict(),
    }


@app.post("/interviewer/evaluate/{session_id}")
async def evaluate_interview(
    session_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Evaluate completed interview session.
    TODO: Implement interview evaluation and scoring
    """
    return {
        "status": "not_implemented",
        "message": f"Interview evaluation for session {session_id} - to be implemented",
        "session_id": session_id,
    }


@app.get("/interviewer/questions/{prep_id}")
async def get_interview_questions(
    prep_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Get interview questions for a preparation.
    TODO: Implement dynamic question retrieval and adaptation
    """
    return {
        "status": "not_implemented",
        "message": f"Get interview questions for prep {prep_id} - to be implemented",
        "prep_id": prep_id,
    }


# ============================================================================
# Utility Functions
# ============================================================================


def extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    """
    Extract text content from a file (PDF or text).

    Args:
        file_bytes: The file content as bytes
        filename: The filename to determine file type

    Returns:
        Extracted text content

    Raises:
        ValueError: If file type is not supported or extraction fails
    """
    filename_lower = filename.lower()

    try:
        if filename_lower.endswith(".pdf"):
            # Extract text from PDF
            pdf_reader = PdfReader(io.BytesIO(file_bytes))
            text = ""
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
            return text.strip()
        elif filename_lower.endswith((".txt", ".md", ".csv")):
            # Decode text files
            return file_bytes.decode("utf-8").strip()
        else:
            # Try UTF-8 decoding for unknown text files
            return file_bytes.decode("utf-8").strip()
    except Exception as e:
        raise ValueError(f"Failed to extract text from {filename}: {str(e)}")


# ============================================================================
# Async Job Processing Functions
# ============================================================================


async def _process_schedule_interview_job(
    user_id: str,
    plan_id: str,  # Changed from job_id
    resume_bytes: bytes,
    resume_filename: str,
    jd_content: str,
    questionBankText: str,
    useAiGeneration: bool,
    interviewType: str,
    interviewName: str,
    scheduledDate: str,
    scheduledTime: str,
):
    """
    Background task to process interview scheduling.
    Updates interview plan status in DynamoDB as it progresses.
    """
    try:
        logger.info(f"Starting plan generation {plan_id} for user {user_id}")

        # Update plan status to processing
        db_service.update_interview_plan_status(user_id, plan_id, "processing")

        # Process interview plan with retry logic
        result = await _schedule_interview_with_retry(
            resume_bytes=resume_bytes,
            resume_filename=resume_filename,
            jd_content=jd_content,
            questionBankText=questionBankText,
            useAiGeneration=useAiGeneration,
            interviewType=interviewType,
            interviewName=interviewName,
            scheduledDate=scheduledDate,
            scheduledTime=scheduledTime,
            user_id=user_id,
        )

        # Complete the interview plan with generated data
        # Note: InterviewerPlan now uses flat fields (company_name, position, industry)
        # instead of nested companyResearch. Adapt to database format for backward compatibility.
        interview_plan = result.get("interviewPlan", {})

        # Build company_research dict from InterviewerPlan flat fields
        company_research = {
            "companyName": interview_plan.get("company_name", ""),
            "positionTitle": interview_plan.get("position", ""),
            "industry": interview_plan.get("industry", ""),
        }

        db_service.complete_interview_plan(
            user_id=user_id,
            plan_id=plan_id,
            resume_summary=result.get("resumeSummary", ""),
            jd_summary=result.get("jdSummary", ""),
            company_research=company_research,
            questions=interview_plan.get("questions", []),
            preparation_tips=[],  # InterviewerPlan no longer includes preparation_tips
        )
        logger.info(f"Plan {plan_id} completed successfully")

    except Exception as e:
        logger.error(f"Plan {plan_id} failed: {e}")
        import traceback

        error_traceback = traceback.format_exc()
        logger.error(f"Traceback: {error_traceback}")

        # Update plan status to failed
        db_service.update_interview_plan_status(
            user_id, plan_id, "failed", error_message=str(e)
        )


async def _schedule_interview_with_retry(
    resume_bytes: bytes,
    resume_filename: str,
    jd_content: str,
    questionBankText: str,
    useAiGeneration: bool,
    interviewType: str,
    interviewName: str,
    scheduledDate: str,
    scheduledTime: str,
    user_id: str,
    max_attempts: int = None,
) -> Dict[str, Any]:
    """
    Schedule interview with application-level retry logic.

    This provides endpoint-level retries for transient errors during
    CV/JD processing and question generation via Bedrock Agent.
    """
    # Use AGGRESSIVE_RETRY_CONFIG max_attempts if not specified
    if max_attempts is None:
        max_attempts = AGGRESSIVE_RETRY_CONFIG.max_attempts

    last_error = None

    for attempt in range(1, max_attempts + 1):
        logger.info(
            f"[Retry Attempt {attempt}/{max_attempts}] Starting interview scheduling"
        )
        try:
            # Initialize Interviewer Planner Service
            planner = InterviewerPlannerService()

            # Handle question input based on mode
            questions_list = []
            if not useAiGeneration and questionBankText and questionBankText.strip():
                # Manual question mode - parse JSON format (enhanced CSV with all fields)
                try:
                    json_questions = json.loads(questionBankText)
                    if isinstance(json_questions, list):
                        questions_list = json_questions
                        logger.info(
                            f"Parsed {len(questions_list)} questions from JSON format (enhanced CSV)"
                        )
                    else:
                        raise ValueError("Question data must be a JSON array")
                except (json.JSONDecodeError, ValueError) as e:
                    logger.error(f"Failed to parse question bank JSON: {e}")
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid question format. Expected JSON array with question objects. Error: {str(e)}",
                    )

            # Generate interview plan or use manual questions
            if useAiGeneration:
                # AI Generation mode: Use agent to process resume, JD, and generate questions
                logger.info(
                    f"Creating interview plan with AI-generated questions (interview_type: {interviewType})..."
                )
                logger.info(
                    f"📄 [Plan Generation] Passing JD to planner (first 500 chars): {jd_content[:500]}"
                )
                result = await planner.create_interview_plan(
                    resume_file_bytes=resume_bytes,
                    file_name=resume_filename,
                    jd_text=jd_content,
                    interview_type=interviewType,
                )
                resume_summary = result.get("resumeSummary", "")
                jd_summary = result.get("jdSummary", "")
                interview_plan_dict = result.get("interviewPlan", {})
            else:
                # Manual CSV mode: Still generate summaries, but skip question generation
                logger.info(
                    f"Using {len(questions_list)} manual questions from CSV - generating summaries but skipping question generation..."
                )

                # Initialize planner for summarization
                planner = InterviewerPlannerService()

                # Extract job details from raw JD
                logger.info("📊 Extracting job details from JD...")
                job_details = await planner._extract_job_details(jd_content)

                # Generate resume and JD summaries (still needed for interviewer context)
                logger.info("Generating resume summary...")
                resume_summary = await planner.summarize_resume(
                    resume_bytes, resume_filename
                )
                logger.info("Generating job description summary...")
                jd_summary = await planner.summarize_job_description(jd_content)

                # Format manual questions into expected structure (JSON format with all fields)
                formatted_questions = []
                for i, q in enumerate(questions_list, 1):
                    # Keep evaluation as string (markdown format with newlines preserved)
                    evaluation_raw = q.get("evaluation", "")

                    formatted_questions.append(
                        {
                            "questionId": f"q{i}",
                            "category": q.get("category", "General"),
                            "questionText": q.get("question", ""),
                            "reasoning": q.get("reasoning", "")
                            or "Question from CSV upload",
                            "difficulty": q.get("difficulty", "medium"),
                            "estimatedTime": q.get(
                                "time", "0"
                            ),  # Map 'time' from CSV to 'estimatedTime'
                            "instructions": q.get("instructions", ""),
                            "evaluationChecklist": evaluation_raw,  # Keep as string
                            "expectedAnswer": q.get("answer", "") or None,
                            "source": "csv_upload",
                        }
                    )

                # Calculate total interview duration from questions
                total_duration = planner._calculate_total_time(formatted_questions)
                logger.info(
                    f"Calculated total interview duration: {total_duration} minutes from {len(formatted_questions)} questions"
                )

                # Use InterviewerPlan structure (flat fields instead of nested companyResearch)
                interview_plan_dict = {
                    "company_name": job_details.company_name,
                    "position": job_details.position,
                    "industry": job_details.industry,
                    "interview_duration_minutes": int(total_duration),
                    "questions": formatted_questions,
                    "totalQuestions": len(formatted_questions),
                }

            logger.info(
                f"[Retry Attempt {attempt}] ✅ Interview plan generated successfully"
            )

            # Return result for database operations (handled by caller)
            return {
                "resumeSummary": resume_summary,
                "jdSummary": jd_summary,
                "interviewPlan": interview_plan_dict,
            }

        except HTTPException as e:
            # Don't retry validation errors (4xx)
            logger.info(
                f"[Retry Attempt {attempt}] ⚠️ Caught HTTPException (no retry): {e}"
            )
            raise

        except ClientError as e:
            logger.info(
                f"[Retry Attempt {attempt}] 🔍 Caught ClientError: {type(e).__name__}"
            )
            last_error = e
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            http_status = e.response.get("ResponseMetadata", {}).get(
                "HTTPStatusCode", 0
            )

            # Check if this is a retryable error
            is_retryable = (
                500 <= http_status < 600
                or http_status == 429
                or error_code
                in [
                    "ThrottlingException",
                    "ServiceUnavailableException",
                    "ModelTimeoutException",
                    "ModelStreamErrorException",
                    "InternalServerError",
                ]
            )

            if not is_retryable or attempt >= max_attempts:
                logger.error(
                    f"Non-retryable error or max attempts reached: "
                    f"{error_code} (HTTP {http_status})"
                )
                raise

            # Calculate exponential backoff with jitter
            backoff = _calculate_backoff(attempt, AGGRESSIVE_RETRY_CONFIG)
            logger.warning(
                f"Endpoint-level retry {attempt}/{max_attempts} after "
                f"{error_code} (HTTP {http_status}). Retrying in {backoff:.1f}s..."
            )
            await asyncio.sleep(backoff)

        except (EventLoopException, EventStreamError) as e:
            logger.info(
                f"[Retry Attempt {attempt}] 🔴 Caught {type(e).__name__}: {str(e)[:100]}"
            )
            last_error = e
            error_str_lower = str(e).lower()

            is_retryable = any(
                code in error_str_lower
                for code in [
                    "serviceunavailable",
                    "throttling",
                    "modeltimeout",
                    "modelstreamerror",
                    "internalservererror",
                ]
            )

            if not is_retryable or attempt >= max_attempts:
                logger.error(
                    f"Non-retryable EventLoop/Stream error or max attempts reached: {str(e)}",
                    exc_info=True,
                )
                raise

            backoff = _calculate_backoff(attempt, AGGRESSIVE_RETRY_CONFIG)
            logger.warning(
                f"Endpoint-level retry {attempt}/{max_attempts} after "
                f"EventLoop/Stream error: {str(e)[:100]}... Retrying in {backoff:.1f}s..."
            )
            await asyncio.sleep(backoff)

        except Exception as e:
            logger.info(
                f"[Retry Attempt {attempt}] ⚡ Caught generic Exception: {type(e).__name__}: {str(e)[:100]}"
            )
            last_error = e
            error_str = str(e).lower()

            is_retryable = any(
                code.lower() in error_str
                for code in [
                    "serviceUnavailable",
                    "serviceunavailableexception",
                    "ThrottlingException",
                    "ModelTimeout",
                    "ModelStreamError",
                    "Internal Server Error",
                    "InternalServerError",
                    "500",
                    "503",
                    "502",
                    "504",
                ]
            )

            if not is_retryable or attempt >= max_attempts:
                logger.error(
                    f"Non-retryable error or max attempts reached: {str(e)}",
                    exc_info=True,
                )
                raise

            backoff = _calculate_backoff(attempt, AGGRESSIVE_RETRY_CONFIG)
            logger.warning(
                f"Endpoint-level retry {attempt}/{max_attempts} after error: {str(e)}. "
                f"Retrying in {backoff:.1f}s..."
            )
            await asyncio.sleep(backoff)

    # If we exhausted all retries
    if last_error:
        raise last_error

    raise Exception("Unexpected error in retry logic")


# ============================================================================
# Future Endpoints (Placeholder documentation)
# ============================================================================


@app.post("/schedule-interview")
async def schedule_interview(
    background_tasks: BackgroundTasks,
    interviewName: str = Form(...),
    scheduledDate: str = Form(...),
    scheduledTime: str = Form(...),
    resumeFile: UploadFile = File(...),
    jdText: Optional[str] = Form(None),
    jdFile: Optional[UploadFile] = File(None),
    questionBankText: str = Form(""),  # Empty string allowed for AI generation mode
    useAiGeneration: Optional[str] = Form(
        "false"
    ),  # 'true' or 'false' string from frontend
    interviewType: str = Form(
        "general"
    ),  # Interview type (technical, behavioral, etc.)
    current_user: dict = Depends(get_current_user),
):
    """
    Schedule a new interview asynchronously.

    Returns a job ID immediately. Client should poll /jobs/{job_id} for status and results.
    This avoids CloudFront 60-second timeout for long-running operations.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Queueing interview scheduling for user")

        # Read resume file (keep as bytes for Bedrock document processing)
        resume_bytes = await resumeFile.read()
        resume_filename = resumeFile.filename

        # Validate resume content
        if not resume_bytes or len(resume_bytes) == 0:
            raise HTTPException(
                status_code=400, detail="Resume file is empty or invalid"
            )

        # Handle JD - can be either text or file
        # Log what was received from frontend
        logger.info(
            f"📄 [JD Debug] Received from frontend - jdText provided: {bool(jdText)}, jdFile provided: {bool(jdFile)}"
        )
        if jdText:
            logger.info(f"📄 [JD Debug] jdText length: {len(jdText)} characters")
        if jdFile:
            logger.info(f"📄 [JD Debug] jdFile.filename: {jdFile.filename}")

        jd_content = jdText or ""
        jd_source = "unknown"

        if jdFile and not jdText:
            # If JD is a file, extract text content (handles PDF, text files, etc.)
            logger.info(f"📄 [JD Debug] Processing JD from FILE: {jdFile.filename}")
            jd_file_bytes = await jdFile.read()
            logger.info(f"📄 [JD Debug] File bytes read: {len(jd_file_bytes)} bytes")
            try:
                jd_content = extract_text_from_file(jd_file_bytes, jdFile.filename)
                logger.info(
                    f"📄 [JD Debug] Extracted text from {jdFile.filename}, length: {len(jd_content)} characters"
                )
                jd_source = f"file:{jdFile.filename}"
            except ValueError as e:
                logger.error(f"📄 [JD Debug] Failed to extract text from file: {e}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Job description file extraction error: {str(e)}",
                )
            logger.info(f"Extracted JD from {jdFile.filename}")
        elif jdText:
            logger.info(f"📄 [JD Debug] Using JD from TEXT input")
            jd_source = "text_input"
        else:
            logger.warning(
                f"📄 [JD Debug] No JD source provided (both jdText and jdFile are empty)"
            )

        if not jd_content or not jd_content.strip():
            raise HTTPException(
                status_code=400, detail="Job description text or file is required"
            )

        # Calculate hash for verification
        import hashlib

        jd_hash_api = hashlib.sha256(jd_content.encode()).hexdigest()[:16]

        # Log the raw JD content for debugging
        logger.info(f"📄 [JD Debug API Entry] ========================================")
        logger.info(f"📄 [JD Debug API Entry] JD Source: {jd_source}")
        logger.info(f"📄 [JD Debug API Entry] JD Hash: {jd_hash_api}")
        logger.info(
            f"📄 [JD Debug API Entry] JD content length: {len(jd_content)} characters"
        )
        logger.info(f"📄 [JD Debug API Entry] FULL JD CONTENT:\n{jd_content}")
        logger.info(f"📄 [JD Debug API Entry] ========================================")

        # Parse useAiGeneration flag (comes as string from form)
        use_ai = useAiGeneration.lower() == "true" if useAiGeneration else False

        # Generate unique plan ID
        plan_id = str(uuid.uuid4())

        # Create interview plan record in DynamoDB with status='pending'
        # This replaces the separate JOB# entry - now we use PLAN# for both tracking and storage
        db_service.save_interview_plan(
            user_id=user_email,
            plan_id=plan_id,
            company_name=None,
            job_title=None,
            interview_type=interviewType,
            resume_summary="",  # Will be filled in when job completes
            jd_summary="",  # Will be filled in when job completes
            company_research={},  # Will be filled in when job completes
            questions=[],  # Will be filled in when job completes
            preparation_tips=[],  # Will be filled in when job completes
            interview_stage="scheduled",
            scheduled_date=scheduledDate,
            scheduled_time=scheduledTime,
            interview_name=interviewName,
            status="pending",  # Job tracking status
            job_params={  # Store params for debugging/reference
                "interviewName": interviewName,
                "scheduledDate": scheduledDate,
                "scheduledTime": scheduledTime,
                "interviewType": interviewType,
                "useAiGeneration": use_ai,
            },
        )

        # Invoke Lambda asynchronously to process job (avoids API Gateway 30s timeout)
        # This returns immediately while processing happens in a separate Lambda invocation
        if LAMBDA_FUNCTION_NAME:
            try:
                # Prepare payload for async processing
                async_payload = {
                    "asyncJobProcessing": True,  # Flag to distinguish from HTTP events
                    "jobType": "interviewer_interview_plan",  # Changed from 'interview_scheduling'
                    "userId": user_email,
                    "planId": plan_id,  # Changed from jobId
                    "resumeBytes": resume_bytes.hex(),  # Convert bytes to hex string for JSON
                    "resumeFilename": resume_filename,
                    "jdContent": jd_content,
                    "questionBankText": questionBankText,
                    "useAiGeneration": use_ai,
                    "interviewType": interviewType,
                    "interviewName": interviewName,
                    "scheduledDate": scheduledDate,
                    "scheduledTime": scheduledTime,
                }

                # Verify JD content in payload
                payload_jd_hash = hashlib.sha256(
                    async_payload["jdContent"].encode()
                ).hexdigest()[:16]
                logger.info(
                    f"📄 [JD Debug Async Payload] JD Hash in payload: {payload_jd_hash} (should match API entry: {jd_hash_api})"
                )
                logger.info(f"📄 [JD Debug Async Payload] Plan ID: {plan_id}")

                # Invoke this Lambda function asynchronously (InvocationType='Event')
                lambda_client.invoke(
                    FunctionName=LAMBDA_FUNCTION_NAME,
                    InvocationType="Event",  # Async invocation - returns immediately
                    Payload=json.dumps(async_payload).encode("utf-8"),
                )
                logger.info(f"Plan {plan_id} queued via Lambda async invoke")
            except Exception as lambda_error:
                logger.error(f"Failed to invoke Lambda async: {lambda_error}")
                # Fall back to synchronous processing if async invoke fails
                logger.warning(
                    "Falling back to background task (will block Lambda execution)"
                )
                background_tasks.add_task(
                    _process_schedule_interview_job,
                    user_id=user_email,
                    plan_id=plan_id,  # Changed from job_id
                    resume_bytes=resume_bytes,
                    resume_filename=resume_filename,
                    jd_content=jd_content,
                    questionBankText=questionBankText,
                    useAiGeneration=use_ai,
                    interviewType=interviewType,
                    interviewName=interviewName,
                    scheduledDate=scheduledDate,
                    scheduledTime=scheduledTime,
                )
        else:
            # Local development - use background tasks
            logger.info(
                "LAMBDA_FUNCTION_NAME not set - using background task for local dev"
            )
            background_tasks.add_task(
                _process_schedule_interview_job,
                user_id=user_email,
                plan_id=plan_id,  # Changed from job_id
                resume_bytes=resume_bytes,
                resume_filename=resume_filename,
                jd_content=jd_content,
                questionBankText=questionBankText,
                useAiGeneration=use_ai,
                interviewType=interviewType,
                interviewName=interviewName,
                scheduledDate=scheduledDate,
                scheduledTime=scheduledTime,
            )

        return {
            "status": "pending",
            "planId": plan_id,  # Changed from jobId
            "message": "Interview scheduling started. Poll /plans/{plan_id} for status.",
        }

    except HTTPException:
        # Re-raise HTTP exceptions (validation errors) without modification
        raise

    except Exception as e:
        logger.error(f"Error queueing interview scheduling: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Failed to queue interview scheduling: {str(e)}"
        )


# ============================================================================
# Async Job Status APIs
# ============================================================================


@app.get("/plans/{plan_id}", dependencies=[Depends(get_current_user)])
async def get_plan_status_endpoint(
    plan_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Poll for interview plan status and results.

    Status values:
    - pending: Plan creation is queued but not yet started
    - processing: Plan is currently being generated
    - completed: Plan generation finished successfully, all data is available
    - failed: Plan generation failed, error message is available

    For completed plans, the full plan data (resume summary, JD summary, questions, etc.) is returned.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Checking plan status {plan_id} for user")

        # Get plan from DynamoDB
        plan = db_service.get_interview_plan_by_id(user_email, plan_id)

        if not plan:
            raise HTTPException(status_code=404, detail="Interview plan not found")

        response = {
            "status": plan.get(
                "status", "completed"
            ),  # Default to completed for backwards compat
            "planId": plan_id,
            "userId": user_email,
            "timestamp": plan.get("timestamp"),
            "companyName": plan.get("companyName"),
            "jobTitle": plan.get("jobTitle"),
            "interviewType": plan.get("interviewType"),
            "interviewStage": plan.get("interviewStage"),
            "interviewName": plan.get("interviewName"),
            "scheduledDate": plan.get("scheduledDate"),
            "scheduledTime": plan.get("scheduledTime"),
        }

        # Add full plan data if generated or completed
        if plan.get("status") in ["generated", "completed"] or not plan.get(
            "status"
        ):  # No status means old completed plan
            response["result"] = {
                "resumeSummary": plan.get("resumeSummary", ""),
                "jdSummary": plan.get("jdSummary", ""),
                "interviewPlan": {
                    "companyResearch": plan.get("companyResearch", {}),
                    "questions": plan.get("questions", []),
                    "preparationTips": plan.get("preparationTips", []),
                },
            }

        # Add error message if failed
        if plan.get("status") == "failed" and "errorMessage" in plan:
            response["errorMessage"] = plan["errorMessage"]

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting plan status: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get plan status: {str(e)}"
        )


@app.post("/mark-schedule-saved/{plan_id}", dependencies=[Depends(get_current_user)])
async def mark_schedule_saved_endpoint(
    plan_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Mark an interview schedule as saved/completed.
    This updates the status from 'generated' to 'completed' when interviewer explicitly saves.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Marking schedule {plan_id} as saved for user")

        # Update plan status to completed
        db_service.mark_interview_plan_as_saved(user_email, plan_id)

        return {
            "status": "success",
            "planId": plan_id,
            "message": "Interview schedule marked as saved",
        }

    except Exception as e:
        logger.error(f"Error marking schedule as saved: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Failed to mark schedule as saved: {str(e)}"
        )


@app.get("/jobs/{job_id}", dependencies=[Depends(get_current_user)])
async def get_job_status_endpoint(
    job_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Poll for job status and results.

    Status values:
    - pending: Job is queued but not yet started
    - processing: Job is currently running
    - completed: Job finished successfully, result is available
    - failed: Job failed, error message is available

    For completed jobs, the full result is returned in the 'result' field.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Checking job status {job_id} for user")

        # Get job from DynamoDB
        job = db_service.get_job_by_id(user_email, job_id)

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        response = {
            "status": job["status"],
            "jobId": job_id,
            "jobType": job.get("jobType"),
            "createdAt": job.get("createdAt"),
            "updatedAt": job.get("updatedAt"),
        }

        # Add result if completed
        if job["status"] == "completed" and "result" in job:
            response["result"] = job["result"]
            if "completedAt" in job:
                response["completedAt"] = job["completedAt"]

        # Add error message if failed
        if job["status"] == "failed" and "errorMessage" in job:
            response["errorMessage"] = job["errorMessage"]

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting job status: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get job status: {str(e)}"
        )


@app.get("/scheduled-interviews")
async def get_scheduled_interviews(current_user: dict = Depends(get_current_user)):
    """
    Get all scheduled interviews for the current user.
    Only returns interviews with interview_stage="scheduled" (excludes candidate practice plans).
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Fetching scheduled interviews for user")

        # Get interview plans from DynamoDB, filtered for scheduled interviews only
        interviews = db_service.get_interview_plans(
            user_email, interview_stage_filter="scheduled"
        )

        logger.info(f"Found {len(interviews)} scheduled interviews for user")

        return {"interviews": interviews}

    except Exception as e:
        logger.error(f"Error fetching scheduled interviews: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch scheduled interviews: {str(e)}"
        )


@app.get("/scheduled-interviews/{interview_id}")
async def get_scheduled_interview(
    interview_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Get a specific scheduled interview by ID.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Fetching scheduled interview {interview_id} for user")

        # Get interview from DynamoDB
        interview = db_service.get_interview_plan_by_id(user_email, interview_id)

        if not interview:
            raise HTTPException(
                status_code=404, detail=f"Interview {interview_id} not found"
            )

        logger.info(f"Successfully fetched interview: {interview_id}")

        return {"interview": interview}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching scheduled interview: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch scheduled interview: {str(e)}"
        )


@app.delete("/scheduled-interviews/{interview_id}")
async def delete_scheduled_interview(
    interview_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Delete a scheduled interview.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Deleting scheduled interview {interview_id} for user")

        # Delete from DynamoDB
        success = db_service.delete_interview_plan(user_email, interview_id)

        if not success:
            raise HTTPException(
                status_code=404, detail=f"Interview {interview_id} not found"
            )

        logger.info(f"Deleted scheduled interview: {interview_id}")

        return {
            "status": "success",
            "message": f"Interview {interview_id} deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting scheduled interview: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to delete scheduled interview: {str(e)}"
        )


# ============================================================================
# Interview Session Endpoints (Live Interview with Transcript Analysis)
# ============================================================================


@app.post("/interview-sessions")
async def save_interview_session(
    sessionId: str = Form(...),
    interviewId: Optional[str] = Form(None),
    interviewName: str = Form(...),
    transcript: str = Form(...),
    transcriptArray: Optional[str] = Form(
        None
    ),  # JSON string of transcript with speakers
    duration: str = Form(...),
    videoFrames: Optional[str] = Form(None),  # JSON string of video frames
    videoRecordingRequested: Optional[bool] = Form(False),
    videoLocation: Optional[str] = Form(
        None
    ),  # S3 location of video recording (PATH B)
    questionStatuses: Optional[str] = Form(
        None
    ),  # JSON string of question progression status
    currentQuestionIndex: Optional[int] = Form(None),  # Final question index reached
    current_user: dict = Depends(get_current_user),
):
    """
    Save interview session and generate structured summary.

    This endpoint:
    1. Receives the full interview transcript
    2. Uses LLM to generate structured assessment
    3. Saves session with summary to storage
    """
    try:
        import base64

        user_email = current_user.get("email", "unknown")
        logger.info(f"Saving interview session {sessionId} for user")

        # Note: videoFrames parameter is obsolete (PATH A deprecated)
        # Current video recording uses PATH B (MediaRecorder - full video)
        # Keeping parameter for backward compatibility but not processing it

        # Load interview plan if interviewId provided
        interview_plan = None
        if interviewId:
            interview_plan_data = db_service.get_interview_plan_by_id(
                user_email, interviewId
            )
            if interview_plan_data:
                interview_plan = interview_plan_data
                logger.info(
                    f"Loaded interview plan from scheduled interview: {interviewId}"
                )

        # Generate structured summary using LLM
        session_service = InterviewerSessionService()
        logger.info("Generating interview summary...")

        summary_result = await session_service.generate_interview_summary(
            transcript=transcript,
            interview_plan=interview_plan,
            interview_name=interviewName,
        )

        logger.info("Interview summary generated successfully")

        # Parse duration to total seconds
        # Frontend sends format: "MM:SS" or "HH:MM:SS"
        duration_seconds = 0
        if ":" in duration:
            parts = duration.split(":")
            if len(parts) == 3:  # HH:MM:SS
                duration_seconds = (
                    int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                )
            elif len(parts) == 2:  # MM:SS
                duration_seconds = int(parts[0]) * 60 + int(parts[1])
        else:
            duration_seconds = int(duration) if duration.isdigit() else 0

        logger.info(f"Duration parsed: {duration} -> {duration_seconds} seconds")

        # Parse transcript array if provided
        transcript_array_data = None
        if transcriptArray:
            try:
                transcript_array_data = json.loads(transcriptArray)
                logger.info(
                    f"Parsed transcript array with {len(transcript_array_data)} items"
                )
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse transcriptArray JSON: {e}")

        # Parse question statuses if provided
        question_statuses_data = None
        if questionStatuses:
            try:
                question_statuses_data = json.loads(questionStatuses)
                logger.info(
                    f"Parsed question statuses with {len(question_statuses_data)} questions"
                )
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse questionStatuses JSON: {e}")

        # Save interview session to DynamoDB
        # Note: We don't store questionStatuses and currentQuestionIndex in metadata anymore
        # Instead, we update them directly in the interview plan (SESSION-PREP table)
        db_result = db_service.save_practice_session(
            user_id=user_email,
            session_id=sessionId,
            prep_id=interviewId or "",
            duration=duration_seconds,  # Store as total seconds
            metadata={
                "interviewName": interviewName,
                "interviewId": interviewId,
                "summary": summary_result,
                "isInterviewerSession": True,
                "durationFormatted": duration,  # Store original format for display
                "transcriptArray": transcript_array_data,  # Structured transcript with speakers (can reconstruct plain text if needed)
                "videoLocation": videoLocation,  # Full video recording from MediaRecorder
            },
        )

        # Update interview plan with question statuses and mark as finished
        if interviewId:
            # Update question statuses in the interview plan (single source of truth)
            if question_statuses_data:
                # Auto-complete the last question if it's still in_progress
                # This handles the case where the interview ends before the final question
                # gets marked as completed by the live assistant
                question_ids = sorted(question_statuses_data.keys())
                if question_ids:
                    last_question_id = question_ids[-1]
                    last_question_status = question_statuses_data[last_question_id].get(
                        "status"
                    )

                    if last_question_status == "in_progress":
                        logger.info(
                            f"Auto-completing last question {last_question_id} which was in_progress"
                        )
                        question_statuses_data[last_question_id]["status"] = "completed"

                        # Set endTime if not already set (use current timestamp in ms)
                        if "endTime" not in question_statuses_data[last_question_id]:
                            question_statuses_data[last_question_id]["endTime"] = int(
                                time.time() * 1000
                            )

                logger.info(
                    f"Updating question statuses in interview plan {interviewId}"
                )
                db_service.update_interview_plan_question_statuses(
                    user_email, interviewId, question_statuses_data
                )

            # Update interview plan status to finished
            db_service.update_interview_plan_status(user_email, interviewId, "finished")
            logger.info(f"Updated interview plan {interviewId} status to finished")

        logger.info(f"Interview session saved successfully: {sessionId}")

        return {
            "status": "success",
            "message": "Interview session saved successfully",
            "sessionId": sessionId,
            "summary": summary_result,
        }

    except Exception as e:
        logger.error(f"Error saving interview session: {e}")
        import traceback

        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Failed to save interview session: {str(e)}"
        )


@app.get("/interview-sessions")
async def get_interview_sessions(current_user: dict = Depends(get_current_user)):
    """
    Get all interview sessions for the current user.
    Only returns sessions with session_prefix='interviewer' (interviewer sessions).
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Fetching interview sessions for user")

        # Get interviewer sessions from DynamoDB (session_prefix='interviewer')
        sessions = db_service.get_interview_sessions(
            user_email, session_prefix="interviewer"
        )

        return {"sessions": sessions}

    except Exception as e:
        logger.error(f"Error fetching interview sessions: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch interview sessions: {str(e)}"
        )


@app.get("/interview-sessions/{session_id}")
async def get_interview_session(
    session_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Get a specific interview session by ID.
    Includes interview plan with questions if session was created from a scheduled interview.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Fetching interview session {session_id} for user")

        # Get session from DynamoDB
        session = db_service.get_interview_session_by_id(user_email, session_id)

        if not session:
            raise HTTPException(
                status_code=404, detail=f"Interview session {session_id} not found"
            )

        # Fetch interview plan if session has interviewId
        if session.get("interviewId"):
            interview_plan = db_service.get_interview_plan_by_id(
                user_email, session["interviewId"]
            )
            if interview_plan:
                session["interviewPlan"] = interview_plan
                logger.info(
                    f"Attached interview plan {session['interviewId']} to session"
                )

        logger.info(f"Successfully fetched interview session: {session_id}")

        return {"session": session}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching interview session: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch interview session: {str(e)}"
        )


@app.delete("/interview-sessions/{session_id}")
async def delete_interview_session(
    session_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Delete an interview session.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Deleting interview session {session_id} for user")

        # Delete from DynamoDB
        success = db_service.delete_interview_session(user_email, session_id)

        if not success:
            raise HTTPException(
                status_code=404, detail=f"Interview session {session_id} not found"
            )

        logger.info(f"Deleted interview session: {session_id}")

        return {
            "status": "success",
            "message": f"Interview session {session_id} deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting interview session: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to delete interview session: {str(e)}"
        )


# PATH B: S3 Multipart Upload Endpoints for Full-Resolution Video Recording


class StartUploadRequest(BaseModel):
    """Request body for starting S3 multipart upload"""

    sessionId: str
    format: str = "webm"


@app.post("/video/start-upload", dependencies=[Depends(get_current_user)])
async def start_video_upload(
    request: StartUploadRequest, current_user: dict = Depends(get_current_user)
):
    """
    Initialize S3 multipart upload for video recording.
    Returns uploadId for subsequent part uploads.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Starting multipart upload for session {request.sessionId}")

        # Create S3 client with Signature Version 4 (required for presigned URLs with multipart uploads)
        s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

        # Generate S3 key for video file
        s3_key = f"video-recordings/{user_email}/{request.sessionId}/recording.{request.format}"

        # Initiate multipart upload
        response = s3_client.create_multipart_upload(
            Bucket=S3_BUCKET_NAME,
            Key=s3_key,
            ContentType=f"video/{request.format}",
            Metadata={
                "session_id": request.sessionId,
                "user_email": user_email,
                "format": request.format,
            },
        )

        upload_id = response["UploadId"]
        logger.info(f"Multipart upload initialized: {upload_id}")

        return {"uploadId": upload_id, "s3Key": s3_key, "bucket": S3_BUCKET_NAME}

    except Exception as e:
        logger.error(f"Error starting multipart upload: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class GetUploadUrlRequest(BaseModel):
    """Request body for getting presigned upload URL"""

    sessionId: str
    uploadId: str
    partNumber: int
    format: str = "webm"


@app.post("/video/get-upload-url", dependencies=[Depends(get_current_user)])
async def get_upload_url(
    request: GetUploadUrlRequest, current_user: dict = Depends(get_current_user)
):
    """
    Generate presigned URL for direct S3 upload (bypasses API Gateway/Lambda limits).
    Client uploads chunk directly to S3 using this URL.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(
            f"Generating presigned URL for session {request.sessionId}, part {request.partNumber}"
        )

        # Create S3 client with Signature Version 4 (required for presigned URLs with multipart uploads)
        s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

        # Reconstruct S3 key (must match the key from start_upload)
        s3_key = f"video-recordings/{user_email}/{request.sessionId}/recording.{request.format}"

        # Generate presigned URL for PUT operation (upload_part)
        presigned_url = s3_client.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": S3_BUCKET_NAME,
                "Key": s3_key,
                "UploadId": request.uploadId,
                "PartNumber": request.partNumber,
            },
            ExpiresIn=3600,  # 1 hour - handles long recordings with buffering + slow networks
        )

        logger.info(f"Generated presigned URL for part {request.partNumber}")

        return {
            "url": presigned_url,
            "partNumber": request.partNumber,
            "expiresIn": 300,
        }

    except Exception as e:
        logger.error(f"Error generating presigned URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class GetFrameUploadUrlRequest(BaseModel):
    """Request body for getting presigned upload URL for frame"""

    sessionId: str
    filename: str
    contentType: str = "image/jpeg"


@app.post("/video/get-frame-upload-url", dependencies=[Depends(get_current_user)])
async def get_frame_upload_url(
    request: GetFrameUploadUrlRequest, current_user: dict = Depends(get_current_user)
):
    """
    Generate presigned URL for frame upload to S3.
    Part of pull-based frame architecture where Agent requests frames on-demand.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(
            f"Generating presigned URL for frame upload: session {request.sessionId}, file {request.filename}"
        )

        # S3 key structure: video-frames/{email}/{sessionId}/frame_{timestamp}.jpg
        s3_key = f"video-frames/{user_email}/{request.sessionId}/{request.filename}"

        # Create S3 client with Signature Version 4
        s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

        # Generate presigned URL for PUT operation (direct frame upload)
        presigned_url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": S3_BUCKET_NAME,
                "Key": s3_key,
                "ContentType": request.contentType,
            },
            ExpiresIn=300,  # 5 minutes sufficient for single frame upload
        )

        logger.info(f"Generated presigned URL for frame: {s3_key}")

        return {
            "presignedUrl": presigned_url,
            "s3Key": s3_key,
            "s3Bucket": S3_BUCKET_NAME,
        }

    except Exception as e:
        logger.error(f"Error generating frame upload URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/video/upload-part", dependencies=[Depends(get_current_user)])
async def upload_video_part(
    chunk: UploadFile = File(...),
    partNumber: int = Form(...),
    uploadId: str = Form(...),
    sessionId: str = Form(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Upload a single part of the video file.
    Returns ETag for the uploaded part.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Uploading part {partNumber} for session {sessionId}")

        s3_client = boto3.client("s3")

        # Read chunk data
        chunk_data = await chunk.read()

        # Reconstruct S3 key (must match the key from start_upload)
        # We need to get the format from the session or pass it explicitly
        # For now, assume webm as default
        s3_key = f"video-recordings/{user_email}/{sessionId}/recording.webm"

        # Upload part
        response = s3_client.upload_part(
            Bucket=S3_BUCKET_NAME,
            Key=s3_key,
            PartNumber=partNumber,
            UploadId=uploadId,
            Body=chunk_data,
        )

        # S3 returns ETag with quotes, strip them for complete_multipart_upload
        etag = response["ETag"]
        etag_clean = etag.strip('"') if etag.startswith('"') else etag
        logger.info(f"Part {partNumber} uploaded, ETag: {etag_clean}")

        return {"ETag": etag_clean, "PartNumber": partNumber}

    except Exception as e:
        logger.error(f"Error uploading part {partNumber}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CompleteUploadRequest(BaseModel):
    """Request body for completing S3 multipart upload"""

    sessionId: str
    uploadId: str
    parts: List[Dict[str, Any]]  # List of {PartNumber, ETag}


@app.post("/video/complete-upload", dependencies=[Depends(get_current_user)])
async def complete_video_upload(
    request: CompleteUploadRequest, current_user: dict = Depends(get_current_user)
):
    """
    Complete S3 multipart upload and save metadata to DynamoDB.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Completing multipart upload for session {request.sessionId}")
        logger.info(f"[ETag] Validating {len(request.parts)} parts before completion")

        # Validate and clean ETags before submission to S3 (defensive check)
        for idx, part in enumerate(request.parts):
            if not part.get("ETag"):
                logger.error(f"[ETag] Part {idx} missing ETag")
                raise ValueError(f"Missing ETag for part {part['PartNumber']}")

            etag = part["ETag"]
            # Remove quotes if present (defensive check - should already be clean from upload_video_part)
            if etag.startswith('"') and etag.endswith('"'):
                part["ETag"] = etag[1:-1]
                logger.info(
                    f"[ETag] Cleaned quotes from part {part['PartNumber']}: {etag} → {part['ETag']}"
                )

            logger.debug(
                f"[ETag] Part {idx}: PartNumber={part['PartNumber']}, ETag={part['ETag'][:20]}..."
            )

        # Validate for duplicate ETags (防止重复上传同一分片)
        etags_seen = set()
        duplicate_parts = []
        for part in request.parts:
            etag = part["ETag"]
            part_num = part["PartNumber"]
            if etag in etags_seen:
                duplicate_parts.append(f"Part {part_num} (ETag: {etag[:20]}...)")
                logger.error(f"[ETag Validation] Duplicate ETag detected for part {part_num}: {etag}")
            etags_seen.add(etag)

        if duplicate_parts:
            error_msg = f"Duplicate ETags detected in upload parts: {', '.join(duplicate_parts)}. Each part must have a unique ETag."
            logger.error(f"[ETag Validation] {error_msg}")
            raise ValueError(error_msg)

        # Validate part numbers are sequential and start from 1
        part_numbers = sorted([p["PartNumber"] for p in request.parts])
        expected_parts = list(range(1, len(part_numbers) + 1))
        if part_numbers != expected_parts:
            error_msg = f"Non-sequential part numbers detected. Expected: {expected_parts}, Got: {part_numbers}"
            logger.error(f"[ETag Validation] {error_msg}")
            raise ValueError(error_msg)

        logger.info(f"[ETag Validation] ✅ All {len(request.parts)} parts validated successfully - no duplicates, sequential numbering")

        # Create S3 client with Signature Version 4 (required for presigned URLs with multipart uploads)
        s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

        # Reconstruct S3 key
        s3_key = f"video-recordings/{user_email}/{request.sessionId}/recording.webm"

        logger.info(
            f"[Upload] Submitting {len(request.parts)} parts to S3 for completion"
        )

        # Complete multipart upload
        _response = s3_client.complete_multipart_upload(
            Bucket=S3_BUCKET_NAME,
            Key=s3_key,
            UploadId=request.uploadId,
            MultipartUpload={"Parts": request.parts},
        )

        video_location = f"s3://{S3_BUCKET_NAME}/{s3_key}"
        logger.info(f"Video recording completed: {video_location}")

        # Note: videoLocation is saved to DynamoDB later when saveInterviewSession is called
        # No need to update DynamoDB here - just return the S3 location to frontend

        return {
            "videoLocation": video_location,
            "s3Key": s3_key,
            "bucket": S3_BUCKET_NAME,
        }

    except Exception as e:
        logger.error(f"Error completing multipart upload: {e}")

        # Attempt to abort the multipart upload on error
        try:
            s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))
            s3_key = f"video-recordings/{user_email}/{request.sessionId}/recording.webm"
            s3_client.abort_multipart_upload(
                Bucket=S3_BUCKET_NAME, Key=s3_key, UploadId=request.uploadId
            )
            logger.info(f"Aborted failed multipart upload: {request.uploadId}")
        except Exception as abort_error:
            logger.error(f"Failed to abort multipart upload: {abort_error}")

        raise HTTPException(status_code=500, detail=str(e))


class GetVideoUrlRequest(BaseModel):
    """Request body for getting presigned video URL"""

    s3Key: str


@app.post("/video/get-url", dependencies=[Depends(get_current_user)])
async def get_video_url(
    request: GetVideoUrlRequest, current_user: dict = Depends(get_current_user)
):
    """
    Generate presigned URL for video playback.
    Returns a temporary URL valid for 1 hour.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Generating presigned URL for video: {request.s3Key}")

        # Security check: Ensure user can only access their own videos
        if not request.s3Key.startswith(f"video-recordings/{user_email}/"):
            raise HTTPException(status_code=403, detail="Access denied to this video")

        # Create S3 client with Signature Version 4 (required for presigned URLs)
        s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

        # Generate presigned URL (valid for 1 hour)
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET_NAME, "Key": request.s3Key},
            ExpiresIn=3600,  # 1 hour
        )

        logger.info(f"Presigned URL generated for {request.s3Key}")

        return {"url": presigned_url, "expiresIn": 3600}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating presigned URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))
