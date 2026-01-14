import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Spinner,
  Alert,
  ExpandableSection,
  ColumnLayout,
  Badge,
  StatusIndicator,
} from "@cloudscape-design/components";
import { sessionAPI, audioAPI } from "../services/api";

function PracticeSessionDetail() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    loadSessionData();
  }, [sessionId]);

  // Load audio when session data is available
  useEffect(() => {
    if (sessionData && sessionData.audioUrl) {
      loadAudio();
    }
  }, [sessionData]);

  const loadSessionData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await sessionAPI.get(sessionId);

      // Axios returns data in response.data
      const data = response.data;
      // Extract session from response
      setSessionData(data.session || data);
    } catch (error) {
      console.error("Failed to load session:", error);
      setError(error.message || "Failed to load session data");
    } finally {
      setLoading(false);
    }
  };

  const loadAudio = async () => {
    try {
      setAudioLoading(true);
      setAudioError(null);
      const presignedUrl = await audioAPI.getSessionAudioUrl(sessionId);
      setAudioUrl(presignedUrl);
    } catch (error) {
      console.error("Failed to load audio:", error);
      setAudioError(
        "Failed to load audio. The recording may not be available.",
      );
    } finally {
      setAudioLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      setAudioError(null);
    }
  };

  const handleAudioError = (e) => {
    console.error("Audio loading error:", e);
    setAudioError(
      "Audio file not available. The recording may not have been saved properly.",
    );
    setIsPlaying(false);
  };

  const handleSeek = (e) => {
    if (!audioRef.current) return;
    const seekTime = (e.nativeEvent.offsetX / e.target.offsetWidth) * duration;
    audioRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: "s" }}>
            Loading session details...
          </Box>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <SpaceBetween size="m">
          <Alert type="error" header="Error loading session">
            {error}
          </Alert>
          <Button onClick={() => navigate("/practice")}>
            Back to Sessions
          </Button>
        </SpaceBetween>
      </Container>
    );
  }

  if (!sessionData) {
    return (
      <Container>
        <Alert type="warning" header="Session not found">
          The requested practice session could not be found.
        </Alert>
      </Container>
    );
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={`Session from ${formatDate(sessionData.createdAt)}`}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              variant="link"
              iconName="arrow-left"
              onClick={() => navigate("/practice")}
            >
              Back to Sessions
            </Button>
          </SpaceBetween>
        }
      >
        Practice Session Details
      </Header>

      {/* Session Overview */}
      <Container header={<Header variant="h2">Session Overview</Header>}>
        <ColumnLayout columns={4} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Session ID</Box>
            <div>{sessionData.sessionId || "N/A"}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Duration</Box>
            <div>{formatDuration(sessionData.duration)}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Messages</Box>
            <div>{sessionData.transcriptArray?.length || 0}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Status</Box>
            <div>
              <Badge color="green">Completed</Badge>
            </div>
          </div>
        </ColumnLayout>
      </Container>

      {/* Audio Player */}
      <Container header={<Header variant="h2">Audio Recording</Header>}>
        <SpaceBetween size="m">
          <Box>
            {audioLoading && (
              <Box textAlign="center" padding={{ vertical: "m" }}>
                <Spinner size="small" />
                <Box variant="p" padding={{ top: "xs" }}>
                  Loading audio...
                </Box>
              </Box>
            )}

            {audioUrl && (
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onError={handleAudioError}
                style={{ display: "none" }}
              />
            )}

            {audioError && (
              <Alert type="warning" header="Audio not available">
                {audioError}
              </Alert>
            )}

            {/* Play/Pause Button - AWS Cloudscape Style */}
            <Box textAlign="center" padding={{ vertical: "m" }}>
              <Button
                onClick={handlePlayPause}
                disabled={!!audioError || audioLoading || !audioUrl}
                variant={isPlaying ? "normal" : "primary"}
                iconName={isPlaying ? "close" : "caret-right-filled"}
              >
                {audioLoading
                  ? "Loading..."
                  : isPlaying
                    ? "Stop"
                    : "Play Audio"}
              </Button>
            </Box>

            {/* Progress Bar */}
            {!audioError && audioUrl && (
              <Box>
                <div
                  onClick={handleSeek}
                  style={{
                    width: "100%",
                    height: "8px",
                    backgroundColor: "#e0e0e0",
                    borderRadius: "4px",
                    cursor: duration > 0 ? "pointer" : "default",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                      height: "100%",
                      backgroundColor: "#0073bb",
                      transition: "width 0.1s linear",
                    }}
                  />
                </div>
                <Box margin={{ top: "xs" }}>
                  <SpaceBetween direction="horizontal" size="xs">
                    <Box fontSize="body-s" color="text-body-secondary">
                      {formatTime(currentTime)}
                    </Box>
                    <Box fontSize="body-s" color="text-body-secondary">
                      {formatTime(duration)}
                    </Box>
                  </SpaceBetween>
                </Box>
              </Box>
            )}
          </Box>

          {isPlaying && (
            <Box>
              <StatusIndicator type="in-progress">
                Playing audio...
              </StatusIndicator>
            </Box>
          )}
        </SpaceBetween>
      </Container>

      {/* Transcription */}
      <Container
        header={<Header variant="h2">Conversation Transcription</Header>}
      >
        {sessionData.transcriptArray &&
        sessionData.transcriptArray.length > 0 ? (
          <Box
            padding="l"
            style={{
              maxHeight: "600px",
              overflowY: "auto",
              backgroundColor: "#f8f9fa",
              borderRadius: "4px",
            }}
          >
            <SpaceBetween size="m">
              {sessionData.transcriptArray.map((transcript, index) => (
                <div
                  key={transcript.id || index}
                  style={{
                    display: "flex",
                    justifyContent:
                      transcript.role === "USER" ? "flex-end" : "flex-start",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "70%",
                      padding: "12px 16px",
                      borderRadius: "16px",
                      backgroundColor:
                        transcript.role === "USER" ? "#0073bb" : "#ffffff",
                      color: transcript.role === "USER" ? "#ffffff" : "#000716",
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
                        {transcript.role === "USER" ? "You" : "AI Interviewer"}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "14px",
                        lineHeight: "1.5",
                        wordBreak: "break-word",
                      }}
                    >
                      {transcript.text}
                    </div>
                  </div>
                </div>
              ))}
            </SpaceBetween>
          </Box>
        ) : (
          <Box padding="l" textAlign="center">
            <Box variant="p" color="text-body-secondary">
              No transcription available for this session.
            </Box>
          </Box>
        )}
      </Container>

      {/* Interview Plan Questions (if available) */}
      {sessionData.interviewPlan &&
        sessionData.interviewPlan.questions &&
        sessionData.interviewPlan.questions.length > 0 && (
          <Container
            header={<Header variant="h2">Interview Plan Questions</Header>}
          >
            <ExpandableSection
              headerText={`View Questions (${sessionData.interviewPlan.questions.length} total)`}
              defaultExpanded={true}
            >
              <SpaceBetween size="m">
                {sessionData.interviewPlan.questions.map((q, index) => (
                  <Box
                    key={index}
                    padding="s"
                    backgroundColor="background-container-content"
                  >
                    <SpaceBetween size="xs">
                      <Box>
                        <SpaceBetween direction="horizontal" size="xs">
                          <Box variant="strong">
                            Q{index + 1}: {q.questionText}
                          </Box>
                          {q.category && <Badge>{q.category}</Badge>}
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
                        </SpaceBetween>
                      </Box>
                      {q.expectedAnswer &&
                        typeof q.expectedAnswer === "string" &&
                        q.expectedAnswer.trim().length > 0 && (
                          <div>
                            <Box
                              variant="small"
                              color="text-body-secondary"
                              padding={{ top: "xs" }}
                            >
                              Answer Strategy:
                            </Box>
                            <Box
                              variant="p"
                              padding={{ top: "xs" }}
                              style={{
                                fontSize: "13px",
                                lineHeight: "1.5",
                              }}
                            >
                              {q.expectedAnswer}
                            </Box>
                          </div>
                        )}
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
                              }}
                            >
                              {q.evaluationChecklist
                                .split("\n")
                                .map((line) => line.trim())
                                .filter((line) => line.length > 0)
                                .map((item, i) => (
                                  <li key={i}>{item}</li>
                                ))}
                            </ul>
                          </div>
                        )}
                    </SpaceBetween>
                  </Box>
                ))}
              </SpaceBetween>
            </ExpandableSection>
          </Container>
        )}

      {/* Feedback */}
      <Container header={<Header variant="h2">Interview Feedback</Header>}>
        {sessionData.analysisStatus === "completed" && sessionData.analysis ? (
          <SpaceBetween size="l">
            {/* Overall Score */}
            <Box>
              <Box variant="awsui-key-label">Overall Score</Box>
              <Box
                fontSize="heading-xl"
                fontWeight="bold"
                color={
                  sessionData.analysis.overall_score >= 7
                    ? "text-status-success"
                    : sessionData.analysis.overall_score >= 5
                      ? "text-status-info"
                      : "text-status-error"
                }
              >
                {sessionData.analysis.overall_score} / 10
              </Box>
            </Box>

            {/* Summary */}
            {sessionData.analysis.summary && (
              <Box>
                <Box variant="awsui-key-label">Summary</Box>
                <Box variant="p" margin={{ top: "xs" }}>
                  {sessionData.analysis.summary}
                </Box>
              </Box>
            )}

            {/* Key Strengths */}
            {sessionData.analysis.key_strengths &&
              sessionData.analysis.key_strengths.length > 0 && (
                <Box>
                  <Box variant="awsui-key-label">Key Strengths</Box>
                  <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                    {sessionData.analysis.key_strengths.map(
                      (strength, index) => (
                        <li key={index} style={{ marginBottom: "4px" }}>
                          <Box variant="p">{strength}</Box>
                        </li>
                      ),
                    )}
                  </ul>
                </Box>
              )}

            {/* Areas for Improvement */}
            {sessionData.analysis.areas_for_improvement &&
              sessionData.analysis.areas_for_improvement.length > 0 && (
                <Box>
                  <Box variant="awsui-key-label">Areas for Improvement</Box>
                  <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                    {sessionData.analysis.areas_for_improvement.map(
                      (area, index) => (
                        <li key={index} style={{ marginBottom: "4px" }}>
                          <Box variant="p">{area}</Box>
                        </li>
                      ),
                    )}
                  </ul>
                </Box>
              )}

            {/* Detailed Evaluation */}
            {sessionData.analysis.evaluation_criteria &&
              sessionData.analysis.evaluation_criteria.length > 0 && (
                <ExpandableSection
                  headerText="Detailed Evaluation by Criteria"
                  defaultExpanded={false}
                >
                  <SpaceBetween size="m">
                    {sessionData.analysis.evaluation_criteria.map(
                      (criterion, index) => (
                        <Box
                          key={index}
                          padding="m"
                          backgroundColor="background-container-content"
                        >
                          <SpaceBetween size="s">
                            <Box>
                              <Box
                                display="flex"
                                justifyContent="space-between"
                                alignItems="center"
                              >
                                <Box variant="h3">
                                  {criterion.criterion_name}
                                </Box>
                                <Badge
                                  color={
                                    criterion.score >= 7
                                      ? "green"
                                      : criterion.score >= 5
                                        ? "blue"
                                        : "red"
                                  }
                                >
                                  {criterion.score} / 10
                                </Badge>
                              </Box>
                            </Box>

                            <Box variant="p">{criterion.feedback}</Box>

                            {criterion.strengths &&
                              criterion.strengths.length > 0 && (
                                <Box>
                                  <Box
                                    variant="strong"
                                    color="text-status-success"
                                  >
                                    Strengths:
                                  </Box>
                                  <ul
                                    style={{
                                      margin: "4px 0",
                                      paddingLeft: "20px",
                                    }}
                                  >
                                    {criterion.strengths.map((s, i) => (
                                      <li key={i}>
                                        <Box variant="small">{s}</Box>
                                      </li>
                                    ))}
                                  </ul>
                                </Box>
                              )}

                            {criterion.improvements &&
                              criterion.improvements.length > 0 && (
                                <Box>
                                  <Box
                                    variant="strong"
                                    color="text-status-warning"
                                  >
                                    Improvements:
                                  </Box>
                                  <ul
                                    style={{
                                      margin: "4px 0",
                                      paddingLeft: "20px",
                                    }}
                                  >
                                    {criterion.improvements.map((i, idx) => (
                                      <li key={idx}>
                                        <Box variant="small">{i}</Box>
                                      </li>
                                    ))}
                                  </ul>
                                </Box>
                              )}
                          </SpaceBetween>
                        </Box>
                      ),
                    )}
                  </SpaceBetween>
                </ExpandableSection>
              )}
          </SpaceBetween>
        ) : sessionData.analysisStatus === "pending" ? (
          <Box padding="l" textAlign="center">
            <SpaceBetween size="m" alignItems="center">
              <Spinner size="large" />
              <Box variant="p" color="text-body-secondary">
                Analyzing your interview performance... This may take a few
                minutes.
              </Box>
              <Button onClick={loadSessionData}>Refresh</Button>
            </SpaceBetween>
          </Box>
        ) : sessionData.analysisStatus === "error" ? (
          <Alert type="error">
            Failed to analyze the interview session. Please try again later.
          </Alert>
        ) : (
          <Box padding="l" textAlign="center">
            <Box variant="p" color="text-body-secondary">
              Feedback will be available after the interview is completed and
              analyzed.
            </Box>
          </Box>
        )}
      </Container>

      {/* Metadata */}
      {sessionData.metadata && (
        <ExpandableSection headerText="Session Metadata" variant="container">
          <Box padding="m">
            <pre style={{ fontSize: "12px", overflow: "auto" }}>
              {JSON.stringify(sessionData.metadata, null, 2)}
            </pre>
          </Box>
        </ExpandableSection>
      )}
    </SpaceBetween>
  );
}

export default PracticeSessionDetail;
