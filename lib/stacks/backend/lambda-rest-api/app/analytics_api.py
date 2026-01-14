"""
Analytics API for dashboard analytics and performance metrics.

Provides endpoints for:
- Analytics overview (total sessions, average score, last practice date)
- Session performance trends
- Detailed session analytics
"""

import os
import logging
import json
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, HTTPException, Security, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.status import HTTP_403_FORBIDDEN
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import auth and feature flags
from auth import validate_token
from config.feature_flags import feature_flags


# Initialize logger
logger = logging.getLogger("analytics_api")

# Environment variables
STACK_PREFIX = os.environ.get("STACK_NAME", "INTERVIEW-ASSISTANT")
STACK_SUFFIX = os.environ.get("STACK_ENVIRONMENT", "DEV")
DOMAIN_NAME = os.getenv("DOMAIN_NAME", "*")

logger.info(f"STACK_PREFIX: {STACK_PREFIX}")
logger.info(f"STACK_SUFFIX: {STACK_SUFFIX}")
logger.info(f"DOMAIN_NAME: {DOMAIN_NAME}")

# Initialize FastAPI app
app = FastAPI(title="Analytics API")

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

from services.database_service import LocalDBService

db = LocalDBService(
    profile_name=None, stack_prefix=STACK_PREFIX, stack_suffix=STACK_SUFFIX
)


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


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.get("/overview", dependencies=[Depends(get_current_user)])
async def get_analytics_overview(
    limit: int = 30, user_info: dict = Depends(get_current_user)
):
    """
    Get analytics overview for the dashboard.

    Args:
        limit: Maximum number of sessions to consider (for future use)
        user_info: Current user information from authentication

    Returns:
        - totalSessions: Total number of practice sessions
        - averageScore: Average score across all sessions
        - lastPracticeDate: Date of the last practice session
    """
    try:
        user_email = user_info.get("email", "unknown")
        logger.info("Fetching analytics overview for user")

        # Get all practice sessions from DynamoDB
        sessions = db.get_practice_sessions(user_email)

        logger.info(f"Retrieved {len(sessions) if sessions else 0} sessions for user")

        total_sessions = len(sessions) if sessions else 0
        average_score = 0
        last_practice_date = None

        if sessions:
            # Calculate average score from sessions (if available)
            scores = []
            for session in sessions:
                session_id = session.get("sessionId", "unknown")
                logger.info(
                    f"Processing session {session_id}: has 'analysis' = {'analysis' in session}"
                )

                # Try to extract score from session analysis data
                # Score is stored in analysis.overall_score (1-10 scale)
                if "analysis" in session and session["analysis"]:
                    try:
                        # Parse analysis - it may be a JSON string or already a dict
                        analysis = session["analysis"]
                        if isinstance(analysis, str):
                            analysis = json.loads(analysis)

                        if isinstance(analysis, dict):
                            overall_score = analysis.get("overall_score")
                            logger.info(
                                f"Session {session_id}: overall_score = {overall_score}"
                            )
                            if overall_score is not None:
                                # Keep score on 1-10 scale
                                scores.append(float(overall_score))
                                logger.info(
                                    f"Session {session_id}: Added score {overall_score} to scores list"
                                )
                        else:
                            logger.info(
                                f"Session {session_id}: analysis is not a dict after parsing"
                            )
                    except json.JSONDecodeError as e:
                        logger.error(
                            f"Session {session_id}: Failed to parse analysis JSON: {e}"
                        )
                    except Exception as e:
                        logger.error(
                            f"Session {session_id}: Error processing analysis: {e}"
                        )
                else:
                    logger.info(f"Session {session_id}: No analysis data found")

            logger.info(f"Total scores collected: {len(scores)}, values: {scores}")
            if scores:
                average_score = sum(scores) / len(scores)
                logger.info(f"Calculated average score: {average_score}")

            # Get the most recent practice date
            if sessions:
                most_recent = sessions[0]
                if "createdAt" in most_recent:
                    # Convert timestamp to ISO format
                    timestamp_ms = most_recent["createdAt"]
                    if isinstance(timestamp_ms, str):
                        last_practice_date = timestamp_ms
                    else:
                        last_practice_date = datetime.fromtimestamp(
                            timestamp_ms / 1000, tz=timezone.utc
                        ).isoformat()

        logger.info(
            f"Analytics overview - sessions: {total_sessions}, avg_score: {average_score:.1f}"
        )

        return {
            "totalSessions": total_sessions,
            "averageScore": average_score,
            "lastPracticeDate": last_practice_date,
        }

    except Exception as e:
        logger.error(f"Error fetching analytics overview: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch analytics overview: {str(e)}"
        )
