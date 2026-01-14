import json
import os
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import boto3
from botocore.client import Config
from pydantic import BaseModel, Field
import time
import uuid
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from fastapi import (
    FastAPI,
    HTTPException,
    Security,
    Depends,
    UploadFile,
    File,
    Form,
    Response,
    Header,
    Request,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import FileResponse
from starlette.status import HTTP_403_FORBIDDEN
from dotenv import load_dotenv
from PyPDF2 import PdfReader
import io


# Load environment variables
load_dotenv()

# Import auth and feature flags
from auth import validate_token
from config.feature_flags import feature_flags

# Import CandidatePlannerService
from candidate_planner_service import CandidatePlannerService

# Import database service
from services.database_service import LocalDBService

# Import memory service
from services.memory_service import MemoryService

# Import retry utilities
from utils.retry_utils import with_retry, AGGRESSIVE_RETRY_CONFIG, _calculate_backoff

# Import Strands and botocore exceptions for specific error handling
try:
    from strands.types.exceptions import EventLoopException
except ImportError:
    EventLoopException = Exception  # Fallback if Strands not available

from botocore.exceptions import EventStreamError

# Initialize logger
logger = logging.getLogger("interview_api")

# Environment variables
STACK_PREFIX = os.environ.get("STACK_NAME", "sonic-int")
STACK_SUFFIX = os.environ.get("STACK_ENVIRONMENT", "dev")
DOMAIN_NAME = os.getenv("DOMAIN_NAME", "*")
S3_BUCKET_NAME = os.getenv("DATA_BUCKET", "ASSISTANT-DataBucket")
AC_MEMORY_ID = os.getenv("AC_MEMORY_ID")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
LAMBDA_FUNCTION_NAME = os.getenv("AWS_LAMBDA_FUNCTION_NAME")  # Auto-provided by Lambda

logger.info(f"STACK_PREFIX: {STACK_PREFIX}")
logger.info(f"STACK_SUFFIX: {STACK_SUFFIX}")
logger.info(f"DOMAIN_NAME: {DOMAIN_NAME}")
logger.info(f"S3_BUCKET_NAME: {S3_BUCKET_NAME}")
logger.info(f"AC_MEMORY_ID: {AC_MEMORY_ID}")
logger.info(f"AWS_REGION: {AWS_REGION}")

# Initialize database service
db_service = LocalDBService(
    stack_prefix=STACK_PREFIX, stack_suffix=STACK_SUFFIX, profile_name=None
)

# Initialize Memory Service
memory_service = MemoryService(region_name=AWS_REGION)

# Initialize Lambda client for async invocations
lambda_client = boto3.client("lambda", region_name=AWS_REGION)

# Initialize FastAPI app
app = FastAPI(title="Interview Practice API")

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
        raise HTTPException(
            status_code=HTTP_403_FORBIDDEN, detail="Authorization token required"
        )

    try:
        user_info = validate_token(credentials.credentials)
        logger.info(f"User authenticated: {user_info.get('user_id', 'unknown')}")
        return user_info
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during token validation: {e}")
        raise HTTPException(
            status_code=HTTP_403_FORBIDDEN,
            detail="Could not validate authentication token",
        )


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


def scrape_website_content(url: str) -> Dict[str, Any]:
    """
    Scrape content from a public URL using BeautifulSoup.
    """
    try:
        # Validate URL
        parsed_url = urlparse(url)
        if not parsed_url.scheme or not parsed_url.netloc:
            return {"status": "error", "error": "Invalid URL format"}

        # Add headers to mimic a browser request
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }

        # Make the request
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        # Parse the HTML content
        soup = BeautifulSoup(response.text, "html.parser")

        # Extract title
        title = soup.title.string if soup.title else "No title found"

        # Extract main text content
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.decompose()

        text_content = soup.get_text(separator="\n", strip=True)

        # Extract links
        links = []
        for link in soup.find_all("a", href=True):
            href = link["href"]
            if href.startswith("http"):
                links.append(href)
            elif href.startswith("/"):
                base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"
                links.append(f"{base_url}{href}")

        return {
            "status": "success",
            "title": title,
            "text_content": text_content,
            "links": links,
        }

    except requests.exceptions.RequestException as e:
        return {"status": "error", "error": f"Request failed: {str(e)}"}
    except Exception as e:
        return {"status": "error", "error": f"Scraping failed: {str(e)}"}


