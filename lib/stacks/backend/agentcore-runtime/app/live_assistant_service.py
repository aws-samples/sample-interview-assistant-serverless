"""
Live Assistant Service - Real-time transcription using Amazon Transcribe
Captures system audio + microphone for meeting transcription
"""

import asyncio
import logging
import time
import os
from typing import Callable
from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.handlers import TranscriptResultStreamHandler
from amazon_transcribe.model import TranscriptEvent, TranscriptResultStream
from services.database_service import LocalDBService

logger = logging.getLogger(__name__)

# Get stack configuration from environment
STACK_PREFIX = os.environ.get("STACK_NAME", "sonic-int")
STACK_SUFFIX = os.environ.get("STACK_ENVIRONMENT", "dev")

# Initialize database service
db = LocalDBService(
    profile_name=None, stack_prefix=STACK_PREFIX, stack_suffix=STACK_SUFFIX
)


class LiveAssistantTranscriptHandler(TranscriptResultStreamHandler):
    """
    Handler for Amazon Transcribe streaming results
    Processes both partial and final transcription results
    """

    def __init__(
        self,
        transcript_result_stream: TranscriptResultStream,
        output_callback: Callable,
        session_id: str,
        parent_service=None,
    ):
        """
        Initialize the transcript handler

        Args:
            transcript_result_stream: The output stream from Transcribe
            output_callback: Async callback function to send results to WebSocket
            session_id: Unique session identifier
            parent_service: Reference to parent LiveAssistantService for event-driven question progression
        """
        super().__init__(transcript_result_stream)
        self.output_callback = output_callback
        self.session_id = session_id
        self.parent_service = parent_service
        self.partial_transcript = ""
        self.transcript_buffer = []

    async def handle_transcript_event(self, transcript_event: TranscriptEvent):
        """
        Handle incoming transcript events from Transcribe

        Args:
            transcript_event: Event containing transcription results
        """
        try:
            results = transcript_event.transcript.results

            for result in results:
                # Check if this is a partial or final result
                if result.is_partial:
                    # Partial result - real-time preview
                    for alt in result.alternatives:
                        transcript = alt.transcript
                        if transcript and transcript != self.partial_transcript:
                            self.partial_transcript = transcript

                            # Send partial result
                            await self.output_callback(
                                {
                                    "event": {
                                        "transcription": {
                                            "sessionId": self.session_id,
                                            "content": transcript,
                                            "isPartial": True,
                                            "timestamp": int(time.time() * 1000),
                                        }
                                    }
                                }
                            )
                            # No logging for partials to avoid spam
                else:
                    # Final result - commit to transcript
                    for alt in result.alternatives:
                        transcript = alt.transcript
                        if transcript:
                            # Reset partial transcript
                            self.partial_transcript = ""

                            # Extract speaker label if available (speaker diarization)
                            speaker_label = None
                            if hasattr(alt, "items") and alt.items:
                                # Get speaker label from first item that has it
                                for item in alt.items:
                                    if hasattr(item, "speaker") and item.speaker:
                                        speaker_label = item.speaker
                                        break

                            logger.info(
                                f"[Session {self.session_id}] 📝 Transcript: {transcript} "
                                f"(Speaker: {speaker_label}, Length: {len(transcript)} chars, "
                                f"Start: {result.start_time if hasattr(result, 'start_time') else 'N/A'}s, "
                                f"End: {result.end_time if hasattr(result, 'end_time') else 'N/A'}s)"
                            )

                            # Add to buffer
                            self.transcript_buffer.append(
                                {
                                    "content": transcript,
                                    "timestamp": int(time.time() * 1000),
                                    "start_time": result.start_time
                                    if hasattr(result, "start_time")
                                    else None,
                                    "end_time": result.end_time
                                    if hasattr(result, "end_time")
                                    else None,
                                    "speaker": speaker_label,
                                }
                            )

                            # Send final result with speaker label
                            await self.output_callback(
                                {
                                    "event": {
                                        "transcription": {
                                            "sessionId": self.session_id,
                                            "content": transcript,
                                            "isPartial": False,
                                            "timestamp": int(time.time() * 1000),
                                            "startTime": result.start_time
                                            if hasattr(result, "start_time")
                                            else None,
                                            "endTime": result.end_time
                                            if hasattr(result, "end_time")
                                            else None,
                                            "speaker": speaker_label,
                                        }
                                    }
                                }
                            )

                            # Event-driven question progression check
                            # Trigger after each final transcript (non-blocking)
                            if self.parent_service:
                                asyncio.create_task(
                                    self.parent_service._trigger_question_progression_check()
                                )

                                # Event-driven tip generation check
                                # Trigger after each final transcript (non-blocking)
                                asyncio.create_task(
                                    self.parent_service._trigger_tip_generation_check()
                                )

        except Exception as e:
            logger.error(f"Error handling transcript event: {e}")
            import traceback

            logger.error(traceback.format_exc())


