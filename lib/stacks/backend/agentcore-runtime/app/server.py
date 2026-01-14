"""
Nova Sonic S2S WebSocket Server for Interview Assistant

This module implements a FastAPI-based WebSocket server for
bidirectional speech-to-speech (S2S) interview interactions using Amazon Nova Sonic.

Architecture:
- FastAPI manages HTTP server on port 8080
- WebSocket endpoint at /ws for bidirectional audio streaming
- Health check endpoints at /health and /ping
- SessionTransitionManager handles automatic session transitions (8-minute limit)
- S2sSessionManager handles Nova Sonic streaming with queues
- OpenTelemetry instrumentation for observability
- Cost tracking with NovaFxSonicCostCalculator
"""

import os

# Set AWS_REGION with default if not already set
# IMPORTANT: This must be done BEFORE any boto3 imports
if not os.getenv("AWS_REGION"):
    os.environ["AWS_REGION"] = "us-east-1"

import asyncio
import json
import logging
import base64
from typing import Dict, Any
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.exceptions import ClientError

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from s2s_session_manager import S2sSessionManager
from s2s_events import S2sEvent
from session_transition_manager import SessionTransitionManager
from opentelemetry_span_manager import OpenTelemetrySpanManager
from nova_sonic_pricing import NovaFxSonicCostCalculator
from live_assistant_service import LiveAssistantService