# ============================================================================
# Pydantic Models
# ============================================================================


class ScrapeJobDescriptionRequest(BaseModel):
    url: str


class ScrapeResumeRequest(BaseModel):
    url: str


class SaveInterviewPlanRequest(BaseModel):
    companyName: Optional[str] = Field(default=None)
    jobTitle: Optional[str] = Field(default=None)
    interviewType: str = Field(default="technical")
    resumeSummary: str = Field(description="Resume summary")
    jdSummary: str = Field(description="Job description summary")
    companyResearch: Dict = Field(description="Company research results")
    questions: List[Dict] = Field(description="Generated questions")
    preparationTips: List[str] = Field(default_factory=list)


class SavePracticeSessionRequest(BaseModel):
    """Request body for saving practice session"""

    sessionId: str
    prepId: Optional[str] = None
    audioS3Key: Optional[str] = None  # S3 key for audio uploaded via presigned URL
    transcription: List[dict]  # List of {role, content, timestamp}
    duration: Optional[int] = None  # Duration in seconds
    metadata: Optional[dict] = None


# ============================================================================
# Health Check
# ============================================================================


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/sessions", dependencies=[Depends(get_current_user)])
async def list_sessions_root_endpoint(current_user: dict = Depends(get_current_user)):
    """
    Root-level endpoint for listing practice sessions.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Fetching sessions for user")

        # Get sessions from DynamoDB
        sessions = db_service.get_practice_sessions(user_email)

        logger.info(f"Found {len(sessions)} sessions for user")

        return {"status": "success", "sessions": sessions}

    except Exception as e:
        logger.error(f"Error fetching sessions: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch sessions: {str(e)}"
        )


# ============================================================================
# Prepare Interview APIs
# ============================================================================


@app.post("/scrape-jd", dependencies=[Depends(get_current_user)])
async def scrape_job_description(
    request: ScrapeJobDescriptionRequest, current_user: dict = Depends(get_current_user)
):
    """
    Scrape job description content from a URL.
    """
    try:
        url = request.url

        # Use existing scrape_website_content function
        result = scrape_website_content(url)

        if result.get("status") == "error":
            raise HTTPException(
                status_code=400, detail=result.get("error", "Failed to scrape URL")
            )

        # Extract and clean the text content
        text_content = result.get("text_content", "")
        title = result.get("title", "")

        # Clean up the text (remove excessive whitespace, etc.)
        lines = [line.strip() for line in text_content.split("\n") if line.strip()]
        cleaned_text = "\n".join(lines)

        return {"status": "success", "text": cleaned_text, "title": title, "url": url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scraping job description: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to scrape job description: {str(e)}"
        )


@app.post("/scrape-resume", dependencies=[Depends(get_current_user)])
async def scrape_resume(
    request: ScrapeResumeRequest, current_user: dict = Depends(get_current_user)
):
    """
    Scrape resume content from a URL (e.g., LinkedIn profile, Google Drive, personal website).
    """
    try:
        url = request.url

        # Use existing scrape_website_content function
        result = scrape_website_content(url)

        if result.get("status") == "error":
            raise HTTPException(
                status_code=400, detail=result.get("error", "Failed to scrape URL")
            )

        # Extract and clean the text content
        text_content = result.get("text_content", "")

        # Clean up the text (remove excessive whitespace, etc.)
        lines = [line.strip() for line in text_content.split("\n") if line.strip()]
        cleaned_text = "\n".join(lines)

        return {"status": "success", "text": cleaned_text, "url": url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scraping resume: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to scrape resume: {str(e)}"
        )


async def _process_interview_plan_job(
    user_id: str,
    plan_id: str,  # Changed from job_id
    resume_bytes: bytes,
    resume_filename: str,
    jd_content: str,
    companyName: Optional[str],
    interviewType: str,
    questionCount: int,
    difficulty: str,
    custom_questions_list: Optional[List],
):
    """
    Background task to process interview plan generation.
    Updates interview plan status in DynamoDB as it progresses.
    """
    try:
        logger.info(f"Starting plan generation {plan_id} for user {user_id}")

        # Update plan status to processing
        db_service.update_interview_plan_status(user_id, plan_id, "processing")

        # Generate interview plan with retry logic
        result = await _generate_interview_plan_with_retry(
            resume_bytes=resume_bytes,
            resume_filename=resume_filename,
            jd_content=jd_content,
            companyName=companyName,
            interviewType=interviewType,
            questionCount=questionCount,
            difficulty=difficulty,
            custom_questions_list=custom_questions_list,
            user_id=user_id,
        )

        # Complete the interview plan with generated data
        db_service.complete_interview_plan(
            user_id=user_id,
            plan_id=plan_id,
            resume_summary=result.get("resumeSummary", ""),
            jd_summary=result.get("jdSummary", ""),
            company_research=result.get("interviewPlan", {}).get("companyResearch", {}),
            questions=result.get("interviewPlan", {}).get("questions", []),
            preparation_tips=result.get("interviewPlan", {}).get("preparationTips", []),
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


async def _generate_interview_plan_with_retry(
    resume_bytes: bytes,
    resume_filename: str,
    jd_content: str,
    companyName: Optional[str],
    interviewType: str,
    questionCount: int,
    difficulty: str,
    custom_questions_list: Optional[List],
    user_id: str,
    max_attempts: int = None,  # Defaults to AGGRESSIVE_RETRY_CONFIG.max_attempts
) -> Dict[str, Any]:
    """
    Generate interview plan with application-level retry logic.

    This provides endpoint-level retries for transient errors that occur
    during the entire pipeline (file processing, Agent creation, Bedrock calls).

    Uses AGGRESSIVE_RETRY_CONFIG by default (5 attempts with exponential backoff + jitter):
    - Attempt 1: Immediate
    - Attempt 2: ~2s (1.0-2.0s with jitter)
    - Attempt 3: ~4s (2.0-4.0s with jitter)
    - Attempt 4: ~8s (4.0-8.0s with jitter)
    - Attempt 5: ~16s (8.0-16.0s with jitter)
    """
    # Use AGGRESSIVE_RETRY_CONFIG max_attempts if not specified
    if max_attempts is None:
        max_attempts = AGGRESSIVE_RETRY_CONFIG.max_attempts
    from botocore.exceptions import ClientError
    import asyncio

    last_error = None

    for attempt in range(1, max_attempts + 1):
        logger.info(
            f"[Retry Attempt {attempt}/{max_attempts}] Starting interview plan generation"
        )
        try:
            # Initialize Candidate Planner Service
            planner = CandidatePlannerService()

            # Generate full interview plan with user_id for memory retrieval
            result = await planner.create_full_interview_plan(
                resume_file_bytes=resume_bytes,
                file_name=resume_filename,
                jd_text=jd_content,
                company_name=companyName,
                interview_type=interviewType,
                question_count=questionCount,
                difficulty=difficulty,
                custom_questions=custom_questions_list,
                user_id=user_id,
            )

            logger.info(
                f"[Retry Attempt {attempt}] ✅ Interview plan generated successfully"
            )
            return result

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
                500 <= http_status < 600  # 5xx errors
                or http_status == 429  # Throttling
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
            # Handle Strands EventLoopException specifically
            logger.info(
                f"[Retry Attempt {attempt}] 🔴 Caught {type(e).__name__}: {str(e)[:100]}"
            )
            last_error = e
            error_str_lower = str(e).lower()

            # Check for Bedrock service errors in the exception message
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

            # Calculate exponential backoff with jitter
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
            error_str = str(
                e
            ).lower()  # Convert to lowercase for case-insensitive matching

            # Check if it's a retryable error string (case-insensitive)
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

            # Calculate exponential backoff with jitter
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


@app.post("/generate-interview-plan", dependencies=[Depends(get_current_user)])
async def generate_interview_plan_endpoint(
    background_tasks: BackgroundTasks,
    resumeFile: UploadFile = File(...),
    jdText: Optional[str] = Form(None),
    jdFile: Optional[UploadFile] = File(None),
    companyName: Optional[str] = Form(None),
    jobTitle: Optional[str] = Form(None),
    interviewType: str = Form("technical"),
    questionCount: int = Form(5),
    difficulty: str = Form("medium"),
    customQuestions: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    """
    Generate an interview preparation plan asynchronously.

    Returns a job ID immediately. Client should poll /jobs/{job_id} for status and results.
    This avoids CloudFront 60-second timeout for long-running operations.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Queueing interview plan generation for user")

        # Read resume file (keep as bytes for Bedrock document processing)
        resume_bytes = await resumeFile.read()
        resume_filename = resumeFile.filename

        # Handle JD - can be either text or file
        jd_content = jdText or ""
        if jdFile and not jdText:
            # If JD is a file, extract text content
            jd_file_bytes = await jdFile.read()
            jd_filename = jdFile.filename
            jd_content = extract_text_from_file(jd_file_bytes, jd_filename)
            logger.info(f"Extracted JD from {jd_filename}")

        if not jd_content:
            raise HTTPException(
                status_code=400, detail="Job description text or file is required"
            )

        # Parse custom questions if provided
        custom_questions_list = None
        if customQuestions:
            try:
                custom_questions_list = json.loads(customQuestions)
                logger.info(f"Received {len(custom_questions_list)} custom questions")
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse custom questions: {e}")

        # Generate unique plan ID
        plan_id = str(uuid.uuid4())

        # Create interview plan record in DynamoDB with status='pending'
        # This replaces the separate JOB# entry - now we use PLAN# for both tracking and storage
        db_service.save_interview_plan(
            user_id=user_email,
            plan_id=plan_id,
            company_name=companyName,
            job_title=jobTitle,
            interview_type=interviewType,
            resume_summary="",  # Will be filled in when job completes
            jd_summary="",  # Will be filled in when job completes
            company_research={},  # Will be filled in when job completes
            questions=[],  # Will be filled in when job completes
            preparation_tips=[],  # Will be filled in when job completes
            interview_stage="practice",
            status="pending",  # Job tracking status
            job_params={  # Store params for debugging/reference
                "companyName": companyName,
                "jobTitle": jobTitle,
                "interviewType": interviewType,
                "questionCount": questionCount,
                "difficulty": difficulty,
            },
        )

        # Invoke Lambda asynchronously to process job (avoids API Gateway 30s timeout)
        # This returns immediately while processing happens in a separate Lambda invocation
        if LAMBDA_FUNCTION_NAME:
            try:
                # Prepare payload for async processing
                async_payload = {
                    "asyncJobProcessing": True,  # Flag to distinguish from HTTP events
                    "jobType": "candidate_interview_plan",  # Changed from 'interview_plan_generation'
                    "userId": user_email,
                    "planId": plan_id,  # Changed from jobId to planId
                    "resumeBytes": resume_bytes.hex(),  # Convert bytes to hex string for JSON
                    "resumeFilename": resume_filename,
                    "jdContent": jd_content,
                    "companyName": companyName,
                    "interviewType": interviewType,
                    "questionCount": questionCount,
                    "difficulty": difficulty,
                    "customQuestions": custom_questions_list,
                }

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
                    _process_interview_plan_job,
                    user_id=user_email,
                    plan_id=plan_id,  # Changed from job_id
                    resume_bytes=resume_bytes,
                    resume_filename=resume_filename,
                    jd_content=jd_content,
                    companyName=companyName,
                    interviewType=interviewType,
                    questionCount=questionCount,
                    difficulty=difficulty,
                    custom_questions_list=custom_questions_list,
                )
        else:
            # Local development - use background tasks
            logger.info(
                "LAMBDA_FUNCTION_NAME not set - using background task for local dev"
            )
            background_tasks.add_task(
                _process_interview_plan_job,
                user_id=user_email,
                plan_id=plan_id,  # Changed from job_id
                resume_bytes=resume_bytes,
                resume_filename=resume_filename,
                jd_content=jd_content,
                companyName=companyName,
                interviewType=interviewType,
                questionCount=questionCount,
                difficulty=difficulty,
                custom_questions_list=custom_questions_list,
            )

        return {
            "status": "pending",
            "planId": plan_id,  # Changed from jobId
            "message": "Interview plan generation started. Poll /plans/{plan_id} for status.",
        }

    except HTTPException:
        # Re-raise HTTP exceptions (validation errors) without modification
        raise

    except Exception as e:
        logger.error(f"Error queueing interview plan generation: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to queue interview plan generation: {str(e)}",
        )


