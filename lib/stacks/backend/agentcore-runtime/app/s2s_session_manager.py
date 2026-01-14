import asyncio
import json
import warnings
import uuid
from s2s_events import S2sEvent
import logging
import os
import base64
import time
import numpy as np
import pathlib
import sys
import boto3
from concurrent.futures import InvalidStateError
import inspect
from enum import Enum
from collections import deque
from typing import Optional, Deque
from opentelemetry import baggage, context, trace
from aws_sdk_bedrock_runtime.client import (
    BedrockRuntimeClient,
    InvokeModelWithBidirectionalStreamOperationInput,
)
from aws_sdk_bedrock_runtime.models import (
    InvokeModelWithBidirectionalStreamInputChunk,
    BidirectionalInputPayloadPart,
    ServiceError,
)
from aws_sdk_bedrock_runtime.config import Config
from smithy_aws_core.identity import (
    EnvironmentCredentialsResolver,
    ContainerCredentialsResolver,
)
from aws_sdk_signers import AWSCredentialIdentity
from smithy_http.aio.aiohttp import AIOHTTPClient, AIOHTTPClientConfig

# Utilities for telemetry and pricing
from opentelemetry_span_manager import OpenTelemetrySpanManager
from nova_sonic_pricing import NovaFxSonicCostCalculator

from services.database_service import LocalDBService
from tools.tools_list import ToolsList

tools_instance = ToolsList()

# Model configuration
NOVA_SONIC_MODEL_ID = os.getenv("NOVA_SONIC_MODEL_ID", "amazon.nova-2-sonic-v1:0")
NOVA_SONIC_MODEL_REGION = os.getenv("AWS_REGION", "us-east-1")

# Suppress warnings
warnings.filterwarnings("ignore")


# Custom logging filter to suppress expected AWS CRT cancellation errors
class SuppressCRTCancellationFilter(logging.Filter):
    """Filter to suppress expected InvalidStateError from AWS CRT during cleanup"""

    def filter(self, record):
        # Suppress AWS CRT cancellation errors
        message = record.getMessage()
        if "InvalidStateError" in message and "CANCELLED" in message:
            return False
        if (
            "Treating Python exception as error" in message
            and "AWS_ERROR_UNKNOWN" in message
        ):
            return False
        return True


# Apply filter to root logger to catch AWS CRT errors
logging.getLogger().addFilter(SuppressCRTCancellationFilter())


# Suppress expected InvalidStateError from AWS CRT during cleanup
def _custom_excepthook(exctype, value, traceback_obj):
    """Custom exception hook to suppress expected InvalidStateError from AWS CRT"""
    if exctype == InvalidStateError and "CANCELLED" in str(value):
        # This is expected when cancelling AWS CRT streams - don't print traceback
        return
    # For all other exceptions, use default handling
    sys.__excepthook__(exctype, value, traceback_obj)


# Install custom exception hook
sys.excepthook = _custom_excepthook

# Set up logging levels to reduce noise
logging.getLogger("run_servers").setLevel(logging.INFO)
logging.getLogger("s2s_session_manager").setLevel(logging.INFO)