class LiveAssistantService:
    """
    Service for real-time audio transcription using Amazon Transcribe
    Supports mixed audio streams (system audio + microphone)
    """

    def __init__(
        self,
        session_id: str,
        region: str = "us-east-1",
        interview_prep: dict = None,
        session_type: str = "candidateAssistant",
    ):
        """
        Initialize the Live Assistant Service

        Args:
            session_id: Unique session identifier
            region: AWS region for Transcribe service
            interview_prep: Interview preparation info (company, position, JD)
            session_type: Type of session ("candidateAssistant" or "interviewerAssistant")
        """
        self.session_id = session_id
        self.region = region
        self.session_type = session_type
        self.transcribe_client = None
        self.stream = None
        self.handler = None
        # Boolean attribute (not a method) - tracks if transcription stream is active
        self.is_active = False  # nosemgrep: is-function-without-parentheses
        self.audio_queue = asyncio.Queue()
        self.processing_task = None

        # Interview preparation context
        self.interview_prep = interview_prep or {}

        # Interview plan data (questions, company info)
        self.interview_questions = []
        self.company_name = None
        self.job_title = None
        self.interview_type = None

        # Question progression tracking
        self.current_question_index = 0
        self.question_statuses = {}
        self.last_question_check_time = None
        self.question_progression_task = (
            None  # Background task for AI-based question detection
        )

        # Transcribe stream health metrics
        self.audio_chunks_received = 0
        self.audio_chunks_sent_to_transcribe = 0
        self.audio_bytes_received = 0
        self.audio_bytes_sent_to_transcribe = 0
        self.transcripts_received = 0
        self.last_audio_received_time = None
        self.last_transcript_received_time = None
        self.transcribe_stream_restarts = 0
        self.metrics_log_interval = 50  # Log metrics every N audio chunks

        # Load interview plan from DynamoDB if interview_id is provided
        self._load_interview_plan()

        # Summary system
        self.current_summary = None  # Latest cumulative summary
        self.last_summary_time = None  # Timestamp of last summary generation
        self.summary_interval = 300  # 5 minutes in seconds
        self.summary_task = None  # Background task for periodic summaries

        # Automatic coaching tips system
        self.last_tip_time = None  # Timestamp of last tip generation
        self.tip_interval = 60  # 1 minute in seconds (increased frequency for more timely guidance)
        self.tip_task = None  # Background task for periodic tips
        self.tip_counter = 0  # Track number of tips generated

        logger.info(
            f"LiveAssistantService initialized for session: {session_id}, type: {session_type}"
        )

    def _load_interview_plan(self):
        """
        Load interview plan from DynamoDB if interview_id or prep_id is provided.
        Similar to s2s_session_manager.py logic for loading questions.
        """
        # Check for interview_id (interviewer sessions) or prep_id (candidate sessions)
        interview_id = self.interview_prep.get(
            "interview_id"
        ) or self.interview_prep.get("prep_id")

        if not interview_id:
            logger.info(
                f"[Session {self.session_id}] No interview_id/prep_id provided - skipping interview plan load"
            )
            return

        # Get user_id from interview_prep (should be set by server.py)
        user_id = self.interview_prep.get("userId") or self.interview_prep.get(
            "user_id"
        )

        if not user_id:
            logger.warning(
                f"[Session {self.session_id}] No user_id found in interview_prep - cannot load interview plan"
            )
            return

        try:
            logger.info(
                f"[Session {self.session_id}] Loading interview plan from DynamoDB - interview_id: {interview_id}, user_id: {user_id}"
            )

            # Retrieve interview plan from DynamoDB
            interview_plan = db.get_interview_plan_by_id(user_id, interview_id)

            if interview_plan:
                logger.info(
                    f"[Session {self.session_id}] ✅ Successfully loaded interview plan from DynamoDB"
                )

                # Extract interview context
                self.company_name = interview_plan.get("companyName", "the company")
                self.job_title = interview_plan.get("jobTitle", "this position")
                self.interview_type = interview_plan.get("interviewType", "interview")

                # Extract questions
                questions = interview_plan.get("questions", [])
                self.interview_questions = []

                for q in questions:
                    question_text = q.get("questionText", "")
                    if question_text:
                        self.interview_questions.append(
                            {
                                "questionText": question_text,
                                "expectedAnswer": q.get("expectedAnswer", ""),
                                "category": q.get("category", ""),
                                "difficulty": q.get("difficulty", ""),
                                "reasoning": q.get("reasoning", ""),
                            }
                        )

                logger.info(
                    f"[Session {self.session_id}] 📋 Loaded {len(self.interview_questions)} questions"
                )
                logger.info(
                    f"[Session {self.session_id}] 🏢 Interview context: {self.company_name} - {self.job_title} ({self.interview_type})"
                )

                # Initialize question progression tracking
                if self.interview_questions:
                    for i in range(len(self.interview_questions)):
                        # Use 1-indexed questionIds to match database schema (q1, q2, q3...)
                        self.question_statuses[f"q{i + 1}"] = {
                            "status": "not_started",
                            "startTime": None,
                            "endTime": None,
                        }
                    # Mark first question as in_progress
                    import time

                    self.question_statuses["q1"] = {
                        "status": "in_progress",
                        "startTime": int(time.time() * 1000),  # milliseconds
                        "endTime": None,
                    }
                    self.current_question_index = 0
                    self.last_question_check_time = time.time()
                    logger.info(
                        f"[Session {self.session_id}] ✅ Initialized question progression tracking"
                    )

                # Update interview_prep with extracted info for use in coaching
                self.interview_prep.update(
                    {
                        "companyName": self.company_name,
                        "jobTitle": self.job_title,
                        "interviewType": self.interview_type,
                        "questions": self.interview_questions,
                    }
                )
            else:
                logger.warning(
                    f"[Session {self.session_id}] ⚠️ No interview plan found in DynamoDB for interview_id: {interview_id}"
                )

        except Exception as e:
            logger.error(
                f"[Session {self.session_id}] ❌ Error loading interview plan from DynamoDB: {e}"
            )
            import traceback

            logger.error(traceback.format_exc())

    async def start_transcription(self, output_callback: Callable):
        """
        Start Amazon Transcribe streaming session

        Args:
            output_callback: Async callback to send transcription results
        """
        try:
            logger.info(f"Starting transcription for session: {self.session_id}")

            # Store callback for restart logic
            self.output_callback = output_callback

            # Create Transcribe client
            self.transcribe_client = TranscribeStreamingClient(region=self.region)

            # Start stream transcription with speaker diarization and PII redaction enabled
            # Note: When content_redaction_type="PII" is set WITHOUT pii_entity_types,
            # all PII types are automatically redacted (per AWS documentation)
            self.stream = await self.transcribe_client.start_stream_transcription(
                language_code="en-US",
                media_sample_rate_hz=16000,
                media_encoding="pcm",
                show_speaker_label=True,  # Enable speaker diarization
                content_redaction_type="PII",  # Enable PII redaction for all types
            )

            # Create handler with the output stream
            self.handler = LiveAssistantTranscriptHandler(
                transcript_result_stream=self.stream.output_stream,
                output_callback=output_callback,
                session_id=self.session_id,
                parent_service=self,
            )

            self.is_active = True

            # Start processing audio from queue
            self.processing_task = asyncio.create_task(self._process_audio_queue())

            # Start handling transcription results
            asyncio.create_task(self._handle_transcription_output())

            # Start periodic summary generation
            self.last_summary_time = time.time()
            self.summary_task = asyncio.create_task(
                self._generate_summaries_periodically()
            )

            # Initialize tip generation (now event-driven)
            self.last_tip_time = None  # Will be set on first tip

            logger.info(
                f"Transcription started successfully for session: {self.session_id}"
            )
            logger.info(
                f"Summary generation will run every {self.summary_interval} seconds"
            )
            logger.info(
                f"Coaching tip generation enabled (event-driven, min {self.tip_interval}s between tips for frequent guidance)"
            )

            # Send session started event
            await output_callback(
                {
                    "event": {
                        "sessionStarted": {
                            "sessionId": self.session_id,
                            "timestamp": int(time.time() * 1000),
                        }
                    }
                }
            )

            # Send initial question progression event if interview questions loaded
            if self.interview_questions and self.session_type == "interviewerAssistant":
                await output_callback(
                    {
                        "event": {
                            "questionProgression": {
                                "questionId": "q1",  # 1-indexed to match database schema
                                "questionIndex": 0,
                                "status": "in_progress",
                                "timestamp": int(time.time() * 1000),
                                "totalQuestions": len(self.interview_questions),
                            }
                        }
                    }
                )
                logger.info(
                    f"[Session {self.session_id}] 📝 Sent initial question progression event (Q1 of {len(self.interview_questions)})"
                )
                # Question progression now uses event-driven approach (triggered after each transcript)
                # No background polling task needed

        except Exception as e:
            logger.error(f"Failed to start transcription: {e}")
            import traceback

            logger.error(traceback.format_exc())
            self.is_active = False
            raise

    async def _process_audio_queue(self):
        """
        Process audio chunks from the queue and send to Transcribe
        """
        try:
            logger.info(
                f"Starting audio queue processing for session: {self.session_id}"
            )

            while self.is_active:
                try:
                    # Get audio chunk from queue with timeout
                    audio_chunk = await asyncio.wait_for(
                        self.audio_queue.get(), timeout=0.5
                    )

                    if audio_chunk and self.stream:
                        # Send audio to Transcribe
                        await self.stream.input_stream.send_audio_event(
                            audio_chunk=audio_chunk
                        )

                        # Track metrics
                        self.audio_chunks_sent_to_transcribe += 1
                        self.audio_bytes_sent_to_transcribe += len(audio_chunk)

                        # Log if there's a large queue backlog
                        queue_size = self.audio_queue.qsize()
                        if queue_size > 100:
                            logger.warning(
                                f"[Session {self.session_id}] Audio queue backlog: {queue_size} chunks"
                            )

                except asyncio.TimeoutError:
                    # No audio received, check for stale session
                    if self.last_audio_received_time:
                        silence_duration = time.time() - self.last_audio_received_time
                        if silence_duration > 30:
                            logger.warning(
                                f"[Session {self.session_id}] No audio received for {silence_duration:.1f}s"
                            )
                    continue
                except Exception as e:
                    logger.error(f"Error processing audio chunk: {e}")

        except asyncio.CancelledError:
            logger.info(
                f"Audio processing task cancelled for session: {self.session_id}"
            )
        except Exception as e:
            logger.error(f"Error in audio queue processing: {e}")
        finally:
            logger.info(
                f"Audio queue processing stopped for session: {self.session_id}"
            )

    async def _handle_transcription_output(self):
        """
        Handle transcription output from Transcribe

        Automatically restarts transcription if it times out due to silence
        """
        max_retries = 3
        retry_count = 0

        while self.is_active and retry_count < max_retries:
            try:
                logger.info(
                    f"Starting transcription output handler for session: {self.session_id} (attempt {retry_count + 1}/{max_retries})"
                )

                # Let the handler process the events
                await self.handler.handle_events()

                # If we get here, transcription ended normally (not an error)
                break

            except asyncio.CancelledError:
                logger.info(
                    f"Transcription handler cancelled for session: {self.session_id}"
                )
                break
            except Exception as e:
                error_message = str(e)

                # Check if this is a timeout due to silence (15-second no audio timeout)
                if "timed out because no new audio was received" in error_message:
                    retry_count += 1
                    self.transcribe_stream_restarts += 1

                    # Log detailed metrics when stream times out
                    audio_age = (
                        time.time() - self.last_audio_received_time
                        if self.last_audio_received_time
                        else 0
                    )
                    transcript_age = (
                        time.time() - self.last_transcript_received_time
                        if self.last_transcript_received_time
                        else 0
                    )

                    logger.warning(
                        f"[Session {self.session_id}] Transcribe stream timeout (attempt {retry_count}/{max_retries}): "
                        f"audio_chunks_received={self.audio_chunks_received}, "
                        f"audio_sent_to_transcribe={self.audio_chunks_sent_to_transcribe}, "
                        f"transcripts_received={self.transcripts_received}, "
                        f"last_audio_age={audio_age:.1f}s, "
                        f"last_transcript_age={transcript_age:.1f}s, "
                        f"queue_size={self.audio_queue.qsize()}"
                    )

                    # Wait a moment before restarting
                    await asyncio.sleep(0.5)

                    # Restart the transcription stream
                    try:
                        # Close old stream
                        if self.stream:
                            try:
                                await self.stream.input_stream.close()
                            except Exception:
                                pass

                        # IMPORTANT: Recreate the Transcribe client to avoid hanging on timeout
                        # The old client is in a bad state after timeout and will hang on new stream creation
                        logger.info(
                            f"Recreating Transcribe client for session: {self.session_id}"
                        )
                        self.transcribe_client = TranscribeStreamingClient(
                            region=self.region
                        )

                        # Create new stream with fresh client
                        logger.info(
                            f"Creating new Transcribe stream for session: {self.session_id}"
                        )
                        self.stream = await self.transcribe_client.start_stream_transcription(
                            language_code="en-US",
                            media_sample_rate_hz=16000,
                            media_encoding="pcm",
                            show_speaker_label=True,  # Enable speaker diarization
                            content_redaction_type="PII",  # Enable PII redaction for all types
                        )

                        # Create new handler with the new output stream
                        self.handler = LiveAssistantTranscriptHandler(
                            transcript_result_stream=self.stream.output_stream,
                            output_callback=self.output_callback,
                            session_id=self.session_id,
                            parent_service=self,
                        )

                        logger.info(
                            f"Transcription stream restarted successfully for session: {self.session_id}"
                        )

                        # Continue the loop to start handling the new stream
                        continue

                    except Exception as restart_error:
                        logger.error(
                            f"Failed to restart transcription stream: {restart_error}"
                        )
                        import traceback

                        logger.error(traceback.format_exc())
                        break
                else:
                    # For other errors, log and exit
                    logger.error(f"Error handling transcription output: {e}")
                    import traceback

                    logger.error(traceback.format_exc())
                    break

        if retry_count >= max_retries:
            logger.error(
                f"Maximum transcription restart attempts ({max_retries}) reached for session: {self.session_id}"
            )

        logger.info(
            f"Transcription output handler stopped for session: {self.session_id}"
        )

    async def send_audio_chunk(self, audio_data: bytes):
        """
        Add audio chunk to processing queue

        Args:
            audio_data: PCM audio data (16-bit, 16kHz, mono)
        """
        if not self.is_active:
            logger.warning(f"Cannot send audio: session {self.session_id} not active")
            return

        try:
            # Track metrics
            self.audio_chunks_received += 1
            self.audio_bytes_received += len(audio_data)
            self.last_audio_received_time = time.time()

            # Add to queue for processing
            await self.audio_queue.put(audio_data)

            # Log metrics periodically to avoid spam
            if self.audio_chunks_received % self.metrics_log_interval == 0:
                logger.info(
                    f"[Session {self.session_id}] Audio metrics: "
                    f"received={self.audio_chunks_received} chunks "
                    f"({self.audio_bytes_received / 1024:.1f} KB), "
                    f"sent_to_transcribe={self.audio_chunks_sent_to_transcribe}, "
                    f"transcripts={self.transcripts_received}, "
                    f"queue_size={self.audio_queue.qsize()}"
                )

        except Exception as e:
            logger.error(f"Error queuing audio chunk: {e}")

    async def stop_transcription(self):
        """
        Stop transcription and cleanup resources
        """
        logger.info(f"Stopping transcription for session: {self.session_id}")

        self.is_active = False

        # Cancel processing task
        if self.processing_task and not self.processing_task.done():
            self.processing_task.cancel()
            try:
                await self.processing_task
            except asyncio.CancelledError:
                pass

        # Cancel summary task
        if self.summary_task and not self.summary_task.done():
            self.summary_task.cancel()
            try:
                await self.summary_task
            except asyncio.CancelledError:
                pass

        # Tip generation is now event-driven (no background task to cancel)

        # Cancel question progression task
        if self.question_progression_task and not self.question_progression_task.done():
            self.question_progression_task.cancel()
            try:
                await self.question_progression_task
            except asyncio.CancelledError:
                pass

        # Close the stream
        if self.stream:
            try:
                await self.stream.input_stream.end_stream()
                logger.info(f"Transcribe stream closed for session: {self.session_id}")
            except Exception as e:
                logger.error(f"Error closing Transcribe stream: {e}")

        # Clear the queue
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        logger.info(f"Transcription stopped for session: {self.session_id}")

    def get_transcript_history(self):
        """
        Get the full transcript history for this session

        Returns:
            List of transcript entries
        """
        if self.handler:
            return self.handler.transcript_buffer
        return []

    def get_transcript_since(self, since_timestamp: float) -> str:
        """
        Get transcript entries since a specific timestamp.

        Args:
            since_timestamp: Unix timestamp in seconds

        Returns:
            Formatted transcript text with speaker labels
        """
        if not self.handler:
            return ""

        transcript_entries = []
        for entry in self.handler.transcript_buffer:
            # entry['timestamp'] is in milliseconds
            entry_time = entry["timestamp"] / 1000.0
            if entry_time >= since_timestamp:
                # Clean up and format each transcript entry
                content = entry["content"].strip()
                if content:  # Only add non-empty entries
                    # Include speaker label for better LLM analysis
                    speaker = entry.get("speaker", "unknown")
                    # Format with speaker label for clarity
                    formatted = f"[Speaker {speaker}]: {content}"
                    transcript_entries.append(formatted)

        # Join with newlines for better readability of multi-speaker conversations
        result = "\n".join(transcript_entries)

        logger.debug(
            f"[Session {self.session_id}] get_transcript_since: {len(transcript_entries)} entries, {len(result)} chars"
        )

        return result

    def get_recent_transcript(self, minutes: int = 5) -> str:
        """
        Get transcript from the last N minutes.

        Args:
            minutes: Number of minutes to look back

        Returns:
            Formatted transcript text
        """
        cutoff_time = time.time() - (minutes * 60)
        return self.get_transcript_since(cutoff_time)

    async def _generate_summaries_periodically(self):
        """
        Background task that generates summaries every 5 minutes.
        """
        try:
            logger.info(f"[Session {self.session_id}] Summary generation task started")

            while self.is_active:
                try:
                    # Wait for 5 minutes
                    await asyncio.sleep(self.summary_interval)

                    if not self.is_active:
                        break

                    # Get transcript since last summary
                    new_transcript = self.get_transcript_since(self.last_summary_time)

                    if not new_transcript.strip():
                        logger.info(
                            f"[Session {self.session_id}] No new transcript for summary, skipping"
                        )
                        continue

                    logger.info(f"[Session {self.session_id}] Generating summary...")

                    # Import agent functions
                    from live_assistant_agent import generate_summary

                    # Generate summary
                    updated_summary = await generate_summary(
                        previous_summary=self.current_summary,
                        new_transcript=new_transcript,
                    )

                    # Update state
                    self.current_summary = updated_summary
                    self.last_summary_time = time.time()

                    logger.info(
                        f"[Session {self.session_id}] Summary updated successfully"
                    )
                    logger.debug(
                        f"[Session {self.session_id}] Summary: {updated_summary[:200]}..."
                    )

                except asyncio.CancelledError:
                    logger.info(
                        f"[Session {self.session_id}] Summary generation task cancelled"
                    )
                    break
                except Exception as e:
                    logger.error(
                        f"[Session {self.session_id}] Error generating summary: {e}"
                    )
                    import traceback

                    logger.error(traceback.format_exc())
                    # Continue despite errors

        except Exception as e:
            logger.error(f"[Session {self.session_id}] Summary task error: {e}")

    # Tip generation is now event-driven via _trigger_tip_generation_check()
    # Triggered after each final transcript in LiveAssistantTranscriptHandler
    # Old poll-based _generate_tips_periodically() method removed

    async def provide_coaching(self, user_request: str = None) -> str:
        """
        Provide AI coaching guidance for the candidate.

        Args:
            user_request: Optional user-specific request or question

        Returns:
            Coaching advice
        """
        try:
            logger.info(f"[Session {self.session_id}] Providing coaching...")

            # Get recent transcript (last 5 minutes)
            recent_transcript = self.get_recent_transcript(minutes=5)

            # Log transcript info
            logger.info(
                f"[Session {self.session_id}] Recent transcript: {len(recent_transcript)} chars"
            )
            logger.info(
                f"[Session {self.session_id}] Transcript preview: {recent_transcript[:200]}..."
            )

            if not recent_transcript.strip() and not self.current_summary:
                return "No conversation has been recorded yet. Please start the interview and try again."

            # Import agent function
            from live_assistant_agent import provide_coaching

            # Get coaching advice
            coaching_advice = await provide_coaching(
                summary=self.current_summary,
                recent_transcript=recent_transcript,
                interview_prep=self.interview_prep,
                user_request=user_request,
                session_type=self.session_type,
            )

            logger.info(f"[Session {self.session_id}] Coaching provided successfully")

            return coaching_advice

        except Exception as e:
            logger.error(f"[Session {self.session_id}] Error providing coaching: {e}")
            import traceback

            logger.error(traceback.format_exc())
            raise

    async def _trigger_question_progression_check(self):
        """
        Event-driven trigger for question progression analysis.
        Called after each final transcript is received.
        Includes intelligent throttling to prevent spam.

        This replaces the polling-based approach with a more responsive
        event-driven architecture that analyzes conversation as it happens.

        Throttling rules:
        - Minimum 12-second gap between AI analyses
        - Minimum 50 characters of transcript required
        - Only runs for interviewerAssistant sessions
        - Stops when all questions completed
        """
        try:
            # Skip if not interviewer session or no questions loaded
            if (
                self.session_type != "interviewerAssistant"
                or not self.interview_questions
            ):
                return

            # Skip if all questions completed
            if self.current_question_index >= len(self.interview_questions) - 1:
                last_q_id = f"q{self.current_question_index + 1}"
                if (
                    self.question_statuses.get(last_q_id, {}).get("status")
                    == "completed"
                ):
                    logger.debug(
                        f"[Session {self.session_id}] All questions completed, skipping progression check"
                    )
                    return

            import time

            current_time = time.time()

            # THROTTLE: Enforce minimum 12-second gap between analyses
            # This prevents excessive AI calls on rapid-fire transcripts
            if (
                self.last_question_check_time
                and (current_time - self.last_question_check_time) < 12
            ):
                time_since_last = current_time - self.last_question_check_time
                logger.debug(
                    f"[Session {self.session_id}] Throttling progression check "
                    f"(last check was {time_since_last:.1f}s ago, need 12s gap)"
                )
                return

            # Get recent transcript (last 3 minutes)
            recent_transcript = self.get_recent_transcript(minutes=3)

            # Require minimum transcript length (avoid analyzing empty/trivial content)
            if not recent_transcript or len(recent_transcript.strip()) < 50:
                logger.debug(
                    f"[Session {self.session_id}] Insufficient transcript for event-driven analysis "
                    f"({len(recent_transcript.strip()) if recent_transcript else 0} chars, need 50+)"
                )
                return

            logger.info(
                f"[Session {self.session_id}] 🔄 Event-driven progression check triggered "
                f"(transcript: {len(recent_transcript)} chars)"
            )

            # Perform AI analysis (existing method)
            await self._analyze_question_progression(recent_transcript)
            self.last_question_check_time = current_time

        except Exception as e:
            logger.error(
                f"[Session {self.session_id}] Error in event-driven progression check: {e}"
            )
            import traceback

            logger.error(traceback.format_exc())

    async def _analyze_question_progression(self, recent_transcript: str):
        """
        Use LLM to analyze conversation and detect if the interviewer has moved to the next question.

        Args:
            recent_transcript: Recent conversation transcript text
        """
        try:
            # Get current and next question info
            current_q = self.interview_questions[self.current_question_index]
            current_question_text = current_q["questionText"]
            current_question_category = current_q.get("category", "General")

            # Check if there's a next question
            if self.current_question_index >= len(self.interview_questions) - 1:
                # This is the last question - check if it's been answered/completed
                next_question_text = None
                next_question_category = None
            else:
                next_q = self.interview_questions[self.current_question_index + 1]
                next_question_text = next_q["questionText"]
                next_question_category = next_q.get("category", "General")

            logger.info(
                f"[Session {self.session_id}] Analyzing progression: Q{self.current_question_index + 1} ({current_question_category}) -> Q{self.current_question_index + 2 if next_question_text else 'LAST'} ({next_question_category if next_question_category else 'N/A'})"
            )

            # Import bedrock agent function
            from live_assistant_agent import analyze_question_progression

            # Call AI analysis with enhanced context
            result = await analyze_question_progression(
                recent_transcript=recent_transcript,
                current_question=current_question_text,
                next_question=next_question_text,
                current_question_category=current_question_category,
                next_question_category=next_question_category,
            )

            logger.info(f"[Session {self.session_id}] AI Analysis Result: {result}")

            # Log detailed decision criteria
            completed = result.get("current_question_completed", False)
            next_started = result.get("next_question_started", False)
            confidence = result.get("confidence", 0.0)
            reasoning = result.get("reasoning", "No reasoning provided")

            logger.info(
                f"[Session {self.session_id}] Decision Factors: completed={completed}, next_started={next_started}, confidence={confidence:.2f}, threshold=0.65"
            )
            logger.info(f"[Session {self.session_id}] AI Reasoning: {reasoning}")

            # Check if we should advance
            # LOGIC: If next question has started, previous question is automatically complete
            # Confidence threshold: 0.65 (lowered from 0.8 to reduce false negatives)
            if confidence >= 0.65:
                if next_question_text and next_started:
                    # Next question detected - advance (previous question is implicitly complete)
                    logger.info(
                        f"[Session {self.session_id}] ✅ Next question detected (confidence={confidence:.2f})"
                    )
                    logger.info(
                        f"[Session {self.session_id}] 🎯 Advancing to next question (Q{self.current_question_index + 2})"
                    )
                    await self._advance_to_next_question(
                        confidence=confidence, reasoning=reasoning
                    )
                elif not next_question_text and completed:
                    # Last question - only check if candidate completed their answer
                    logger.info(
                        f"[Session {self.session_id}] ✅ Last question completed (confidence={confidence:.2f})"
                    )
                    logger.info(
                        f"[Session {self.session_id}] 🏁 Marking last question as completed"
                    )
                    await self._mark_current_question_completed(reasoning=reasoning)
                elif next_question_text and not next_started:
                    logger.info(
                        f"[Session {self.session_id}] ⏸️  Next question not detected yet (confidence={confidence:.2f})"
                    )
            else:
                logger.info(
                    f"[Session {self.session_id}] ⏸️  Confidence too low: {confidence:.2f} (need >=0.65)"
                )

        except Exception as e:
            logger.error(
                f"[Session {self.session_id}] Error analyzing question progression: {e}"
            )
            import traceback

            logger.error(traceback.format_exc())

    async def _advance_to_next_question(self, confidence: float, reasoning: str):
        """
        Advance to the next question in the interview plan.
        Marks current question as completed and next question as in_progress.

        Args:
            confidence: AI confidence score (0.0-1.0)
            reasoning: Explanation from AI
        """
        try:
            import time

            timestamp = int(time.time() * 1000)

            # Mark current question as completed (1-indexed: current_question_index=0 → q1)
            current_question_id = f"q{self.current_question_index + 1}"
            self.question_statuses[current_question_id] = {
                "status": "completed",
                "startTime": self.question_statuses[current_question_id].get(
                    "startTime"
                ),
                "endTime": timestamp,
            }

            # Increment to next question
            self.current_question_index += 1

            # Mark next question as in_progress (1-indexed: current_question_index=1 → q2)
            next_question_id = f"q{self.current_question_index + 1}"
            self.question_statuses[next_question_id] = {
                "status": "in_progress",
                "startTime": timestamp,
                "endTime": None,
            }

            logger.info(
                f"[Session {self.session_id}] 📝 Advanced to Q{self.current_question_index + 1} (confidence: {confidence:.2f})"
            )
            logger.info(f"[Session {self.session_id}] Reasoning: {reasoning}")
            logger.info(
                f"[Session {self.session_id}] Question statuses updated: {current_question_id}=completed, {next_question_id}=in_progress"
            )

            # EVENT 1: Send completion event for previous question
            completion_event = {
                "event": {
                    "questionProgression": {
                        "questionId": current_question_id,
                        "questionIndex": self.current_question_index - 1,
                        "status": "completed",
                        "timestamp": timestamp,
                        "totalQuestions": len(self.interview_questions),
                    }
                }
            }

            logger.info(
                f"[Session {self.session_id}] 📤 Sending completion event for {current_question_id}: {completion_event}"
            )

            await self.output_callback(completion_event)

            logger.info(
                f"[Session {self.session_id}] ✅ Successfully sent question completion event to frontend"
            )

            # EVENT 2: Send in_progress event for next question
            progression_event = {
                "event": {
                    "questionProgression": {
                        "questionId": next_question_id,
                        "questionIndex": self.current_question_index,
                        "status": "in_progress",
                        "timestamp": timestamp,
                        "totalQuestions": len(self.interview_questions),
                    }
                }
            }

            logger.info(
                f"[Session {self.session_id}] 📤 Sending progression event for {next_question_id}: {progression_event}"
            )

            await self.output_callback(progression_event)

            logger.info(
                f"[Session {self.session_id}] ✅ Successfully sent question progression event to frontend"
            )

        except Exception as e:
            logger.error(f"[Session {self.session_id}] Error advancing question: {e}")
            import traceback

            logger.error(traceback.format_exc())

    async def _mark_current_question_completed(self, reasoning: str):
        """
        Mark the current (last) question as completed without advancing.

        Args:
            reasoning: Explanation from AI
        """
        try:
            import time

            timestamp = int(time.time() * 1000)

            # Mark current question as completed (1-indexed)
            current_question_id = f"q{self.current_question_index + 1}"
            self.question_statuses[current_question_id] = {
                "status": "completed",
                "startTime": self.question_statuses[current_question_id].get(
                    "startTime"
                ),
                "endTime": timestamp,
            }

            logger.info(
                f"[Session {self.session_id}] 📝 Marked Q{self.current_question_index + 1} as completed (last question)"
            )
            logger.info(f"[Session {self.session_id}] Reasoning: {reasoning}")

            # Send progression event to frontend
            await self.output_callback(
                {
                    "event": {
                        "questionProgression": {
                            "questionId": current_question_id,
                            "questionIndex": self.current_question_index,
                            "status": "completed",
                            "timestamp": timestamp,
                            "totalQuestions": len(self.interview_questions),
                        }
                    }
                }
            )

            logger.info(
                f"[Session {self.session_id}] ✅ Sent final question completion event to frontend"
            )

        except Exception as e:
            logger.error(
                f"[Session {self.session_id}] Error marking question complete: {e}"
            )
            import traceback

            logger.error(traceback.format_exc())

    async def _trigger_tip_generation_check(self):
        """
        Event-driven trigger for coaching tip generation.
        Called after each final transcript is received.
        Includes intelligent throttling to prevent spam.

        This replaces the polling-based approach with a more responsive
        event-driven architecture that generates tips as conversation happens.

        For interviewer sessions, includes question timing and progression guidance.

        Throttling rules:
        - Minimum 60-second gap between tip generations (increased frequency for timely guidance)
        - Minimum 100 characters of transcript required (more than progression check)
        - Runs for both candidateAssistant and interviewerAssistant sessions
        - Continues generating tips throughout session (no completion limit)
        """
        try:
            import time

            current_time = time.time()

            # THROTTLE #1: Enforce minimum 60-second gap between tips
            # This provides more frequent guidance for real-time decision making
            if (
                self.last_tip_time
                and (current_time - self.last_tip_time) < self.tip_interval
            ):
                time_since_last = current_time - self.last_tip_time
                logger.debug(
                    f"[Session {self.session_id}] Throttling tip generation "
                    f"(last tip was {time_since_last:.1f}s ago, need {self.tip_interval}s gap)"
                )
                return

            # Get recent transcript (last 3 minutes - same as old approach)
            recent_transcript = self.get_recent_transcript(minutes=3)

            # THROTTLE #2: Require minimum transcript length
            # Use 100 chars (more than progression's 50) since tips need more context
            if not recent_transcript or len(recent_transcript.strip()) < 100:
                logger.debug(
                    f"[Session {self.session_id}] Insufficient transcript for tip generation "
                    f"({len(recent_transcript.strip()) if recent_transcript else 0} chars, need 100+)"
                )
                return

            logger.info(
                f"[Session {self.session_id}] 💡 Event-driven tip generation triggered "
                f"(transcript: {len(recent_transcript)} chars)"
            )

            # Increment tip counter
            self.tip_counter += 1

            # Prepare current question info for interviewer sessions
            current_question_info = None
            if (
                self.session_type == "interviewerAssistant"
                and self.interview_questions
                and self.current_question_index < len(self.interview_questions)
            ):
                current_q = self.interview_questions[self.current_question_index]
                question_id = f"q{self.current_question_index + 1}"
                question_status = self.question_statuses.get(question_id, {})

                # Calculate time spent on current question
                start_time = question_status.get("startTime")
                time_spent_minutes = 0.0
                if start_time:
                    # startTime is in milliseconds
                    time_spent_seconds = (current_time * 1000 - start_time) / 1000
                    time_spent_minutes = time_spent_seconds / 60

                current_question_info = {
                    "questionText": current_q.get("questionText", ""),
                    "category": current_q.get("category", ""),
                    "estimatedTime": current_q.get("estimatedTime", ""),
                    "timeSpentMinutes": time_spent_minutes,
                    "evaluationChecklist": current_q.get("evaluationChecklist", ""),
                    "questionIndex": self.current_question_index,
                    "totalQuestions": len(self.interview_questions),
                }

                logger.info(
                    f"[Session {self.session_id}] Including question context: Q{self.current_question_index + 1}, "
                    f"Time spent: {time_spent_minutes:.1f} min, Estimated: {current_q.get('estimatedTime', 'N/A')}"
                )

            # Generate tip with enhanced context
            from live_assistant_agent import generate_coaching_tip

            tip = await generate_coaching_tip(
                recent_transcript=recent_transcript,
                interview_prep=self.interview_prep,
                session_type=self.session_type,
                summary=self.current_summary,
                current_question_info=current_question_info,
            )

            # Update state
            self.last_tip_time = current_time

            # Send tip to frontend based on session type
            event_name = (
                "interviewerTip"
                if self.session_type == "interviewerAssistant"
                else "candidateTip"
            )

            await self.output_callback(
                {
                    "event": {
                        event_name: {
                            "tip": tip,
                            "timestamp": int(self.last_tip_time * 1000),
                            "questionNumber": self.tip_counter,
                        }
                    }
                }
            )

            logger.info(
                f"[Session {self.session_id}] ✅ Tip #{self.tip_counter} sent successfully"
            )
            logger.debug(f"[Session {self.session_id}] Tip: {tip[:100]}...")

        except Exception as e:
            logger.error(
                f"[Session {self.session_id}] Error in event-driven tip generation: {e}"
            )
            import traceback

            logger.error(traceback.format_exc())