@app.post("/save-interview-plan", dependencies=[Depends(get_current_user)])
async def save_interview_plan_endpoint(
    request: SaveInterviewPlanRequest, current_user: dict = Depends(get_current_user)
):
    """
    Save interview preparation plan to DynamoDB.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Saving interview plan for user")

        # Generate unique ID
        plan_id = str(uuid.uuid4())

        # Remove companyName and positionTitle from companyResearch to avoid duplication
        # These are stored as top-level fields (company_name, job_title)
        company_research_filtered = (
            {
                k: v
                for k, v in request.companyResearch.items()
                if k not in ["companyName", "positionTitle", "jobTitle"]
            }
            if isinstance(request.companyResearch, dict)
            else {}
        )

        # Save to DynamoDB
        result = db_service.save_interview_plan(
            user_id=user_email,
            plan_id=plan_id,
            company_name=request.companyName,
            job_title=request.jobTitle,
            interview_type=request.interviewType,
            resume_summary=request.resumeSummary,
            jd_summary=request.jdSummary,
            company_research=company_research_filtered,  # Only actual research data (no duplicate name/title)
            questions=request.questions,
            preparation_tips=request.preparationTips,
            interview_stage="practice",  # Mark as candidate practice plan
        )

        logger.info(f"Interview plan saved to DynamoDB: {plan_id}")

        return {
            "status": "success",
            "planId": plan_id,
            "message": "Interview plan saved successfully",
        }

    except Exception as e:
        logger.error(f"Error saving interview plan: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save interview plan: {str(e)}"
        )


@app.post("/mark-plan-saved/{plan_id}", dependencies=[Depends(get_current_user)])
async def mark_plan_saved_endpoint(
    plan_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Mark an interview plan as saved/completed.
    This updates the status from 'generated' to 'completed' when user explicitly saves.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Marking plan {plan_id} as saved for user")

        # Update plan status to completed
        db_service.mark_interview_plan_as_saved(user_email, plan_id)

        return {
            "status": "success",
            "planId": plan_id,
            "message": "Interview plan marked as saved",
        }

    except Exception as e:
        logger.error(f"Error marking plan as saved: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Failed to mark plan as saved: {str(e)}"
        )


@app.get("/interview-plans", dependencies=[Depends(get_current_user)])
async def get_interview_plans_endpoint(current_user: dict = Depends(get_current_user)):
    """
    Get all saved interview plans for the current user.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Fetching interview plans for user")

        # Get plans from DynamoDB (only practice plans, not interviewer scheduled interviews)
        plans = db_service.get_interview_plans(
            user_email, interview_stage_filter="practice"
        )

        logger.info(f"Found {len(plans)} practice interview plans for user")

        return {"status": "success", "plans": plans}

    except Exception as e:
        logger.error(f"Error fetching interview plans: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch interview plans: {str(e)}"
        )


