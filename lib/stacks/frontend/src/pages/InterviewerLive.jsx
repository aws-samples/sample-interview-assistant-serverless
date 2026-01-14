import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Alert,
  StatusIndicator,
  Select,
  Spinner,
  Modal,
  ExpandableSection,
  Flashbar,
  Input,
  FormField,
  Textarea,
  Checkbox,
  ProgressBar,
  Badge,
} from "@cloudscape-design/components";
import { interviewerAPI } from "../services/api";

/**
 * Render basic markdown formatting (bold, bullets, numbered lists)
 * @param {string} text - Text with markdown formatting
 * @returns {JSX.Element} - Rendered content with formatting
 */
const renderMarkdown = (text) => {
  if (!text) return null;

  // Split by lines
  const lines = text.split("\n");
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      elements.push(<br key={`br-${key++}`} />);
      continue;
    }

    // Handle bold text (**text** or __text__)
    const boldRegex = /(\*\*|__)(.*?)\1/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = boldRegex.exec(line)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }
      // Add bold text
      parts.push(<strong key={`bold-${key++}`}>{match[2]}</strong>);
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < line.length) {
      parts.push(line.substring(lastIndex));
    }

    // Wrap in appropriate element
    if (line.trim().match(/^[-*•]\s+/)) {
      // Bullet point
      const content = parts.length > 0 ? parts : line.replace(/^[-*•]\s+/, "");
      elements.push(
        <li key={`li-${key++}`} style={{ marginLeft: "20px" }}>
          {content}
        </li>,
      );
    } else if (line.trim().match(/^\d+[.)]\s+/)) {
      // Numbered list item
      const content =
        parts.length > 0 ? parts : line.replace(/^\d+[.)]\s+/, "");
      elements.push(
        <li
          key={`li-${key++}`}
          style={{ marginLeft: "20px", listStyleType: "decimal" }}
        >
          {content}
        </li>,
      );
    } else {
      // Regular paragraph
      elements.push(
        <div key={`p-${key++}`} style={{ marginBottom: "8px" }}>
          {parts.length > 0 ? parts : line}
        </div>,
      );
    }
  }

  return <div>{elements}</div>;
};

/**
 * Get speaker-specific styling for transcription bubbles
 * Alternates colors to differentiate speakers
 */
const getSpeakerStyle = (speaker) => {
  // Extract speaker number if format is "spk_0", "spk_1", etc.
  const speakerNum = speaker ? parseInt(speaker.replace("spk_", "")) : 0;

  // Alternate between blue (even) and white (odd) backgrounds
  const isBlue = speakerNum % 2 === 0;

  return {
    backgroundColor: isBlue ? "#0073bb" : "#ffffff",
    color: isBlue ? "#ffffff" : "#000716",
    border: isBlue ? "none" : "1px solid #d5dbdb",
    textAlign: "left",
  };
};

