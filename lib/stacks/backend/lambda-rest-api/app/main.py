"""
Lambda handler for REST API (FastAPI with Mangum adapter)

This module creates the main FastAPI application for the Interview Assistant REST API,
mounts all sub-applications (candidate, interviewer, analytics), and wraps everything
with the Mangum adapter for AWS Lambda compatibility.

Key differences from EKS version (run_servers.py):
- No WebSocket endpoints (handled by AgentCore Runtime)
- Uses Mangum adapter for Lambda compatibility
- Environment variables automatically provided by Lambda
- Single entry point (no separate server process)
"""

# Load environment variables FIRST before any other imports that depend on them
from dotenv import load_dotenv

load_dotenv()

import os
import sys
import logging
import boto3
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel
from typing import Optional

# Import the sub-applications
from candidate_api import app as candidate_api_app
from interviewer_api import app as interviewer_api_app, _process_schedule_interview_job
from analytics_api import app as analytics_api_app

# Import feature flags (after dotenv is loaded)
from config.feature_flags import feature_flags

# Initialize SSM client for parameter retrieval
ssm_client = None
_agentcore_runtime_arn_cache = None  # Cache for runtime ARN

# Configure logging for Lambda
# IMPORTANT: Configure root logger to ensure all child loggers (interviewer_api, candidate_api, etc.)
# properly write to CloudWatch. Using basicConfig alone is insufficient for Lambda.
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Remove any existing handlers to avoid duplicates
if root_logger.handlers:
    for handler in root_logger.handlers:
        root_logger.removeHandler(handler)

# Add stdout handler with consistent formatting
handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.INFO)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
root_logger.addHandler(handler)

# Create module-specific logger (inherits from root)
logger = logging.getLogger("lambda_rest_api")
logger.setLevel(logging.INFO)

# Log environment info on cold start
logger.info("=" * 60)
logger.info(f"COGNITO_USER_POOL_ID: {os.getenv('COGNITO_USER_POOL_ID')}")
logger.info(f"COGNITO_APP_CLIENT_ID: {os.getenv('COGNITO_APP_CLIENT_ID')}")
logger.info(f"AWS_REGION: {os.getenv('AWS_REGION')}")
logger.info(f"STACK_NAME: {os.getenv('STACK_NAME')}")
logger.info(f"STACK_ENVIRONMENT: {os.getenv('STACK_ENVIRONMENT')}")
logger.info(f"NO_AUTH MODE: {feature_flags['NO_AUTH']}")
logger.info("=" * 60)

# Create main FastAPI application
app = FastAPI(
    title="Interview Assistant REST API",
    description="REST API for Interview Assistant - Lambda Version",
    version="2.0.0",
)

# Add CORS middleware - Configured with specific origins for security
# Get allowed origins from environment variable (set by CDK stack)
# Format: Comma-separated list of origins (e.g., "https://example.com,https://app.example.com")
allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
if allowed_origins_env:
    allowed_origins = [
        origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()
    ]
else:
    # Fallback for local development only - should never be used in production
    allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
    logging.warning(
        "ALLOWED_ORIGINS environment variable not set. Using localhost for development."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,  # Specific origins only - no wildcards
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# Health check endpoint (no authentication required)
@app.get("/health")
async def health_check():
    """Health check endpoint for ALB/monitoring"""
    return {
        "status": "healthy",
        "service": "interview-assistant-rest-api",
        "version": "2.0.0",
        "environment": os.environ.get("STACK_ENVIRONMENT", "dev"),
        "runtime": "lambda",
    }


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Interview Assistant REST API",
        "version": "2.0.0",
        "runtime": "lambda",
        "endpoints": {
            "health": "/health",
            "candidate": "/api/candidate/*",
            "interviewer": "/api/interviewer/*",
            "analytics": "/api/analytics/*",
            "websocket": "/api/get-ws-url",
        },
    }


