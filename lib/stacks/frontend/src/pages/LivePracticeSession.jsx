import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Badge,
  Spinner,
  Alert,
  StatusIndicator,
  ExpandableSection,
  Modal,
} from "@cloudscape-design/components";
import {
  AudioRecorder,
  AudioPlayer,
  checkAudioSupport,
} from "../utils/audioUtils";
import { s2sWebSocketService } from "../services/s2sWebSocket";
import { sessionAPI } from "../services/api";

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

function LivePracticeSession({ user }) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prepId = searchParams.get("prepId");
  const mode = searchParams.get("mode") || "light"; // Default to 'light' if not specified
  const saveAudio = searchParams.get("saveAudio") === "true"; // Parse boolean from URL

  // Log the interview mode for debugging
  console.log("=".repeat(60));
  console.log(`INTERVIEW MODE: ${mode}`);
  console.log(`Session ID: ${sessionId}`);
  console.log(`Prep ID: ${prepId}`);
  console.log(`Save Audio: ${saveAudio}`);
  console.log("=".repeat(60));

  // Connection state
  const [isConnecting, setIsConnecting] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  // Audio state
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false); // Interviewer is thinking (agent processing)
  const [audioSupport, setAudioSupport] = useState(null);

  // Track speaking state with ref for immediate access (avoid React state delay)
  const isSpeakingRef = useRef(false);
  const isRecordingRef = useRef(false);

  // Session state
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);

  // Transcription state
  const [transcriptions, setTranscriptions] = useState([]);

  // Coaching tips state - stores all tips and current viewing index
  const [coachingTips, setCoachingTips] = useState([]);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const tipCountRef = useRef(0); // Track how many tips have been received

  // Audio recording state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const sessionStartTimeRef = useRef(null);
  const audioChunksRef = useRef([]); // Store all audio chunks
  const currentTurnRef = useRef(0); // Track current turn number
  const turnSequenceRef = useRef(0); // Track sequence within turn

  // Refs
  const audioRecorderRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const transcriptionEndRef = useRef(null);
  const pendingAIMessageRef = useRef(null); // Store AI message until audio plays

  // Check audio support on mount
  useEffect(() => {
    const support = checkAudioSupport();
    setAudioSupport(support);

    if (!support.supported) {
      setConnectionError(
        "Your browser does not support audio recording or playback.",
      );
    }
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    if (!audioSupport?.supported) return;

    // Store event handlers for cleanup
    const handleConnect = () => {
      console.log("Connected to S2S WebSocket");
      setIsConnected(true);
      setIsConnecting(false);
    };

    const handleDisconnect = () => {
      console.log("Disconnected from S2S WebSocket");
      setIsConnected(false);

      // Update refs immediately (synchronous)
      isRecordingRef.current = false;
      isSpeakingRef.current = false;

      // Update states for UI (asynchronous)
      setIsRecording(false);
      setIsSpeaking(false);
    };

    const handleError = (error) => {
      console.error("S2S WebSocket error:", error);
      setConnectionError("Connection error occurred");
    };

    const handleContentStart = (data) => {
      // When AI starts generating content
      if (data.role === "ASSISTANT" && data.type === "AUDIO") {
        // Clear thinking state when AI starts speaking
        setIsThinking(false);

        // Pause user recording while AI is speaking to avoid echo/crosstalk
        if (isRecordingRef.current && audioRecorderRef.current) {
          audioRecorderRef.current.stop();
          // NOTE: Don't close WebSocket content - just pause recording
          // This keeps the audio content stream open for seamless resume
        }

        // DON'T set any speaking state here - let first audioOutput chunk handle everything
        // This ensures turn counter increments correctly and audio is saved
      }
    };

    const handleInterviewerThinking = () => {
      // Interviewer is processing with agent tool
      console.log("[LivePractice] Interviewer is thinking...");
      setIsThinking(true);
    };

    const handleAudioOutput = async (base64Audio) => {
      try {
        // Use ref for immediate state check (avoid React state update delay)
        if (!isSpeakingRef.current) {
          // New AI turn - increment turn counter and reset sequence
          currentTurnRef.current += 1;
          turnSequenceRef.current = 0;

          // Reset playback complete flag for new AI turn
          if (audioPlayerRef.current) {
            audioPlayerRef.current.playbackCompleteCalled = false;
          }

          // Update ref immediately (synchronous)
          isSpeakingRef.current = true;

          // Update state for UI (asynchronous, but doesn't affect turn logic)
          setIsSpeaking(true);
        }

        // Store audio chunk for recording (with error handling)
        try {
          if (audioChunksRef.current && base64Audio) {
            audioChunksRef.current.push({
              type: "ai",
              data: base64Audio,
              timestamp: Date.now(), // Keep for debugging/metadata
              turn: currentTurnRef.current,
              sequence: turnSequenceRef.current,
            });
            turnSequenceRef.current += 1;
          }
        } catch (bufferError) {
          console.warn("Failed to buffer audio chunk:", bufferError);
          // Continue even if buffering fails - don't break playback
        }

        if (audioPlayerRef.current) {
          await audioPlayerRef.current.play(base64Audio);
        }
      } catch (error) {
        console.error("Failed to play audio:", error);
      }
    };

    const handleContentEnd = (data) => {
      // When AI finishes generating content
      if (data.role === "ASSISTANT") {
        // NOTE: Don't clear speaking state here - wait for actual audio playback to complete
        // isSpeaking will be cleared by audioPlayer.onPlaybackComplete callback
        // This ensures UI state (button enable/disable) matches actual audio playback

        // Add pending AI message to transcription
        if (pendingAIMessageRef.current) {
          // Store reference locally to avoid null issues in setState closure
          const pendingMessage = pendingAIMessageRef.current;
          pendingAIMessageRef.current = null;

          setTranscriptions((prev) => {
            const lastMessage = prev[prev.length - 1];

            // Check if the last message is from ASSISTANT (same turn continuation)
            if (lastMessage && lastMessage.role === "ASSISTANT") {
              // Check if this content is already included (avoid duplicates)
              const isAlreadyIncluded = lastMessage.content.includes(
                pendingMessage.content.trim(),
              );

              if (isAlreadyIncluded) {
                console.log(
                  "Content already included, skipping:",
                  pendingMessage.content.substring(0, 50),
                );
                return prev;
              }

              // Check if this is genuinely new content to append
              const isNewContent = pendingMessage.content.trim().length > 0;

              if (isNewContent) {
                // Append to existing ASSISTANT message
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...lastMessage,
                  content:
                    lastMessage.content + " " + pendingMessage.content.trim(),
                  // Keep original id to prevent React re-render jumping
                  timestamp: pendingMessage.timestamp,
                };
                console.log(
                  "Appended to existing AI message:",
                  updated[updated.length - 1].content.substring(0, 100),
                );
                return updated;
              }
            }

            // New ASSISTANT turn or first message
            return [...prev, pendingMessage];
          });
        }
      }
    };

    const handleCandidateTip = (tipData) => {
      console.log("[LivePractice] Received candidate tip:", tipData);

      // Increment tip counter
      tipCountRef.current += 1;

      // Skip only the very first tip (counter === 1)
      if (tipCountRef.current === 1) {
        console.log("[LivePractice] Skipping first tip (counter: 1)");
        return;
      }

      // Add tip to the coaching tips array
      setCoachingTips((prev) => {
        const newTips = [
          ...prev,
          {
            tip: tipData.tip,
            timestamp: tipData.timestamp || new Date().toISOString(),
            questionNumber: tipData.questionNumber,
          },
        ];

        // Auto-navigate to the latest tip
        setCurrentTipIndex(newTips.length - 1);

        return newTips;
      });
    };

    const handleResponseComplete = () => {
      // NOTE: Don't clear speaking state here - wait for actual audio playback to complete
      // isSpeaking will be cleared by audioPlayer.onPlaybackComplete callback

      // Backup: Add pending AI message if contentEnd was missed
      if (pendingAIMessageRef.current) {
        // Store reference locally to avoid null issues in setState closure
        const pendingMessage = pendingAIMessageRef.current;
        pendingAIMessageRef.current = null;

        setTranscriptions((prev) => {
          const lastMessage = prev[prev.length - 1];

          // Check if the last message is from ASSISTANT (same turn continuation)
          if (lastMessage && lastMessage.role === "ASSISTANT") {
            // Check if this content is already included (avoid duplicates)
            const isAlreadyIncluded = lastMessage.content.includes(
              pendingMessage.content.trim(),
            );

            if (isAlreadyIncluded) {
              console.log(
                "Content already included on responseComplete, skipping:",
                pendingMessage.content.substring(0, 50),
              );
              return prev;
            }

            // Check if this is genuinely new content to append
            const isNewContent = pendingMessage.content.trim().length > 0;

            if (isNewContent) {
              // Append to existing ASSISTANT message
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...lastMessage,
                content:
                  lastMessage.content + " " + pendingMessage.content.trim(),
                // Keep original id to prevent React re-render jumping
                timestamp: pendingMessage.timestamp,
              };
              console.log(
                "Appended to existing AI message on responseComplete:",
                updated[updated.length - 1].content.substring(0, 100),
              );
              return updated;
            }
          }

          // New ASSISTANT turn or first message
          return [...prev, pendingMessage];
        });
      }
    };

    const handleTextOutput = (data) => {
      const { role, content, contentId } = data;

      if (!content || !contentId) return;

      // Filter out system messages (JSON-like content)
      const trimmedContent = content.trim();
      if (trimmedContent.startsWith("{") && trimmedContent.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmedContent);
          // Skip if it's a system message like { "interrupted": true }
          if (
            parsed.interrupted !== undefined ||
            Object.keys(parsed).length === 0
          ) {
            return;
          }
        } catch (e) {
          // Not valid JSON, continue processing
        }
      }

      // Filter out initial "hello" or very short user messages at the start
      const trimmedLowerContent = trimmedContent.toLowerCase();
      if (
        role === "USER" &&
        (trimmedLowerContent === "hello" ||
          trimmedLowerContent === "hi" ||
          trimmedContent.length < 3)
      ) {
        // Skip initial greeting messages from user
        return;
      }

      // For AI messages, store in pending and wait for audio to finish
      if (role === "ASSISTANT") {
        // Accumulate content in the same turn (same contentId or consecutive messages)
        if (pendingAIMessageRef.current) {
          // Check if this is continuation of the same turn
          // Nova Sonic may send multiple textOutput events in one turn
          const isNewSentence =
            content.trim() &&
            !pendingAIMessageRef.current.content.includes(content.trim());

          if (isNewSentence) {
            // Append new content to existing message with space separator
            pendingAIMessageRef.current.content += " " + content.trim();
            pendingAIMessageRef.current.id = contentId; // Update to latest contentId
            console.log(
              "Accumulated AI message:",
              pendingAIMessageRef.current.content.substring(0, 100),
            );
          } else {
            // Same content (SPECULATIVE -> FINAL update), just update the contentId
            pendingAIMessageRef.current.id = contentId;
          }
        } else {
          // Start new pending message
          pendingAIMessageRef.current = {
            id: contentId,
            role: role,
            content: content.trim(),
            timestamp: new Date().toISOString(),
          };
          console.log("Started new AI message:", content.substring(0, 100));
        }
        return; // Don't add to transcription yet
      }

      // For USER messages, accumulate in the same turn
      setTranscriptions((prev) => {
        // Check if there's already a USER message in this turn (last message with same role)
        const lastMessage = prev[prev.length - 1];

        if (lastMessage && lastMessage.role === "USER") {
          // Check if this is new content or just an update
          const isNewContent =
            content.trim() && !lastMessage.content.includes(content.trim());

          if (isNewContent) {
            // Append to existing USER message
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...lastMessage,
              content: lastMessage.content + " " + content.trim(),
              // Keep original id to prevent React re-render jumping
              timestamp: new Date().toISOString(),
            };
            console.log(
              "Accumulated USER message:",
              updated[updated.length - 1].content.substring(0, 100),
            );
            return updated;
          } else {
            // Same content (SPECULATIVE -> FINAL), just update the message
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...lastMessage,
              // Keep original id to prevent React re-render jumping
              timestamp: new Date().toISOString(),
            };
            return updated;
          }
        } else {
          // New USER message (different turn)
          return [
            ...prev,
            {
              id: contentId,
              role: role,
              content: content.trim(),
              timestamp: new Date().toISOString(),
            },
          ];
        }
      });
    };

    const initializeConnection = async () => {
      try {
        setIsConnecting(true);
        setConnectionError(null);

        // Initialize audio components
        audioRecorderRef.current = new AudioRecorder();
        audioPlayerRef.current = new AudioPlayer();
        await audioPlayerRef.current.initialize();

        // Set up playback complete callback for resuming user recording
        audioPlayerRef.current.onPlaybackComplete = () => {
          // Clear AI speaking state now that audio has actually finished playing
          isSpeakingRef.current = false;
          setIsSpeaking(false);

          // Resume user recording if it was active before AI started speaking
          if (isRecordingRef.current && audioRecorderRef.current) {
            // Start NEW user turn (increment turn counter for local storage)
            currentTurnRef.current += 1;
            turnSequenceRef.current = 0;

            // Restart recording with existing WebSocket content
            audioRecorderRef.current
              .start((base64Audio) => {
                try {
                  if (audioChunksRef.current && base64Audio) {
                    audioChunksRef.current.push({
                      type: "user",
                      data: base64Audio,
                      timestamp: Date.now(),
                      turn: currentTurnRef.current,
                      sequence: turnSequenceRef.current,
                    });
                    turnSequenceRef.current += 1;
                  }
                } catch (bufferError) {
                  console.warn(
                    "Failed to buffer user audio chunk:",
                    bufferError,
                  );
                }

                try {
                  s2sWebSocketService.sendAudioChunk(base64Audio);
                } catch (sendError) {
                  console.error(
                    "Failed to send audio chunk to WebSocket:",
                    sendError,
                  );
                }
              })
              .catch((error) => {
                console.error("Failed to resume recording:", error);
              });
          }
        };

        // Setup event listeners BEFORE connecting
        s2sWebSocketService.on("connect", handleConnect);
        s2sWebSocketService.on("disconnect", handleDisconnect);
        s2sWebSocketService.on("error", handleError);
        s2sWebSocketService.on("contentStart", handleContentStart);
        s2sWebSocketService.on("contentEnd", handleContentEnd);
        s2sWebSocketService.on("audio:output", handleAudioOutput);
        s2sWebSocketService.on("text:output", handleTextOutput);
        s2sWebSocketService.on("response:complete", handleResponseComplete);
        s2sWebSocketService.on("candidate:tip", handleCandidateTip);
        s2sWebSocketService.on(
          "interviewer:thinking",
          handleInterviewerThinking,
        );

        // Connect to WebSocket AFTER setting up listeners
        const token = localStorage.getItem("authToken") || "";

        // Get userId from authenticated user, or use default for NO_AUTH mode
        // IMPORTANT: Prioritize email over username to ensure DynamoDB queries match stored data
        let userId = user?.email || user?.username || user?.sub;
        if (!userId) {
          // Fallback for NO_AUTH development mode
          userId = "local-dev-user@example.com";
          console.log(
            "[LivePractice] Using dev userId (NO_AUTH mode):",
            userId,
          );
        } else {
          console.log(
            "[LivePractice] Connected with authenticated userId:",
            userId,
          );
        }

        await s2sWebSocketService.connect(
          sessionId,
          token,
          userId,
          prepId,
          mode,
          "practiceSession",
        );

        // Connection successful - update state immediately
        console.log("WebSocket connection established");
        setIsConnected(true);
        setIsConnecting(false);
      } catch (error) {
        console.error("Failed to initialize connection:", error);
        setConnectionError(error.message || "Failed to connect to server");
        setIsConnecting(false);
      }
    };

    initializeConnection();

    // Cleanup on unmount
    return () => {
      console.log("[LivePracticeSession] Cleaning up...");

      // Remove event listeners
      s2sWebSocketService.off("connect", handleConnect);
      s2sWebSocketService.off("disconnect", handleDisconnect);
      s2sWebSocketService.off("error", handleError);
      s2sWebSocketService.off("contentStart", handleContentStart);
      s2sWebSocketService.off("contentEnd", handleContentEnd);
      s2sWebSocketService.off("audio:output", handleAudioOutput);
      s2sWebSocketService.off("text:output", handleTextOutput);
      s2sWebSocketService.off("response:complete", handleResponseComplete);
      s2sWebSocketService.off("candidate:tip", handleCandidateTip);
      s2sWebSocketService.off(
        "interviewer:thinking",
        handleInterviewerThinking,
      );

      // Stop and cleanup audio
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stop();
        audioRecorderRef.current = null;
      }
      if (audioPlayerRef.current) {
        audioPlayerRef.current.cleanup();
        audioPlayerRef.current = null;
      }

      // Clear pending messages
      pendingAIMessageRef.current = null;

      // Disconnect WebSocket
      s2sWebSocketService.disconnect();
    };
  }, [sessionId, prepId, mode, audioSupport]);

  // Initialize S2S session after connection
  useEffect(() => {
    if (isConnected && !sessionInitialized) {
      const initSession = async () => {
        try {
          console.log("Initializing S2S session...");
          await s2sWebSocketService.initializeSession();
          setSessionInitialized(true);
        } catch (error) {
          console.error("Failed to initialize session:", error);
          setConnectionError("Failed to initialize interview session");
        }
      };

      initSession();
    }
  }, [isConnected, sessionInitialized]);

  // Auto-scroll to bottom when new transcriptions arrive
  useEffect(() => {
    if (transcriptionEndRef.current) {
      // Use 'auto' instead of 'smooth' to prevent jumping during rapid content updates
      transcriptionEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [transcriptions]);

  // Start conversation (prompt)
  // Handle microphone button
  const handleMicToggle = async () => {
    // If this is the first time clicking the mic, start the conversation
    if (!conversationStarted) {
      try {
        console.log("Starting conversation on first mic click...");
        setConversationStarted(true);
        // Start tracking session time
        sessionStartTimeRef.current = Date.now();
      } catch (error) {
        console.error("Failed to start conversation:", error);
        setConnectionError("Failed to start conversation");
        return;
      }
    }

    if (isRecording) {
      // Stop recording
      try {
        audioRecorderRef.current.stop();
        s2sWebSocketService.completeAudioContent();

        // Update ref immediately (synchronous)
        isRecordingRef.current = false;

        // Update state for UI (asynchronous)
        setIsRecording(false);

        // Reinitialize audio player to reset scheduling for next response
        if (audioPlayerRef.current) {
          await audioPlayerRef.current.initialize(true);
        }
      } catch (error) {
        console.error("Failed to stop recording:", error);
      }
    } else {
      // Start recording
      try {
        // Reinitialize audio player before starting new recording (reset scheduling)
        if (audioPlayerRef.current) {
          await audioPlayerRef.current.initialize(true);
        }

        // New user turn - increment turn counter and reset sequence
        currentTurnRef.current += 1;
        turnSequenceRef.current = 0;

        // Update ref immediately (synchronous)
        isRecordingRef.current = true;

        // Start audio content
        s2sWebSocketService.startAudioContent();

        // Start recording with callback for audio chunks
        await audioRecorderRef.current.start((base64Audio) => {
          try {
            // Store user audio chunk for recording
            if (audioChunksRef.current && base64Audio) {
              audioChunksRef.current.push({
                type: "user",
                data: base64Audio,
                timestamp: Date.now(), // Keep for debugging/metadata
                turn: currentTurnRef.current,
                sequence: turnSequenceRef.current,
              });
              turnSequenceRef.current += 1;
            }
          } catch (bufferError) {
            console.warn("Failed to buffer user audio chunk:", bufferError);
            // Continue even if buffering fails - don't break recording
          }

          // Always try to send to WebSocket even if buffering fails
          try {
            s2sWebSocketService.sendAudioChunk(base64Audio);
          } catch (sendError) {
            console.error(
              "Failed to send audio chunk to WebSocket:",
              sendError,
            );
          }
        });

        setIsRecording(true);
      } catch (error) {
        console.error("Failed to start recording:", error);
        setConnectionError(
          "Failed to access microphone. Please check permissions.",
        );
      }
    }
  };

  // Handle end session - show save modal
  const handleEndSession = () => {
    if (!conversationStarted || transcriptions.length === 0) {
      // No conversation yet, just navigate away
      navigate("/practice");
      return;
    }
    // Show save modal
    setShowSaveModal(true);
  };

  // Mix audio chunks with turn-based sequential ordering
  const mixAudioChunks = (chunks, sampleRate = 16000) => {
    if (!chunks || chunks.length === 0) {
      return new Uint8Array(0);
    }

    console.log(
      `Mixing ${chunks.length} audio chunks with turn-based sequential ordering...`,
    );

    // Step 1: Sort chunks by turn and sequence for proper ordering
    const sortedChunks = [...chunks].sort((a, b) => {
      if (a.turn !== b.turn) {
        return a.turn - b.turn; // Sort by turn first
      }
      return a.sequence - b.sequence; // Then by sequence within turn
    });

    const maxTurn = Math.max(...sortedChunks.map((c) => c.turn));
    console.log(`Sorted into ${maxTurn} turns`);

    // DEBUG: Analyze each turn in detail
    for (let turn = 1; turn <= maxTurn; turn++) {
      const turnChunks = sortedChunks.filter((c) => c.turn === turn);
      if (turnChunks.length > 0) {
        const type = turnChunks[0].type;
        const totalBytes = turnChunks.reduce((sum, c) => {
          const bytes = atob(c.data).length;
          return sum + bytes;
        }, 0);
        const durationSec = totalBytes / 2 / sampleRate;
        console.log(
          `  Turn ${turn}: ${type.toUpperCase()} - ${turnChunks.length} chunks, ${totalBytes} bytes, ${durationSec.toFixed(2)}s`,
        );
      }
    }

    // Step 2: Decode all chunks sequentially
    const decodedChunks = [];
    let totalSamples = 0;

    for (const chunk of sortedChunks) {
      try {
        // Decode base64 to PCM
        const binaryString = atob(chunk.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Convert to Int16Array (PCM 16-bit)
        const int16Array = new Int16Array(bytes.buffer);

        // Convert to Float32 for mixing [-1.0, 1.0]
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }

        decodedChunks.push({
          samples: float32Array,
          type: chunk.type,
          turn: chunk.turn,
          sequence: chunk.sequence,
        });

        totalSamples += float32Array.length;
      } catch (error) {
        console.error("Error decoding audio chunk:", error);
      }
    }

    if (decodedChunks.length === 0) {
      console.warn("No valid audio chunks to mix");
      return new Uint8Array(0);
    }

    console.log(`Decoded ${decodedChunks.length} chunks successfully`);
    console.log(
      `Total samples: ${totalSamples} (${(totalSamples / sampleRate).toFixed(2)}s)`,
    );

    // Step 3: Concatenate all chunks sequentially (no overlap)
    const mixedBuffer = new Float32Array(totalSamples);
    let offset = 0;

    for (const chunk of decodedChunks) {
      mixedBuffer.set(chunk.samples, offset);
      offset += chunk.samples.length;
    }

    // Step 4: Normalize to prevent clipping
    let peak = 0;
    for (let i = 0; i < mixedBuffer.length; i++) {
      const abs = Math.abs(mixedBuffer[i]);
      if (abs > peak) peak = abs;
    }

    if (peak > 1.0) {
      console.log(`Normalizing audio (peak: ${peak.toFixed(2)})`);
      const scale = 1.0 / peak;
      for (let i = 0; i < mixedBuffer.length; i++) {
        mixedBuffer[i] *= scale;
      }
    }

    // Step 5: Convert Float32 back to Int16 PCM
    const int16Output = new Int16Array(mixedBuffer.length);
    for (let i = 0; i < mixedBuffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, mixedBuffer[i]));
      int16Output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    // Convert to Uint8Array for WAV creation
    const uint8Output = new Uint8Array(int16Output.buffer);

    console.log(`Audio mixing complete: ${uint8Output.length} bytes`);
    return uint8Output;
  };

  // Convert PCM chunks to WAV format
  const createWavFile = (
    pcmData,
    sampleRate = 16000,
    numChannels = 1,
    bitsPerSample = 16,
  ) => {
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, "WAVE");

    // fmt sub-chunk
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // Write PCM data
    const pcmView = new Uint8Array(buffer, 44);
    pcmView.set(pcmData);

    return buffer;
  };

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // Save session
  const handleSaveSession = async () => {
    try {
      setIsSaving(true);

      // Calculate duration
      const duration = sessionStartTimeRef.current
        ? Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
        : 0;

      // Prepare transcript array with speaker information for structured storage
      // This matches the pattern used in LiveAssistant.jsx for consistent data structure
      const transcriptWithSpeakers = transcriptions.map((t) => ({
        text: t.content,
        role: t.role,
        timestamp: t.timestamp,
        id: t.id,
      }));

      // Prepare session data
      const sessionData = {
        sessionId: sessionId,
        prepId: prepId,
        transcription: transcriptions, // Keep for backward compatibility / memory service
        duration: duration,
        metadata: {
          audioChunks: audioChunksRef.current.length,
          conversationStarted: conversationStarted,
          audioRecordingRequested: saveAudio,
          transcriptArray: transcriptWithSpeakers, // Add structured transcript for DynamoDB storage and detail page display
        },
      };

      // Only process and include audio if user requested it
      if (saveAudio) {
        console.log("Audio recording enabled - using timestamp-based mixing");
        console.log("- Total audio chunks:", audioChunksRef.current.length);

        // Mix audio chunks using timestamp-based positioning
        // This ensures proper timing even with overlapping audio
        const mixedPcmData = mixAudioChunks(audioChunksRef.current, 16000);

        if (mixedPcmData.length > 0) {
          // Create WAV file from mixed PCM data
          const wavBuffer = createWavFile(mixedPcmData, 16000, 1, 16);
          const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });

          console.log("Audio processing complete:");
          console.log("- Mixed PCM data size:", mixedPcmData.length, "bytes");
          console.log("- WAV file size:", wavBuffer.byteLength, "bytes");

          // Upload audio directly to S3 via presigned URL (bypasses API Gateway 6MB limit)
          try {
            console.log("🔄 Getting presigned URL for audio upload...");
            const API_BASE_URL =
              process.env.REACT_APP_API_URL || "http://localhost:8000";
            const token = localStorage.getItem("authToken") || "";

            // Get presigned URL from backend
            const urlResponse = await fetch(
              `${API_BASE_URL}/api/candidate/audio/get-upload-url`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionId,
                  format: "wav",
                }),
              },
            );

            if (!urlResponse.ok) {
              throw new Error(
                `Failed to get presigned URL: ${urlResponse.status}`,
              );
            }

            const { url: presignedUrl, s3Key } = await urlResponse.json();
            console.log("✅ Got presigned URL, uploading to S3...");

            // Upload audio directly to S3
            const uploadResponse = await fetch(presignedUrl, {
              method: "PUT",
              body: wavBlob,
              headers: {
                "Content-Type": "audio/wav",
              },
            });

            if (!uploadResponse.ok) {
              throw new Error(`S3 upload failed: ${uploadResponse.status}`);
            }

            console.log("✅ Audio uploaded to S3 successfully");

            // Add S3 key to session data (not base64)
            sessionData.audioS3Key = s3Key;
          } catch (audioUploadError) {
            console.error("❌ Failed to upload audio to S3:", audioUploadError);
            // Don't fail the entire save - just warn user
            alert(
              "Warning: Failed to upload audio recording. Transcription will still be saved.",
            );
          }
        } else {
          console.warn("No valid audio data to save");
        }
      } else {
        console.log(
          "Audio recording not requested - saving transcription only",
        );
      }

      // Send to backend through service
      const response = await sessionAPI.save(sessionData);

      console.log("Session saved successfully");
      setShowSaveModal(false);
      navigate("/practice");
    } catch (error) {
      console.error("Error saving session:", error);
      setConnectionError(`Failed to save session: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Don't save, just navigate away
  const handleDiscardSession = () => {
    setShowSaveModal(false);
    navigate("/practice");
  };

  // Get status badge
  const getStatusBadge = () => {
    if (isConnecting) {
      return <Badge color="blue">Connecting...</Badge>;
    }
    if (!isConnected) {
      return <Badge color="red">Disconnected</Badge>;
    }
    if (!sessionInitialized) {
      return <Badge color="blue">Initializing...</Badge>;
    }
    if (!conversationStarted) {
      return <Badge color="grey">Ready</Badge>;
    }
    if (isThinking) {
      return <Badge color="blue">Interviewer Thinking...</Badge>;
    }
    if (isSpeaking) {
      return <Badge color="green">AI Speaking</Badge>;
    }
    if (isRecording) {
      return <Badge color="green">Listening</Badge>;
    }
    return <Badge color="green">Connected</Badge>;
  };

  // Loading state
  if (isConnecting) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: "s" }}>
            Connecting to interview session...
          </Box>
        </Box>
      </Container>
    );
  }

  // Error state
  if (connectionError && !isConnected) {
    return (
      <Container>
        <SpaceBetween size="m">
          <Alert type="error" header="Connection Error">
            {connectionError}
          </Alert>
          <Button onClick={() => navigate("/practice")}>
            Back to Practice Sessions
          </Button>
        </SpaceBetween>
      </Container>
    );
  }

  return (
    <SpaceBetween size="l">
      <Modal
        visible={showSaveModal}
        onDismiss={() => setShowSaveModal(false)}
        header="Save practice session"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={handleDiscardSession}>
                Don't Save
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveSession}
                loading={isSaving}
              >
                Save Session
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box variant="p">
            Would you like to save this practice session?{" "}
            {saveAudio
              ? "You'll be able to review the audio recording and transcription later."
              : "The conversation transcription will be saved (audio not included)."}
          </Box>
          <SpaceBetween size="xs">
            <Box fontSize="body-s">
              <strong>Duration:</strong>{" "}
              {sessionStartTimeRef.current
                ? Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
                : 0}{" "}
              seconds
            </Box>
            <Box fontSize="body-s">
              <strong>Messages:</strong> {transcriptions.length}
            </Box>
            {saveAudio && (
              <Box fontSize="body-s">
                <strong>Audio chunks:</strong> {audioChunksRef.current.length}
              </Box>
            )}
            <Box
              fontSize="body-s"
              color={saveAudio ? "text-status-success" : "text-body-secondary"}
            >
              <strong>Recording mode:</strong>{" "}
              {saveAudio ? "Audio recording enabled" : "Transcription only"}
            </Box>
          </SpaceBetween>
        </SpaceBetween>
      </Modal>

      <Header
        variant="h1"
        description="Speech-to-speech interview practice with Nova Sonic AI"
        actions={
          <Button iconName="close" onClick={handleEndSession}>
            Exit
          </Button>
        }
      >
        Live Practice Session
      </Header>

      {connectionError && (
        <Alert
          type="warning"
          dismissible
          onDismiss={() => setConnectionError(null)}
        >
          {connectionError}
        </Alert>
      )}

      <Container>
        <SpaceBetween size="l">
          {/* Status */}
          <Box>
            <SpaceBetween size="xs" direction="horizontal">
              <Box variant="awsui-key-label">Status:</Box>
              {getStatusBadge()}
            </SpaceBetween>
          </Box>

          {/* Voice Interface - Show immediately when session is initialized */}
          {sessionInitialized && (
            <Box textAlign="center">
              <SpaceBetween size="l">
                {/* Microphone Status Indicator (Read-only) */}
                <Box>
                  <div
                    style={{
                      width: "100px",
                      height: "100px",
                      borderRadius: "50%",
                      border: "none",
                      background: (() => {
                        // Blue when AI is speaking or thinking
                        if (isThinking || isSpeaking) return "#0073bb"; // Blue = AI turn
                        // Green when listening (recording)
                        if (isRecording) return "#28a745"; // Green = Listening
                        // Red when muted
                        return "#dc3545"; // Red = Muted
                      })(),
                      color: "white",
                      boxShadow: (() => {
                        if (isThinking || isSpeaking)
                          return "0 4px 20px rgba(0, 115, 187, 0.4)";
                        if (isRecording)
                          return "0 4px 20px rgba(40, 167, 69, 0.4)";
                        return "0 4px 20px rgba(220, 53, 69, 0.3)";
                      })(),
                      transition: "all 0.3s ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto",
                      opacity: !isConnected ? 0.5 : 1,
                      cursor: "default",
                    }}
                  >
                    {/* Show appropriate icon based on state */}
                    {isThinking || isSpeaking ? (
                      // AI speaking/thinking icon
                      <svg
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    ) : isRecording ? (
                      // Regular microphone icon (GREEN = listening)
                      <svg
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    ) : (
                      // Muted microphone icon (RED = muted)
                      <svg
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    )}
                  </div>
                </Box>

                {/* Status text */}
                <Box>
                  {isThinking ? (
                    <StatusIndicator type="loading">
                      Interviewer is thinking...
                    </StatusIndicator>
                  ) : isSpeaking ? (
                    <StatusIndicator type="info">
                      Interviewer is speaking...
                    </StatusIndicator>
                  ) : isRecording ? (
                    <StatusIndicator type="success">Listening</StatusIndicator>
                  ) : (
                    <StatusIndicator type="stopped">
                      You're muted
                    </StatusIndicator>
                  )}
                </Box>

                {/* Microphone Control Button */}
                <Box>
                  <Button
                    variant="primary"
                    iconName={
                      !conversationStarted
                        ? "status-positive"
                        : isRecording
                          ? "microphone-off"
                          : "microphone"
                    }
                    onClick={handleMicToggle}
                    disabled={!isConnected || isSpeaking || isThinking}
                  >
                    {!conversationStarted
                      ? "Start"
                      : isRecording
                        ? "Mute"
                        : "Unmute"}
                  </Button>
                </Box>
              </SpaceBetween>
            </Box>
          )}

          {/* Coaching Tips Section - Available in all modes */}
          {conversationStarted && coachingTips.length > 0 && (
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

          {/* Transcription Section */}
          {conversationStarted && transcriptions.length > 0 && (
            <Box padding={{ top: "l" }}>
              <ExpandableSection
                headerText={`Conversation Transcription (${transcriptions.length} messages)`}
                variant="container"
                defaultExpanded={true}
              >
                <Box
                  padding="l"
                  style={{
                    maxHeight: "500px",
                    overflowY: "auto",
                    backgroundColor: "#f8f9fa",
                    borderRadius: "4px",
                  }}
                >
                  <SpaceBetween size="m">
                    {transcriptions.map((transcript, index) => (
                      <div key={transcript.id || index}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent:
                              transcript.role === "USER"
                                ? "flex-end"
                                : "flex-start",
                            width: "100%",
                          }}
                        >
                          <div
                            style={{
                              maxWidth: "70%",
                              padding: "12px 16px",
                              borderRadius: "16px",
                              backgroundColor:
                                transcript.role === "USER"
                                  ? "#0073bb"
                                  : "#ffffff",
                              color:
                                transcript.role === "USER"
                                  ? "#ffffff"
                                  : "#000716",
                              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
                              border:
                                transcript.role === "USER"
                                  ? "none"
                                  : "1px solid #d5dbdb",
                            }}
                          >
                            <div style={{ marginBottom: "4px" }}>
                              <span
                                style={{
                                  fontSize: "12px",
                                  fontWeight: "600",
                                  opacity: transcript.role === "USER" ? 1 : 0.7,
                                }}
                              >
                                {transcript.role === "USER"
                                  ? "You"
                                  : "AI Interviewer"}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: "14px",
                                lineHeight: "1.5",
                                wordBreak: "break-word",
                              }}
                            >
                              {transcript.content}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={transcriptionEndRef} />
                  </SpaceBetween>
                </Box>
              </ExpandableSection>
            </Box>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}

export default LivePracticeSession;