function InterviewerLive({ user }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const interviewIdParam = searchParams.get("interviewId");

  // Interview Plan Selection
  const [scheduledInterviews, setScheduledInterviews] = useState([]);
  const [selectedInterview, setSelectedInterview] = useState(null);
  const [loadingInterviews, setLoadingInterviews] = useState(true);
  const [currentInterviewName, setCurrentInterviewName] = useState(""); // Generated interview name

  // Question Progression Tracking
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [questionStatuses, setQuestionStatuses] = useState({});

  // WebSocket and Session
  const [sessionId] = useState(
    () =>
      `interviewer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  );
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState(null);
  const [saveVideoRecording, setSaveVideoRecording] = useState(false);
  const [flashMessages, setFlashMessages] = useState([]);

  // Save Modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSummary, setSavedSummary] = useState(null);

  // AI Coaching
  const [coachingRequest, setCoachingRequest] = useState("");
  const [coachingResponse, setCoachingResponse] = useState(null);
  const [isCoachingLoading, setIsCoachingLoading] = useState(false);
  const [showCoachingSection, setShowCoachingSection] = useState(false);

  // Automatic Coaching Tips
  const [coachingTips, setCoachingTips] = useState([]);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const tipCountRef = useRef(0);

  // Refs
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const systemStreamRef = useRef(null);
  const micStreamRef = useRef(null);
  const startTimeRef = useRef(null);
  const transcriptContainerRef = useRef(null);
  const videoTrackRef = useRef(null);
  const videoCapture = useRef(null);

  // PATH B: MediaRecorder for full-resolution video recording
  const mediaRecorderRef = useRef(null);
  const uploadIdRef = useRef(null);
  const partNumberRef = useRef(1);
  const uploadedPartsRef = useRef([]);
  const videoLocationRef = useRef(null); // Store S3 location for passing to save endpoint
  // Chunk buffering for S3 5MB minimum (safety mechanism for VBR compression)
  const pendingChunksRef = useRef([]);
  const pendingSizeRef = useRef(0);
  const uploadInProgressRef = useRef(null); // Track in-progress upload promise to prevent race conditions
  const MIN_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB minimum for S3 multipart parts

  // Load scheduled interviews
  useEffect(() => {
    loadScheduledInterviews();
  }, []);

  // Set selected interview from URL param
  useEffect(() => {
    if (interviewIdParam && scheduledInterviews.length > 0) {
      const interview = scheduledInterviews.find(
        (i) => i.value === interviewIdParam,
      );
      if (interview) {
        setSelectedInterview(interview);
      }
    }
  }, [interviewIdParam, scheduledInterviews]);

  // Timer
  useEffect(() => {
    let interval;
    if (isListening) {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isListening]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop =
        transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);

  const loadScheduledInterviews = async () => {
    try {
      setLoadingInterviews(true);
      const response = await interviewerAPI.listScheduledInterviews();

      // Axios returns response.data with the actual data
      const data = response.data;
      const interviews = data.interviews || [];

      // Convert to select options
      const options = interviews.map((interview) => {
        // Use interview name directly
        const interviewName = interview.interviewName || "Untitled Interview";

        // Format the timestamp
        const timestamp =
          interview.timestamp || interview.scheduled_date || interview.date;
        let formattedDate = "No date";
        if (timestamp) {
          try {
            const date = new Date(timestamp);
            formattedDate = date.toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          } catch (e) {
            console.warn("Failed to parse timestamp:", timestamp);
          }
        }

        return {
          label: `${interviewName} (${formattedDate})`,
          value: interview.id,
          interview: interview,
        };
      });

      setScheduledInterviews(options);
    } catch (err) {
      console.error("Failed to load scheduled interviews:", err);
      setError("Failed to load scheduled interviews");
    } finally {
      setLoadingInterviews(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDuration = () => {
    const hours = Math.floor(elapsedTime / 3600);
    const mins = Math.floor((elapsedTime % 3600) / 60);
    const secs = elapsedTime % 60;
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const startListening = async () => {
    try {
      setError(null);

      // Generate interview name based on selection
      let interviewName;
      if (selectedInterview && selectedInterview.interview) {
        // Use the interview name from the selected scheduled interview
        interviewName =
          selectedInterview.interview.interviewName || "Untitled Interview";
      } else {
        // Generate a default name for interviews without pre-planned questions
        const now = new Date();
        const dateStr = now.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const timeStr = now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        });
        interviewName = `Interviewer Session - ${dateStr}, ${timeStr}`;
      }

      // Store the generated interview name for display
      setCurrentInterviewName(interviewName);

      // Step 1: Request system audio capture (for candidate's voice in video call)
      const sysStream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Required to show selection UI
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Check if system audio track exists
      const systemAudioTrack = sysStream.getAudioTracks()[0];
      if (!systemAudioTrack) {
        // Stop video tracks before throwing error
        sysStream.getVideoTracks().forEach((track) => track.stop());
        throw new Error(
          'No system audio. Please check "Share system audio" checkbox.',
        );
      }

      console.log("✅ System audio captured:", systemAudioTrack.label);

      // Create a new stream with only the audio track
      const audioOnlyStream = new MediaStream([systemAudioTrack]);
      systemStreamRef.current = audioOnlyStream;

      // Keep video track alive for frame capture (don't stop it)
      const videoTrack = sysStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrackRef.current = videoTrack;
        console.log(
          "✅ Video track captured for frame capture:",
          videoTrack.label,
        );
      }

      // Step 2: Request microphone access (for interviewer's questions)
      let micStream = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        micStreamRef.current = micStream;
        console.log("✅ Microphone captured");
      } catch (micError) {
        console.warn(
          "⚠️ Microphone access denied, continuing with system audio only:",
          micError,
        );
        // Continue without mic - not a fatal error
      }

      // Step 3: Mix both audio sources
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      // Create sources
      const systemSource =
        audioContext.createMediaStreamSource(audioOnlyStream);

      // Create destination for mixing
      const destination = audioContext.createMediaStreamDestination();

      // Connect system audio
      systemSource.connect(destination);

      // Connect microphone if available
      if (micStream) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(destination);
        console.log("✅ Audio mixed: System + Microphone");
      } else {
        console.log("✅ Audio source: System only");
      }

      const mixedStream = destination.stream;
      const source = audioContext.createMediaStreamSource(mixedStream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      // Get userId from authenticated user, or use default for NO_AUTH mode
      // IMPORTANT: Prioritize email over username to ensure DynamoDB queries match stored data
      let userId = user?.email || user?.username || user?.sub;
      if (!userId) {
        // Fallback for NO_AUTH development mode
        userId = "local-dev-user@example.com";
        console.log(
          "[InterviewerLive] Using dev userId (NO_AUTH mode):",
          userId,
        );
      } else {
        console.log(
          "[InterviewerLive] Connected with authenticated userId:",
          userId,
        );
      }

      // Step 1: Request pre-signed WebSocket URL
      const API_BASE_URL =
        process.env.REACT_APP_API_URL || "http://localhost:8000";
      const token = localStorage.getItem("authToken") || "";

      console.log("[InterviewerLive] Requesting pre-signed WebSocket URL...");
      const response = await fetch(`${API_BASE_URL}/api/get-ws-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          user_id: userId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Failed to get WebSocket URL: ${response.statusText} - ${error}`,
        );
      }

      const { wsUrl } = await response.json();
      console.log("[InterviewerLive] Received pre-signed WebSocket URL");

      // Step 2: Connect to pre-signed URL
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        console.log("[InterviewerLive] WebSocket connected via pre-signed URL");
        setIsConnected(true);
        setIsListening(true);
        startTimeRef.current = Date.now();

        // Initialize question progression tracking if interview plan exists
        if (selectedInterview?.interview?.interviewPlan?.questions) {
          const questions = selectedInterview.interview.interviewPlan.questions;
          const initialStatuses = {};

          // Initialize all questions as "not_started" using questionId from backend
          questions.forEach((q) => {
            const questionId = q.questionId; // Use questionId from backend
            initialStatuses[questionId] = {
              status: "not_started",
              startTime: null,
              endTime: null,
              timestamp: null,
            };
          });

          // Mark first question as "in_progress"
          if (questions.length > 0 && questions[0].questionId) {
            const firstQuestionId = questions[0].questionId; // Use questionId from backend
            initialStatuses[firstQuestionId] = {
              status: "in_progress",
              startTime: Date.now(),
              endTime: null,
              timestamp: Date.now(),
            };
            setCurrentQuestionIndex(0);
          }

          setQuestionStatuses(initialStatuses);
          console.log(
            "[InterviewerLive] Initialized question progression tracking:",
            initialStatuses,
          );
        }

        // Step 3: Send initialization message IMMEDIATELY (don't wait for video setup)
        const initMessage = {
          type: "init",
          sessionType: "interviewerAssistant",
          userId: userId,
          interviewId: selectedInterview?.value || null,
        };

        console.log(
          "[InterviewerLive] Sending initialization message:",
          initMessage,
        );
        ws.send(JSON.stringify(initMessage));
        console.log("[InterviewerLive] Initialization message sent");

        // Setup video capture in background (don't block init message)
        if (videoTrackRef.current) {
          setupVideoCapture(videoTrackRef.current).catch((err) => {
            console.error(
              "[InterviewerLive] Video capture setup failed (non-fatal):",
              err,
            );
          });

          // Setup MediaRecorder for full-resolution recording (PATH B)
          setupMediaRecorder(videoTrackRef.current, mixedStream).catch(
            (err) => {
              console.error(
                "[InterviewerLive] MediaRecorder setup failed (non-fatal):",
                err,
              );
            },
          );
        }

        // Setup audio processing
        let audioChunkCount = 0;

        processor.onaudioprocess = (e) => {
          // Only check WebSocket state (not isListening due to closure/async issues)
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            return;
          }

          const audioData = e.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(audioData.length);

          for (let i = 0; i < audioData.length; i++) {
            const s = Math.max(-1, Math.min(1, audioData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          // Convert to base64
          const bytes = new Uint8Array(pcmData.buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64Audio = btoa(binary);

          // Send audio chunk
          try {
            wsRef.current.send(
              JSON.stringify({
                event: {
                  audioInput: {
                    content: base64Audio,
                  },
                },
              }),
            );

            // Log only first few chunks to avoid spam
            audioChunkCount++;
            if (audioChunkCount <= 3) {
              console.log(
                `📤 Sent audio chunk #${audioChunkCount} (${bytes.length} bytes)`,
              );
            } else if (audioChunkCount === 4) {
              console.log("📤 Continuing to send audio chunks...");
            }
          } catch (error) {
            console.error("Failed to send audio:", error);
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (!message.event) return;

          const eventType = Object.keys(message.event)[0];
          const eventData = message.event[eventType];

          switch (eventType) {
            case "transcription":
              const transcript = eventData.content;
              if (transcript && transcript.trim()) {
                if (eventData.isPartial) {
                  // Update partial transcript (real-time preview)
                  setTranscript((prev) => {
                    const lastItem = prev[prev.length - 1];
                    if (lastItem && lastItem.isPartial) {
                      // Replace last partial
                      return [
                        ...prev.slice(0, -1),
                        {
                          text: transcript,
                          timestamp: new Date(
                            eventData.timestamp,
                          ).toISOString(),
                          isPartial: true,
                          speaker: eventData.speaker || null,
                        },
                      ];
                    }
                    // Add new partial
                    return [
                      ...prev,
                      {
                        text: transcript,
                        timestamp: new Date(eventData.timestamp).toISOString(),
                        isPartial: true,
                        speaker: eventData.speaker || null,
                      },
                    ];
                  });
                } else {
                  // Final transcript - consolidate if same speaker, otherwise add new
                  setTranscript((prev) => {
                    const lastItem = prev[prev.length - 1];
                    const currentSpeaker = eventData.speaker || null;

                    if (lastItem && lastItem.isPartial) {
                      // Replace last partial with final
                      return [
                        ...prev.slice(0, -1),
                        {
                          text: transcript,
                          timestamp: new Date(
                            eventData.timestamp,
                          ).toISOString(),
                          isPartial: false,
                          speaker: currentSpeaker,
                        },
                      ];
                    }

                    // Check if last message is from the same speaker (consolidate)
                    if (
                      lastItem &&
                      !lastItem.isPartial &&
                      lastItem.speaker === currentSpeaker
                    ) {
                      // Check if this is new content or duplicate
                      const isNewContent =
                        transcript.trim() &&
                        !lastItem.text.includes(transcript.trim());

                      if (isNewContent) {
                        // Append to existing speaker's transcript
                        const updated = [...prev];
                        updated[updated.length - 1] = {
                          ...lastItem,
                          text: lastItem.text + " " + transcript.trim(),
                          timestamp: new Date(
                            eventData.timestamp,
                          ).toISOString(),
                        };
                        return updated;
                      }
                      // Duplicate content, just update timestamp
                      return prev;
                    }

                    // New speaker or first transcript
                    return [
                      ...prev,
                      {
                        text: transcript,
                        timestamp: new Date(eventData.timestamp).toISOString(),
                        isPartial: false,
                        speaker: currentSpeaker,
                      },
                    ];
                  });
                }
              }
              break;

            case "sessionStarted":
              console.log("✅ Transcription session started");
              break;

            case "preparationReceived":
              console.log(
                "✅ Interview preparation info acknowledged by server",
              );
              break;

            case "coachingResponse":
              console.log("✅ Coaching response received");
              setCoachingResponse(eventData.advice);
              setIsCoachingLoading(false);
              setShowCoachingSection(true);
              break;

            case "coachingError":
              console.error("❌ Coaching error:", eventData.error);
              setError("Failed to get coaching: " + eventData.error);
              setIsCoachingLoading(false);
              break;

            case "candidateTip":
            case "interviewerTip":
              console.log(
                "[InterviewerLive] Received coaching tip:",
                eventData,
              );

              // Increment tip counter
              tipCountRef.current += 1;

              // Add tip to the coaching tips array
              setCoachingTips((prev) => {
                const newTips = [
                  ...prev,
                  {
                    tip: eventData.tip,
                    timestamp: eventData.timestamp || new Date().toISOString(),
                    questionNumber: eventData.questionNumber,
                  },
                ];

                // Auto-navigate to the latest tip
                setCurrentTipIndex(newTips.length - 1);

                return newTips;
              });
              break;

            case "requestFrame":
              // Pull-based frame architecture: Agent requests frame on-demand
              console.log(
                "[InterviewerLive] Frame requested by Agent:",
                eventData,
              );
              handleFrameRequest(eventData).catch((err) => {
                console.error("❌ Frame request handler failed:", err);
              });
              break;

            case "questionProgression":
              console.log(
                "[InterviewerLive] 📥 Question progression update received:",
                eventData,
              );

              const {
                questionId,
                questionIndex,
                status,
                timestamp,
                totalQuestions,
              } = eventData;

              console.log(
                `[InterviewerLive] 📊 Progression details: questionId=${questionId}, questionIndex=${questionIndex}, status=${status}, totalQuestions=${totalQuestions}`,
              );
              console.log(
                `[InterviewerLive] 🕒 Previous currentQuestionIndex: ${currentQuestionIndex}`,
              );

              // Update current question index (only for in_progress events, not completed)
              if (status === "in_progress") {
                setCurrentQuestionIndex(questionIndex);
                console.log(
                  `[InterviewerLive] ✅ Updated currentQuestionIndex to: ${questionIndex}`,
                );
              }

              // Update question status
              setQuestionStatuses((prev) => {
                // Preserve existing data (especially startTime for completed questions)
                const existingStatus = prev[questionId] || {};

                const newStatus = {
                  ...existingStatus, // Preserve existing fields (startTime, etc.)
                  status: status,
                  timestamp: timestamp,
                  ...(status === "in_progress" && { startTime: timestamp }),
                  ...(status === "completed" && { endTime: timestamp }),
                };

                console.log(
                  `[InterviewerLive] 📝 Updating question status for ${questionId}:`,
                  newStatus,
                );

                const updated = {
                  ...prev,
                  [questionId]: newStatus,
                };
                console.log(
                  `[InterviewerLive] 💾 New questionStatuses state:`,
                  updated,
                );
                return updated;
              });

              console.log(
                "[InterviewerLive] ✅ Question progression state updated successfully",
              );
              break;

            default:
              console.log("Unhandled event type:", eventType);
          }
        } catch (err) {
          console.error("Error processing WebSocket message:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setError("Connection error occurred");
      };

      ws.onclose = (event) => {
        console.log(
          `WebSocket closed - Code: ${event.code}, Reason: ${event.reason || "No reason provided"}, Clean: ${event.wasClean}`,
        );
        setIsConnected(false);
        // Cleanup is handled by stopListening()
      };
    } catch (err) {
      console.error("Error starting listening mode:", err);
      if (err.name === "NotAllowedError") {
        setError(
          'Permission denied. Please allow screen sharing and check "Share system audio".',
        );
      } else if (err.message.includes("No system audio")) {
        setError(err.message);
      } else {
        setError("Failed to start listening mode. Please try again.");
      }
    }
  };

  const setupVideoCapture = async (videoTrack) => {
    try {
      // 1. Create hidden video element
      const video = document.createElement("video");
      video.srcObject = new MediaStream([videoTrack]);
      video.autoplay = true; // MediaStreams auto-play, no need for explicit .play()
      video.muted = true;

      const canvas = document.createElement("canvas");

      // 2. Wait for metadata (essential for canvas sizing)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Video metadata timeout")),
          10000,
        );
        video.addEventListener(
          "loadedmetadata",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });

      console.log(
        "✅ Video metadata loaded, dimensions:",
        video.videoWidth,
        "x",
        video.videoHeight,
      );

      // 2.5. Explicitly start video playback (non-blocking)
      // Screen share MediaStreams don't reliably auto-play even with autoplay=true
      video
        .play()
        .then(() => {
          console.log("✅ Video playback started successfully");
        })
        .catch((err) => {
          console.warn("⚠️ Video play() failed, but continuing:", err.message);
          // Non-fatal - continue anyway
        });

      // 3. Monitor video track state
      videoTrack.addEventListener("ended", () => {
        console.warn("⚠️ Video track ended");
        stopVideoCapture();
      });

      // 4. Store refs for pull-based frame capture
      // Pull-based architecture: Agent requests frames on-demand via requestFrame event
      // No continuous interval needed - handleFrameRequest() captures frames when requested
      videoCapture.current = { video, canvas };

      console.log("✅ Video element ready for pull-based frame capture");
    } catch (error) {
      console.error("❌ Video capture failed:", error);
      setError("Video capture failed. Audio will continue working.");
      // Graceful degradation - don't throw
    }
  };

  const stopVideoCapture = () => {
    if (videoCapture.current) {
      const { video } = videoCapture.current;

      if (video) {
        video.srcObject = null;
        video.remove();
      }

      videoCapture.current = null;
    }

    if (videoTrackRef.current) {
      videoTrackRef.current.stop();
      videoTrackRef.current = null;
    }
  };

  // Pull-based frame architecture: Handle Agent's frame request
  const handleFrameRequest = async (requestData) => {
    if (!videoCapture.current) {
      console.warn("⚠️ Frame requested but video capture not initialized");
      return;
    }

    const { video } = videoCapture.current;

    if (!video || video.readyState < 2) {
      console.warn("⚠️ Frame requested but video not ready");
      return;
    }

    try {
      // 1. Create canvas for full-resolution capture
      const canvas = document.createElement("canvas");

      // Use actual video dimensions (up to 1920×1080)
      const maxWidth = 1920;
      const maxHeight = 1080;
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      // Scale down if larger than max dimensions while preserving aspect ratio
      const scale = Math.min(1, maxWidth / videoWidth, maxHeight / videoHeight);
      canvas.width = Math.round(videoWidth * scale);
      canvas.height = Math.round(videoHeight * scale);

      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 2. Convert to JPEG blob (quality 0.9 for analysis)
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            console.error("❌ Failed to create JPEG blob");
            return;
          }

          try {
            const filename = `frame_${Date.now()}.jpg`;
            const frameSizeKB = (blob.size / 1024).toFixed(2);
            console.log(
              `📸 Captured frame: ${canvas.width}×${canvas.height}, ${frameSizeKB}KB`,
            );

            // 3. Get presigned URL from backend
            const API_BASE_URL =
              process.env.REACT_APP_API_URL || "http://localhost:8000";
            const token = localStorage.getItem("authToken") || "";

            const urlResponse = await fetch(
              `${API_BASE_URL}/api/interviewer/video/get-frame-upload-url`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionId,
                  filename: filename,
                  contentType: "image/jpeg",
                }),
              },
            );

            if (!urlResponse.ok) {
              throw new Error(
                `Failed to get presigned URL: ${urlResponse.status}`,
              );
            }

            const { presignedUrl, s3Key, s3Bucket } = await urlResponse.json();

            // 4. Upload to S3 (non-blocking, async)
            const uploadResponse = await fetch(presignedUrl, {
              method: "PUT",
              headers: {
                "Content-Type": "image/jpeg",
              },
              body: blob,
            });

            if (!uploadResponse.ok) {
              throw new Error(`S3 upload failed: ${uploadResponse.status}`);
            }

            console.log(`✅ Frame uploaded to S3: ${s3Key}`);

            // 5. Send frameReady confirmation to Agent (~300 bytes)
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  event: {
                    frameReady: {
                      requestId: requestData.requestId,
                      s3Key: s3Key,
                      s3Bucket: s3Bucket,
                      filename: filename,
                      timestamp: Date.now(),
                      width: canvas.width,
                      height: canvas.height,
                      sizeBytes: blob.size,
                    },
                  },
                }),
              );

              console.log(
                `📤 Sent frameReady confirmation for request ${requestData.requestId}`,
              );
            }
          } catch (error) {
            console.error("❌ Frame upload failed:", error);
          }
        },
        "image/jpeg",
        0.9,
      ); // High quality for Agent analysis
    } catch (error) {
      console.error("❌ Frame capture failed:", error);
    }
  };

  // PATH B: Setup MediaRecorder for full-resolution video recording
  const setupMediaRecorder = async (videoTrack, mixedAudioStream) => {
    if (!saveVideoRecording) {
      console.log("📹 Video recording disabled - skipping MediaRecorder setup");
      return;
    }

    try {
      console.log(
        "📹 Setting up MediaRecorder for full-resolution video recording...",
      );

      // Combine video track with mixed audio stream
      const recordingStream = new MediaStream([
        videoTrack,
        ...mixedAudioStream.getAudioTracks(),
      ]);

      // Check for supported MIME types
      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];

      let selectedMimeType = null;
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          console.log("✅ Selected MIME type:", mimeType);
          break;
        }
      }

      if (!selectedMimeType) {
        throw new Error("No supported video MIME types found");
      }

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(recordingStream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps
        audioBitsPerSecond: 128000, // 128 kbps
      });

      mediaRecorderRef.current = mediaRecorder;

      // Handle data available event
      // Helper function to upload a buffered blob to S3
      const uploadBufferedChunk = async (blob) => {
        try {
          // Initialize multipart upload on first chunk
          if (!uploadIdRef.current) {
            const API_BASE_URL =
              process.env.REACT_APP_API_URL || "http://localhost:8000";
            const token = localStorage.getItem("authToken") || "";

            const response = await fetch(
              `${API_BASE_URL}/api/interviewer/video/start-upload`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionId,
                  format: "webm",
                }),
              },
            );

            if (!response.ok) {
              throw new Error("Failed to start multipart upload");
            }

            const data = await response.json();
            uploadIdRef.current = data.uploadId;
            console.log("✅ Multipart upload initialized:", data.uploadId);
          }

          // Get presigned URL for direct S3 upload
          const API_BASE_URL =
            process.env.REACT_APP_API_URL || "http://localhost:8000";
          const token = localStorage.getItem("authToken") || "";

          const urlResponse = await fetch(
            `${API_BASE_URL}/api/interviewer/video/get-upload-url`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                sessionId: sessionId,
                uploadId: uploadIdRef.current,
                partNumber: partNumberRef.current,
                format: "webm",
              }),
            },
          );

          if (!urlResponse.ok) {
            const errorText = await urlResponse.text();
            console.error(
              `❌ Failed to get presigned URL (${urlResponse.status}):`,
              errorText.substring(0, 500),
            );
            throw new Error(
              `Failed to get presigned URL: ${urlResponse.status}`,
            );
          }

          const { url: presignedUrl } = await urlResponse.json();

          // Upload to S3
          const uploadResponse = await fetch(presignedUrl, {
            method: "PUT",
            body: blob,
            headers: {
              "Content-Type": "video/webm",
            },
          });

          if (!uploadResponse.ok) {
            console.error(`❌ S3 upload failed (${uploadResponse.status})`);
            throw new Error(`Failed to upload to S3: ${uploadResponse.status}`);
          }

          const etag = uploadResponse.headers.get("ETag");
          if (!etag) {
            console.warn("⚠️ No ETag returned from S3");
          }

          uploadedPartsRef.current.push({
            PartNumber: partNumberRef.current,
            ETag: etag,
          });

          console.log(
            `✅ Uploaded part ${partNumberRef.current} directly to S3, ETag: ${etag}, Size: ${(blob.size / 1024).toFixed(2)}KB`,
          );
          partNumberRef.current++;
        } catch (error) {
          console.error("❌ Error uploading buffered chunk:", error);
          throw error;
        }
      };

      mediaRecorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size === 0) {
          return;
        }

        const chunkSizeMB = (event.data.size / 1024 / 1024).toFixed(2);
        console.log(`📦 Video chunk available: ${chunkSizeMB}MB`);

        try {
          // Add chunk to pending buffer
          pendingChunksRef.current.push(event.data);
          pendingSizeRef.current += event.data.size;

          console.log(
            `📊 Buffer status: ${pendingChunksRef.current.length} chunks, ${(pendingSizeRef.current / 1024 / 1024).toFixed(2)}MB total`,
          );

          // Upload when buffer exceeds 5MB minimum
          if (pendingSizeRef.current >= MIN_UPLOAD_SIZE) {
            console.log(
              `✅ Buffer reached ${(pendingSizeRef.current / 1024 / 1024).toFixed(2)}MB - uploading to S3`,
            );

            // Combine all pending chunks into single blob
            const combinedBlob = new Blob(pendingChunksRef.current, {
              type: "video/webm",
            });

            // Upload the combined chunk (track promise to prevent race conditions)
            uploadInProgressRef.current = uploadBufferedChunk(combinedBlob);
            await uploadInProgressRef.current;
            uploadInProgressRef.current = null;

            // Clear buffer
            pendingChunksRef.current = [];
            pendingSizeRef.current = 0;
            console.log("🧹 Buffer cleared");
          } else {
            console.log(
              `⏳ Buffer below 5MB minimum - waiting for more chunks (${(pendingSizeRef.current / 1024 / 1024).toFixed(2)}MB / 5MB)`,
            );
          }
        } catch (error) {
          console.error("❌ Error processing video chunk:", error);
          // Continue recording even if upload fails
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("❌ MediaRecorder error:", event.error);
      };

      mediaRecorder.onstop = () => {
        console.log("📹 MediaRecorder stopped");
      };

      // Start recording with 30-second chunks (ensures >5MB for S3 multipart upload minimum)
      // At 2.5 Mbps video + 128 kbps audio = 2.628 Mbps × 30s = 9.85 MB theoretical
      // Actual with VBR compression: ~6.3 MB per chunk (above 5MB S3 minimum)
      mediaRecorder.start(30000);
      console.log(
        "✅ MediaRecorder started - recording at 2.5 Mbps video, 128 kbps audio, 30s chunks",
      );
    } catch (error) {
      console.error("❌ Failed to setup MediaRecorder:", error);
      setError("Video recording setup failed. Frame capture will continue.");
      // Graceful degradation - PATH A still works
    }
  };

  const stopMediaRecorder = async () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      console.log("📹 Stopping MediaRecorder...");
      mediaRecorderRef.current.stop();

      // Wait for final ondataavailable to fire
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // CRITICAL: Wait for any in-progress uploads to complete before uploading final chunk
      // This prevents race condition where ondataavailable async upload is still running
      if (uploadInProgressRef.current) {
        console.log("⏳ Waiting for in-progress upload to complete...");
        await uploadInProgressRef.current;
        uploadInProgressRef.current = null;
        console.log("✅ In-progress upload completed");
      }

      // Upload any remaining buffered chunks (final part can be any size)
      if (pendingChunksRef.current.length > 0) {
        console.log(
          `📤 Uploading final buffered chunks: ${pendingChunksRef.current.length} chunks, ${(pendingSizeRef.current / 1024 / 1024).toFixed(2)}MB`,
        );
        try {
          const finalBlob = new Blob(pendingChunksRef.current, {
            type: "video/webm",
          });

          // Initialize upload if not done yet
          if (!uploadIdRef.current) {
            const API_BASE_URL =
              process.env.REACT_APP_API_URL || "http://localhost:8000";
            const token = localStorage.getItem("authToken") || "";

            const response = await fetch(
              `${API_BASE_URL}/api/interviewer/video/start-upload`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionId,
                  format: "webm",
                }),
              },
            );

            if (response.ok) {
              const data = await response.json();
              uploadIdRef.current = data.uploadId;
              console.log(
                "✅ Multipart upload initialized for final chunk:",
                data.uploadId,
              );
            }
          }

          // Upload final chunk
          if (uploadIdRef.current) {
            const API_BASE_URL =
              process.env.REACT_APP_API_URL || "http://localhost:8000";
            const token = localStorage.getItem("authToken") || "";

            const urlResponse = await fetch(
              `${API_BASE_URL}/api/interviewer/video/get-upload-url`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionId,
                  uploadId: uploadIdRef.current,
                  partNumber: partNumberRef.current,
                  format: "webm",
                }),
              },
            );

            if (urlResponse.ok) {
              const { url: presignedUrl } = await urlResponse.json();

              const uploadResponse = await fetch(presignedUrl, {
                method: "PUT",
                body: finalBlob,
                headers: {
                  "Content-Type": "video/webm",
                },
              });

              if (uploadResponse.ok) {
                const etag = uploadResponse.headers.get("ETag");
                uploadedPartsRef.current.push({
                  PartNumber: partNumberRef.current,
                  ETag: etag,
                });
                console.log(
                  `✅ Uploaded final part ${partNumberRef.current} (${(finalBlob.size / 1024 / 1024).toFixed(2)}MB)`,
                );
              }
            }
          }
        } catch (error) {
          console.error("❌ Error uploading final buffered chunks:", error);
        }

        // Clear buffer
        pendingChunksRef.current = [];
        pendingSizeRef.current = 0;
      }

      // Complete multipart upload
      if (uploadIdRef.current && uploadedPartsRef.current.length > 0) {
        try {
          const API_BASE_URL =
            process.env.REACT_APP_API_URL || "http://localhost:8000";
          const token = localStorage.getItem("authToken") || "";

          const response = await fetch(
            `${API_BASE_URL}/api/interviewer/video/complete-upload`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                sessionId: sessionId,
                uploadId: uploadIdRef.current,
                parts: uploadedPartsRef.current,
              }),
            },
          );

          if (response.ok) {
            const data = await response.json();
            console.log("✅ Video recording completed:", data.videoLocation);
            // Store videoLocation for passing to save-interview-session endpoint
            videoLocationRef.current = data.videoLocation;
          } else {
            console.error("❌ Failed to complete multipart upload");
          }
        } catch (error) {
          console.error("❌ Error completing video upload:", error);
        }
      }

      // Reset refs
      mediaRecorderRef.current = null;
      uploadIdRef.current = null;
      partNumberRef.current = 1;
      uploadedPartsRef.current = [];
      pendingChunksRef.current = [];
      pendingSizeRef.current = 0;
      uploadInProgressRef.current = null;
    }
  };

  const requestCoaching = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to server");
      return;
    }

    console.log("🤖 Requesting AI coaching for interviewer...");
    setIsCoachingLoading(true);
    setCoachingResponse(null);
    setError(null);

    try {
      wsRef.current.send(
        JSON.stringify({
          event: {
            getCoaching: {
              userRequest: coachingRequest.trim() || null,
            },
          },
        }),
      );
    } catch (error) {
      console.error("Failed to request coaching:", error);
      setError("Failed to send coaching request");
      setIsCoachingLoading(false);
    }
  };

  const stopListening = async () => {
    // Stop MediaRecorder first (PATH B)
    await stopMediaRecorder();

    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ event: { stop: {} } }));
      wsRef.current.close();
      wsRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop system audio stream
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((track) => track.stop());
      systemStreamRef.current = null;
    }

    // Stop microphone stream
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    // Stop video capture (PATH A)
    stopVideoCapture();

    setIsListening(false);
    setIsConnected(false);

    // Show save modal
    setShowSaveModal(true);
  };

  const handleSaveInterview = async () => {
    try {
      setIsSaving(true);
      setError(null);

      // Combine all transcript text for LLM analysis
      const fullTranscript = transcript
        .filter((t) => !t.isPartial)
        .map((t) => t.text)
        .join(" ");

      if (!fullTranscript.trim()) {
        setError("No transcript available to save");
        return;
      }

      // Prepare transcript array with speaker information for display
      const transcriptWithSpeakers = transcript
        .filter((t) => !t.isPartial)
        .map((t) => ({
          text: t.text,
          speaker: t.speaker || "unknown",
          timestamp: t.timestamp,
        }));

      const sessionData = {
        sessionId,
        interviewId: selectedInterview?.value || "",
        interviewName: currentInterviewName,
        transcript: fullTranscript,
        transcriptArray: JSON.stringify(transcriptWithSpeakers), // Save structured data
        duration: formatDuration(),
        videoLocation: videoLocationRef.current, // PATH B: S3 location from MediaRecorder upload
        // Question progression tracking data
        questionStatuses: JSON.stringify(questionStatuses), // Save question progression status
        currentQuestionIndex: currentQuestionIndex, // Final question index reached
        // Note: Video recording handled by PATH B (MediaRecorder) during session
        // Video uploaded via multipart upload complete-upload endpoint
      };

      console.log(`📝 Saving interview session metadata`, {
        sessionId,
        videoLocation: videoLocationRef.current,
        hasVideoLocation: !!videoLocationRef.current,
        questionStatusesCount: Object.keys(questionStatuses).length,
        currentQuestionIndex: currentQuestionIndex,
      });

      const response = await interviewerAPI.saveInterviewSession(sessionData);

      // Axios returns response.data with the actual data
      const data = response.data;
      setSavedSummary(data.summary);

      setFlashMessages([
        {
          type: "success",
          content: "Interview session saved successfully!",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "save-success",
        },
      ]);
    } catch (err) {
      console.error("Error saving interview:", err);
      setError(err.message || "Failed to save interview session");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseModal = () => {
    setShowSaveModal(false);
    setSavedSummary(null);
    navigate("/interviewer/sessions");
  };

  return (
    <SpaceBetween size="l">
      <Flashbar items={flashMessages} />

      <Header
        variant="h1"
        description="Conduct live interview with real-time transcription"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            {!isListening && (
              <Button onClick={() => navigate("/interviewer/create")}>
                Back to List
              </Button>
            )}
            {isListening && (
              <Button variant="primary" onClick={stopListening}>
                End & Save Interview
              </Button>
            )}
          </SpaceBetween>
        }
      >
        Live Assistant (Interviewer)
      </Header>

      {error && (
        <Alert type="error" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Interview Setup */}
      {!isListening && (
        <Container header={<Header variant="h2">Interview Setup</Header>}>
          <SpaceBetween size="m">
            <Alert type="info" header="How to use Interviewer Live Assistant">
              <SpaceBetween size="s">
                <Box variant="p">
                  <strong>Step-by-step guide:</strong>
                </Box>
                <ol style={{ margin: "8px 0", paddingLeft: "24px" }}>
                  <li>Click "Start with Selected Interview" or "Skip" below</li>
                  <li>A screen sharing dialog will appear</li>
                  <li>
                    Select any screen, window, or tab to share (typically your
                    video call tab)
                  </li>
                  <li>
                    <strong>
                      Important: Check "Share system audio" checkbox
                    </strong>{" "}
                    - This captures candidate's voice
                  </li>
                  <li>Click "Share" to start</li>
                  <li>
                    Allow microphone access when prompted - This captures your
                    voice
                  </li>
                </ol>

                <Box variant="p" margin={{ top: "s" }}>
                  <strong>What gets captured:</strong>
                </Box>
                <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
                  <li>
                    <strong>System audio:</strong> Other participants' voices in
                    the meeting (via screen share)
                  </li>
                  <li>
                    <strong>Shared screen:</strong> Screen content (via screen
                    share)
                  </li>
                  <li>
                    <strong>Microphone:</strong> Your own voice responses
                  </li>
                </ul>
              </SpaceBetween>
            </Alert>

            <div>
              <Box variant="awsui-key-label">
                Select Scheduled Interview (Optional)
              </Box>
              {loadingInterviews ? (
                <Spinner />
              ) : (
                <Select
                  selectedOption={selectedInterview}
                  onChange={({ detail }) =>
                    setSelectedInterview(detail.selectedOption)
                  }
                  options={scheduledInterviews}
                  placeholder="None - conduct interview without pre-planned questions"
                  empty="No scheduled interviews available"
                />
              )}
              <Box
                variant="small"
                color="text-body-secondary"
                padding={{ top: "xs" }}
              >
                If you select a scheduled interview, the questions and checklist
                will be available during the interview.
              </Box>
            </div>

            <Box>
              <Checkbox
                checked={saveVideoRecording}
                onChange={({ detail }) => setSaveVideoRecording(detail.checked)}
              >
                Save video recording for playback
              </Checkbox>
              {saveVideoRecording && (
                <Box
                  variant="p"
                  color="text-body-secondary"
                  margin={{ top: "xs" }}
                >
                  Video frames will be captured at 1 FPS and stored securely in
                  S3 for playback.
                </Box>
              )}
            </Box>

            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={startListening}>
                Skip (No Scheduled Interview)
              </Button>
              <Button
                variant="primary"
                iconName="microphone"
                onClick={startListening}
                disabled={!selectedInterview}
              >
                Start with Selected Interview
              </Button>
            </SpaceBetween>
          </SpaceBetween>
        </Container>
      )}

      {/* Status Bar */}
      {isListening && (
        <Container>
          <SpaceBetween direction="horizontal" size="l">
            <div>
              <Box variant="awsui-key-label">Status</Box>
              <Box padding={{ top: "xs" }}>
                <StatusIndicator type={isConnected ? "in-progress" : "stopped"}>
                  {isConnected ? "Listening..." : "Not Connected"}
                </StatusIndicator>
              </Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Interview</Box>
              <Box variant="p">{currentInterviewName}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Elapsed Time</Box>
              <Box variant="h2">{formatTime(elapsedTime)}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Transcript Lines</Box>
              <Box variant="h2">
                {transcript.filter((t) => !t.isPartial).length}
              </Box>
            </div>
          </SpaceBetween>
        </Container>
      )}

      {/* Automatic Coaching Tips Section */}
      {isListening && coachingTips.length > 0 && (
        <Box padding={{ top: "l" }}>
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #d5dbdb",
              borderRadius: "8px",
              padding: "20px 24px",
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.08)",
            }}
          >
            <SpaceBetween size="m">
              {/* Header with navigation */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: "600",
                      color: "#1f2937",
                      marginBottom: "4px",
                    }}
                  >
                    Coaching Tips
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#6b7280",
                    }}
                  >
                    Real-time coaching feedback from AI
                  </div>
                </div>
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    iconName="angle-left"
                    variant="icon"
                    disabled={currentTipIndex === 0}
                    onClick={() =>
                      setCurrentTipIndex((prev) => Math.max(0, prev - 1))
                    }
                  />
                  <Box
                    variant="span"
                    color="text-body-secondary"
                    fontSize="body-s"
                    style={{ minWidth: "60px", textAlign: "center" }}
                  >
                    {currentTipIndex + 1} of {coachingTips.length}
                  </Box>
                  <Button
                    iconName="angle-right"
                    variant="icon"
                    disabled={currentTipIndex === coachingTips.length - 1}
                    onClick={() =>
                      setCurrentTipIndex((prev) =>
                        Math.min(coachingTips.length - 1, prev + 1),
                      )
                    }
                  />
                </SpaceBetween>
              </div>

              {/* Tip content - Yellow themed message box */}
              <div
                style={{
                  backgroundColor: "#fffbea",
                  padding: "16px 20px",
                  borderRadius: "6px",
                  border: "1px solid #f4d03f",
                  borderLeft: "4px solid #f4d03f",
                }}
              >
                <Box
                  variant="div"
                  fontSize="body-m"
                  style={{
                    lineHeight: "1.8",
                    color: "#1f2937",
                  }}
                >
                  {renderMarkdown(coachingTips[currentTipIndex]?.tip || "")}
                </Box>
              </div>

              {/* Timestamp */}
              <Box
                variant="small"
                color="text-body-secondary"
                style={{
                  textAlign: "right",
                }}
              >
                {new Date(
                  coachingTips[currentTipIndex]?.timestamp,
                ).toLocaleTimeString()}
              </Box>
            </SpaceBetween>
          </div>
        </Box>
      )}

      {/* AI Coaching Request */}
      {isListening && (
        <Container>
          <SpaceBetween size="m">
            <Header
              variant="h3"
              description="Get AI guidance for conducting more effective interviews"
            >
              AI Interview Coaching
            </Header>

            <FormField
              label="Your Question (Optional)"
              description="Ask a specific question or leave blank for general coaching"
            >
              <Textarea
                value={coachingRequest}
                onChange={({ detail }) => setCoachingRequest(detail.value)}
                placeholder="e.g., What follow-up questions should I ask? Are there any red flags I should explore?"
                rows={3}
                disabled={isCoachingLoading}
              />
            </FormField>

            <Button
              variant="primary"
              iconName="contact"
              onClick={requestCoaching}
              loading={isCoachingLoading}
              disabled={
                isCoachingLoading ||
                transcript.length === 0 ||
                !coachingRequest.trim()
              }
            >
              Get AI Coaching
            </Button>
          </SpaceBetween>
        </Container>
      )}

      {/* AI Coaching Response */}
      {showCoachingSection && coachingResponse && (
        <Container>
          <ExpandableSection
            headerText="AI Coaching Advice"
            variant="container"
            defaultExpanded={true}
          >
            <Box padding="s" backgroundColor="background-container-content">
              <Box variant="p" whiteSpace="pre-wrap">
                {renderMarkdown(coachingResponse)}
              </Box>
            </Box>
          </ExpandableSection>
        </Container>
      )}

      {/* Interview Plan (if selected) */}
      {(() => {
        const shouldShow =
          isListening &&
          selectedInterview &&
          selectedInterview.interview &&
          selectedInterview.interview.interviewPlan &&
          selectedInterview.interview.interviewPlan.questions &&
          selectedInterview.interview.interviewPlan.questions.length > 0;

        const totalQuestions = shouldShow
          ? selectedInterview.interview.interviewPlan.questions.length
          : 0;

        // Count actual completed questions from questionStatuses
        const completedCount = shouldShow
          ? Object.values(questionStatuses).filter(
              (status) => status.status === "completed",
            ).length
          : 0;

        const progressPercentage =
          totalQuestions > 0 ? (completedCount / totalQuestions) * 100 : 0;

        return (
          shouldShow && (
            <>
              {/* Question Progress Indicator */}
              <Container>
                <SpaceBetween size="xs">
                  <Box variant="h3">
                    Interview Progress: Question {currentQuestionIndex + 1} of{" "}
                    {totalQuestions} ({Math.round(progressPercentage)}%)
                  </Box>
                  <ProgressBar
                    value={progressPercentage}
                    additionalInfo={`${completedCount} completed`}
                    description="Track your progress through the interview questions"
                  />
                </SpaceBetween>
              </Container>

              <Container header={<Header variant="h2">Interview Plan</Header>}>
                <ExpandableSection
                  headerText="View Questions & Checklist"
                  defaultExpanded={false}
                >
                  <SpaceBetween size="m">
                    {selectedInterview.interview.interviewPlan.questions.map(
                      (q, index) => {
                        // Use questionId from backend
                        const questionId = q.questionId;
                        const status =
                          questionStatuses[questionId]?.status || "not_started";
                        const isCompleted = status === "completed";
                        const isInProgress = status === "in_progress";
                        const isNotStarted = status === "not_started";

                        // Calculate elapsed time if available
                        let elapsedTimeStr = "";
                        if (questionStatuses[questionId]) {
                          const startTime =
                            questionStatuses[questionId].startTime;
                          const endTime = questionStatuses[questionId].endTime;
                          if (startTime && endTime) {
                            const elapsedMs = endTime - startTime;
                            const elapsedMinutes = Math.floor(
                              elapsedMs / 60000,
                            );
                            const elapsedSeconds = Math.floor(
                              (elapsedMs % 60000) / 1000,
                            );
                            elapsedTimeStr = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, "0")} elapsed`;
                          } else if (startTime) {
                            const elapsedMs = Date.now() - startTime;
                            const elapsedMinutes = Math.floor(
                              elapsedMs / 60000,
                            );
                            const elapsedSeconds = Math.floor(
                              (elapsedMs % 60000) / 1000,
                            );
                            elapsedTimeStr = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, "0")} elapsed`;
                          }
                        }

                        return (
                          <Box
                            key={index}
                            padding="s"
                            backgroundColor={
                              isInProgress
                                ? "background-status-info"
                                : "background-container-content"
                            }
                          >
                            <SpaceBetween size="xs">
                              {/* Question header with metadata */}
                              <Box>
                                <SpaceBetween direction="horizontal" size="xs">
                                  <span
                                    style={{
                                      opacity: isCompleted ? 0.6 : 1,
                                      fontWeight: isInProgress
                                        ? "bold"
                                        : "normal",
                                    }}
                                  >
                                    {isCompleted && "✅ "}
                                    {isInProgress && "▶️ "}
                                    {isNotStarted && "⏸️ "}
                                    <Box variant="strong" display="inline">
                                      Q{index + 1}
                                    </Box>
                                  </span>
                                  {q.difficulty && (
                                    <Badge
                                      color={
                                        q.difficulty === "hard"
                                          ? "red"
                                          : q.difficulty === "medium"
                                            ? "blue"
                                            : "green"
                                      }
                                    >
                                      {q.difficulty}
                                    </Badge>
                                  )}
                                  {q.estimatedTime && (
                                    <Box
                                      variant="small"
                                      color="text-body-secondary"
                                    >
                                      ⏱️ {q.estimatedTime}
                                    </Box>
                                  )}
                                </SpaceBetween>
                              </Box>

                              {/* Question text */}
                              <Box>
                                <Box
                                  variant="p"
                                  style={{
                                    opacity: isCompleted ? 0.6 : 1,
                                  }}
                                >
                                  {q.questionText}
                                </Box>
                                {elapsedTimeStr && (
                                  <Box
                                    variant="small"
                                    color="text-status-info"
                                    display="block"
                                    margin={{ top: "xxxs" }}
                                  >
                                    Status:{" "}
                                    {status === "completed"
                                      ? "Completed"
                                      : "In Progress"}{" "}
                                    ({elapsedTimeStr})
                                  </Box>
                                )}
                                {isNotStarted && (
                                  <Box
                                    variant="small"
                                    color="text-status-inactive"
                                    display="block"
                                    margin={{ top: "xxxs" }}
                                  >
                                    Status: Not Started
                                  </Box>
                                )}
                              </Box>
                              {q.evaluationChecklist &&
                                typeof q.evaluationChecklist === "string" &&
                                q.evaluationChecklist.trim().length > 0 && (
                                  <ul
                                    style={{
                                      margin: "4px 0",
                                      paddingLeft: "20px",
                                      fontSize: "12px",
                                      opacity: isCompleted ? 0.6 : 1,
                                    }}
                                  >
                                    {q.evaluationChecklist
                                      .split("\n")
                                      .map((line) => line.trim())
                                      .filter((line) => line.length > 0)
                                      .map((line) =>
                                        line.replace(/^[-*]\s*/, ""),
                                      )
                                      .map((item, i) => (
                                        <li key={i}>{item}</li>
                                      ))}
                                  </ul>
                                )}
                            </SpaceBetween>
                          </Box>
                        );
                      },
                    )}
                  </SpaceBetween>
                </ExpandableSection>
              </Container>
            </>
          )
        );
      })()}

      {/* Live Transcription */}
      {isListening && (
        <Container
          header={
            <Header
              variant="h2"
              description="Real-time conversation transcription"
              counter={`(${transcript.filter((t) => !t.isPartial).length} lines)`}
            >
              Live Transcription
            </Header>
          }
        >
          <div
            ref={transcriptContainerRef}
            style={{
              maxHeight: "500px",
              overflowY: "auto",
              padding: "16px",
              backgroundColor: "#f8f9fa",
              borderRadius: "8px",
            }}
          >
            {transcript.length === 0 ? (
              <Box textAlign="center" color="text-body-secondary" padding="xl">
                Speak into your microphone to start transcribing...
              </Box>
            ) : (
              <SpaceBetween size="m">
                {transcript.map((item, index) => (
                  <div key={index}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-start",
                        width: "100%",
                      }}
                    >
                      <div
                        style={{
                          maxWidth: "70%",
                          padding: "12px 16px",
                          borderRadius: "16px",
                          // Apply speaker-specific colors for final transcripts, special styling for partial
                          ...(item.isPartial
                            ? {
                                backgroundColor: "#e8f4f8",
                                color: "#000716",
                                border: "2px solid #0972d3",
                              }
                            : { ...getSpeakerStyle(item.speaker) }),
                          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
                        }}
                      >
                        <div style={{ marginBottom: "4px" }}>
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: "600",
                              opacity: item.isPartial ? 0.7 : 1,
                            }}
                          >
                            {item.speaker
                              ? `Speaker ${item.speaker}`
                              : "Speaker"}
                            {item.isPartial && (
                              <span
                                style={{
                                  marginLeft: "8px",
                                  fontStyle: "italic",
                                  opacity: 0.6,
                                }}
                              >
                                (listening...)
                              </span>
                            )}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "14px",
                            lineHeight: "1.5",
                            wordBreak: "break-word",
                            fontStyle: item.isPartial ? "italic" : "normal",
                          }}
                        >
                          {item.text}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </SpaceBetween>
            )}
          </div>
        </Container>
      )}

      {/* Save Modal */}
      <Modal
        visible={showSaveModal}
        onDismiss={() => !isSaving && handleCloseModal()}
        header="Save Interview Session"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                onClick={handleCloseModal}
                disabled={isSaving}
              >
                {savedSummary ? "Close" : "Cancel"}
              </Button>
              {!savedSummary && (
                <Button
                  variant="primary"
                  onClick={handleSaveInterview}
                  loading={isSaving}
                >
                  Save Interview
                </Button>
              )}
            </SpaceBetween>
          </Box>
        }
        size="large"
      >
        {isSaving ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
            <Box variant="p" padding={{ top: "s" }}>
              Generating interview summary with AI...
            </Box>
          </Box>
        ) : savedSummary ? (
          <SpaceBetween size="m">
            <Alert type="success" header="Interview Saved Successfully">
              The interview has been saved with AI-generated summary and
              assessment.
            </Alert>

            <Box variant="h3">Summary</Box>
            <Box variant="p">{savedSummary.summary}</Box>

            <Box variant="p">
              <Button
                variant="primary"
                onClick={() => navigate(`/interviewer/sessions/${sessionId}`)}
              >
                View Full Assessment
              </Button>
            </Box>
          </SpaceBetween>
        ) : (
          <SpaceBetween size="m">
            <Box variant="p">This will save the interview session with:</Box>
            <ul>
              <li>
                Full transcript ({transcript.filter((t) => !t.isPartial).length}{" "}
                lines)
              </li>
              <li>Duration: {formatDuration()}</li>
              <li>AI-generated interview summary</li>
              <li>Detailed interview notes</li>
              <li>Competency assessment</li>
              <li>Concerns and areas for improvement</li>
            </ul>
            <Alert type="info">
              The AI will analyze the transcript to generate a structured
              assessment. This may take 30-60 seconds.
            </Alert>
          </SpaceBetween>
        )}
      </Modal>
    </SpaceBetween>
  );
}

export default InterviewerLive;