# Helper function to retrieve AgentCore Runtime ARN
def _get_agentcore_runtime_arn() -> Optional[str]:
    """
    Get AgentCore Runtime ARN from environment variable or SSM Parameter Store.
    Uses caching to avoid repeated SSM calls within the same Lambda execution context.

    Returns:
        str: AgentCore Runtime ARN or None if not found
    """
    global ssm_client, _agentcore_runtime_arn_cache

    # Try environment variable first
    runtime_arn = os.getenv("AGENTCORE_RUNTIME_ARN")
    if runtime_arn:
        return runtime_arn

    # Check cache (for Lambda warm starts)
    if _agentcore_runtime_arn_cache:
        logger.info("Using cached AgentCore Runtime ARN from previous invocation")
        return _agentcore_runtime_arn_cache

    # Fall back to SSM Parameter Store
    try:
        if not ssm_client:
            ssm_client = boto3.client(
                "ssm", region_name=os.getenv("AWS_REGION", "us-east-1")
            )

        stack_name = os.getenv("STACK_NAME", "sonic-int")
        # Note: Parameter path uses projectId only (not projectId-environment)
        parameter_name = f"/{stack_name}/agentcore/runtime-arn"

        logger.info(
            f"Retrieving AgentCore Runtime ARN from Parameter Store: {parameter_name}"
        )

        response = ssm_client.get_parameter(Name=parameter_name)
        runtime_arn = response["Parameter"]["Value"]

        # Cache for subsequent invocations in same Lambda context
        _agentcore_runtime_arn_cache = runtime_arn
        logger.info("Successfully retrieved AgentCore Runtime ARN from Parameter Store")

        return runtime_arn
    except Exception as e:
        logger.warning(
            f"Failed to retrieve AgentCore Runtime ARN from Parameter Store: {e}"
        )
        return None


# Pydantic model for WebSocket URL request
class WebSocketUrlRequest(BaseModel):
    session_id: str
    user_id: str
    practice_session_id: Optional[str] = None
    mode: str = "light"
    voice_id: str = "matthew"


# WebSocket pre-signed URL endpoint
@app.post("/api/get-ws-url")
async def get_websocket_url(request: WebSocketUrlRequest):
    """
    Generate a pre-signed WebSocket URL for AgentCore Runtime.

    This endpoint allows browser clients to obtain a pre-signed WebSocket URL
    that includes SigV4 authentication in query parameters, avoiding the need
    for custom headers (which browsers don't support with WebSocket API).

    Args:
        request: WebSocketUrlRequest containing session_id, user_id, and optional parameters

    Returns:
        dict: Contains 'wsUrl' with the pre-signed WebSocket URL, expiresIn, and sessionId

    Raises:
        HTTPException: 500 if AGENTCORE_RUNTIME_ARN is not configured or URL generation fails
    """
    try:
        # Import here to avoid issues if bedrock-agentcore is not available during development
        from bedrock_agentcore.runtime import AgentCoreRuntimeClient
    except ImportError as e:
        logger.error(f"Failed to import bedrock_agentcore: {e}")
        raise HTTPException(
            status_code=500, detail="AgentCore Runtime client not available"
        )

    # Get AgentCore Runtime ARN from environment variable or SSM Parameter Store
    runtime_arn = _get_agentcore_runtime_arn()
    if not runtime_arn:
        logger.error(
            "AGENTCORE_RUNTIME_ARN not available from environment or Parameter Store"
        )
        raise HTTPException(
            status_code=500, detail="AgentCore Runtime ARN not configured"
        )

    # Get AWS region
    region = os.getenv("AWS_REGION", "us-east-1")

    try:
        logger.info(
            f"Generating pre-signed WebSocket URL for session: {request.session_id}"
        )

        # Initialize AgentCore Runtime client
        client = AgentCoreRuntimeClient(region=region)

        # Generate pre-signed URL with IAM authentication (valid for 5 minutes)
        # This URL includes SigV4 signature in query parameters:
        # ?X-Amz-Algorithm=...&X-Amz-Credential=...&X-Amz-Signature=...
        # IMPORTANT: Do NOT append additional query parameters after signing!
        # Additional parameters would invalidate the SigV4 signature.
        #
        # Note: The 300-second (5 minute) expiry is the MAXIMUM allowed by AgentCore Runtime
        # This is only the time window to ESTABLISH the connection - once connected,
        # the WebSocket stays open much longer (backend handles session renewal automatically)
        #
        # IMPORTANT: session_id is required for proper session isolation
        # AgentCore Runtime will set the x-amzn-bedrock-agentcore-runtime-session-id header
        # which the backend WebSocket handler uses to maintain separate session state
        presigned_url = client.generate_presigned_url(
            runtime_arn=runtime_arn,
            session_id=request.session_id,  # Required for session isolation
            expires=300,  # 5 minutes (300 seconds) - AgentCore Runtime maximum
        )

        logger.info(
            f"Successfully generated pre-signed WebSocket URL (expires in 300s / 5 minutes)"
        )

        # Return application parameters separately (NOT in the URL)
        # Frontend will send these in the initial WebSocket message
        return {
            "wsUrl": presigned_url,  # Clean pre-signed URL (SigV4 only)
            "expiresIn": 300,  # seconds (5 minutes) - time to establish connection
            "sessionId": request.session_id,
            # Application parameters (sent separately, not in URL)
            "userId": request.user_id,
            "mode": request.mode,
            "voiceId": request.voice_id,
            "practiceSessionId": request.practice_session_id,
        }

    except Exception as e:
        logger.error(f"Error generating pre-signed WebSocket URL: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Failed to generate WebSocket URL: {str(e)}"
        )


