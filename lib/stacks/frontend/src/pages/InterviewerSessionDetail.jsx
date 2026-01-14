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
import { interviewerAPI } from "../services/api";

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

function InterviewerSessionDetail() {
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
      const response = await interviewerAPI.getInterviewSession(sessionId);

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
        `${API_BASE_URL}/api/interviewer/video/get-url`,
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
          <Button onClick={() => navigate("/interviewer/sessions")}>
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

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <Button onClick={() => navigate("/interviewer/sessions")}>
            Back to Sessions
          </Button>
        }
      >
        Interview Assessment
      </Header>

      {/* Basic Information */}
      <Container header={<Header variant="h2">Session Information</Header>}>
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Interview Name</Box>
            <Box variant="p">{safeText(session.interviewName) || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Date Created</Box>
            <Box variant="p">{formatDate(session.createdAt)}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Duration</Box>
            <Box variant="p">{formatDuration(session.duration)}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Status</Box>
            <Box variant="p">
              <Badge color={session.status === "completed" ? "green" : "blue"}>
                {session.status || "N/A"}
              </Badge>
            </Box>
          </Box>
          {session.interviewId && (
            <Box>
              <Box variant="awsui-key-label">Interview ID</Box>
              <Box variant="code">{session.interviewId}</Box>
            </Box>
          )}
          {session.videoLocation && (
            <Box>
              <Box variant="awsui-key-label">Video Recording</Box>
              <Badge color="green">Available</Badge>
            </Box>
          )}
        </SpaceBetween>
      </Container>

      {/* Interview Plan Questions (if available) */}
      {session.interviewPlan &&
        session.interviewPlan.questions &&
        session.interviewPlan.questions.length > 0 && (
          <Container
            header={<Header variant="h2">Interview Plan Questions</Header>}
          >
            {/* Question Coverage Summary */}
            <Box padding={{ bottom: "m" }}>
              <SpaceBetween direction="horizontal" size="l">
                <Box>
                  <Box variant="awsui-key-label">Questions Asked</Box>
                  <Box variant="h2">
                    {
                      session.interviewPlan.questions.filter(
                        (q) =>
                          q.status === "completed" ||
                          q.status === "in_progress",
                      ).length
                    }{" "}
                    / {session.interviewPlan.questions.length}
                  </Box>
                </Box>
                <Box>
                  <Box variant="awsui-key-label">Coverage (Completed)</Box>
                  <Box variant="h2">
                    {
                      session.interviewPlan.questions.filter(
                        (q) => q.status === "completed",
                      ).length
                    }{" "}
                    / {session.interviewPlan.questions.length}
                  </Box>
                </Box>
              </SpaceBetween>
            </Box>
            <ExpandableSection
              headerText={`View Questions (${session.interviewPlan.questions.length} total)`}
              defaultExpanded={true}
            >
              <SpaceBetween size="m">
                {session.interviewPlan.questions.map((q, index) => {
                  // Get question progression status - read directly from question object
                  // Status is stored in the question object itself: q.status, q.startTime, q.endTime
                  const status = q.status || "not_started";
                  const isCompleted = status === "completed";
                  const isInProgress = status === "in_progress";
                  const isNotAsked = status === "not_started";

                  // Calculate elapsed time if available
                  let elapsedTimeStr = "";
                  if (q.startTime && q.endTime) {
                    const elapsedMs = q.endTime - q.startTime;
                    const elapsedMinutes = Math.floor(elapsedMs / 60000);
                    const elapsedSeconds = Math.floor(
                      (elapsedMs % 60000) / 1000,
                    );
                    elapsedTimeStr = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, "0")}`;
                  }

                  return (
                    <Box
                      key={index}
                      padding="s"
                      backgroundColor={
                        isCompleted
                          ? "background-container-content"
                          : isInProgress
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
                                opacity: isNotAsked ? 0.5 : 1,
                                fontWeight: isCompleted ? "normal" : "bold",
                              }}
                            >
                              {isCompleted && "✅ "}
                              {isInProgress && "🔄 "}
                              {isNotAsked && "⏸️ "}
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
                              <Box variant="small" color="text-body-secondary">
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
                              opacity: isNotAsked ? 0.5 : 1,
                            }}
                          >
                            {q.questionText}
                          </Box>
                          {elapsedTimeStr && (
                            <Box
                              variant="small"
                              color="text-status-success"
                              display="block"
                              margin={{ top: "xxxs" }}
                            >
                              ⏱️ Time spent: {elapsedTimeStr}
                            </Box>
                          )}
                          {isNotAsked && (
                            <Box
                              variant="small"
                              color="text-status-inactive"
                              display="block"
                              margin={{ top: "xxxs" }}
                            >
                              Status: Not Asked
                            </Box>
                          )}
                          {isInProgress && (
                            <Box
                              variant="small"
                              color="text-status-info"
                              display="block"
                              margin={{ top: "xxxs" }}
                            >
                              Status: In Progress
                            </Box>
                          )}
                        </Box>
                        {q.evaluationChecklist &&
                          typeof q.evaluationChecklist === "string" &&
                          q.evaluationChecklist.trim().length > 0 && (
                            <div>
                              <Box
                                variant="small"
                                color="text-body-secondary"
                                padding={{ top: "xs" }}
                              >
                                Evaluation Checklist:
                              </Box>
                              <ul
                                style={{
                                  margin: "4px 0",
                                  paddingLeft: "20px",
                                  fontSize: "12px",
                                  opacity: isNotAsked ? 0.5 : 1,
                                }}
                              >
                                {q.evaluationChecklist
                                  .split("\n")
                                  .map((line) => line.trim())
                                  .filter((line) => line.length > 0)
                                  .map((line) => line.replace(/^[-*]\s*/, ""))
                                  .map((item, i) => (
                                    <li key={i}>{item}</li>
                                  ))}
                              </ul>
                            </div>
                          )}
                      </SpaceBetween>
                    </Box>
                  );
                })}
              </SpaceBetween>
            </ExpandableSection>
          </Container>
        )}

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
      {summary.summary && (
        <Container header={<Header variant="h2">Executive Summary</Header>}>
          <Box variant="p">
            <div style={{ whiteSpace: "pre-line", lineHeight: "1.6" }}>
              {safeText(summary.summary)}
            </div>
          </Box>
        </Container>
      )}

      {/* Interview Notes - Most Detailed Section */}
      {summary.interviewNotes && (
        <Container
          header={
            <Header
              variant="h2"
              description="Detailed question-by-question breakdown with candidate responses and observations"
            >
              Interview Notes
            </Header>
          }
        >
          <Box variant="p">
            <div
              style={{
                whiteSpace: "pre-line",
                lineHeight: "1.8",
                fontSize: "14px",
              }}
            >
              {safeText(summary.interviewNotes)}
            </div>
          </Box>
        </Container>
      )}

      {/* Competency Assessment */}
      <Container header={<Header variant="h2">Competency Assessment</Header>}>
        <SpaceBetween size="m">
          {/* Strengths */}
          {competency.strengths && competency.strengths.length > 0 && (
            <Box>
              <Box variant="h3" padding={{ bottom: "xs" }}>
                <Badge color="green">Strengths</Badge>
              </Box>
              <ul
                style={{
                  margin: "8px 0",
                  paddingLeft: "20px",
                  lineHeight: "1.8",
                }}
              >
                {competency.strengths.map((strength, i) => (
                  <li key={i} style={{ marginBottom: "8px" }}>
                    {safeText(strength)}
                  </li>
                ))}
              </ul>
            </Box>
          )}

          {/* Technical Skills */}
          {competency.technicalSkills &&
            competency.technicalSkills.length > 0 && (
              <Box>
                <Box variant="h3" padding={{ bottom: "xs" }}>
                  <Badge color="blue">Technical Skills</Badge>
                </Box>
                <ul
                  style={{
                    margin: "8px 0",
                    paddingLeft: "20px",
                    lineHeight: "1.8",
                  }}
                >
                  {competency.technicalSkills.map((skill, i) => (
                    <li key={i} style={{ marginBottom: "8px" }}>
                      {safeText(skill)}
                    </li>
                  ))}
                </ul>
              </Box>
            )}

          {/* Soft Skills */}
          {competency.softSkills && competency.softSkills.length > 0 && (
            <Box>
              <Box variant="h3" padding={{ bottom: "xs" }}>
                <Badge color="blue">Soft Skills</Badge>
              </Box>
              <ul
                style={{
                  margin: "8px 0",
                  paddingLeft: "20px",
                  lineHeight: "1.8",
                }}
              >
                {competency.softSkills.map((skill, i) => (
                  <li key={i} style={{ marginBottom: "8px" }}>
                    {safeText(skill)}
                  </li>
                ))}
              </ul>
            </Box>
          )}

          {(!competency.strengths || competency.strengths.length === 0) &&
            (!competency.technicalSkills ||
              competency.technicalSkills.length === 0) &&
            (!competency.softSkills || competency.softSkills.length === 0) && (
              <Box textAlign="center" padding="l" color="text-body-secondary">
                No competency assessment available
              </Box>
            )}
        </SpaceBetween>
      </Container>

      {/* Concerns and Areas for Improvement */}
      <Container
        header={
          <Header variant="h2">Concerns and Areas for Improvement</Header>
        }
      >
        <SpaceBetween size="m">
          {/* Weaknesses */}
          {concern.weaknesses && concern.weaknesses.length > 0 && (
            <Box>
              <Box variant="h3" padding={{ bottom: "xs" }}>
                <Badge color="red">Weaknesses</Badge>
              </Box>
              <ul
                style={{
                  margin: "8px 0",
                  paddingLeft: "20px",
                  lineHeight: "1.8",
                }}
              >
                {concern.weaknesses.map((weakness, i) => (
                  <li key={i} style={{ marginBottom: "8px" }}>
                    {safeText(weakness)}
                  </li>
                ))}
              </ul>
            </Box>
          )}

          {/* Red Flags */}
          {concern.redFlags && concern.redFlags.length > 0 && (
            <Box>
              <Box variant="h3" padding={{ bottom: "xs" }}>
                <Badge color="red">Red Flags</Badge>
              </Box>
              <ul
                style={{
                  margin: "8px 0",
                  paddingLeft: "20px",
                  lineHeight: "1.8",
                }}
              >
                {concern.redFlags.map((flag, i) => (
                  <li key={i} style={{ marginBottom: "8px" }}>
                    {safeText(flag)}
                  </li>
                ))}
              </ul>
            </Box>
          )}

          {/* Areas for Improvement */}
          {concern.areasForImprovement &&
            concern.areasForImprovement.length > 0 && (
              <Box>
                <Box variant="h3" padding={{ bottom: "xs" }}>
                  <Badge>Areas for Improvement</Badge>
                </Box>
                <ul
                  style={{
                    margin: "8px 0",
                    paddingLeft: "20px",
                    lineHeight: "1.8",
                  }}
                >
                  {concern.areasForImprovement.map((area, i) => (
                    <li key={i} style={{ marginBottom: "8px" }}>
                      {safeText(area)}
                    </li>
                  ))}
                </ul>
              </Box>
            )}

          {(!concern.weaknesses || concern.weaknesses.length === 0) &&
            (!concern.redFlags || concern.redFlags.length === 0) &&
            (!concern.areasForImprovement ||
              concern.areasForImprovement.length === 0) && (
              <Box textAlign="center" padding="l" color="text-body-secondary">
                No concerns identified
              </Box>
            )}
        </SpaceBetween>
      </Container>

      {/* Full Transcript */}
      {(session.transcriptArray || session.transcript) && (
        <Container header={<Header variant="h2">Full Transcript</Header>}>
          <ExpandableSection
            headerText="View Complete Interview Transcript"
            defaultExpanded={false}
          >
            {/* Check if structured transcript array is available - check both locations */}
            {(session.transcriptArray || session.metadata?.transcriptArray) &&
            (session.transcriptArray?.length > 0 ||
              session.metadata?.transcriptArray?.length > 0) ? (
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
                  {(
                    session.transcriptArray ||
                    session.metadata?.transcriptArray ||
                    []
                  ).map((item, index) => (
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
              // Fallback to plain text display
              <Box
                padding="m"
                backgroundColor="background-container-content"
                style={{
                  whiteSpace: "pre-line",
                  lineHeight: "1.6",
                  fontFamily: "monospace",
                  fontSize: "13px",
                  maxHeight: "600px",
                  overflowY: "auto",
                }}
              >
                {safeText(session.transcript)}
              </Box>
            )}
          </ExpandableSection>
        </Container>
      )}
    </SpaceBetween>
  );
}

export default InterviewerSessionDetail;
