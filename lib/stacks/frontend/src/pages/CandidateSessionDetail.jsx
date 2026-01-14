import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Spinner,
  Alert,
  Badge,
  ExpandableSection,
} from "@cloudscape-design/components";
import { candidateAPI } from "../services/api";

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

function CandidateSessionDetail() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);

  useEffect(() => {
    loadSessionDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const loadSessionDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await candidateAPI.getInterviewSession(sessionId);

      // Axios returns response.data with the actual data
      const data = response.data;
      setSession(data.session);

      // Check if video recording exists and load it
      if (data.session && data.session.videoLocation) {
        loadVideoUrl(data.session.videoLocation);
      }
    } catch (err) {
      console.error("Failed to load session detail:", err);
      setError(err.message || "Failed to load interview session");
    } finally {
      setLoading(false);
    }
  };

  const loadVideoUrl = async (videoLocation) => {
    try {
      setVideoLoading(true);

      // Extract S3 key from video location (format: s3://bucket/key)
      const s3Key = videoLocation.replace(/^s3:\/\/[^/]+\//, "");

      // Request presigned URL from backend
      const API_BASE_URL =
        process.env.REACT_APP_API_URL || "http://localhost:8000";
      const token = localStorage.getItem("authToken") || "";

      const response = await fetch(
        `${API_BASE_URL}/api/candidate/video/get-url`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            s3Key: s3Key,
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        setVideoUrl(data.url);
      } else {
        console.error("Failed to get video URL:", response.statusText);
      }
    } catch (err) {
      console.error("Error loading video URL:", err);
    } finally {
      setVideoLoading(false);
    }
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
      timeZoneName: "short",
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return "0 seconds";

    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    } else if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    } else {
      return `${secs} second${secs !== 1 ? "s" : ""}`;
    }
  };

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: "s" }}>
            Loading interview session...
          </Box>
        </Box>
      </Container>
    );
  }

  if (error || !session) {
    return (
      <Container>
        <Alert type="error" header="Error loading session">
          {error || "Interview session not found"}
        </Alert>
        <Box margin={{ top: "m" }}>
          <Button onClick={() => navigate("/candidate/sessions")}>
            Back to Sessions
          </Button>
        </Box>
      </Container>
    );
  }

  // Safely extract summary object - handle case where summary might be the whole object
  let summary = {};
  let competency = {};
  let concern = {};

  if (session.summary) {
    // If session.summary has summary/competency/concern properties, use it as-is
    if (
      session.summary.summary ||
      session.summary.competency ||
      session.summary.interviewNotes ||
      session.summary.concern
    ) {
      summary = session.summary;
    } else {
      // Otherwise treat session.summary as the summary string
      summary = { summary: session.summary };
    }
  }

  competency = summary.competency || {};
  concern = summary.concern || {};

  // Helper to safely render text content (convert objects to strings if needed)
  const safeText = (value) => {
    if (typeof value === "string") return value;
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  // Check if transcriptArray is available (structured transcript with speakers)
  const hasTranscriptArray =
    session.transcriptArray &&
    Array.isArray(session.transcriptArray) &&
    session.transcriptArray.length > 0;

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <Button onClick={() => navigate("/candidate/sessions")}>
            Back to Sessions
          </Button>
        }
      >
        Interview Session Details
      </Header>

      {/* Session Overview */}
      <Container header={<Header variant="h2">Session Information</Header>}>
        <SpaceBetween size="m">
          <div>
            <Box variant="awsui-key-label">Interview Name</Box>
            <Box variant="p">{session.interviewName || "N/A"}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Date</Box>
            <Box variant="p">{formatDate(session.timestamp)}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Duration</Box>
            <Box variant="p">{formatDuration(session.duration)}</Box>
          </div>
          {session.interviewId && (
            <div>
              <Box variant="awsui-key-label">Interview Plan ID</Box>
              <Box variant="p">{session.interviewId}</Box>
            </div>
          )}
          {session.videoLocation && (
            <div>
              <Box variant="awsui-key-label">Video Recording</Box>
              <Badge color="green">Available</Badge>
            </div>
          )}
        </SpaceBetween>
      </Container>

      {/* Video Recording Playback */}
      {session.videoLocation && (
        <Container header={<Header variant="h2">Video Recording</Header>}>
          <SpaceBetween size="m">
            {videoLoading ? (
              <Box textAlign="center" padding="l">
                <Spinner size="large" />
                <Box variant="p" padding={{ top: "s" }}>
                  Loading video...
                </Box>
              </Box>
            ) : videoUrl ? (
              <div>
                <video
                  controls
                  style={{
                    width: "100%",
                    maxWidth: "1200px",
                    backgroundColor: "#000",
                    borderRadius: "8px",
                  }}
                >
                  <source src={videoUrl} type="video/webm" />
                  <source src={videoUrl} type="video/mp4" />
                  Your browser does not support the video player.
                </video>
                <Box
                  variant="small"
                  color="text-body-secondary"
                  padding={{ top: "s" }}
                >
                  Screen share recording with system audio and microphone
                </Box>
              </div>
            ) : (
              <Alert type="warning">
                Video recording is available but could not be loaded. Please try
                refreshing the page.
              </Alert>
            )}
          </SpaceBetween>
        </Container>
      )}

      {/* Executive Summary */}
      <Container header={<Header variant="h2">Executive Summary</Header>}>
        <Box variant="p" whiteSpace="pre-wrap">
          {summary.summary ? safeText(summary.summary) : "No summary available"}
        </Box>
      </Container>

      {/* Interview Notes */}
      {summary.interviewNotes && (
        <Container header={<Header variant="h2">Interview Notes</Header>}>
          <Box variant="p" whiteSpace="pre-wrap">
            {safeText(summary.interviewNotes)}
          </Box>
        </Container>
      )}

      {/* Competency Assessment */}
      {(competency.strengths || competency.areasForImprovement) && (
        <Container header={<Header variant="h2">Competency Assessment</Header>}>
          <SpaceBetween size="m">
            {competency.strengths &&
              Array.isArray(competency.strengths) &&
              competency.strengths.length > 0 && (
                <div>
                  <Box variant="awsui-key-label">Strengths</Box>
                  <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                    {competency.strengths.map((strength, index) => (
                      <li key={index}>
                        <Box variant="p">{safeText(strength)}</Box>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {competency.areasForImprovement &&
              Array.isArray(competency.areasForImprovement) &&
              competency.areasForImprovement.length > 0 && (
                <div>
                  <Box variant="awsui-key-label">Areas for Improvement</Box>
                  <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                    {competency.areasForImprovement.map((area, index) => (
                      <li key={index}>
                        <Box variant="p">{safeText(area)}</Box>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </SpaceBetween>
        </Container>
      )}

      {!competency.strengths && !competency.areasForImprovement && (
        <Container header={<Header variant="h2">Competency Assessment</Header>}>
          <Alert type="info">
            No competency assessment available for this session.
          </Alert>
        </Container>
      )}

      {/* Concerns and Areas for Improvement */}
      {(concern.redFlags || concern.areasToExplore) && (
        <Container
          header={
            <Header variant="h2">Concerns and Areas for Improvement</Header>
          }
        >
          <SpaceBetween size="m">
            {concern.redFlags &&
              Array.isArray(concern.redFlags) &&
              concern.redFlags.length > 0 && (
                <div>
                  <Box variant="awsui-key-label">Red Flags</Box>
                  <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                    {concern.redFlags.map((flag, index) => (
                      <li key={index}>
                        <Box variant="p" color="text-status-error">
                          {safeText(flag)}
                        </Box>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {concern.areasToExplore &&
              Array.isArray(concern.areasToExplore) &&
              concern.areasToExplore.length > 0 && (
                <div>
                  <Box variant="awsui-key-label">Areas to Explore</Box>
                  <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                    {concern.areasToExplore.map((area, index) => (
                      <li key={index}>
                        <Box variant="p">{safeText(area)}</Box>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </SpaceBetween>
        </Container>
      )}

      {/* Full Transcript */}
      <Container header={<Header variant="h2">Full Transcript</Header>}>
        <ExpandableSection
          headerText="View Complete Interview Transcript"
          defaultExpanded={false}
        >
          {hasTranscriptArray ? (
            // Render structured transcript with speaker bubbles
            <Box
              style={{
                maxHeight: "600px",
                overflowY: "auto",
                backgroundColor: "#f8f9fa",
                borderRadius: "4px",
                padding: "16px",
              }}
            >
              <SpaceBetween size="m">
                {session.transcriptArray.map((item, index) => (
                  <div key={`transcript-${index}`}>
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
                          ...getSpeakerStyle(item.speaker),
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
                            {item.speaker
                              ? `Speaker ${item.speaker}`
                              : "Speaker"}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "14px",
                            lineHeight: "1.5",
                            wordBreak: "break-word",
                          }}
                        >
                          {item.text}
                        </div>
                        {item.timestamp && (
                          <div
                            style={{
                              fontSize: "11px",
                              color: "currentColor",
                              opacity: 0.7,
                              marginTop: "4px",
                            }}
                          >
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </SpaceBetween>
            </Box>
          ) : (
            // Fallback when transcriptArray is not available
            <Box
              padding="s"
              backgroundColor="background-container-content"
              style={{
                maxHeight: "600px",
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                fontSize: "14px",
              }}
            >
              No transcript available for this session
            </Box>
          )}
        </ExpandableSection>
      </Container>
    </SpaceBetween>
  );
}

export default CandidateSessionDetail;