# Mount sub-applications
# These handle all the business logic for different user roles
logger.info("Mounting candidate API at /api/candidate")
app.mount("/api/candidate", candidate_api_app)

logger.info("Mounting interviewer API at /api/interviewer")
app.mount("/api/interviewer", interviewer_api_app)

logger.info("Mounting analytics API at /api/analytics")
app.mount("/api/analytics", analytics_api_app)

logger.info("FastAPI app initialized successfully")


# Import async job processor
from candidate_api import _process_interview_plan_job
import asyncio

# Lambda handler using Mangum for HTTP events
# This wraps the FastAPI app to make it compatible with AWS Lambda
# lifespan="off" disables FastAPI's lifespan events for Lambda compatibility
mangum_handler = Mangum(app, lifespan="off")

logger.info("Mangum handler created - ready to handle Lambda events")


# Main Lambda handler - routes between HTTP and async job events
def handler(event, context):
    """
    Main Lambda handler that routes between:
    1. HTTP events from API Gateway (via Mangum)
    2. Async job processing events (direct invocation)

    This allows the same Lambda function to handle both HTTP requests
    and long-running background jobs without blocking HTTP responses.
    """
    # Check if this is an async job processing event
    if isinstance(event, dict) and event.get("asyncJobProcessing"):
        plan_id_or_job_id = event.get("planId")
        logger.info(
            f"Processing async job event: {event.get('jobType')} (planId: {plan_id_or_job_id})"
        )

        try:
            # Extract job parameters
            job_type = event.get("jobType")

            if (
                job_type == "candidate_interview_plan"
                or job_type == "interview_plan_generation"
            ):
                # Convert hex string back to bytes
                resume_bytes = bytes.fromhex(event["resumeBytes"])

                # Create a new event loop for async job processing
                # Set as current event loop to enable proper logging to CloudWatch
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

                try:
                    # Process the interview plan job
                    # Use planId if available (new flow), otherwise fall back to jobId (old flow)
                    loop.run_until_complete(
                        _process_interview_plan_job(
                            user_id=event["userId"],
                            plan_id=event.get("planId"),
                            resume_bytes=resume_bytes,
                            resume_filename=event["resumeFilename"],
                            jd_content=event["jdContent"],
                            companyName=event.get("companyName"),
                            interviewType=event["interviewType"],
                            questionCount=event["questionCount"],
                            difficulty=event["difficulty"],
                            custom_questions_list=event.get("customQuestions"),
                        )
                    )
                finally:
                    # Clean up the loop without affecting global event loop
                    loop.close()

                logger.info(f"Async plan {plan_id_or_job_id} completed successfully")
                return {"statusCode": 200, "body": "Plan processed"}

            elif (
                job_type == "interviewer_interview_plan"
                or job_type == "interview_scheduling"
            ):
                # Convert hex string back to bytes
                resume_bytes = bytes.fromhex(event["resumeBytes"])

                # Create a new event loop for async job processing
                # Set as current event loop to enable proper logging to CloudWatch
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

                try:
                    # Process the interview scheduling job
                    loop.run_until_complete(
                        _process_schedule_interview_job(
                            user_id=event["userId"],
                            plan_id=event.get("planId"),
                            resume_bytes=resume_bytes,
                            resume_filename=event["resumeFilename"],
                            jd_content=event["jdContent"],
                            questionBankText=event["questionBankText"],
                            useAiGeneration=event["useAiGeneration"],
                            interviewType=event["interviewType"],
                            interviewName=event["interviewName"],
                            scheduledDate=event["scheduledDate"],
                            scheduledTime=event["scheduledTime"],
                        )
                    )
                finally:
                    # Clean up the loop
                    loop.close()

                logger.info(f"Async plan {plan_id_or_job_id} completed successfully")
                return {"statusCode": 200, "body": "Plan processed"}

            else:
                logger.error(f"Unknown job type: {job_type}")
                return {"statusCode": 400, "body": f"Unknown job type: {job_type}"}

        except Exception as e:
            logger.error(f"Error processing async job: {e}")
            import traceback

            logger.error(f"Traceback: {traceback.format_exc()}")
            return {"statusCode": 500, "body": f"Job processing failed: {str(e)}"}

    # Otherwise, handle as HTTP event via Mangum
    return mangum_handler(event, context)