# Configure logging
LOGLEVEL = os.environ.get("LOGLEVEL", "INFO").upper()
logging.basicConfig(
    level=LOGLEVEL, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(title="Nova Sonic S2S WebSocket Server - Interview Assistant")

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
    logger.warning(
        "ALLOWED_ORIGINS environment variable not set. Using localhost for development."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,  # Specific origins only - no wildcards
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Model configuration
NOVA_SONIC_MODEL_ID = os.getenv("NOVA_SONIC_MODEL_ID", "amazon.nova-2-sonic-v1:0")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
DATA_BUCKET_NAME = os.getenv("DATA_BUCKET_NAME", "")

# S3 client for video frame uploads
s3_client = boto3.client("s3", region_name=AWS_REGION)

# Thread pool for async S3 uploads (non-blocking)
upload_executor = ThreadPoolExecutor(max_workers=5)

# Session storage for video frames and audio chunks
# Used for Agent analysis and multimodal coaching
active_sessions: Dict[str, Dict[str, Any]] = {}


def upload_frame_to_s3(
    session_id: str, interview_id: str, frame_data: Dict[str, Any]
) -> None:
    """
    Upload a video frame to S3 synchronously (runs in thread pool).

    Args:
        session_id: WebSocket session ID
        interview_id: Interview/prep ID for organizing frames
        frame_data: Frame object with content, metadata, etc.
    """
    if not DATA_BUCKET_NAME:
        logger.warning(
            f"[Session {session_id}] DATA_BUCKET_NAME not configured, skipping frame upload"
        )
        return

    try:
        # Decode base64 JPEG content
        image_bytes = base64.b64decode(frame_data["content"])

        # S3 key structure: video-frames/{interview_id}/{session_id}/frame_{sequence_number}.jpg
        sequence_number = frame_data.get("sequence_number", 0)
        s3_key = (
            f"video-frames/{interview_id}/{session_id}/frame_{sequence_number:04d}.jpg"
        )

        # Upload to S3
        s3_client.put_object(
            Bucket=DATA_BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType="image/jpeg",
            Metadata={
                "session_id": session_id,
                "interview_id": interview_id,
                "timestamp": str(frame_data.get("timestamp", 0)),
                "width": str(frame_data.get("width", 0)),
                "height": str(frame_data.get("height", 0)),
                "sequence_number": str(sequence_number),
            },
        )

        logger.info(
            f"[Session {session_id}] ✅ Uploaded frame {sequence_number} to S3: s3://{DATA_BUCKET_NAME}/{s3_key}"
        )

    except ClientError as e:
        logger.error(
            f"[Session {session_id}] ❌ S3 upload failed for frame {sequence_number}: {e}"
        )
    except Exception as e:
        logger.error(
            f"[Session {session_id}] ❌ Unexpected error uploading frame {sequence_number}: {e}"
        )


async def async_upload_frame_to_s3(
    session_id: str, interview_id: str, frame_data: Dict[str, Any]
) -> None:
    """
    Upload a video frame to S3 asynchronously without blocking the main event loop.

    Args:
        session_id: WebSocket session ID
        interview_id: Interview/prep ID for organizing frames
        frame_data: Frame object with content, metadata, etc.
    """
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        upload_executor, upload_frame_to_s3, session_id, interview_id, frame_data
    )


async def wait_for_frame_confirmation(
    session_data: Dict[str, Any], request_id: str
) -> None:
    """
    Wait for frameReady confirmation from frontend.

    Args:
        session_data: Session storage dictionary
        request_id: Frame request ID to wait for
    """
    # Poll for frame confirmation (frameReady event clears pending_frame_request)
    while session_data.get("pending_frame_request") == request_id:
        await asyncio.sleep(0.1)


async def agent_frame_request_loop(
    send_to_websocket,
    session_id: str,
    session_data: Dict[str, Any],
    request_interval: float = 1.0,
):
    """
    Agent-controlled frame request loop for pull-based architecture.

    Sends frame requests to frontend at controlled intervals, reducing WebSocket
    bandwidth by 31x compared to push-based architecture.

    Args:
        send_to_websocket: Callback to send events to WebSocket
        session_id: Session identifier
        session_data: Session storage dictionary
        request_interval: Seconds between frame requests (default: 1.0 for 1 FPS)
    """
    import time

    logger.info(
        f"[Session {session_id}] Starting agent frame request loop (interval: {request_interval}s)"
    )

    frame_count = 0

    try:
        while session_data.get("active", True):
            # Check if we should request a frame
            # For now, use simple time-based logic (1 FPS)
            # In production, this could be event-driven (e.g., after key moments in conversation)

            # Generate unique request ID
            request_id = f"frame-{int(time.time() * 1000)}-{frame_count}"
            frame_count += 1

            # Send frame request to frontend
            try:
                await send_to_websocket(
                    {
                        "event": {
                            "requestFrame": {
                                "requestId": request_id,
                                "timestamp": int(time.time() * 1000),
                            }
                        }
                    }
                )

                # Mark as pending
                session_data["pending_frame_request"] = request_id

                # Log only first few requests to avoid spam
                if frame_count <= 5:
                    logger.info(
                        f"[Session {session_id}] 📸 Requested frame {frame_count} (request_id: {request_id})"
                    )
                elif frame_count == 6:
                    logger.info(
                        f"[Session {session_id}] 📸 Continuing to request frames..."
                    )

                # Wait for frameReady confirmation (with timeout)
                try:
                    await asyncio.wait_for(
                        wait_for_frame_confirmation(session_data, request_id),
                        timeout=5.0,
                    )

                    if frame_count <= 5:
                        logger.debug(
                            f"[Session {session_id}] ✅ Frame {frame_count} confirmed"
                        )

                except asyncio.TimeoutError:
                    logger.warning(
                        f"[Session {session_id}] ⏱️ Frame {frame_count} upload timeout after 5s"
                    )
                    session_data["pending_frame_request"] = None

            except Exception as e:
                logger.error(f"[Session {session_id}] ❌ Error requesting frame: {e}")

            # Wait for next frame request interval
            await asyncio.sleep(request_interval)

    except asyncio.CancelledError:
        logger.info(f"[Session {session_id}] Frame request loop cancelled")
    except Exception as e:
        logger.error(f"[Session {session_id}] Frame request loop error: {e}")
    finally:
        logger.info(
            f"[Session {session_id}] Frame request loop ended (total frames: {frame_count})"
        )


async def _handle_coaching_request(
    session_id: str,
    session_type: str,
    user_request: str,
    live_assistant,
    send_to_websocket,
):
    """
    Handle coaching request asynchronously without blocking audio processing.

    This runs as a background task to ensure audio continues flowing to Transcribe
    while coaching is being generated.

    Args:
        session_id: Session identifier
        session_type: Type of session (candidateAssistant/interviewerAssistant)
        user_request: User's coaching request
        live_assistant: LiveAssistantService instance
        send_to_websocket: Callback to send events to WebSocket
    """
    import time

    try:
        logger.info(
            f"[Session {session_id}] Starting coaching generation (background task)"
        )

        # Get coaching from Live Assistant service (uses appropriate prompt based on session_type)
        coaching_advice = await live_assistant.provide_coaching(
            user_request=user_request
        )

        # Send coaching response
        await send_to_websocket(
            {
                "event": {
                    "coachingResponse": {
                        "sessionId": session_id,
                        "advice": coaching_advice,
                        "timestamp": int(time.time() * 1000),
                    }
                }
            }
        )

        logger.info(
            f"[Session {session_id}] Coaching provided successfully for {session_type}"
        )

    except Exception as e:
        logger.error(f"[Session {session_id}] Error providing coaching: {e}")
        try:
            await send_to_websocket(
                {
                    "event": {
                        "coachingError": {
                            "sessionId": session_id,
                            "error": str(e),
                            "timestamp": int(time.time() * 1000),
                        }
                    }
                }
            )
        except Exception as send_error:
            logger.error(
                f"[Session {session_id}] Error sending coaching error response: {send_error}"
            )


async def handle_listening_session(
    websocket: WebSocket,
    session_id: str,
    user_id: str,
    session_type: str,
    prep_id: str = None,
    interview_id: str = None,
):
    """
    Handle listening mode sessions using Amazon Transcribe.
    Used for both candidateAssistant and interviewerAssistant session types.

    Args:
        websocket: WebSocket connection
        session_id: Session identifier
        user_id: User identifier
        session_type: Type of session ("candidateAssistant" or "interviewerAssistant")
        prep_id: Optional preparation ID for candidate assistant
        interview_id: Optional interview ID for interviewer assistant
    """
    import base64
    import time

    logger.info(
        f"Starting listening session: {session_type} for session {session_id}, user: {user_id}"
    )

    # Build interview preparation context if provided
    interview_prep = {}
    if prep_id:
        interview_prep["prep_id"] = prep_id
    if interview_id:
        interview_prep["interview_id"] = interview_id
    # Add user_id for database queries
    interview_prep["user_id"] = user_id

    # Create LiveAssistantService instance
    live_assistant = LiveAssistantService(
        session_id=session_id,
        region=AWS_REGION,
        interview_prep=interview_prep,
        session_type=session_type,
    )

    # Initialize session storage for video frames and audio chunks
    from datetime import datetime

    active_sessions[session_id] = {
        "session_id": session_id,
        "user_id": user_id,
        "session_type": session_type,
        "video_frames": [],  # Buffer for Agent analysis
        "audio_chunks": [],  # Buffer for Agent analysis
        "created_at": datetime.now().isoformat(),
        "active": True,  # Frame request loop control flag
        "pending_frame_request": None,  # Current pending frame request ID
        "last_frame": None,  # Latest frame S3 reference
    }
    logger.info(
        f"[Session {session_id}] Session storage initialized for video/audio buffering"
    )

    # Output callback to send events to WebSocket
    async def send_to_websocket(event_data):
        """Send events to WebSocket client"""
        try:
            await websocket.send_json(event_data)
        except Exception as e:
            logger.error(
                f"[Session {session_id}] Error sending event to WebSocket: {e}"
            )

    # Background task reference for frame request loop
    frame_request_task = None

    try:
        # Start transcription
        await live_assistant.start_transcription(send_to_websocket)
        logger.info(f"Transcription started for {session_type} session {session_id}")

        # Start frame request loop as background task (pull-based architecture)
        session_data = active_sessions.get(session_id)
        if session_data:
            frame_request_task = asyncio.create_task(
                agent_frame_request_loop(
                    send_to_websocket,
                    session_id,
                    session_data,
                    request_interval=5.0,  # 0.2 FPS - frame every 5 seconds
                )
            )
            logger.info(f"[Session {session_id}] Frame request loop started")

        # Main message loop - receive messages from client
        while live_assistant.is_active:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                message_size_kb = len(message) / 1024

                data = json.loads(message)

                if "event" not in data:
                    continue

                event_type = list(data["event"].keys())[0]
                event_data = data["event"][event_type]

                # Handle audio input
                if event_type == "audioInput":
                    audio_base64 = event_data.get("content", "")
                    if audio_base64:
                        # Decode base64 to bytes
                        audio_bytes = base64.b64decode(audio_base64)
                        # Send to Transcribe
                        await live_assistant.send_audio_chunk(audio_bytes)

                        # Also buffer audio for Agent analysis
                        session_data = active_sessions.get(session_id)
                        if session_data:
                            audio_obj = {
                                "content": audio_base64,  # Keep as base64 for consistency
                                "timestamp": int(time.time() * 1000),
                                "size_bytes": len(audio_bytes),
                            }
                            session_data["audio_chunks"].append(audio_obj)
                            # Log first chunk and periodically thereafter
                            chunk_count = len(session_data["audio_chunks"])
                            if chunk_count == 1:
                                logger.info(
                                    f"[Session {session_id}] ▶️  First audio chunk received from WebSocket "
                                    f"({len(audio_bytes)} bytes, base64_len={len(audio_base64)})"
                                )
                            elif chunk_count % 100 == 0:
                                logger.info(
                                    f"[Session {session_id}] 🎵 Buffered {chunk_count} audio chunks from WebSocket "
                                    f"(latest: {len(audio_bytes)} bytes)"
                                )
                    else:
                        logger.warning(
                            f"[Session {session_id}] Received audioInput event but no content"
                        )

                # Handle frameReady event (pull-based architecture)
                elif event_type == "frameReady":
                    frame_info = {
                        "requestId": event_data.get("requestId"),
                        "s3Key": event_data.get("s3Key"),
                        "s3Bucket": event_data.get("s3Bucket", DATA_BUCKET_NAME),
                        "filename": event_data.get("filename"),
                        "timestamp": event_data.get("timestamp"),
                        "width": event_data.get("width"),
                        "height": event_data.get("height"),
                        "sizeBytes": event_data.get("sizeBytes"),
                    }

                    session_data = active_sessions.get(session_id)
                    if session_data:
                        # Store as latest frame (no frame data in RAM, just S3 reference)
                        session_data["last_frame"] = frame_info
                        session_data["pending_frame_request"] = None

                        logger.info(
                            f"[Session {session_id}] ✅ Frame ready at S3: {frame_info['s3Key']} ({frame_info['width']}×{frame_info['height']}, {frame_info['sizeBytes']} bytes)"
                        )

                        # Agent can now read from S3 for analysis when needed
                        # TODO: Trigger Agent analysis if needed

                # Handle interview preparation info
                elif event_type == "interviewPreparation":
                    prep_info = event_data
                    logger.info(
                        f"[Session {session_id}] Interview Preparation received:"
                    )
                    logger.info(f"  Company: {prep_info.get('companyName')}")
                    logger.info(f"  Position: {prep_info.get('positionTitle')}")
                    logger.info(f"  Interview Type: {prep_info.get('interviewType')}")
                    logger.info(f"  Prep ID: {prep_info.get('prepId')}")
                    logger.info(f"  Interview ID: {prep_info.get('interviewId')}")

                    # Update interview prep info (by reference)
                    interview_prep.update(prep_info)

                    # Acknowledge receipt
                    await send_to_websocket(
                        {
                            "event": {
                                "preparationReceived": {
                                    "sessionId": session_id,
                                    "message": "Interview preparation info received",
                                }
                            }
                        }
                    )

                # Handle coaching request (for both candidateAssistant and interviewerAssistant)
                elif event_type == "getCoaching":
                    user_request = event_data.get("userRequest")
                    logger.info(
                        f"[Session {session_id}] Coaching requested for {session_type}"
                    )
                    if user_request:
                        logger.info(f"  User request: {user_request[:100]}...")

                    # Spawn coaching as background task to avoid blocking audio processing
                    asyncio.create_task(
                        _handle_coaching_request(
                            session_id,
                            session_type,
                            user_request,
                            live_assistant,
                            send_to_websocket,
                        )
                    )
                    logger.info(
                        f"[Session {session_id}] Coaching request spawned as background task"
                    )

                # Handle stop/end events
                elif event_type in ["stop", "sessionEnd"]:
                    logger.info(
                        f"[Session {session_id}] Received {event_type} event, stopping transcription"
                    )
                    break

            except asyncio.TimeoutError:
                # No message received in 30 seconds, continue
                continue
            except WebSocketDisconnect:
                logger.info(f"[Session {session_id}] WebSocket disconnected")
                break
            except Exception as e:
                logger.error(f"[Session {session_id}] Error processing message: {e}")
                break

    except Exception as e:
        logger.error(
            f"[Session {session_id}] Error in listening session: {e}", exc_info=True
        )
    finally:
        # Cleanup
        logger.info(f"[Session {session_id}] Cleaning up listening session")

        # Stop frame request loop
        if session_id in active_sessions:
            active_sessions[session_id]["active"] = False
            logger.info(f"[Session {session_id}] Signaled frame request loop to stop")

        # Cancel frame request task
        if frame_request_task and not frame_request_task.done():
            logger.info(f"[Session {session_id}] Cancelling frame request task")
            frame_request_task.cancel()
            try:
                await frame_request_task
            except asyncio.CancelledError:
                logger.info(f"[Session {session_id}] Frame request task cancelled")

        # Clean up session storage
        if session_id in active_sessions:
            session_data = active_sessions.pop(session_id)
            video_count = len(session_data.get("video_frames", []))
            audio_count = len(session_data.get("audio_chunks", []))
            logger.info(
                f"[Session {session_id}] Cleaned up session storage (video frames: {video_count}, audio chunks: {audio_count})"
            )

        try:
            await live_assistant.stop_transcription()
        except Exception as e:
            logger.error(f"[Session {session_id}] Error stopping transcription: {e}")

        try:
            await websocket.close()
        except Exception as e:
            logger.error(f"[Session {session_id}] Error closing WebSocket: {e}")

        logger.info(f"[Session {session_id}] Listening session closed")


def extract_websocket_params(websocket: WebSocket) -> dict:
    """
    Extract parameters from WebSocket query string.

    Args:
        websocket: WebSocket connection

    Returns:
        dict: Extracted parameters including prep_id, voice_id, mode
    """
    query_params = dict(websocket.query_params)

    # Extract practice session ID (prep_id for loading interview questions)
    prep_id = query_params.get("practiceSessionId")

    # Extract voice ID (optional, defaults to 'matthew')
    voice_id = query_params.get("voiceId", "matthew")

    # Extract interview mode (defaults to 'light')
    mode = query_params.get("mode", "light")

    # Extract user ID (optional)
    user_id = query_params.get("userId")

    return {
        "prep_id": prep_id,
        "voice_id": voice_id,
        "mode": mode,
        "user_id": user_id,
        "query_params": query_params,
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket handler for bidirectional audio streaming with Nova Sonic and Transcribe.

    This endpoint is exposed at ws://<host>:8080/ws and handles connections
    authenticated via AgentCore Runtime pre-signed URLs.

    Connection Flow:
    1. Frontend calls REST API /api/get-ws-url with session_id and user parameters
    2. REST API generates pre-signed WebSocket URL with SigV4 authentication + session_id
    3. Frontend connects to pre-signed URL (AgentCore Runtime validates SigV4)
    4. AgentCore Runtime forwards connection with x-amzn-bedrock-agentcore-runtime-session-id header
    5. Backend accepts WebSocket connection and extracts session_id from header
    6. Frontend sends initialization message: {"type": "init", "sessionType": "...", "userId": "...", ...}
    7. Backend parses init message and routes based on sessionType:
       - "practiceSession" → Nova Sonic S2S speech-to-speech (default)
       - "candidateAssistant" → Transcribe + coaching for candidates
       - "interviewerAssistant" → Transcribe + coaching for interviewers

    Session Types:
    - practiceSession: Real-time speech-to-speech interview practice with Nova Sonic
      Uses SessionTransitionManager for automatic 8-minute session renewal
    - candidateAssistant: Live transcription + AI coaching during practice interviews
      Uses LiveAssistantService with Amazon Transcribe
    - interviewerAssistant: Live transcription + AI coaching for interviewers
      Uses LiveAssistantService with Amazon Transcribe

    Session Isolation:
    - Each WebSocket connection has a unique session_id passed in pre-signed URL generation
    - AgentCore Runtime ensures session_id is forwarded via header for proper isolation
    - Backend maintains separate state per session_id for conversation history and audio buffers

    Args:
        websocket: FastAPI WebSocket connection with AgentCore Runtime headers
    """
    logger.info("websocket_endpoint endpoint called")
    # Extract session_id from header (AgentCore Runtime protocol via SigV4 pre-signed URL)
    session_id = websocket.headers.get("x-amzn-bedrock-agentcore-runtime-session-id")
    if not session_id:
        # Generate a session ID if not provided (shouldn't happen with pre-signed URLs)
        import uuid

        session_id = str(uuid.uuid4())
        logger.warning(
            f"No sessionId provided in AgentCore header, generated: {session_id}"
        )

    logger.info(
        f"WebSocket connection attempt from: {websocket.client}, session: {session_id}"
    )
    logger.debug(f"Headers: {websocket.headers}")

    # Accept the WebSocket connection FIRST
    # Application parameters will be received in the initial message (not query params)
    await websocket.accept()
    logger.info(f"WebSocket connection accepted for session: {session_id}")

    # Wait for initialization message with application parameters
    # Format: {"type": "init", "sessionType": "practiceSession" | "candidateAssistant" | "interviewerAssistant", "userId": "...", "mode": "...", "voiceId": "...", "practiceSessionId": "..."}
    prep_id = None
    voice_id = None
    mode = None
    user_id = None
    session_type = None
    interview_id = None

    try:
        logger.info("Waiting for initialization message with application parameters...")
        init_message = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        init_data = json.loads(init_message)

        if init_data.get("type") == "init":
            user_id = init_data.get("userId")
            session_type = init_data.get(
                "sessionType", "practiceSession"
            )  # Default to "practiceSession" for backward compatibility
            mode = init_data.get("mode", "light")
            voice_id = init_data.get("voiceId", "matthew")
            prep_id = init_data.get(
                "practiceSessionId"
            )  # Optional - for practice sessions
            interview_id = init_data.get(
                "interviewId"
            )  # Optional - for interviewer assistant

            logger.info(
                f"Session {session_id} initialized - user_id: {user_id}, session_type: {session_type}, mode: {mode}, voice_id: {voice_id}, prep_id: {prep_id}, interview_id: {interview_id}"
            )
        else:
            logger.error(
                f"First message was not an init message: {init_data.get('type')}"
            )
            await websocket.close(code=1002, reason="Expected init message")
            return

    except asyncio.TimeoutError:
        logger.error("Timeout waiting for initialization message")
        await websocket.close(code=1002, reason="Init timeout")
        return
    except Exception as e:
        logger.error(f"Error receiving initialization message: {e}")
        await websocket.close(code=1002, reason="Init error")
        return

    # Route to appropriate service based on sessionType
    if session_type in ["candidateAssistant", "interviewerAssistant"]:
        logger.info(
            f"Routing to LiveAssistantService (Transcribe) for {session_type} session {session_id}"
        )
        await handle_listening_session(
            websocket, session_id, user_id, session_type, prep_id, interview_id
        )
        return

    # Default: practiceSession - continue with Nova Sonic S2S flow below
    logger.info(f"Routing to Nova Sonic S2S for practiceSession {session_id}")

    transition_manager = None
    forward_task = None

    try:
        # Main message processing loop
        while True:
            try:
                message = await websocket.receive_text()
                logger.debug("Received message from client")

                try:
                    data = json.loads(message)

                    # Handle wrapped body format
                    if "body" in data:
                        data = json.loads(data["body"])

                    if "event" not in data:
                        logger.warning("Received message without event field")
                        continue

                    event_type = list(data["event"].keys())[0]

                    # Handle session start - create SessionTransitionManager
                    if event_type == "sessionStart":
                        logger.info(
                            "Starting new session with SessionTransitionManager"
                        )

                        # Clean up existing session if any
                        if transition_manager:
                            logger.info("Cleaning up existing transition manager")
                            await transition_manager.close_all_sessions()
                        if forward_task and not forward_task.done():
                            forward_task.cancel()
                            try:
                                await forward_task
                            except asyncio.CancelledError:
                                pass

                        # Extract the prompt name from the event
                        prompt_name = data["event"]["sessionStart"].get(
                            "promptName", "interview_prompt"
                        )
                        logger.info(
                            f"Received sessionStart event with promptName: {prompt_name}"
                        )

                        # Create SessionTransitionManager for multi-session orchestration
                        transition_manager = SessionTransitionManager()

                        # Build user_info dict (simplified version for AgentCore)
                        user_info = {
                            "user_id": user_id or "unknown-user",
                            "session_id": session_id,
                        }

                        # Prepare kwargs for S2sSessionManager instances
                        stream_manager_kwargs = {
                            "model_id": NOVA_SONIC_MODEL_ID,
                            "region": AWS_REGION,
                            "session_id": session_id,
                            "prep_id": prep_id,
                            "user_info": user_info,
                            "voice_id": voice_id,
                            "mode": mode,
                        }

                        # Initialize first session using SessionTransitionManager
                        logger.info(
                            "Initializing first session via SessionTransitionManager"
                        )
                        try:
                            await transition_manager.initialize_first_session(
                                S2sSessionManager, prompt_name, **stream_manager_kwargs
                            )
                            logger.info("First session initialized successfully")
                        except Exception as stream_error:
                            logger.error(
                                f"Failed to initialize first session: {stream_error}",
                                exc_info=True,
                            )
                            raise

                        # Start forward_responses task after first session is initialized
                        if not forward_task or forward_task.done():
                            logger.info(
                                f"Starting forward_responses task for session: {session_id}"
                            )
                            forward_task = asyncio.create_task(
                                forward_responses(
                                    websocket, transition_manager, session_id
                                )
                            )

                        logger.info(
                            "Session initialized successfully (ready for transitions)"
                        )

                    # Handle session end - clean up resources
                    elif event_type == "sessionEnd":
                        logger.info("Ending session")

                        if transition_manager:
                            await transition_manager.close_all_sessions()
                            transition_manager = None
                        if forward_task and not forward_task.done():
                            forward_task.cancel()
                            try:
                                await forward_task
                            except asyncio.CancelledError:
                                pass
                            forward_task = None

                        # Continue to next iteration
                        continue

                    # Process events if we have an active transition manager
                    if transition_manager:
                        stream_manager = transition_manager.get_active_stream_manager()
                        if stream_manager and stream_manager.is_active:
                            # Store prompt name and content names if provided
                            if event_type == "promptStart":
                                stream_manager.prompt_name = data["event"][
                                    "promptStart"
                                ]["promptName"]
                            elif (
                                event_type == "contentStart"
                                and data["event"]["contentStart"].get("type") == "AUDIO"
                            ):
                                stream_manager.audio_content_name = data["event"][
                                    "contentStart"
                                ]["contentName"]

                            # Handle audio input - route through transition manager for buffering support
                            if event_type == "audioInput":
                                import base64

                                prompt_name = data["event"]["audioInput"]["promptName"]
                                content_name = data["event"]["audioInput"][
                                    "contentName"
                                ]
                                audio_base64 = data["event"]["audioInput"]["content"]

                                # Decode base64 to bytes for transition manager
                                audio_bytes = base64.b64decode(audio_base64)
                                # Route audio through transition manager (handles buffering + routing to current session)
                                transition_manager.add_audio_chunk(audio_bytes)
                            else:
                                # Send other events directly to active stream manager
                                await stream_manager.send_raw_event(data)
                        elif event_type not in ["sessionStart", "sessionEnd"]:
                            logger.warning(
                                f"Received event {event_type} but no active stream manager"
                            )

                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON received from WebSocket: {e}")
                    try:
                        await websocket.send_json(
                            {"type": "error", "message": "Invalid JSON format"}
                        )
                    except Exception:
                        pass
                except Exception as exp:
                    logger.error(
                        f"Error processing WebSocket message: {exp}", exc_info=True
                    )
                    try:
                        await websocket.send_json(
                            {"type": "error", "message": str(exp)}
                        )
                    except Exception:
                        pass

            except WebSocketDisconnect as e:
                logger.info(f"WebSocket disconnected: {websocket.client}")
                logger.info(
                    f"Disconnect details: code={getattr(e, 'code', 'N/A')}, reason={getattr(e, 'reason', 'N/A')}"
                )
                if transition_manager:
                    stream_manager = transition_manager.get_active_stream_manager()
                    if stream_manager and stream_manager.is_active:
                        logger.info(
                            "Bedrock stream was still active when WebSocket disconnected"
                        )
                break
            except Exception as e:
                logger.error(f"WebSocket error: {e}", exc_info=True)
                break

    except Exception as e:
        logger.error(f"WebSocket handler error: {e}", exc_info=True)
        try:
            await websocket.send_json(
                {"type": "error", "message": "WebSocket handler error"}
            )
        except Exception:
            pass
    finally:
        # Clean up resources
        logger.info("Cleaning up WebSocket connection resources")

        if transition_manager:
            await transition_manager.close_all_sessions()
        if forward_task and not forward_task.done():
            forward_task.cancel()
            try:
                await forward_task
            except asyncio.CancelledError:
                pass

        try:
            await websocket.close()
        except Exception as e:
            logger.error(f"Error closing websocket: {e}")

        logger.info("Connection closed")


def split_large_event(response, max_size=16000):
    """
    Split a large event into smaller chunks by dividing the content field.
    For audio events, ensures splits occur at sample boundaries to avoid noise.
    Returns a list of events to send.
    """
    event = json.dumps(response)
    event_size = len(event.encode("utf-8"))

    # If event is small enough, return as-is
    if event_size <= max_size:
        return [response]

    # Get event type and data
    if "event" not in response:
        return [response]

    event_type = list(response["event"].keys())[0]
    event_data = response["event"][event_type]

    # Only split events that have a 'content' field (audioOutput, textOutput, etc.)
    if "content" not in event_data:
        logger.warning(
            f"Event {event_type} is large ({event_size} bytes) but has no content field to split"
        )
        return [response]

    content = event_data["content"]

    # Calculate how much content we can fit per chunk
    # Create a template event to measure overhead
    template_event = response.copy()
    template_event["event"] = {event_type: event_data.copy()}
    template_event["event"][event_type]["content"] = ""
    overhead = len(json.dumps(template_event).encode("utf-8"))

    # Calculate max content size per chunk (leave some margin)
    max_content_size = max_size - overhead - 100

    # For audio events, align to sample boundaries
    # Base64 encoding: 4 chars = 3 bytes of binary data
    # PCM 16-bit: 2 bytes per sample
    # Must align to multiples of 4 chars for valid base64 (no padding issues)
    if event_type == "audioOutput":
        # Align to 4-char boundaries for complete base64 groups
        alignment = 4
        max_content_size = (max_content_size // alignment) * alignment
        logger.debug(
            f"Audio splitting: aligned chunk size to {max_content_size} chars (base64 boundary)"
        )

    # Split content into chunks
    chunks = []
    for i in range(0, len(content), max_content_size):
        chunk_content = content[i : i + max_content_size]

        # For base64 content, ensure proper padding if needed
        if event_type == "audioOutput":
            remainder = len(chunk_content) % 4
            if remainder != 0:
                padding_needed = 4 - remainder
                chunk_content += "=" * padding_needed
                logger.warning(f"Added {padding_needed} padding chars to audio chunk")

        # Create new event with chunked content
        chunk_event = response.copy()
        chunk_event["event"] = {event_type: event_data.copy()}
        chunk_event["event"][event_type]["content"] = chunk_content

        chunks.append(chunk_event)

    logger.info(
        f"Split {event_type} event ({event_size} bytes) into {len(chunks)} chunks"
    )
    return chunks


async def forward_responses(websocket: WebSocket, transition_manager, session_id: str):
    """
    Forward responses from Bedrock to the WebSocket client.

    Uses SessionTransitionManager to get the active stream manager,
    which automatically handles session transitions.

    Args:
        websocket: FastAPI WebSocket connection
        transition_manager: SessionTransitionManager instance
        session_id: Session identifier for logging
    """
    try:
        logger.info(f"Starting forward_responses for session: {session_id}")
        while True:
            # Get active stream manager (handles session transitions automatically)
            stream_manager = transition_manager.get_active_stream_manager()
            if not stream_manager:
                # No active session, wait briefly and continue
                await asyncio.sleep(0.1)
                continue

            # Get next response from the output queue
            try:
                response = await asyncio.wait_for(
                    stream_manager.output_queue.get(), timeout=0.5
                )
            except asyncio.TimeoutError:
                # Check if transition manager still has active sessions
                stream_manager = transition_manager.get_active_stream_manager()
                if not stream_manager or not stream_manager.is_active:
                    logger.info(
                        f"No active session for {session_id}, stopping forward_responses"
                    )
                    break
                continue

            # Send to WebSocket
            try:
                # Check if event needs to be split
                event = json.dumps(response)
                event_size = len(event.encode("utf-8"))

                # Get event type for logging
                event_type = (
                    list(response.get("event", {}).keys())[0]
                    if "event" in response
                    else "unknown"
                )

                # Split large events
                if event_size > 10000:
                    logger.warning(
                        f"Large {event_type} event detected (size: {event_size} bytes) - splitting..."
                    )
                    events_to_send = split_large_event(response, max_size=10000)
                else:
                    events_to_send = [response]

                # Send all chunks
                for idx, event_chunk in enumerate(events_to_send):
                    chunk_json = json.dumps(event_chunk)
                    chunk_size = len(chunk_json.encode("utf-8"))

                    await websocket.send_text(chunk_json)

                    if len(events_to_send) > 1:
                        logger.info(
                            f"[Session {session_id}] Forwarded {event_type} chunk {idx + 1}/{len(events_to_send)} to client (size: {chunk_size} bytes)"
                        )
                    elif event_type not in [
                        "audioOutput"
                    ]:  # Skip logging audio events to reduce noise
                        logger.debug(
                            f"[Session {session_id}] Forwarded {event_type} to client (size: {chunk_size} bytes)"
                        )

            except Exception as e:
                logger.error(f"Error sending response to client: {e}", exc_info=True)
                # Check if it's a connection error that should break the loop
                error_str = str(e).lower()
                if "closed" in error_str or "disconnect" in error_str:
                    logger.info(
                        f"WebSocket connection {session_id} closed, stopping forward task"
                    )
                    break
                # For other errors, log but continue trying
                logger.warning(
                    f"Continuing to forward responses for {session_id} despite error"
                )

    except asyncio.CancelledError:
        logger.debug(f"Forward responses task cancelled for session {session_id}")
    except Exception as e:
        logger.error(
            f"Error forwarding responses for session {session_id}: {e}", exc_info=True
        )
    finally:
        logger.info(f"Forward responses task ended for session {session_id}")


async def cleanup_session_managers():
    """
    Clean up inactive session managers.

    Note: With SessionTransitionManager, each WebSocket connection manages
    its own lifecycle, so this is primarily for consistency with the old
    implementation. The cleanup happens automatically in the finally block
    of each WebSocket handler.
    """
    # This function is kept for compatibility but doesn't need to do much
    # since each WebSocket connection manages its own transition manager
    pass


# Global variable to track cleanup task
cleanup_task = None


@app.on_event("startup")
async def startup_event():
    """Startup event handler to initialize periodic cleanup task"""
    global cleanup_task

    logger.info("🚀 Application starting up...")
    logger.info(f"📍 AWS Region: {AWS_REGION}")
    logger.info(f"🎤 Model: {NOVA_SONIC_MODEL_ID}")

    # Start periodic session cleanup
    async def periodic_cleanup():
        """Periodic cleanup of inactive session managers"""
        while True:
            try:
                await asyncio.sleep(300)  # Clean up every 5 minutes
                await cleanup_session_managers()
                logger.debug("Periodic session cleanup completed")
            except asyncio.CancelledError:
                logger.info("Periodic cleanup task cancelled")
                break
            except Exception as e:
                logger.error(f"Error in periodic cleanup: {e}")

    # Start the cleanup task in the background
    cleanup_task = asyncio.create_task(periodic_cleanup())
    logger.info("✅ Started periodic session cleanup task")


@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown event handler to gracefully stop background tasks"""
    global cleanup_task

    logger.info("🛑 Application shutting down...")

    # Cancel cleanup task if running
    if cleanup_task and not cleanup_task.done():
        logger.info("Stopping periodic cleanup task...")
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass
        logger.info("Periodic cleanup task stopped")

    logger.info("✅ Application shutdown complete")


@app.get("/health")
@app.get("/")
async def health_check():
    """Health check endpoint"""
    logger.info("Health check request received")
    return JSONResponse({"status": "healthy"})


@app.get("/ping")
async def ping():
    """Ping endpoint for liveness check"""
    logger.debug("Ping endpoint called")
    return JSONResponse({"status": "ok"})


@app.get("/credentials/info")
async def credentials_info():
    """
    Get information about credential configuration (for debugging).

    Returns credential source information to help diagnose authentication issues.
    """
    # Determine credential source
    if os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"):
        credential_source = "Environment Variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)"
        mode = "local"
        note = "Using static credentials from environment variables"
    else:
        # Check if we're in ECS (ECS_CONTAINER_METADATA_URI_V4 or ECS_CONTAINER_METADATA_URI)
        if os.getenv("ECS_CONTAINER_METADATA_URI_V4") or os.getenv(
            "ECS_CONTAINER_METADATA_URI"
        ):
            credential_source = "ECS Task Role (Container Metadata Service)"
            mode = "ecs"
            note = "Credentials automatically managed by ECS task role via boto3 default credential chain"
        elif os.getenv("AWS_EXECUTION_ENV"):
            # Lambda or other AWS execution environment
            credential_source = (
                f"AWS Execution Environment ({os.getenv('AWS_EXECUTION_ENV')})"
            )
            mode = "aws-managed"
            note = "Credentials automatically managed by AWS execution environment"
        else:
            # Fallback - likely EC2 instance profile or local AWS profile
            credential_source = (
                "Default Credential Chain (EC2 Instance Profile or AWS Profile)"
            )
            mode = "ec2-or-profile"
            note = "Credentials resolved via boto3 default credential chain"

    return JSONResponse(
        {
            "status": "ok",
            "mode": mode,
            "credential_source": credential_source,
            "region": AWS_REGION,
            "model": NOVA_SONIC_MODEL_ID,
            "note": note,
        }
    )


# Run the app with uvicorn
if __name__ == "__main__":
    import uvicorn

    # Binding to 0.0.0.0 is required for containerized apps in AWS Lambda/ECS
    # The container runtime forwards requests to this interface
    host = os.getenv("HOST", "0.0.0.0")  # nosec B104
    port = int(os.getenv("PORT", "8080"))

    logger.info("=" * 80)
    logger.info(f"Starting Nova Sonic S2S WebSocket Server on {host}:{port}")
    logger.info(f"Model: {NOVA_SONIC_MODEL_ID}")
    logger.info(f"Region: {AWS_REGION}")
    logger.info(f"WebSocket endpoint: ws://<host>:{port}/ws")
    logger.info(f"Health check endpoints: GET /health, GET /ping")
    logger.info(f"Debug endpoint: GET /credentials/info")
    logger.info("=" * 80)

    try:
        uvicorn.run(app, host=host, port=port)
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")