# Filter out noisy log messages related to audio data
class AudioDataFilter(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        # Filter out audio-related log messages to reduce noise
        if "audioOutput" in message or "audio chunk" in message:
            return False
        return True


# Configure logging early
logger = logging.getLogger(__name__)

# Apply the filter to the logger
logger.addFilter(AudioDataFilter())

# Configure logging
DEBUG = os.environ.get("DEBUG")

# Check if telemetry is enabled
TELEMETRY_ENABLED = (
    os.environ.get("AGENT_OBSERVABILITY_ENABLED", "false").lower() == "true"
)

STACK_PREFIX = os.environ["STACK_NAME"]
print(f"STACK_PREFIX: {STACK_PREFIX}")
STACK_SUFFIX = os.environ["STACK_ENVIRONMENT"]
print(f"STACK_SUFFIX: {STACK_SUFFIX}")

db = LocalDBService(
    profile_name=None, stack_prefix=STACK_PREFIX, stack_suffix=STACK_SUFFIX
)

# Import prompts from live_practice_prompts
from live_practice_prompts import get_system_prompt

# Bedrock rate limit handling constants
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # 1 second base delay


class S2sSessionManager:
    """Manages bidirectional streaming with AWS Bedrock using asyncio"""

    def __init__(
        self,
        model_id=NOVA_SONIC_MODEL_ID,
        region=NOVA_SONIC_MODEL_REGION,
        session_id=None,
        prep_id=None,
        user_info=None,
        voice_id=None,
        mode="light",
        hello_audio_played=False,
        span_manager=None,
        cost_calculator=None,
        token_usage=None,
        usage_events=None,
    ):
        """Initialize the stream manager for a single Bedrock session."""
        self.model_id = model_id
        self.region = region
        self.session_start_time = time.time()
        self.voice_id = voice_id  # Voice ID for audio output
        self.mode = mode  # Interview mode: 'light' or 'smart'

        # Flag to track whether hello audio has been played (shared across sessions)
        self.hello_audio_played = hello_audio_played

        # Audio and output queues
        self.audio_input_queue = asyncio.Queue()
        self.output_queue = asyncio.Queue()

        self.response_task = None
        self.audio_task = None
        self.stream = None
        # Boolean attribute (not a method) - tracks if stream is active
        # Semgrep may flag "if self.is_active:" as missing parentheses, but this is correct
        self.is_active = False  # nosemgrep: is-function-without-parentheses
        self.bedrock_client = None

        # Session information (EXISTING - for backward compatibility)
        self.prompt_name = None  # Will be set from frontend
        self.content_name = None  # Will be set from frontend
        self.audio_content_name = None  # Will be set from frontend
        self.session_initialized = False  # Track if session is already initialized
        self.toolUseContent = ""
        self.toolUseId = ""
        self.toolName = ""
        self.session_id = session_id  # Unique session ID for memory
        self.prep_id = prep_id  # Interview preparation ID for loading questions
        self.user_info = user_info

        # Track content generation stages by contentId
        self.content_stages = {}  # Maps contentId to generationStage

        # Track processed tool use IDs to prevent duplicate execution
        self.processed_tool_use_ids = set()

        # Task tracking for proper cleanup
        self.tasks = set()

        # Track in-progress tool calls (for async tool execution)
        self.pending_tool_tasks = {}

        # Telemetry and token usage - Use references from SessionTransitionManager
        # These track the entire conversation across all sessions
        self.span_manager = span_manager
        self.cost_calculator = cost_calculator
        self.token_usage = (
            token_usage
            if token_usage is not None
            else {
                "totalInputTokens": 0,
                "totalOutputTokens": 0,
                "totalTokens": 0,
                "details": {
                    "input": {"speechTokens": 0, "textTokens": 0},
                    "output": {"speechTokens": 0, "textTokens": 0},
                },
            }
        )
        self.usage_events = usage_events if usage_events is not None else []

    async def stream_hello_audio(self):
        """
        Send initial greeting to Nova Sonic session.

        For Nova Sonic v1 (amazon.nova-2-sonic-v1:0): Sends text greeting message
        For older models: Streams hello.raw audio file with validation and proper timing
        """
        try:
            # Check model version - Nova Sonic v1 uses text greeting
            if self.model_id == "amazon.nova-2-sonic-v1:0":
                logger.info(
                    f"[HELLO_GREETING] Nova Sonic v1 detected - sending text greeting"
                )

                # Create unique content name for the hello text
                hello_content_name = f"hello-text-{uuid.uuid4()}"

                # Send content start event for text with USER role
                # Follow AWS Nova Sonic documentation: https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-cross-modal.html
                content_start_event = {
                    "event": {
                        "contentStart": {
                            "promptName": self.prompt_name,
                            "contentName": hello_content_name,
                            "role": "USER",
                            "type": "TEXT",
                            "interactive": True,
                            "textInputConfiguration": {"mediaType": "text/plain"},
                        }
                    }
                }
                await self.send_raw_event(content_start_event)
                logger.info(
                    f"[HELLO_GREETING] Sent contentStart for text greeting with role=USER"
                )

                # Send text input event with greeting message
                # NOTE: textInput event should NOT include 'role' field (role is in contentStart only)
                text_input_event = {
                    "event": {
                        "textInput": {
                            "promptName": self.prompt_name,
                            "contentName": hello_content_name,
                            "content": "Hello",
                        }
                    }
                }
                await self.send_raw_event(text_input_event)
                logger.info(
                    f"[HELLO_GREETING] Sent textInput with 'Hello' message (role=USER specified in contentStart)"
                )

                # Send content end event
                await self.send_raw_event(
                    S2sEvent.content_end(
                        prompt_name=self.prompt_name, content_name=hello_content_name
                    )
                )
                logger.info(
                    f"[HELLO_GREETING] Sent contentEnd - text greeting complete"
                )
                return

            # For older models, use audio file streaming
            logger.info(
                f"[HELLO_AUDIO] Older model detected - using audio file greeting"
            )

            # Use path relative to the current file
            hello_audio_path = os.path.join(
                os.path.dirname(__file__), "audio", "hello.raw"
            )
            logger.info(
                f"[HELLO_AUDIO] Attempting to read hello.raw from: {hello_audio_path}"
            )

            # Check if hello.raw file exists
            if not os.path.exists(hello_audio_path):
                # Try alternative location
                hello_audio_path = os.path.join(
                    os.path.dirname(__file__), "..", "audio", "hello.raw"
                )
                if not os.path.exists(hello_audio_path):
                    logger.info(
                        f"[HELLO_AUDIO] hello.raw not found, skipping initial audio"
                    )
                    return

            # Read and validate the audio file
            with open(hello_audio_path, "rb") as f:
                audio_buffer = f.read()

            logger.info(
                f"[HELLO_AUDIO] Successfully read hello.raw: {len(audio_buffer)} bytes"
            )

            # Validate audio format (should be 16-bit PCM, little-endian)
            if len(audio_buffer) % 2 != 0:
                logger.error(
                    f"[HELLO_AUDIO] Invalid audio file: size {len(audio_buffer)} is not even (required for 16-bit PCM)"
                )
                return

            # Convert to 16-bit samples for analysis
            samples = np.frombuffer(audio_buffer, dtype=np.int16)
            sample_count = len(samples)
            duration_seconds = sample_count / 16000  # Assume 16kHz sample rate

            # Calculate audio statistics
            min_value = np.min(samples)
            max_value = np.max(samples)
            rms = np.sqrt(np.mean(np.square(samples.astype(np.float32))))

            logger.info(f"[HELLO_AUDIO] Audio file analysis:")
            logger.info(f"[HELLO_AUDIO]   - Total samples: {sample_count}")
            logger.info(f"[HELLO_AUDIO]   - Duration: {duration_seconds:.2f} seconds")
            logger.info(f"[HELLO_AUDIO]   - Sample range: {min_value} to {max_value}")
            logger.info(f"[HELLO_AUDIO]   - RMS energy: {rms:.1f}")

            # Validate that we have meaningful audio content
            if rms < 100:
                logger.warning(
                    f"[HELLO_AUDIO] Warning: Low RMS energy ({rms:.1f}) - audio may be very quiet or silence"
                )

            # Check for reasonable sample values
            if min_value < -32768 or max_value > 32767:
                logger.error(
                    f"[HELLO_AUDIO] Invalid sample values outside 16-bit range: {min_value} to {max_value}"
                )
                return

            # Use full audio content
            audio_to_stream = audio_buffer
            logger.info(
                f"[HELLO_AUDIO] Using full audio file: {len(audio_to_stream)} bytes"
            )

            # No need to wait since we're triggered by actual audio input (session is confirmed ready)
            logger.info(f"[HELLO_AUDIO] Session confirmed ready, streaming immediately")

            # Stream audio in properly sized chunks
            # 1024 samples = 2048 bytes (16-bit samples)
            SAMPLES_PER_CHUNK = 1024
            BYTES_PER_CHUNK = SAMPLES_PER_CHUNK * 2  # 2 bytes per 16-bit sample
            bytes_offset = 0
            chunk_count = 0

            # Create a unique content name for the hello audio
            hello_content_name = f"hello-audio-{uuid.uuid4()}"

            # Get the content start event from S2sEvent
            content_start_event = S2sEvent.content_start_audio(
                prompt_name=self.prompt_name, content_name=hello_content_name
            )

            # Add the required role field to the event
            content_start_event["event"]["contentStart"]["role"] = "USER"

            # Send the modified content start event
            await self.send_raw_event(content_start_event)

            logger.info(
                f"[HELLO_AUDIO] Starting chunked streaming: {SAMPLES_PER_CHUNK} samples ({BYTES_PER_CHUNK} bytes) per chunk"
            )

            while bytes_offset < len(audio_to_stream):
                # Calculate chunk size (handle last chunk which might be smaller)
                remaining_bytes = len(audio_to_stream) - bytes_offset
                chunk_size = min(BYTES_PER_CHUNK, remaining_bytes)

                # Extract chunk
                chunk = audio_to_stream[bytes_offset : bytes_offset + chunk_size]

                # Ensure chunk is properly aligned for 16-bit samples
                aligned_chunk_size = (chunk_size // 2) * 2
                aligned_chunk = chunk[:aligned_chunk_size]

                if len(aligned_chunk) == 0:
                    logger.info(
                        f"[HELLO_AUDIO] Skipping empty aligned chunk at offset {bytes_offset}"
                    )
                    break

                # Check if stream is still active before sending
                if not self.is_active or not self.stream:
                    logger.info(
                        f"[HELLO_AUDIO] Stream no longer active at chunk {chunk_count}, stopping stream"
                    )
                    break

                # Stream the chunk
                try:
                    # Convert to base64
                    base64_chunk = base64.b64encode(aligned_chunk).decode("utf-8")

                    # Create audio input event
                    audio_event = S2sEvent.audio_input(
                        self.prompt_name, hello_content_name, base64_chunk
                    )

                    # Send the event
                    await self.send_raw_event(audio_event)

                    chunk_count += 1

                    # Log progress periodically (every 10th chunk to reduce log noise)
                    if chunk_count % 10 == 0 or chunk_count <= 3:
                        samples_in_chunk = len(aligned_chunk) // 2
                        logger.info(
                            f"[HELLO_AUDIO] Streamed chunk {chunk_count}: {len(aligned_chunk)} bytes ({samples_in_chunk} samples), offset: {bytes_offset}"
                        )
                except Exception as stream_error:
                    logger.error(
                        f"[HELLO_AUDIO] Error streaming chunk {chunk_count}: {stream_error}"
                    )
                    break

                bytes_offset += len(aligned_chunk)

                # Calculate realistic timing between chunks
                # At 16kHz sample rate, each chunk represents a specific duration
                chunk_duration_ms = (
                    (len(aligned_chunk) / 2) / 16000 * 1000
                )  # Convert to milliseconds

                # Use a minimum delay to avoid overwhelming the stream, but respect audio timing
                delay_ms = max(25, min(chunk_duration_ms, 100))  # 25ms to 100ms range
                await asyncio.sleep(delay_ms / 1000)  # Convert to seconds

            # Send content end event
            await self.send_raw_event(
                S2sEvent.content_end(
                    prompt_name=self.prompt_name, content_name=hello_content_name
                )
            )

            total_chunks = chunk_count
            streamed_bytes = bytes_offset
            streamed_samples = streamed_bytes // 2
            streamed_duration = streamed_samples / 16000

            logger.info(f"[HELLO_AUDIO] Streaming complete:")
            logger.info(f"[HELLO_AUDIO]   - Total chunks: {total_chunks}")
            logger.info(
                f"[HELLO_AUDIO]   - Bytes streamed: {streamed_bytes}/{len(audio_to_stream)}"
            )
            logger.info(
                f"[HELLO_AUDIO]   - Duration streamed: {streamed_duration:.2f}s"
            )
            logger.info(
                f"[HELLO_AUDIO]   - Completion: {((streamed_bytes / len(audio_to_stream)) * 100):.1f}%"
            )

        except Exception as error:
            logger.error(f"[HELLO_AUDIO] Error streaming hello.raw: {error}")

    async def _initialize_session_components(self, prompt_name):
        """Initialize session components without sending sessionStart event (frontend already sent it)."""
        if not prompt_name:
            raise ValueError("Prompt name cannot be empty")

        self.prompt_name = prompt_name

        # Don't reset session start time or send sessionStart - frontend already did this
        logger.info(
            f"Initializing session components with prompt: {self.prompt_name}, session ID: {self.session_id}"
        )

        # Start the response processing task
        if not self.response_task or self.response_task.done():
            self.response_task = asyncio.create_task(self._process_responses())
            self.response_task.set_name("response_processing_task")
            self.tasks.add(self.response_task)
            logger.info("Response processing task started")

        # Start the audio processing task
        if not self.audio_task or self.audio_task.done():
            self.audio_task = asyncio.create_task(self._process_audio_input())
            self.audio_task.set_name("audio_processing_task")
            self.tasks.add(self.audio_task)
            logger.info("Audio processing task started")

    async def initialize_session_with_prompt(self, prompt_name):
        """Initialize the session with a prompt name."""
        if not prompt_name:
            raise ValueError("Prompt name cannot be empty")

        # Check if session is already initialized to prevent duplicate initialization
        if self.session_initialized:
            logger.warning(
                f"Session already initialized with prompt {self.prompt_name}, skipping duplicate initialization"
            )
            return

        # Set the prompt name
        self.prompt_name = prompt_name

        # Reset session start time
        self.session_start_time = time.time()

        # Log the session initialization
        logger.info(
            f"Session initialized with prompt: {self.prompt_name}, session ID: {self.session_id}"
        )

        # Clean up any existing agent session state for fresh start

        try:
            # Use database service to clear previous agent session state
            if self.user_info and "user_id" in self.user_info:
                user_id = self.user_info.get("user_id", "unknown")
                from interview_session_memory import clear_session_memory

                clear_session_memory(self.session_id)
                logger.info(
                    f"Cleared previous agent session state for session {self.session_id}"
                )
            else:
                logger.warning(
                    f"Cannot clear agent session state - user_info not available"
                )
        except Exception as e:
            logger.warning(
                f"Error clearing agent session state: {e}, continuing with fresh session"
            )

        # Start a new S2S session - this must be the first event sent to Bedrock
        logger.info(
            f"Sending sessionStart event to Bedrock for session: {self.session_id}"
        )
        await self.send_raw_event(S2sEvent.session_start(self.model_id))

        # Wait a small amount of time to ensure the sessionStart event is processed
        await asyncio.sleep(0.1)

        # Start the response processing task after session start
        if not self.response_task or self.response_task.done():
            self.response_task = asyncio.create_task(self._process_responses())
            self.response_task.set_name("response_processing_task")
            self.tasks.add(self.response_task)
            logger.info("Response processing task started")

        # Start the audio processing task after session start
        if not self.audio_task or self.audio_task.done():
            self.audio_task = asyncio.create_task(self._process_audio_input())
            self.audio_task.set_name("audio_processing_task")
            self.tasks.add(self.audio_task)
            logger.info("Audio processing task started")

        # CRITICAL: Wait for tasks to start listening before sending events
        # Tasks don't actually start until event loop yields
        await asyncio.sleep(0.1)
        logger.info("Response and audio tasks ready to receive events")

        # Log the session initialization
        logger.info(
            f"Session initialized with prompt: {self.prompt_name}, session ID: {self.session_id}"
        )

        # promptStart event
        # Initialize the tools configuration
        tools_config = {"tools": [], "toolChoice": {"any": {}}}

        # Define which tools to use based on mode
        # Smart Mode: Only interviewAgentTool (added separately below)
        # Light Mode: Only get_next_interview_question
        if self.mode == "smart":
            # Smart Mode: No regular tools needed - only interviewAgentTool
            # The agent handles everything (questions, follow-ups, feedback)
            allowed_tools = set()  # Empty set - no regular tools
            logger.info(f"Smart Mode: Using only interviewAgentTool (no regular tools)")
        else:
            # Light Mode: Only need conduct_interview_turn
            allowed_tools = {"conduct_interview_turn"}
            logger.info(f"Light Mode: Using only conduct_interview_turn tool")
            # logger.info(f"Light Mode: Using no  tools, just following call script in system prompt")

        # Get all methods that have been decorated with bedrock_tool
        for method_name in dir(tools_instance):
            if method_name.startswith("_"):
                continue

            method = getattr(tools_instance, method_name)
            if hasattr(method, "bedrock_schema"):
                tool_schema = dict(method.bedrock_schema)
                tool_name = tool_schema.get("toolSpec", {}).get("name")

                # Filter tools based on mode
                if allowed_tools is not None and tool_name not in allowed_tools:
                    logger.info(
                        f"Skipping tool '{tool_name}' (not in allowed list for {self.mode} mode)"
                    )
                    continue

                # For Streaming API, inputSchema.json must be serialized as a JSON string
                # Note: This is different from the Converse API which requires inputSchema.json to remain as a dictionary object
                if isinstance(
                    tool_schema.get("toolSpec", {}).get("inputSchema", {}).get("json"),
                    (dict, list),
                ):
                    tool_schema["toolSpec"]["inputSchema"]["json"] = json.dumps(
                        tool_schema["toolSpec"]["inputSchema"]["json"]
                    )

                tools_config["tools"].append(tool_schema)
                logger.info(f"✓ Added tool: {tool_name}")

        # Add Smart Mode agent tool if mode is 'smart'
        logger.info(f"=" * 60)
        logger.info(f"INTERVIEW MODE CHECK: self.mode = '{self.mode}'")
        logger.info(f"=" * 60)

        if self.mode == "smart":
            try:
                logger.info("SMART MODE DETECTED - Loading agent tools...")
                from live_practice_service import get_smart_mode_tools

                smart_tools = get_smart_mode_tools()
                logger.info(f"Retrieved {len(smart_tools)} smart mode tools")

                for smart_tool in smart_tools:
                    # Extract handler and store it
                    handler = smart_tool.pop("_handler", None)
                    if handler:
                        tool_name = smart_tool["toolSpec"]["name"]
                        # Store handler for later use in processToolUse
                        if not hasattr(self, "agent_tool_handlers"):
                            self.agent_tool_handlers = {}
                        self.agent_tool_handlers[tool_name] = handler
                        logger.info(f"✓ Registered Smart Mode agent tool: {tool_name}")

                    # Add tool to configuration
                    tools_config["tools"].append(smart_tool)
                    logger.info(
                        f"✓ Added tool to configuration: {smart_tool['toolSpec']['name']}"
                    )

                logger.info(f"=" * 60)
                logger.info(
                    f"SMART MODE ENABLED: Added {len(smart_tools)} agent tool(s)"
                )
                logger.info(f"=" * 60)
            except Exception as e:
                logger.error(f"=" * 60)
                logger.error(f"FAILED TO LOAD SMART MODE TOOLS: {e}")
                logger.error(f"=" * 60)
                import traceback

                logger.error(traceback.format_exc())
                # Continue with basic tools if agent tools fail
        else:
            logger.info(f"=" * 60)
            logger.info(f"LIGHT MODE ENABLED - Using basic tools only")
            logger.info(f"=" * 60)

        # If no tools were found, fall back to default
        if len(tools_config["tools"]) == 0:
            logger.info("No tools found in ToolsList, using default config")
            tools_config = S2sEvent.DEFAULT_TOOL_CONFIG

        # Set the tool configuration on the stream manager
        self.toolConfiguration = tools_config
        logger.info(f"Total tools configured: {len(tools_config['tools'])}")

        # Get audio output config with the selected voice
        from live_practice_service import get_audio_output_config

        audio_output_config = get_audio_output_config(self.voice_id)
        logger.info(f"Using voice_id: {self.voice_id} for audio output config")
        logger.info(f"Audio output config: {audio_output_config}")

        promptStart_event = S2sEvent.prompt_start(
            prompt_name=self.prompt_name,
            audio_output_config=audio_output_config,
            tool_config=self.toolConfiguration,
        )
        await self.send_raw_event(promptStart_event)

        # Send system prompt content start (already has SYSTEM role from S2sEvent.content_start_text)
        content_name = f"system-{uuid.uuid4()}"
        content_start_event = S2sEvent.content_start_text(
            prompt_name=self.prompt_name, content_name=content_name
        )
        await self.send_raw_event(content_start_event)

        system_prompt = self.get_formatted_system_prompt()

        # Send system prompt content input
        # NOTE: textInput event should NOT include 'role' field (role=SYSTEM is in contentStart only)
        text_input_event = {
            "event": {
                "textInput": {
                    "promptName": self.prompt_name,
                    "contentName": content_name,
                    "content": system_prompt,
                }
            }
        }
        await self.send_raw_event(text_input_event)

        # Send system prompt content end
        await self.send_raw_event(
            S2sEvent.content_end(
                prompt_name=self.prompt_name, content_name=content_name
            )
        )

        # Stream hello.raw audio file to provide an initial audio greeting, but only on first initialization
        if not self.hello_audio_played:
            logger.info("First initialization detected, playing hello audio greeting")
            await self.stream_hello_audio()
            self.hello_audio_played = True
        else:
            logger.info("Skipping hello audio greeting on subsequent initialization")

        # Mark session as initialized to prevent duplicate initialization
        self.session_initialized = True
        logger.info(f"Session initialization complete for session: {self.session_id}")

    def get_formatted_system_prompt(self):
        """Format the system prompt with user information"""
        if not hasattr(self, "user_info") or not self.user_info:
            logger.error("ERROR: User information not available for system prompt")
            return "Missing user information, no system prompt available"

        # Get user information
        user_id = self.user_info.get("user_id", "unknown")
        session_id = self.session_id
        current_date = time.strftime("%Y-%m-%d")

        # Use prep_id to load interview plan, or fall back to session_id if prep_id not set
        plan_id = self.prep_id if self.prep_id else self.session_id
        logger.info(f"Loading preparation from DynamoDB for prep_id: {plan_id}")

        # Load interview plan from DynamoDB using the database service
        import json

        interview_questions = []
        preparation_details = []
        company_name = None
        job_title = None
        interview_type = None
        questions_with_details = []

        try:
            # Retrieve interview plan from DynamoDB using prep_id
            interview_plan = db.get_interview_plan_by_id(user_id, plan_id)
            logger.info(
                f"Retrieved interview plan from DynamoDB for prep_id: {interview_plan}"
            )
            if interview_plan:
                logger.info(
                    f"Retrieved interview plan from DynamoDB for prep_id: {plan_id}"
                )

                # Extract interview context
                company_name = interview_plan.get("companyName", "the company")
                job_title = interview_plan.get("jobTitle", "this position")
                interview_type = interview_plan.get("interviewType", "interview")

                logger.info(
                    f"Interview context: {company_name} - {job_title} ({interview_type})"
                )

                # Extract questions and expected answers
                questions = interview_plan.get("questions", [])

                for q in questions:
                    question_text = q.get("questionText", "")
                    expected_answer = q.get("expectedAnswer", "")

                    if question_text:
                        interview_questions.append(question_text)

                        # Store full question object for agent context
                        questions_with_details.append(
                            {
                                "questionText": question_text,
                                "expectedAnswer": expected_answer,
                                "category": q.get("category", ""),
                                "difficulty": q.get("difficulty", ""),
                                "reasoning": q.get("reasoning", ""),
                            }
                        )

                    if expected_answer:
                        # Format as Question + Answer for preparation details
                        prep_detail = f"Question: {question_text}\nExpected Answer: {expected_answer}"
                        preparation_details.append(prep_detail)

                logger.info(
                    f"Loaded {len(interview_questions)} questions and {len(preparation_details)} preparation answers from DynamoDB"
                )
            else:
                logger.warning(
                    f"WARNING: No interview plan found in DynamoDB for prep_id: {self.session_id}, using mock data for testing"
                )
                interview_questions = [
                    "Tell me about a time when you had to work under pressure to meet a deadline.",
                    "Describe a situation where you had to resolve a conflict in your team.",
                    "Give me an example of when you showed leadership skills.",
                ]
                preparation_details = [
                    f"Question: {q}\nExpected Answer: [Mock prepared answer for testing - candidate should provide real answer during interview]"
                    for q in interview_questions
                ]
                logger.info(
                    f"Created {len(preparation_details)} mock preparation answers for testing"
                )

        except Exception as e:
            logger.error(f"Error retrieving interview plan from DynamoDB: {e}")
            logger.warning("Falling back to mock data for testing")
            interview_questions = [
                "Tell me about a time when you had to work under pressure to meet a deadline.",
                "Describe a situation where you had to resolve a conflict in your team.",
                "Give me an example of when you showed leadership skills.",
            ]
            preparation_details = [
                f"Question: {q}\nExpected Answer: [Mock prepared answer for testing - candidate should provide real answer during interview]"
                for q in interview_questions
            ]
            logger.info(
                f"Created {len(preparation_details)} mock preparation answers for testing"
            )

        # Initialize interview session memory with questions and preparation details
        if interview_questions and isinstance(interview_questions, list):
            from interview_session_memory import get_session_memory

            # Use unique session_id for memory, prep_id for reference to interview plan
            memory = get_session_memory(session_id)
            memory.initialize_session(
                session_id=session_id,
                user_id=user_id,
                interview_questions=interview_questions,
                prep_id=plan_id,  # Use plan_id (prep_id) not session_id
                preparation_details=preparation_details,
                company_name=company_name,
                job_title=job_title,
                interview_type=interview_type,
                questions_with_details=questions_with_details
                if "questions_with_details" in locals()
                else [],
            )

            logger.info(
                f"Initialized interview session memory with {len(interview_questions)} questions and {len(preparation_details)} preparation answers for {company_name} - {job_title}"
            )

        # parse interview_questions to a string with clear numbering
        if interview_questions is None:
            interview_questions = "No interview questions available."
        elif isinstance(interview_questions, list):
            numbered_questions = []
            for i, question in enumerate(interview_questions, 1):
                numbered_questions.append(f"Question {i}: {question}")
            interview_questions = "\n\n".join(numbered_questions)
        elif not isinstance(interview_questions, str):
            interview_questions = str(interview_questions)

        # get a random randomized tag to use in the prompt
        randomized_tag = uuid.uuid4().hex[:8]  # Generate a short random tag

        # Use mode-aware prompt selection (Smart Mode uses agent-focused prompt)
        # This will select SMART_MODE_INTERVIEW_SYSTEM_PROMPT for smart mode
        # and STRUCTURED_INTERVIEW_SYSTEM_PROMPT for light mode
        logger.info(f"=" * 60)
        logger.info(f"SYSTEM PROMPT SELECTION: mode = '{self.mode}'")
        logger.info(f"=" * 60)

        formatted_prompt = get_system_prompt(
            prompt_type="structured",
            mode=self.mode,  # Use the mode (light/smart) from session manager
            userId=user_id,
            sessionId=session_id,
            date=current_date,
            interviewQuestions=interview_questions,
            randomized=randomized_tag,
        )

        # Log which prompt was selected
        if self.mode == "smart":
            logger.info("✓ Using SMART_MODE_INTERVIEW_SYSTEM_PROMPT")
        else:
            logger.info("✓ Using STRUCTURED_INTERVIEW_SYSTEM_PROMPT")

        logger.info(f"System prompt:\n {formatted_prompt}")
        logger.info(f"=" * 60)

        return formatted_prompt

    def _initialize_client(self):
        """Initialize the Bedrock client."""
        # Clear any existing client first
        self.bedrock_client = None

        # Check if we have user credentials
        aws_creds = None
        if (
            hasattr(self, "user_info")
            and self.user_info
            and "aws_credentials" in self.user_info
        ):
            aws_creds = self.user_info["aws_credentials"]

        # Only use user-specific credentials if they are provided and valid
        if (
            aws_creds is not None
            and isinstance(aws_creds, dict)
            and aws_creds.get("access_key")
            and aws_creds.get("secret_key")
        ):
            # Use user-specific credentials
            logger.info("Using user-specific AWS credentials")

            #  Log credential structure for debugging
            logger.info(f"AWS credentials type: {type(aws_creds)}")
            logger.info(f"AWS credentials keys: {list(aws_creds.keys())}")
            logger.info(f"access_key exists: {'access_key' in aws_creds}")
            logger.info(f"secret_key exists: {'secret_key' in aws_creds}")

            class UserCredentialsResolver:
                def __init__(self, access_key, secret_key, session_token):
                    self.access_key = access_key
                    self.secret_key = secret_key
                    self.session_token = session_token

                async def get_identity(self, properties=None):
                    return AWSCredentialIdentity(
                        access_key_id=self.access_key,
                        secret_access_key=self.secret_key,
                        session_token=self.session_token,
                        expiration=None,
                    )

            credentials_resolver = UserCredentialsResolver(
                access_key=aws_creds["access_key"],
                secret_key=aws_creds["secret_key"],
                session_token=aws_creds.get("session_token"),
            )

            config = Config(
                endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
                region=self.region,
                aws_credentials_identity_resolver=credentials_resolver,
            )

        elif (
            "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI" in os.environ
            or "AWS_CONTAINER_CREDENTIALS_FULL_URI" in os.environ
        ):
            logger.info("Using default AWS credentials from environment or IAM role")

            client_config = AIOHTTPClientConfig()
            http_client = AIOHTTPClient(client_config=client_config)

            # Create credentials resolver with required http_client
            credentials_resolver = ContainerCredentialsResolver(http_client)

            config = Config(
                endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
                region=self.region,
                aws_credentials_identity_resolver=credentials_resolver,
            )
        else:
            logger.info("Using default AWS credentials (profile or environment)")

            # Use boto3 to get credentials from default chain (profile, env vars, IAM role, etc.)
            try:
                boto_session = boto3.Session()
                boto_credentials = boto_session.get_credentials()

                if not boto_credentials:
                    raise Exception(
                        "No AWS credentials found in default credential chain"
                    )

                # Get frozen credentials to access the values
                frozen_creds = boto_credentials.get_frozen_credentials()

                logger.info("Found AWS credentials via boto3")

                # Create a custom resolver that returns the boto3 credentials
                class Boto3CredentialsResolver:
                    def __init__(self, access_key, secret_key, session_token):
                        self.access_key = access_key
                        self.secret_key = secret_key
                        self.session_token = session_token

                    async def get_identity(self, properties=None):
                        return AWSCredentialIdentity(
                            access_key_id=self.access_key,
                            secret_access_key=self.secret_key,
                            session_token=self.session_token,
                            expiration=None,
                        )

                credentials_resolver = Boto3CredentialsResolver(
                    access_key=frozen_creds.access_key,
                    secret_key=frozen_creds.secret_key,
                    session_token=frozen_creds.token,
                )

                config = Config(
                    endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
                    region=self.region,
                    aws_credentials_identity_resolver=credentials_resolver,
                )
            except Exception as e:
                logger.error(f"Failed to get AWS credentials from boto3: {e}")
                raise

        # Initialize the Bedrock client with the configuration
        self.bedrock_client = BedrockRuntimeClient(config=config)
        logger.info(f"Bedrock client initialized with region: {self.region}")

    async def initialize_stream(self):
        """Initialize the bidirectional stream with Bedrock."""
        try:
            # Reset session start time when initializing a new stream
            self.session_start_time = time.time()

            self._initialize_client()

            # Note: During transitions, we create a new stream without closing the old one
            # The old session's stream will be closed by _close_old_session_and_promote()
            # after the transition is complete

            logger.info(
                f"Initializing new stream with model {self.model_id} in region {self.region}"
            )

            # Initialize the stream with retry logic
            retry_count = 0
            while retry_count < MAX_RETRIES:
                try:
                    # Initialize the stream
                    logger.info(
                        f"Calling invoke_model_with_bidirectional_stream for {self.model_id}..."
                    )
                    self.stream = await self.bedrock_client.invoke_model_with_bidirectional_stream(
                        InvokeModelWithBidirectionalStreamOperationInput(
                            model_id=self.model_id
                        )
                    )
                    logger.info("invoke_model_with_bidirectional_stream call completed")
                    self.is_active = True
                    logger.info(f"Stream is now active: {self.is_active}")
                    break
                except ServiceError as e:
                    retry_count += 1
                    if "retry-after" in str(e).lower() and retry_count < MAX_RETRIES:
                        # Extract retry time if available or use exponential backoff
                        retry_time = RETRY_BASE_DELAY * (2 ** (retry_count - 1))
                        logger.warning(
                            f"Rate limited by Bedrock API, retrying in {retry_time} seconds (attempt {retry_count}/{MAX_RETRIES})"
                        )
                        await asyncio.sleep(retry_time)
                    else:
                        if retry_count >= MAX_RETRIES:
                            logger.error(
                                f"Failed to initialize stream after {MAX_RETRIES} retries"
                            )
                        raise

            # Wait a bit to ensure everything is set up
            logger.info("Waiting 0.1s for stream setup to complete...")
            await asyncio.sleep(0.1)
            logger.info("Wait completed")

            logger.info("Stream initialized successfully")
            return self
        except Exception as e:
            self.is_active = False
            logger.error(f"Failed to initialize stream: {str(e)}")

            raise

    async def send_raw_event(self, event_data, retry_count=0):
        """Send a raw event to the Bedrock stream."""
        if not self.stream or not self.is_active:
            logger.info(
                f"Stream not initialized or closed, stream is set to active: {self.is_active}"
            )
            return

        # Create event span using utility method
        event_span = self.span_manager.create_event_span(
            event_data, session_id=self.session_id
        )

        # Prevent infinite retries
        max_retries = 2
        if retry_count >= max_retries:
            logger.error(
                f"Maximum retry attempts ({max_retries}) exceeded for sending event"
            )
            return

        try:
            event_json = json.dumps(event_data)

            # Create and send the event
            event = InvokeModelWithBidirectionalStreamInputChunk(
                value=BidirectionalInputPayloadPart(bytes_=event_json.encode("utf-8"))
            )

            # Check if stream is still active before sending
            if not self.is_active or not self.stream:
                logger.info("Stream is no longer active, cannot send event")
                return

            await self.stream.input_stream.send(event)

            # End event span with success
            if event_span:
                event_type = (
                    list(event_data["event"].keys())[0]
                    if "event" in event_data
                    else "unknown"
                )
                self.span_manager.end_span_safely(
                    event_span, output={"status": "sent", "event_type": event_type}
                )

            # Close session if session end event
            if "event" in event_data and "sessionEnd" in event_data["event"]:
                # Wait a moment for the event to be processed before closing
                await asyncio.sleep(0.2)
                logger.info("Closing stream given we received a sessionEnd event")
                await self.close()

        except ServiceError as e:
            # End event span with error if created
            if event_span:
                self.span_manager.end_span_safely(
                    event_span,
                    level="ERROR",
                    status_message=f"Error sending event: {str(e)}",
                )

            if "retry-after" in str(e).lower():
                logger.warning(f"Rate limited by Bedrock API: {e}")
                # Wait before next attempt
                await asyncio.sleep(1.0)
            else:
                logger.debug(f"Error sending event: {str(e)}")

        except Exception as e:
            if event_span:
                self.span_manager.end_span_safely(
                    event_span, level="ERROR", status_message=f"Error: {str(e)}"
                )
            logger.debug(f"Error sending event: {str(e)}")

    async def _process_audio_input(self):
        # """Process audio input from the queue and send to Bedrock."""

        try:
            while self.is_active:
                try:
                    # Get audio data from the queue with a timeout to allow clean cancellation
                    try:
                        data = await asyncio.wait_for(
                            self.audio_input_queue.get(), timeout=0.5
                        )
                    except asyncio.TimeoutError:
                        # No data received within timeout, continue checking is_active
                        continue

                    # Extract data from the queue item
                    prompt_name = data.get("prompt_name")
                    content_name = data.get("content_name")
                    audio_bytes = data.get("audio_bytes")

                    if not audio_bytes or not prompt_name or not content_name:
                        logger.debug("Missing required audio data properties")
                        continue

                    # Create the audio input event
                    audio_event = S2sEvent.audio_input(
                        prompt_name,
                        content_name,
                        audio_bytes.decode("utf-8")
                        if isinstance(audio_bytes, bytes)
                        else audio_bytes,
                    )
                    # Send the event
                    await self.send_raw_event(audio_event)

                except asyncio.CancelledError:
                    logger.info("Audio processing task cancelled")
                    break
                except Exception as e:
                    logger.error(f"Error processing audio: {e}")
                    # Don't break the loop on error, continue processing
        except asyncio.CancelledError:
            logger.info("Audio task cancelled during processing")
        except Exception as e:
            logger.error(f"Unexpected error in audio processing task: {e}")
        finally:
            logger.info("Audio processing task completed")

    def add_audio_chunk(self, prompt_name, content_name, audio_data):
        """Add an audio chunk to the input queue for processing.

        Args:
            prompt_name: Name of the prompt
            content_name: Name of the content
            audio_data: Base64-encoded audio data from frontend
        """
        try:
            self.audio_input_queue.put_nowait(
                {
                    "prompt_name": prompt_name,
                    "content_name": content_name,
                    "audio_bytes": audio_data,
                }
            )
        except Exception as e:
            logger.error(f"Error adding audio chunk to queue: {e}")

    async def _process_responses(self):
        """Process incoming responses from Bedrock."""

        try:
            logger.info("Starting response processing task")
            while self.is_active:
                try:
                    # Get response with a timeout for cancellation
                    output = await self.stream.await_output()

                    # Check if stream is still active before processing
                    if not self.is_active or not self.stream:
                        logger.info(
                            "Stream is no longer active, stopping response processing"
                        )
                        break

                    result = await output[1].receive()

                    # Check if result is None or has no value
                    if result is None or not result.value or not result.value.bytes_:
                        continue

                    response_data = result.value.bytes_.decode("utf-8")
                    # Only log a brief summary of the response to reduce noise
                    if "event" in json.loads(response_data):
                        event_type = list(json.loads(response_data)["event"].keys())[0]
                        logger.debug(
                            f"Received response from Bedrock: event type {event_type}"
                        )

                    try:
                        json_data = json.loads(response_data)
                        json_data["timestamp"] = int(
                            time.time() * 1000
                        )  # Milliseconds since epoch

                        event_name = None
                        response_span = None

                        if "event" in json_data:
                            event_name = list(json_data["event"].keys())[0]

                            # Create response event span
                            response_span = self.span_manager.create_event_span(
                                json_data, session_id=self.session_id
                            )

                            # Only log important events (skip noisy ones)
                            noisy_events = [
                                "usageEvent",
                                "contentStart",
                                "contentEnd",
                                "textOutput",
                                "audioOutput",
                            ]
                            if event_name not in noisy_events:
                                logger.info(f"Received event type: {event_name}")

                            if event_name == "contentStart":
                                content_id = json_data["event"]["contentStart"].get(
                                    "contentId"
                                )
                                content_type = json_data["event"]["contentStart"].get(
                                    "type"
                                )

                                # Extract generationStage from additionalModelFields if present
                                additional_fields = json_data["event"][
                                    "contentStart"
                                ].get("additionalModelFields")
                                if additional_fields and content_type in [
                                    "TEXT",
                                    "TOOL",
                                ]:
                                    try:
                                        # Parse the additionalModelFields JSON string
                                        fields_dict = json.loads(additional_fields)
                                        generation_stage = fields_dict.get(
                                            "generationStage"
                                        )

                                        # Store the generation stage for this contentId
                                        if generation_stage:
                                            self.content_stages[content_id] = (
                                                generation_stage
                                            )
                                            # Only log FINAL stages to reduce noise
                                            if generation_stage == "FINAL":
                                                logger.debug(
                                                    f"Content {content_id} (type: {content_type}) marked as FINAL"
                                                )
                                    except json.JSONDecodeError:
                                        logger.warning(
                                            f"Failed to parse additionalModelFields: {additional_fields}"
                                        )

                            elif event_name == "textInput":
                                prompt_name = json_data["event"]["textInput"].get(
                                    "promptName"
                                )
                                content_name = json_data["event"]["textInput"].get(
                                    "contentName"
                                )

                                logger.info(
                                    f"Received textInput event: {prompt_name}, {content_name}"
                                )

                            # Handle usage events
                            elif event_name == "usageEvent":
                                # Store the usage event
                                event_data = json_data["event"]["usageEvent"]
                                self.usage_events.append(event_data)

                                # Update token usage aggregates
                                if "totalInputTokens" in event_data:
                                    self.token_usage["totalInputTokens"] = (
                                        event_data.get("totalInputTokens", 0)
                                    )
                                if "totalOutputTokens" in event_data:
                                    self.token_usage["totalOutputTokens"] = (
                                        event_data.get("totalOutputTokens", 0)
                                    )
                                if "totalTokens" in event_data:
                                    self.token_usage["totalTokens"] = event_data.get(
                                        "totalTokens", 0
                                    )

                                # Update detailed token usage if available
                                if "details" in event_data:
                                    details = event_data.get("details", {})
                                    if "delta" in details:
                                        delta = details.get("delta", {})
                                        # Update input tokens
                                        if "input" in delta:
                                            input_delta = delta.get("input", {})
                                            self.token_usage["details"]["input"][
                                                "speechTokens"
                                            ] += input_delta.get("speechTokens", 0)
                                            self.token_usage["details"]["input"][
                                                "textTokens"
                                            ] += input_delta.get("textTokens", 0)
                                        # Update output tokens
                                        if "output" in delta:
                                            output_delta = delta.get("output", {})
                                            self.token_usage["details"]["output"][
                                                "speechTokens"
                                            ] += output_delta.get("speechTokens", 0)
                                            self.token_usage["details"]["output"][
                                                "textTokens"
                                            ] += output_delta.get("textTokens", 0)

                                    # If total values are provided, use those instead
                                    if "total" in details:
                                        total = details.get("total", {})
                                        if "input" in total:
                                            input_total = total.get("input", {})
                                            self.token_usage["details"]["input"][
                                                "speechTokens"
                                            ] = input_total.get(
                                                "speechTokens",
                                                self.token_usage["details"]["input"][
                                                    "speechTokens"
                                                ],
                                            )
                                            self.token_usage["details"]["input"][
                                                "textTokens"
                                            ] = input_total.get(
                                                "textTokens",
                                                self.token_usage["details"]["input"][
                                                    "textTokens"
                                                ],
                                            )
                                        if "output" in total:
                                            output_total = total.get("output", {})
                                            self.token_usage["details"]["output"][
                                                "speechTokens"
                                            ] = output_total.get(
                                                "speechTokens",
                                                self.token_usage["details"]["output"][
                                                    "speechTokens"
                                                ],
                                            )
                                            self.token_usage["details"]["output"][
                                                "textTokens"
                                            ] = output_total.get(
                                                "textTokens",
                                                self.token_usage["details"]["output"][
                                                    "textTokens"
                                                ],
                                            )

                                if self.span_manager.session_span and hasattr(
                                    self.span_manager.session_span, "set_attribute"
                                ):
                                    # Update telemetry silently (no logging)
                                    cost = self.cost_calculator.calculate_cost(
                                        self.token_usage["details"]
                                    )
                                    self.span_manager.session_span.set_attribute(
                                        "input_tokens",
                                        self.token_usage["totalInputTokens"],
                                    )
                                    self.span_manager.session_span.set_attribute(
                                        "output_tokens",
                                        self.token_usage["totalOutputTokens"],
                                    )
                                    self.span_manager.session_span.set_attribute(
                                        "total_tokens", self.token_usage["totalTokens"]
                                    )
                                    self.span_manager.session_span.set_attribute(
                                        "cost", cost
                                    )
                                    self.span_manager.session_span.set_attribute(
                                        "currency", "USD"
                                    )
                                    # Add an event for token usage update
                                    self.span_manager.session_span.add_event(
                                        "token_usage_updated",
                                        {
                                            "input_tokens": self.token_usage[
                                                "totalInputTokens"
                                            ],
                                            "output_tokens": self.token_usage[
                                                "totalOutputTokens"
                                            ],
                                            "total_tokens": self.token_usage[
                                                "totalTokens"
                                            ],
                                            "cost": cost,
                                        },
                                    )

                            elif event_name == "textOutput":
                                prompt_name = (
                                    json_data["event"]
                                    .get("textOutput", {})
                                    .get("promptName")
                                )
                                content = (
                                    json_data["event"]
                                    .get("textOutput", {})
                                    .get("content")
                                )
                                content_id = (
                                    json_data["event"]
                                    .get("textOutput", {})
                                    .get("contentId")
                                )
                                role = (
                                    json_data["event"]
                                    .get("textOutput", {})
                                    .get("role", "ASSISTANT")
                                )
                                # lowercase the role and append "user" with "Input" and "assistant" with "Output"
                                if role == "USER":
                                    messageType = "userInput"
                                elif role == "ASSISTANT":
                                    messageType = "assistantOutput"

                                # Check generation stage: SPECULATIVE (preview) vs FINAL (actually spoken)
                                generation_stage = self.content_stages.get(
                                    content_id, "FINAL"
                                )

                                # Log ALL messages with their generation stage for debugging
                                logger.info(f"[{generation_stage}] {role}: {content}")

                                if generation_stage == "FINAL":
                                    # Filter out initial "hello" from hello.raw audio
                                    # This is just Nova Sonic responding to the greeting audio, not actual user input
                                    if (
                                        role == "USER"
                                        and content.strip().lower() == "hello"
                                    ):
                                        logger.info(
                                            "Skipping 'hello' greeting - not adding to chat history"
                                        )
                                        continue

                                    # Also add to session memory conversation history
                                    try:
                                        if self.session_id:
                                            from interview_session_memory import (
                                                get_session_memory,
                                            )

                                            memory = get_session_memory(self.session_id)
                                            memory.add_to_history(role, content)
                                            logger.debug(
                                                f"Added {role} message to session memory conversation history"
                                            )
                                    except Exception as memory_error:
                                        logger.warning(
                                            f"Could not add message to session memory: {memory_error}"
                                        )

                                # SPECULATIVE outputs are skipped silently (no logging)

                            # Handle tool use detection
                            elif event_name == "toolUse":
                                tool_use_event = json_data["event"]["toolUse"]
                                self.toolUseContent = tool_use_event
                                self.toolName = tool_use_event["toolName"]
                                self.toolUseId = tool_use_event["toolUseId"]
                                # Track contentId for generation stage filtering
                                self.toolUseContentId = tool_use_event.get("contentId")
                                logger.info(
                                    f"Tool use detected: {self.toolName}, ID: {self.toolUseId}, ContentId: {self.toolUseContentId}"
                                )

                            # Process tool use when content ends
                            elif (
                                event_name == "contentEnd"
                                and json_data["event"][event_name].get("type") == "TOOL"
                            ):
                                content_id = json_data["event"]["contentEnd"].get(
                                    "contentId"
                                )
                                prompt_name = json_data["event"]["contentEnd"].get(
                                    "promptName"
                                )

                                # Check generation stage - only process FINAL, skip SPECULATIVE
                                generation_stage = self.content_stages.get(
                                    content_id, "FINAL"
                                )

                                # Check if this tool use ID has already been processed (deduplication)
                                if self.toolUseId in self.processed_tool_use_ids:
                                    logger.info(
                                        f"Skipping duplicate tool execution: {self.toolName}, ID: {self.toolUseId} (already processed)"
                                    )
                                elif generation_stage == "SPECULATIVE":
                                    logger.info(
                                        f"Skipping SPECULATIVE tool execution: {self.toolName}, ID: {self.toolUseId}"
                                    )
                                else:
                                    logger.info(
                                        f"Processing FINAL tool use: {self.toolName}, ID: {self.toolUseId}"
                                    )

                                    # Mark this tool use ID as processed
                                    self.processed_tool_use_ids.add(self.toolUseId)

                                    # Start asynchronous tool processing - non-blocking
                                    # This allows the response loop to continue processing other events
                                    self.handle_tool_request(
                                        prompt_name,
                                        self.toolName,
                                        self.toolUseContent,
                                        self.toolUseId,
                                    )
                                    # End response span with success
                        if response_span:
                            self.span_manager.end_span_safely(
                                response_span,
                                output={
                                    "status": "processed",
                                    "event_type": event_name,
                                },
                            )

                        # Put the response in the output queue for forwarding to the frontend
                        # Forward all events including usageEvent to the client
                        await self.output_queue.put(json_data)
                        # logger.info(f"Added response to output queue: {json_data.get('event', {}).keys()}")

                    except json.JSONDecodeError as json_error:
                        logger.error(f"JSON decode error: {json_error}")
                        await self.output_queue.put({"raw_data": response_data})

                except asyncio.CancelledError:
                    logger.debug("Response processing task cancelled")
                    break
                except StopAsyncIteration:
                    # Stream has ended
                    logger.debug("Stream iteration stopped")
                    break
                except Exception as e:
                    # Handle ValidationException properly
                    if "ValidationException" in str(e):
                        error_message = str(e)
                        logger.error(f"Validation error: {error_message}")

                        # Handle specific audio content errors gracefully
                        if (
                            "No open content found for content name" in error_message
                            and "audio-" in error_message
                        ):
                            logger.warning(
                                f"Audio content validation error - continuing processing: {error_message}"
                            )
                            # This is a known issue with audio content lifecycle management
                            # Continue processing instead of breaking the session
                            continue

                        # For other validation errors, we may want to break or continue based on severity
                        if "audio" in error_message.lower():
                            logger.warning(
                                "Audio-related validation error, continuing session"
                            )
                            continue
                    elif "retry-after" in str(e).lower():
                        logger.warning("Rate limited by Bedrock API")
                        # Wait before next attempt
                        await asyncio.sleep(1.0)
                        continue

                    elif "CANCELLED" in str(e) or "InvalidStateError" in str(e):
                        # Handle cancelled futures gracefully
                        logger.info(
                            "Stream was cancelled, stopping response processing"
                        )
                        break
                    elif "ModelStreamErrorException" in str(e):
                        # Handle unexpected processing errors from Bedrock
                        logger.error(f"Bedrock processing error: {str(e)}")
                        # Attempt to recover by reinitializing the stream
                        try:
                            logger.info(
                                "Attempting to recover from Bedrock processing error by reinitializing stream"
                            )
                            await self.initialize_stream()
                            continue
                        except Exception as recovery_error:
                            logger.error(
                                f"Failed to recover from Bedrock processing error: {recovery_error}"
                            )
                            break
                    else:
                        logger.error(f"Error receiving response: {e}")

                        # Continue to retry for recoverable errors
                        if not self.is_active:
                            break
        except asyncio.CancelledError:
            logger.info("Response task cancelled")
        except Exception as outer_e:
            logger.error(f"Outer error in response processing: {outer_e}")
        finally:
            self.is_active = False
            logger.debug("Response processing completed")

    def handle_tool_request(self, prompt_name, tool_name, tool_content, tool_use_id):
        """Handle a tool request asynchronously (non-blocking)"""
        # Create a unique content name for this tool response
        tool_content_name = str(uuid.uuid4())

        # Create an asynchronous task for the tool execution
        task = asyncio.create_task(
            self._execute_tool_and_send_result(
                prompt_name, tool_name, tool_content, tool_use_id, tool_content_name
            )
        )

        # Store the task
        self.pending_tool_tasks[tool_content_name] = task

        # Add error handling callback
        task.add_done_callback(
            lambda t: self._handle_tool_task_completion(t, tool_content_name)
        )

    def _handle_tool_task_completion(self, task, content_name):
        """Handle the completion of a tool task"""
        # Remove task from pending tasks
        if content_name in self.pending_tool_tasks:
            del self.pending_tool_tasks[content_name]

        # Handle any exceptions
        if task.done() and not task.cancelled():
            exception = task.exception()
            if exception:
                logger.error(f"Tool task failed: {str(exception)}")

    async def _execute_tool_and_send_result(
        self, prompt_name, tool_name, tool_content, tool_use_id, content_name
    ):
        """Execute a tool and send the result"""
        try:
            logger.info(f"Starting tool execution: {tool_name}")

            # Process the tool - this doesn't block the event loop
            tool_result = await self.processToolUse(tool_name, tool_content)

            # Send tool start event
            tool_start_event = S2sEvent.content_start_tool(
                prompt_name, content_name, tool_use_id
            )
            await self.send_raw_event(tool_start_event)

            # Send tool result event
            if isinstance(tool_result, dict):
                content_json_string = json.dumps(tool_result)
            else:
                content_json_string = tool_result

            tool_result_event = S2sEvent.text_input_tool(
                prompt_name, content_name, content_json_string
            )
            await self.send_raw_event(tool_result_event)

            # Send tool content end event
            tool_content_end_event = S2sEvent.content_end(prompt_name, content_name)
            await self.send_raw_event(tool_content_end_event)

            # send the latest candidate tip to frontend
            if self.session_id:
                try:
                    from interview_session_memory import get_session_memory

                    memory = get_session_memory(self.session_id)
                    latest_tip = memory.get_latest_candidate_tip()

                    if latest_tip:
                        # Create a custom event for the frontend
                        tip_event = {
                            "event": {
                                "candidateTip": {
                                    "tip": latest_tip.get("tip"),
                                    "timestamp": latest_tip.get("timestamp"),
                                    "questionNumber": latest_tip.get("question_number"),
                                }
                            },
                            "timestamp": int(time.time() * 1000),
                        }

                        # Send tip to frontend via output queue
                        await self.output_queue.put(tip_event)
                        logger.info(
                            f"Sent candidate tip to frontend: {latest_tip.get('tip', '')[:100]}..."
                        )
                except Exception as tip_error:
                    logger.warning(
                        f"Could not send candidate tip to frontend: {tip_error}"
                    )

            logger.info(f"Tool execution complete: {tool_name}")
        except Exception as e:
            logger.error(f"Error executing tool {tool_name}: {str(e)}")
            # Try to send an error response if possible
            try:
                error_result = {"error": f"Tool execution failed: {str(e)}"}

                tool_start_event = S2sEvent.content_start_tool(
                    prompt_name, content_name, tool_use_id
                )
                await self.send_raw_event(tool_start_event)

                tool_result_event = S2sEvent.text_input_tool(
                    prompt_name, content_name, json.dumps(error_result)
                )
                await self.send_raw_event(tool_result_event)

                tool_content_end_event = S2sEvent.content_end(prompt_name, content_name)
                await self.send_raw_event(tool_content_end_event)
            except Exception as send_error:
                logger.error(f"Failed to send error response: {str(send_error)}")

    async def processToolUse(self, toolName, toolUseContent):
        """Return the tool result"""
        logger.info(f"Tool Use Content: {toolUseContent}")

        # Initialize parameters dictionary to pass to the tool function
        params = {}

        if toolUseContent.get("content"):
            # Parse the JSON string in the content field
            try:
                content_json = json.loads(toolUseContent.get("content"))
                logger.info(f"toolName: {toolName}, Content JSON: {content_json}")

                # Extract all parameters from the content JSON
                for key, value in content_json.items():
                    params[key] = value

                logger.info(f"Extracted parameters: {params}")
            except json.JSONDecodeError:
                logger.error("Failed to parse tool content JSON")
                return {"result": "Error processing tool content"}

        # Check if this is a Smart Mode agent tool
        if (
            hasattr(self, "agent_tool_handlers")
            and toolName in self.agent_tool_handlers
        ):
            try:
                logger.info(f"Calling Smart Mode agent tool: {toolName}")

                # Get the handler
                handler = self.agent_tool_handlers[toolName]

                # Inject sessionId automatically (not provided by Nova Sonic)
                params["sessionId"] = self.session_id
                logger.info(f"Injected sessionId: {self.session_id}")

                # Call the async handler (thread pool execution happens inside the handler)
                tool_start_time = time.time_ns()

                # Check if handler is async or sync
                if asyncio.iscoroutinefunction(handler):
                    result = await handler(params)
                else:
                    # If sync, run in thread pool
                    loop = asyncio.get_event_loop()
                    result = await loop.run_in_executor(None, handler, params)

                tool_end_time = time.time_ns()
                tool_run_time = tool_end_time - tool_start_time

                logger.info(f"Smart Mode agent tool completed: {toolName}")

                # Create tool use span
                response_span = self.span_manager.create_child_span(
                    "agentToolUse",
                    parent_span=self.span_manager.session_span,
                    input={"toolName": toolName, "params": params},
                    metadata={
                        "session_id": self.session_id,
                        "tool_start_time": tool_start_time,
                        "mode": "smart",
                    },
                )

                self.span_manager.end_span_safely(
                    response_span,
                    output={"result": result},
                    metadata={
                        "tool_run_time": tool_run_time,
                        "tool_start_time": tool_start_time,
                        "tool_end_time": tool_end_time,
                    },
                )

                return result  # Agent tool already returns dict format

            except Exception as e:
                logger.error(f"Smart Mode agent tool execution error: {str(e)}")
                import traceback

                logger.error(f"Traceback: {traceback.format_exc()}")
                return {"result": f"Agent tool execution failed: {str(e)}"}

        tool_function = getattr(tools_instance, toolName, None)

        if tool_function:
            try:
                # Log the final parameters being passed to the tool
                logger.info(f"Calling tool '{toolName}' with parameters: {params}")

                # Call the tool function with unpacked parameters
                tool_start_time = time.time_ns()
                result = tool_function(**params)
                tool_end_time = time.time_ns()
                tool_run_time = tool_end_time - tool_start_time
                logger.info(f"Tool use captured: {toolName}")

                # Create tool use span as a child of the current prompt or session span
                response_span = self.span_manager.create_child_span(
                    "toolUse",
                    parent_span=self.span_manager.session_span,
                    input={"toolName": toolName, "params": params},
                    metadata={
                        "session_id": self.session_id,
                        "tool_start_time": tool_start_time,
                    },
                )
                logger.info(f"created toolUse span: {toolName}")

                self.span_manager.end_span_safely(
                    response_span,
                    output={"result": result},
                    metadata={
                        "tool_run_time": tool_run_time,
                        "tool_start_time": tool_start_time,
                        "tool_end_time": tool_end_time,
                    },
                )
                logger.info(f"ended toolUse span: {toolName}")

                return {"result": result}
            except TypeError as e:
                logger.error(f"Error calling tool function {toolName}: {str(e)}")
                logger.error(f"Parameters passed: {params}")
                signature = inspect.signature(tool_function)
                logger.error(f"Tool function signature: {signature}")
                return {"result": f"Error calling tool: {str(e)}"}
            except Exception as e:
                logger.error(f"Tool execution error: {str(e)}")
                import traceback

                logger.error(f"Traceback: {traceback.format_exc()}")
                return {"result": f"Tool execution failed: {str(e)}"}

        logger.error(f"Tool not implemented: {toolName}")
        return {"result": f"Tool not implemented - {toolName}"}

    async def close(self):
        """Close the stream properly (does NOT manage multi-session state).

        This method only manages stream resources:
        - Cancels tool processing tasks
        - Clears audio and output queues
        - Resets tool use state
        - Cancels response and audio tasks
        - Closes the stream handle

        Session state management (session transitions) is handled by
        SessionTransitionManager.
        """
        if not self.is_active:
            return

        self.is_active = False

        # Cancel any pending tool tasks
        for task in self.pending_tool_tasks.values():
            if not task.done():
                task.cancel()
        self.pending_tool_tasks.clear()

        # Clear audio queue to prevent processing old audio data
        while not self.audio_input_queue.empty():
            try:
                self.audio_input_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Clear output queue
        while not self.output_queue.empty():
            try:
                self.output_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Reset tool use state
        self.toolUseContent = ""
        self.toolUseId = ""
        self.toolName = ""

        # Reset session information (prompt/content names, not session state)
        self.prompt_name = None
        self.content_name = None
        self.audio_content_name = None

        # Close the stream if it exists
        if self.stream:
            try:
                await self.stream.input_stream.close()
            except Exception as e:
                logger.debug(f"Error closing stream: {e}")

        # Cancel response_task
        if self.response_task and not self.response_task.done():
            self.response_task.cancel()
            try:
                await self.response_task
            except asyncio.CancelledError:
                pass

        # Cancel audio_task
        if self.audio_task and not self.audio_task.done():
            self.audio_task.cancel()
            try:
                await self.audio_task
            except asyncio.CancelledError:
                pass

        # Set stream and tasks to None to ensure proper cleanup
        self.stream = None
        self.response_task = None
        self.audio_task = None

        logger.debug("Stream closed successfully")