@app.get("/interview-plans/{plan_id}", dependencies=[Depends(get_current_user)])
async def get_interview_plan_by_id_endpoint(
    plan_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Get a specific interview plan by ID.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Fetching interview plan {plan_id} for user")

        # Get plan from DynamoDB
        plan = db_service.get_interview_plan_by_id(user_email, plan_id)

        if not plan:
            raise HTTPException(status_code=404, detail="Interview plan not found")

        return {"status": "success", "plan": plan}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching interview plan: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch interview plan: {str(e)}"
        )


@app.delete("/interview-plans/{plan_id}", dependencies=[Depends(get_current_user)])
async def delete_interview_plan_endpoint(
    plan_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Delete a specific interview plan by ID.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Deleting interview plan {plan_id} for user")

        # Delete from DynamoDB
        success = db_service.delete_interview_plan(user_email, plan_id)

        if not success:
            raise HTTPException(status_code=404, detail="Interview plan not found")

        logger.info(f"Interview plan deleted: {plan_id}")

        return {
            "status": "success",
            "message": "Interview plan deleted successfully",
            "planId": plan_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting interview plan: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Failed to delete interview plan: {str(e)}"
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


# ============================================================================
# Practice Session APIs
# ============================================================================


@app.post("/practice-sessions", dependencies=[Depends(get_current_user)])
async def save_practice_session_endpoint(
    request: SavePracticeSessionRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """
    Save practice session recording with audio and transcription to DynamoDB.
    Audio must be pre-uploaded to S3 via presigned URL.
    Triggers async analysis in the background.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Saving practice session {request.sessionId} for user")

        # Initialize S3 client for audio upload
        s3_client = boto3.client("s3")

        # Handle audio upload if provided
        audio_size = 0
        audio_location = None
        audio_url = None

        # Audio already uploaded to S3 via presigned URL
        if request.audioS3Key:
            logger.info(f"Using pre-uploaded audio from S3: {request.audioS3Key}")
            audio_location = f"s3://{S3_BUCKET_NAME}/{request.audioS3Key}"
            audio_url = (
                f"https://{S3_BUCKET_NAME}.s3.amazonaws.com/{request.audioS3Key}"
            )

            # Verify the audio file exists in S3
            try:
                response = s3_client.head_object(
                    Bucket=S3_BUCKET_NAME, Key=request.audioS3Key
                )
                audio_size = response.get("ContentLength", 0)
                logger.info(
                    f"Verified audio in S3: {audio_location} ({audio_size} bytes)"
                )
            except Exception as e:
                logger.error(f"Audio file not found in S3: {request.audioS3Key} - {e}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Audio file not found in S3: {request.audioS3Key}",
                )

        # Save practice session to DynamoDB with S3 audio references
        # Note: transcription moved to metadata, audio_size removed (obsolete)
        db_result = db_service.save_practice_session(
            user_id=user_email,
            session_id=request.sessionId,
            prep_id=request.prepId or "",
            duration=request.duration or 0,
            metadata=request.metadata,
            audio_location=audio_location,
            audio_url=audio_url,
        )
        logger.info(f"Practice session saved to DynamoDB: {request.sessionId}")

        # Save conversation history to AgentCore Memory
        memory_service.save_conversation_history(
            user_id=user_email,
            session_id=request.sessionId,
            transcription=request.transcription,
        )

        # Trigger async analysis in the background
        from interview_analysis_service import analyze_session_async

        background_tasks.add_task(
            analyze_session_async,
            user_id=user_email,
            session_id=request.sessionId,
            prep_id=request.prepId,
            transcription=request.transcription,
            duration=request.duration or 0,
        )
        logger.info(f"Background analysis task queued for session: {request.sessionId}")

        # Prepare response
        response_data = {
            "status": "success",
            "sessionId": request.sessionId,
            "message": "Practice session saved successfully. Analysis in progress.",
        }

        # Include audio info if uploaded
        if audio_location:
            response_data["audioLocation"] = audio_location
            response_data["audioUrl"] = audio_url

        return response_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving practice session: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save practice session: {str(e)}"
        )


@app.get("/practice-sessions", dependencies=[Depends(get_current_user)])
async def list_practice_sessions_endpoint(
    current_user: dict = Depends(get_current_user),
):
    """
    Get all saved practice sessions for the current user.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Fetching practice sessions for user")

        # Get sessions from DynamoDB
        sessions = db_service.get_practice_sessions(user_email)

        logger.info(f"Found {len(sessions)} practice sessions for user")

        return {"status": "success", "sessions": sessions}

    except Exception as e:
        logger.error(f"Error fetching practice sessions: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch practice sessions: {str(e)}"
        )


@app.get("/practice-sessions/{session_id}", dependencies=[Depends(get_current_user)])
async def get_practice_session_endpoint(
    session_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Get full practice session data including transcription and analysis (if available).
    Includes interview plan with questions if session was created from a prep plan.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Fetching session {session_id} for user")

        # Get session from DynamoDB
        session = db_service.get_practice_session_by_id(user_email, session_id)

        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Fetch interview plan if session has prepId
        if session.get("prepId"):
            interview_plan = db_service.get_interview_plan_by_id(
                user_email, session["prepId"]
            )
            if interview_plan:
                session["interviewPlan"] = interview_plan
                logger.info(f"Attached interview plan {session['prepId']} to session")

        return {"status": "success", "session": session}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching session: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch session: {str(e)}"
        )


@app.get("/sessions", dependencies=[Depends(get_current_user)])
async def list_sessions_endpoint(current_user: dict = Depends(get_current_user)):
    """
    Alias endpoint for listing practice sessions at /sessions.
    This is kept for backward compatibility.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Fetching sessions for user")

        # Get sessions from DynamoDB
        sessions = db_service.get_practice_sessions(user_email)

        logger.info(f"Found {len(sessions)} sessions for user")

        return {"status": "success", "sessions": sessions}

    except Exception as e:
        logger.error(f"Error fetching sessions: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch sessions: {str(e)}"
        )


@app.delete("/practice-sessions/{session_id}", dependencies=[Depends(get_current_user)])
async def delete_practice_session_endpoint(
    session_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Delete a practice session.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Deleting session {session_id} for user")

        # Delete from DynamoDB
        success = db_service.delete_practice_session(user_email, session_id)

        if not success:
            raise HTTPException(status_code=404, detail="Session not found")

        logger.info(f"Session deleted: {session_id}")

        return {
            "status": "success",
            "message": "Practice session deleted successfully",
            "sessionId": session_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting session: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to delete session: {str(e)}"
        )


# ============================================================================
# Candidate Interview Session APIs (Live Interview with Transcript Analysis)
# ============================================================================


@app.post("/candidate-interview-sessions")
async def save_candidate_interview_session(
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
    current_user: dict = Depends(get_current_user),
):
    """
    Save candidate interview session and generate structured summary.

    This endpoint:
    1. Receives the full interview transcript
    2. Uses LLM to generate structured assessment
    3. Saves session with summary to storage
    """
    try:
        import base64

        user_email = current_user.get("email", "unknown")
        logger.info(f"Saving candidate interview session {sessionId} for user")

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
                logger.info(f"Loaded interview plan from practice plan: {interviewId}")

        # Generate structured summary using LLM (reuse interviewer session service)
        from interviewer_session_service import InterviewerSessionService

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

        # Save interview session to DynamoDB
        # Note: Removed obsolete PATH A fields (videoFramesEnabled, videoFramesLocation,
        # videoFrameCount, videoFrameManifest, audioSize, messageCount, transcription)
        # Transcript data stored ONLY in metadata.transcriptArray (structured with speakers)
        # Plain text transcript can be reconstructed from transcriptArray if needed
        db_result = db_service.save_practice_session(
            user_id=user_email,
            session_id=sessionId,
            prep_id=interviewId or "",
            duration=duration_seconds,  # Store as total seconds
            metadata={
                "interviewName": interviewName,
                "interviewId": interviewId,
                "summary": summary_result,
                "isCandidateInterviewSession": True,
                "durationFormatted": duration,  # Store original format for display
                "transcriptArray": transcript_array_data,  # Structured transcript with speakers (can reconstruct plain text if needed)
                "videoLocation": videoLocation,  # PATH B: Full video recording from MediaRecorder
            },
        )

        logger.info(f"Candidate interview session saved successfully: {sessionId}")

        return {
            "status": "success",
            "message": "Interview session saved successfully",
            "sessionId": sessionId,
            "summary": summary_result,
        }

    except Exception as e:
        logger.error(f"Error saving candidate interview session: {e}")
        import traceback

        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Failed to save interview session: {str(e)}"
        )


@app.get("/candidate-interview-sessions")
async def get_candidate_interview_sessions(
    current_user: dict = Depends(get_current_user),
):
    """
    Get all candidate interview sessions for the current user.
    Only returns sessions with session_prefix='candidate' (candidate sessions).
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info("Fetching candidate interview sessions for user")

        # Get candidate interview sessions from DynamoDB (session_prefix='candidate')
        sessions = db_service.get_interview_sessions(
            user_email, session_prefix="candidate"
        )

        return {"sessions": sessions}

    except Exception as e:
        logger.error(f"Error fetching candidate interview sessions: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch interview sessions: {str(e)}"
        )


@app.get("/candidate-interview-sessions/{session_id}")
async def get_candidate_interview_session(
    session_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Get a specific candidate interview session by ID.
    Includes interview plan with questions if session was created from a practice plan.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Fetching candidate interview session {session_id} for user")

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

        logger.info(f"Successfully fetched candidate interview session: {session_id}")

        return {"session": session}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching candidate interview session: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch interview session: {str(e)}"
        )


@app.delete("/candidate-interview-sessions/{session_id}")
async def delete_candidate_interview_session(
    session_id: str, current_user: dict = Depends(get_current_user)
):
    """
    Delete a candidate interview session.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Deleting candidate interview session {session_id} for user")

        # Delete from DynamoDB
        success = db_service.delete_interview_session(user_email, session_id)

        if not success:
            raise HTTPException(
                status_code=404, detail=f"Interview session {session_id} not found"
            )

        logger.info(f"Deleted candidate interview session: {session_id}")

        return {
            "status": "success",
            "message": f"Interview session {session_id} deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting candidate interview session: {e}")
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

        etag = response["ETag"]
        logger.info(f"Part {partNumber} uploaded, ETag: {etag}")

        return {"ETag": etag, "PartNumber": partNumber}

    except Exception as e:
        logger.error(f"Error uploading part {partNumber}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Audio Upload APIs (for practice sessions)
# ============================================================================


class GetAudioUploadUrlRequest(BaseModel):
    """Request body for getting presigned audio upload URL"""

    sessionId: str
    format: str = "wav"


@app.post("/audio/get-upload-url", dependencies=[Depends(get_current_user)])
async def get_audio_upload_url(
    request: GetAudioUploadUrlRequest, current_user: dict = Depends(get_current_user)
):
    """
    Generate presigned URL for direct S3 audio upload.
    Bypasses API Gateway 6MB payload limit for large audio files.

    Audio files from practice sessions can be 900+ seconds with 4096 sample buffers,
    resulting in 3000+ chunks. This exceeds API Gateway limits when sent as base64.

    Returns a presigned URL that the client can use to upload audio directly to S3.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(
            f"Generating presigned URL for audio upload: session {request.sessionId}"
        )

        # Create S3 client with Signature Version 4
        s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

        # Generate S3 key for audio file
        s3_key = (
            f"practice-sessions/{user_email}/{request.sessionId}/audio.{request.format}"
        )

        # Generate presigned URL for PUT operation (single file upload, not multipart)
        presigned_url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": S3_BUCKET_NAME,
                "Key": s3_key,
                "ContentType": f"audio/{request.format}",
            },
            ExpiresIn=3600,  # 1 hour - handles long recordings
        )

        logger.info(f"Generated presigned URL for audio upload: {s3_key}")

        return {
            "url": presigned_url,
            "s3Key": s3_key,
            "expiresIn": 3600,
        }

    except Exception as e:
        logger.error(f"Error generating audio upload URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class GetAudioUrlRequest(BaseModel):
    """Request body for getting presigned audio URL"""

    sessionId: str


@app.post("/audio/get-url", dependencies=[Depends(get_current_user)])
async def get_audio_url(
    request: GetAudioUrlRequest, current_user: dict = Depends(get_current_user)
):
    """
    Generate presigned URL for audio playback.
    Returns a temporary URL valid for 1 hour.
    """
    try:
        user_email = current_user.get("email", "unknown")
        logger.info(f"Generating presigned URL for audio session: {request.sessionId}")

        # Get session metadata from DynamoDB to find audio location
        session = db_service.get_practice_session_by_id(user_email, request.sessionId)

        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        if not session.get("audioLocation"):
            raise HTTPException(
                status_code=404, detail="Audio not found for this session"
            )

        # Extract S3 key from audioLocation (format: s3://bucket/key)
        audio_location = session.get("audioLocation", "")
        if not audio_location.startswith("s3://"):
            raise HTTPException(
                status_code=500, detail="Invalid audio location in session"
            )

        # Parse S3 location: s3://bucket-name/path/to/file
        s3_parts = audio_location.replace("s3://", "").split("/", 1)
        bucket = s3_parts[0]
        s3_key = s3_parts[1] if len(s3_parts) > 1 else ""

        # Security check: Ensure user can only access their own audio
        expected_prefix = f"practice-sessions/{user_email}/"
        if not s3_key.startswith(expected_prefix):
            raise HTTPException(status_code=403, detail="Access denied to this audio")

        # Create S3 client with Signature Version 4 (required for presigned URLs)
        s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

        # Generate presigned URL (valid for 1 hour)
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": s3_key},
            ExpiresIn=3600,  # 1 hour
        )

        logger.info(f"Presigned URL generated for audio session: {request.sessionId}")

        return {"url": presigned_url, "expiresIn": 3600}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating presigned audio URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Video Upload APIs (multipart for large files)
# ============================================================================


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

        # Create S3 client with Signature Version 4 (required for presigned URLs with multipart uploads)
        s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

        # Reconstruct S3 key
        s3_key = f"video-recordings/{user_email}/{request.sessionId}/recording.webm"

        # Complete multipart upload
        response = s3_client.complete_multipart_upload(
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
