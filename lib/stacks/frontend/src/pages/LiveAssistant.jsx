import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Alert,
  StatusIndicator,
  Badge,
  ExpandableSection,
  FormField,
  Textarea,
  Table,
  TextFilter,
  Modal,
  Spinner,
  Flashbar,
  Checkbox,
} from "@cloudscape-design/components";
import { interviewPlanAPI, candidateAPI } from "../services/api";

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

function LiveAssistant({ user }) {
  const navigate = useNavigate();

  // Step management
  const [currentStep, setCurrentStep] = useState("preparation"); // 'preparation' or 'listening'

  // Step 1: Preparation selection
  const [loading, setLoading] = useState(true);
  const [preparations, setPreparations] = useState([]);
  const [selectedPreparation, setSelectedPreparation] = useState([]);
  const [filteringText, setFilteringText] = useState("");

  // Step 2: Listening mode
  const [isCapturing, setIsCapturing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [saveVideoRecording, setSaveVideoRecording] = useState(false);
  const [transcriptions, setTranscriptions] = useState([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [systemStream, setSystemStream] = useState(null);
  const [micStream, setMicStream] = useState(null);
  const [audioContext, setAudioContext] = useState(null);
  const [showInstructions, setShowInstructions] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [flashMessages, setFlashMessages] = useState([]);

  // AI Coaching
  const [coachingRequest, setCoachingRequest] = useState("");
  const [coachingResponse, setCoachingResponse] = useState(null);
  const [isCoachingLoading, setIsCoachingLoading] = useState(false);
  const [showCoachingSection, setShowCoachingSection] = useState(false);

  // Automatic Coaching Tips
  const [coachingTips, setCoachingTips] = useState([]);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const tipCountRef = useRef(0);

  // Save Modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSummary, setSavedSummary] = useState(null);

  const sessionIdRef = useRef(
    `candidate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  );
  const wsRef = useRef(null);
  const audioProcessorRef = useRef(null);
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
  const MIN_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB minimum for S3 multipart parts

  useEffect(() => {
    // Load interview preparations
    loadPreparations();

    return () => {
      // Cleanup on unmount
      stopCapture();
    };
  }, []);

  // Timer for elapsed time
  useEffect(() => {
    let interval;
    if (isCapturing) {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isCapturing]);

  const loadPreparations = async () => {
    try {
      setLoading(true);
      const response = await interviewPlanAPI.list();

      // Axios returns response.data with the actual data
      const data = response.data;

      // Transform API data to table format (same as LivePractice)
      // Backend already filters for status='completed' plans only
      const plans = data.plans || [];
      const formattedPlans = plans.map((plan) => ({
        id: plan.id,
        companyName: plan.companyName || "N/A",
        jobTitle: plan.jobTitle || "N/A",
        interviewType: plan.interviewType || "N/A",
        jobDescription: plan.jobDescription || "",
        status: plan.status || "unknown", // Use status from backend (filtered to 'completed')
        questionsGenerated: plan.questionCount || 0,
        createdAt: plan.timestamp,
      }));

      setPreparations(formattedPlans);
    } catch (error) {
      console.error("Failed to load preparations:", error);
      setPreparations([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      completed: { color: "green", label: "Ready" },
      processing: { color: "blue", label: "Processing" },
      failed: { color: "red", label: "Failed" },
    };
    const config = statusMap[status] || { color: "grey", label: status };
    return <Badge color={config.color}>{config.label}</Badge>;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleContinueToListening = () => {
    if (selectedPreparation.length === 0) {
      setError("Please select an interview preparation to continue");
      return;
    }
    setCurrentStep("listening");
  };

  const handleSkipPreparation = () => {
    setSelectedPreparation([]);
    setCurrentStep("listening");
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

  const startCapture = async () => {
    try {
      setError(null);

      // Step 1: Request system audio capture
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
      console.log("   Audio track state:", systemAudioTrack.readyState);
      console.log("   Audio track enabled:", systemAudioTrack.enabled);

      // Create a new stream with only the audio track
      const audioOnlyStream = new MediaStream([systemAudioTrack]);

      // Keep video track alive for frame capture (don't stop it)
      const videoTrack = sysStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrackRef.current = videoTrack;
        console.log(
          "✅ Video track captured for frame capture:",
          videoTrack.label,
        );
      }

      setSystemStream(audioOnlyStream);

      // Step 2: Request microphone access
      let micStreamObj = null;
      try {
        micStreamObj = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        console.log(
          "✅ Microphone captured:",
          micStreamObj.getAudioTracks()[0].label,
        );
        setMicStream(micStreamObj);
      } catch (micError) {
        console.warn(
          "⚠️ Microphone access denied, continuing with system audio only:",
          micError,
        );
        // Continue without mic - not a fatal error
      }

      // Step 3: Mix both audio sources
      const mixedStream = await mixAudioStreams(audioOnlyStream, micStreamObj);

      // Connect to WebSocket
      await connectWebSocket(mixedStream);

      // Step 4: Setup video capture if video track is available
      if (videoTrackRef.current) {
        await setupVideoCapture(videoTrackRef.current);

        // Step 5: Setup MediaRecorder for full-resolution video recording (PATH B)
        await setupMediaRecorder(videoTrackRef.current, mixedStream);
      }

      setIsCapturing(true);
      setShowInstructions(false);
    } catch (error) {
      console.error("Failed to capture audio:", error);
      if (error.name === "NotAllowedError") {
        setError(
          'Permission denied. Please allow screen sharing and check "Share system audio".',
        );
      } else if (error.message.includes("No system audio")) {
        setError(error.message);
      } else {
        setError("Failed to capture audio. Please try again.");
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
              `${API_BASE_URL}/api/candidate/video/start-upload`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionIdRef.current,
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
            `${API_BASE_URL}/api/candidate/video/get-upload-url`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                sessionId: sessionIdRef.current,
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

            // Upload the combined chunk
            await uploadBufferedChunk(combinedBlob);

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

      // Wait a bit for final ondataavailable
      await new Promise((resolve) => setTimeout(resolve, 1000));

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
              `${API_BASE_URL}/api/candidate/video/start-upload`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionIdRef.current,
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
              `${API_BASE_URL}/api/candidate/video/get-upload-url`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionIdRef.current,
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
            `${API_BASE_URL}/api/candidate/video/complete-upload`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                sessionId: sessionIdRef.current,
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
              `${API_BASE_URL}/api/candidate/video/get-frame-upload-url`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sessionId: sessionIdRef.current,
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

  const mixAudioStreams = async (systemStream, microphoneStream) => {
    try {
      // Create audio context for mixing
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      setAudioContext(audioCtx);

      // Create sources
      const systemSource = audioCtx.createMediaStreamSource(systemStream);

      // Create destination for mixing
      const destination = audioCtx.createMediaStreamDestination();

      // Create analysers for debugging audio levels
      const systemAnalyser = audioCtx.createAnalyser();
      systemAnalyser.fftSize = 256;
      const systemDataArray = new Uint8Array(systemAnalyser.frequencyBinCount);

      // Connect system audio with analyser
      systemSource.connect(systemAnalyser);
      systemAnalyser.connect(destination);

      // Monitor system audio level
      const checkSystemAudio = () => {
        systemAnalyser.getByteFrequencyData(systemDataArray);
        const systemLevel =
          systemDataArray.reduce((a, b) => a + b, 0) / systemDataArray.length;
        console.log(`🔊 System audio level: ${systemLevel.toFixed(2)}`);
      };
      setTimeout(checkSystemAudio, 1000);
      setTimeout(checkSystemAudio, 3000);

      // Connect microphone if available
      if (microphoneStream) {
        const micSource = audioCtx.createMediaStreamSource(microphoneStream);
        const micAnalyser = audioCtx.createAnalyser();
        micAnalyser.fftSize = 256;
        const micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);

        micSource.connect(micAnalyser);
        micAnalyser.connect(destination);

        // Monitor mic audio level
        const checkMicAudio = () => {
          micAnalyser.getByteFrequencyData(micDataArray);
          const micLevel =
            micDataArray.reduce((a, b) => a + b, 0) / micDataArray.length;
          console.log(`🎤 Microphone audio level: ${micLevel.toFixed(2)}`);
        };
        setTimeout(checkMicAudio, 1000);
        setTimeout(checkMicAudio, 3000);

        console.log("✅ Audio mixed: System + Microphone");
      } else {
        console.log("✅ Audio source: System only");
      }

      return destination.stream;
    } catch (error) {
      console.error("Failed to mix audio streams:", error);
      // Fallback to system audio only
      return systemStream;
    }
  };

  const connectWebSocket = async (stream) => {
    try {
      // Get userId from authenticated user, or use default for NO_AUTH mode
      // IMPORTANT: Prioritize email over username to ensure DynamoDB queries match stored data
      let userId = user?.email || user?.username || user?.sub;
      if (!userId) {
        // Fallback for NO_AUTH development mode
        userId = "local-dev-user@example.com";
        console.log("[LiveAssistant] Using dev userId (NO_AUTH mode):", userId);
      } else {
        console.log(
          "[LiveAssistant] Connected with authenticated userId:",
          userId,
        );
      }

      // Step 1: Request pre-signed WebSocket URL
      const API_BASE_URL =
        process.env.REACT_APP_API_URL || "http://localhost:8000";
      const token = localStorage.getItem("authToken") || "";

      console.log("[LiveAssistant] Requesting pre-signed WebSocket URL...");
      const response = await fetch(`${API_BASE_URL}/api/get-ws-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
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
      console.log("[LiveAssistant] Received pre-signed WebSocket URL");

      // Step 2: Connect to pre-signed URL
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[LiveAssistant] WebSocket connected via pre-signed URL");
        setIsConnected(true);

        // Step 3: Send initialization message with sessionType and prep context
        const initMessage = {
          type: "init",
          sessionType: "candidateAssistant",
          userId: userId,
          practiceSessionId:
            selectedPreparation.length > 0 ? selectedPreparation[0].id : null,
        };

        console.log(
          "[LiveAssistant] Sending initialization message:",
          initMessage,
        );
        ws.send(JSON.stringify(initMessage));
        console.log("[LiveAssistant] Initialization message sent");

        // Start sending audio after connection is established
        startAudioSending(stream);
      };

      ws.onclose = (event) => {
        console.log(
          `Live Assistant WebSocket closed - Code: ${event.code}, Reason: ${event.reason || "No reason provided"}, Clean: ${event.wasClean}`,
        );
        setIsConnected(false);
      };

      ws.onerror = (error) => {
        console.error("Live Assistant WebSocket error:", error);
        setError("Connection error occurred");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };
    } catch (error) {
      console.error("WebSocket connection failed:", error);
      setError("Failed to connect to server");
    }
  };

  const handleWebSocketMessage = (message) => {
    if (!message.event) return;

    const eventType = Object.keys(message.event)[0];
    const eventData = message.event[eventType];

    console.log("[Live Assistant] Event:", eventType, eventData);

    switch (eventType) {
      case "transcription":
        if (eventData.isPartial) {
          // Update partial transcript (real-time preview)
          setPartialTranscript(eventData.content);
        } else {
          // Add final transcript with speaker label (consolidate if same speaker)
          setTranscriptions((prev) => {
            const lastMessage = prev[prev.length - 1];
            const currentSpeaker = eventData.speaker || null;
            const content = eventData.content;

            // Check if last message is from the same speaker (consolidate)
            if (lastMessage && lastMessage.speaker === currentSpeaker) {
              // Check if this is new content or duplicate
              const isNewContent =
                content.trim() && !lastMessage.content.includes(content.trim());

              if (isNewContent) {
                // Append to existing speaker's transcript
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...lastMessage,
                  content: lastMessage.content + " " + content.trim(),
                  timestamp: eventData.timestamp,
                };
                return updated;
              }
              // Duplicate content, no change
              return prev;
            }

            // New speaker or first transcript
            return [
              ...prev,
              {
                content: content,
                timestamp: eventData.timestamp,
                isPartial: false,
                speaker: currentSpeaker,
              },
            ];
          });
          // Clear partial transcript
          setPartialTranscript("");
        }
        break;

      case "sessionStarted":
        console.log("✅ Transcription session started");
        break;

      case "preparationReceived":
        console.log("✅ Interview preparation info acknowledged by server");
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
        console.log("[LiveAssistant] Received coaching tip:", eventData);

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
        console.log("[LiveAssistant] Frame requested by Agent:", eventData);
        handleFrameRequest(eventData).catch((err) => {
          console.error("❌ Frame request handler failed:", err);
        });
        break;

      default:
        console.log("Unhandled event type:", eventType);
    }
  };

  const startAudioSending = (stream) => {
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioCtx.destination);

    // Store reference for cleanup
    audioProcessorRef.current = { audioContext: audioCtx, processor, source };

    console.log("✅ Audio processor started, will send audio to WebSocket");

    let audioChunkCount = 0;

    processor.onaudioprocess = (e) => {
      // Only check WebSocket state (not isCapturing due to closure/async issues)
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = new Int16Array(inputData.length);

      // Convert Float32Array to Int16Array (PCM)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Convert to base64
      const bytes = new Uint8Array(pcmData.buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Audio = btoa(binary);

      // Send to WebSocket in expected format
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
  };

  const requestCoaching = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to server");
      return;
    }

    console.log("🤖 Requesting AI coaching...");
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

  const stopCapture = async () => {
    // Stop MediaRecorder first (PATH B)
    await stopMediaRecorder();

    // Stop WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ event: { stop: {} } }));
        wsRef.current.close();
      } catch (e) {
        console.error("Error closing WebSocket:", e);
      }
      wsRef.current = null;
    }

    // Stop audio processing
    if (audioProcessorRef.current) {
      const { audioContext, processor, source } = audioProcessorRef.current;
      try {
        processor.disconnect();
        source.disconnect();
        audioContext.close();
      } catch (e) {
        console.error("Error closing audio processor:", e);
      }
      audioProcessorRef.current = null;
    }

    // Stop system audio stream
    if (systemStream) {
      systemStream.getTracks().forEach((track) => track.stop());
      setSystemStream(null);
    }

    // Stop microphone stream
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      setMicStream(null);
    }

    // Close audio context
    if (audioContext) {
      audioContext.close();
      setAudioContext(null);
    }

    // Stop video capture (PATH A)
    stopVideoCapture();

    setIsCapturing(false);
    setIsConnected(false);
    setPartialTranscript("");

    // Show save modal
    setShowSaveModal(true);
  };

  const handleSaveInterview = async () => {
    try {
      setIsSaving(true);
      setError(null);

      // Combine all transcript text for LLM analysis
      const fullTranscript = transcriptions
        .filter((t) => !t.isPartial)
        .map((t) => t.content)
        .join(" ");

      if (!fullTranscript.trim()) {
        setError("No transcript available to save");
        return;
      }

      // Prepare transcript array with speaker information for display
      const transcriptWithSpeakers = transcriptions
        .filter((t) => !t.isPartial)
        .map((t) => ({
          text: t.content,
          speaker: t.speaker || "unknown",
          timestamp: t.timestamp,
        }));

      // Generate a name for the interview session
      const interviewName =
        selectedPreparation.length > 0
          ? `${selectedPreparation[0].companyName} - ${selectedPreparation[0].jobTitle} Candidate`
          : "Candidate Interview Session Recording";

      const sessionData = {
        sessionId: sessionIdRef.current,
        interviewId:
          selectedPreparation.length > 0 ? selectedPreparation[0].id : "",
        interviewName,
        transcript: fullTranscript,
        transcriptArray: JSON.stringify(transcriptWithSpeakers),
        duration: formatDuration(),
        videoLocation: videoLocationRef.current, // PATH B: S3 location from MediaRecorder upload
        // Note: Video recording handled by PATH B (MediaRecorder) during session
        // Video uploaded via multipart upload complete-upload endpoint
      };

      console.log(`📝 Saving interview session metadata`, {
        sessionId: sessionIdRef.current,
        videoLocation: videoLocationRef.current,
        hasVideoLocation: !!videoLocationRef.current,
      });

      const response = await candidateAPI.saveInterviewSession(sessionData);
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
    navigate("/candidate/sessions");
  };

  // Render different UI based on current step
  if (currentStep === "preparation") {
    return (
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description="Select an interview preparation to get personalized AI coaching"
        >
          Live Assistant - Select Preparation
        </Header>

        {error && (
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Container>
          <Table
            columnDefinitions={[
              {
                id: "companyName",
                header: "Company",
                cell: (item) => item.companyName,
                sortingField: "companyName",
              },
              {
                id: "jobTitle",
                header: "Position",
                cell: (item) => item.jobTitle,
                sortingField: "jobTitle",
              },
              {
                id: "interviewType",
                header: "Type",
                cell: (item) => item.interviewType,
                sortingField: "interviewType",
              },
              {
                id: "status",
                header: "Status",
                cell: (item) => getStatusBadge(item.status),
              },
              {
                id: "questions",
                header: "Questions",
                cell: (item) => item.questionsGenerated,
              },
              {
                id: "createdAt",
                header: "Created",
                cell: (item) => formatDate(item.createdAt),
                sortingField: "createdAt",
              },
            ]}
            items={preparations}
            loading={loading}
            loadingText="Loading interview preparations..."
            selectionType="single"
            selectedItems={selectedPreparation}
            onSelectionChange={({ detail }) =>
              setSelectedPreparation(detail.selectedItems)
            }
            empty={
              <Box textAlign="center" color="inherit">
                <b>No interview preparations</b>
                <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                  Create an interview preparation first, or skip to continue
                  without one.
                </Box>
              </Box>
            }
            filter={
              <TextFilter
                filteringText={filteringText}
                filteringPlaceholder="Find interview preparations"
                onChange={({ detail }) =>
                  setFilteringText(detail.filteringText)
                }
              />
            }
            header={
              <Header
                counter={`(${preparations.length})`}
                actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button onClick={handleSkipPreparation}>
                      Skip (No Preparation)
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleContinueToListening}
                      disabled={selectedPreparation.length === 0}
                    >
                      Continue
                    </Button>
                  </SpaceBetween>
                }
              >
                Interview Preparations
              </Header>
            }
          />
        </Container>
      </SpaceBetween>
    );
  }

  // Step 2: Listening Mode
  return (
    <SpaceBetween size="l">
      <Flashbar items={flashMessages} />

      <Header
        variant="h1"
        description="Get real-time AI coaching during your meetings"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              iconName="arrow-left"
              onClick={() => setCurrentStep("preparation")}
              disabled={isCapturing}
            >
              Back to Preparation Selection
            </Button>
            {isCapturing && (
              <Button variant="primary" onClick={stopCapture}>
                End & Save Interview
              </Button>
            )}
          </SpaceBetween>
        }
      >
        Live Assistant - Listening Mode
      </Header>

      {/* Instructions */}
      {showInstructions && (
        <Alert type="info" header="How to use Listening Mode">
          <SpaceBetween size="s">
            <Box variant="p">
              <strong>Step-by-step guide:</strong>
            </Box>
            <ol style={{ margin: "8px 0", paddingLeft: "24px" }}>
              <li>Click "Start Listening Mode" below</li>
              <li>A screen sharing dialog will appear</li>
              <li>Select any screen, window, or tab to share</li>
              <li>
                <strong>Important: Check "Share system audio" checkbox</strong>{" "}
                - This captures others' voices
              </li>
              <li>Click "Share" to start</li>
              <li>
                Allow microphone access when prompted - This captures your voice
              </li>
            </ol>

            <Box variant="p" margin={{ top: "s" }}>
              <strong>What gets captured:</strong>
            </Box>
            <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
              <li>
                <strong>System audio:</strong> Other participants' voices in the
                meeting (via screen share)
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
      )}

      {/* Error Alert */}
      {error && (
        <Alert type="error" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Selected Interview Preparation */}
      {selectedPreparation.length > 0 && (
        <Container>
          <SpaceBetween size="xs">
            <Box variant="h3">Interview Context</Box>
            <Box>
              <strong>Company:</strong> {selectedPreparation[0].companyName}
            </Box>
            <Box>
              <strong>Position:</strong> {selectedPreparation[0].jobTitle}
            </Box>
            <Box>
              <strong>Type:</strong> {selectedPreparation[0].interviewType}
            </Box>
          </SpaceBetween>
        </Container>
      )}

      {/* Status Bar */}
      {isCapturing ? (
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
              <Box variant="awsui-key-label">Elapsed Time</Box>
              <Box variant="h2">{formatTime(elapsedTime)}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Transcript Lines</Box>
              <Box variant="h2">{transcriptions.length}</Box>
            </div>
          </SpaceBetween>
        </Container>
      ) : (
        <Container>
          <SpaceBetween size="m">
            <Box>
              <SpaceBetween size="xs" direction="horizontal">
                <Box variant="awsui-key-label">Status:</Box>
                <StatusIndicator type="stopped">Not started</StatusIndicator>
              </SpaceBetween>
            </Box>

            <Box>
              <SpaceBetween size="xs" direction="horizontal">
                <Box variant="awsui-key-label">Connection:</Box>
                <Badge color="grey">Disconnected</Badge>
              </SpaceBetween>
            </Box>

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

            <Box textAlign="center" padding={{ vertical: "l" }}>
              <Button
                variant="primary"
                iconName="microphone"
                onClick={startCapture}
              >
                Start Listening Mode
              </Button>
            </Box>
          </SpaceBetween>
        </Container>
      )}

      {/* Automatic Coaching Tips Section */}
      {isCapturing && coachingTips.length > 0 && (
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
      {isCapturing && (
        <Container>
          <SpaceBetween size="m">
            <Header
              variant="h3"
              description="Get personalized coaching advice based on the conversation"
            >
              AI Coaching Request
            </Header>

            <FormField
              label="Your Question (Optional)"
              description="Ask a specific question or leave blank for general coaching"
            >
              <Textarea
                value={coachingRequest}
                onChange={({ detail }) => setCoachingRequest(detail.value)}
                placeholder="e.g., How should I answer questions about AWS experience? What should I emphasize about my background?"
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
                transcriptions.length === 0 ||
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

      {/* Transcription */}
      {(transcriptions.length > 0 || partialTranscript) && (
        <ExpandableSection
          headerText={`Live Transcription (${transcriptions.length} final transcripts)`}
          defaultExpanded={true}
        >
          <SpaceBetween size="m">
            {/* Show partial transcript (real-time preview) */}
            {partialTranscript && (
              <Box padding="s" backgroundColor="background-container-content">
                <SpaceBetween size="xs">
                  <Box>
                    <Badge color="grey">Listening...</Badge>
                  </Box>
                  <Box
                    variant="p"
                    fontStyle="italic"
                    color="text-body-secondary"
                  >
                    {partialTranscript}
                  </Box>
                </SpaceBetween>
              </Box>
            )}

            {/* Show final transcripts with speaker labels (chat-bubble style like LivePracticeSession) */}
            <Box
              style={{
                maxHeight: "500px",
                overflowY: "auto",
                backgroundColor: "#f8f9fa",
                borderRadius: "4px",
                padding: "16px",
              }}
            >
              <SpaceBetween size="m">
                {transcriptions.map((msg, index) => (
                  <div key={`transcript-${msg.timestamp}-${index}`}>
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
                          // Apply speaker-specific colors
                          ...getSpeakerStyle(msg.speaker),
                          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
                        }}
                      >
                        <div style={{ marginBottom: "4px" }}>
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: "600",
                              opacity: 1,
                            }}
                          >
                            {msg.speaker ? `Speaker ${msg.speaker}` : "Speaker"}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "14px",
                            lineHeight: "1.5",
                            wordBreak: "break-word",
                          }}
                        >
                          {msg.content}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "currentColor",
                            opacity: 0.7,
                            marginTop: "4px",
                          }}
                        >
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </SpaceBetween>
            </Box>
          </SpaceBetween>
        </ExpandableSection>
      )}

      {/* Help Section */}
      <ExpandableSection
        headerText="Troubleshooting & Tips"
        variant="container"
      >
        <SpaceBetween size="s">
          <Box variant="h4">No audio is being captured?</Box>
          <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
            <li>
              Make sure you checked "Share system audio" in the sharing dialog
            </li>
            <li>Chrome and Edge work best - Firefox has limited support</li>
            <li>Try selecting "Entire Screen" instead of specific windows</li>
          </ul>

          <Box variant="h4">Alternative: Virtual Audio Device</Box>
          <Box variant="p">
            For more reliable audio capture, consider installing a virtual audio
            device:
          </Box>
          <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
            <li>
              <strong>macOS:</strong> BlackHole (free, open source)
            </li>
            <li>
              <strong>Windows:</strong> VB-Cable or Voicemeeter
            </li>
          </ul>

          <Box variant="h4">Use Cases</Box>
          <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
            <li>Practice interviews while in a mock interview session</li>
            <li>Get real-time feedback during phone screens</li>
            <li>Analyze your communication patterns in meetings</li>
          </ul>
        </SpaceBetween>
      </ExpandableSection>

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
                onClick={() =>
                  navigate(`/candidate/sessions/${sessionIdRef.current}`)
                }
              >
                View Full Assessment
              </Button>
            </Box>
          </SpaceBetween>
        ) : (
          <SpaceBetween size="m">
            <Box variant="p">This will save the interview session with:</Box>
            <ul>
              <li>Full transcript ({transcriptions.length} lines)</li>
              <li>Duration: {formatDuration()}</li>
              <li>AI-generated interview summary</li>
              <li>Detailed interview notes</li>
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

export default LiveAssistant;
