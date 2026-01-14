import React, { useState, useEffect } from "react";
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

function InterviewerDetail() {
  const { interviewId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [interview, setInterview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadInterviewDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  const loadInterviewDetail = async () => {
    try {
      setLoading(true);
      const response = await interviewerAPI.getScheduledInterview(interviewId);

      // Axios returns data in response.data
      const data = response.data;
      setInterview(data.interview);
    } catch (err) {
      console.error("Failed to load interview detail:", err);
      setError(err.message || "Failed to load scheduled interview");
    } finally {
      setLoading(false);
    }
  };

  const getDifficultyBadge = (difficulty) => {
    const colors = {
      easy: "green",
      medium: "blue",
      hard: "red",
    };
    return <Badge color={colors[difficulty] || "grey"}>{difficulty}</Badge>;
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      scheduled: { color: "blue", label: "Scheduled" },
      completed: { color: "green", label: "Completed" },
      cancelled: { color: "grey", label: "Cancelled" },
      in_progress: { color: "blue", label: "In Progress" },
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
      timeZoneName: "short",
    });
  };

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: "s" }}>
            Loading interview details...
          </Box>
        </Box>
      </Container>
    );
  }

  if (error || !interview) {
    return (
      <Container>
        <Alert type="error" header="Error loading interview">
          {error || "Scheduled interview not found"}
        </Alert>
        <Box margin={{ top: "m" }}>
          <Button onClick={() => navigate("/interviewer/create")}>
            Back to List
          </Button>
        </Box>
      </Container>
    );
  }

  // Questions can be at top level (new format) or nested in interviewPlan (legacy)
  const questions =
    interview.questions || interview.interviewPlan?.questions || [];

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => navigate("/interviewer/create")}>
              Back to List
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                navigate(`/interviewer/live?interviewId=${interviewId}`)
              }
              disabled={
                interview.status === "finished" ||
                interview.status === "cancelled"
              }
            >
              Start Interview
            </Button>
          </SpaceBetween>
        }
      >
        Interview Plan Details
      </Header>

      {/* Basic Info */}
      <Container header={<Header variant="h2">Basic Information</Header>}>
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Interview Name</Box>
            <Box variant="p">{interview.interviewName || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Company</Box>
            <Box variant="p">{interview.companyName || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Position</Box>
            <Box variant="p">{interview.jobTitle || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Scheduled Date</Box>
            <Box variant="p">{interview.scheduledDate || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Scheduled Time</Box>
            <Box variant="p">{interview.scheduledTime || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Status</Box>
            <Box>{getStatusBadge(interview.status)}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Created</Box>
            <Box variant="p">{formatDate(interview.timestamp)}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Total Questions</Box>
            <Box variant="p">{questions.length || 0}</Box>
          </Box>
        </SpaceBetween>
      </Container>

      {/* Candidate Summary */}
      {interview.resumeSummary && (
        <Container header={<Header variant="h2">Candidate Summary</Header>}>
          <ExpandableSection
            headerText="Resume Summary"
            defaultExpanded={false}
          >
            <Box variant="p">
              <div style={{ whiteSpace: "pre-line", lineHeight: "1.6" }}>
                {interview.resumeSummary}
              </div>
            </Box>
          </ExpandableSection>
        </Container>
      )}

      {/* Interview Questions Flow */}
      {questions.length > 0 && (
        <Container
          header={
            <Header
              variant="h2"
              description="Follow this question sequence for an optimal interview flow"
            >
              Interview Question Flow ({questions.length} Questions)
            </Header>
          }
        >
          <SpaceBetween size="m">
            {questions.map((q, index) => (
              <Box
                key={q.questionId || index}
                padding={{ vertical: "s", horizontal: "m" }}
                backgroundColor="background-container-content"
              >
                <SpaceBetween size="xs">
                  <div key="question-header">
                    <SpaceBetween direction="horizontal" size="xs">
                      <Box variant="strong" color="text-status-info">
                        Q{index + 1}
                      </Box>
                      {q.category && <Badge>{q.category}</Badge>}
                      {q.estimatedTime && (
                        <Box variant="small" color="text-body-secondary">
                          Time: {q.estimatedTime}
                        </Box>
                      )}
                      {getDifficultyBadge(q.difficulty)}
                    </SpaceBetween>
                  </div>
                  <div key="question-text">
                    <Box variant="h4">{q.questionText}</Box>
                  </div>
                  {q.reasoning && (
                    <div key="reasoning">
                      <Box variant="small" color="text-body-secondary">
                        <strong>Why this question:</strong> {q.reasoning}
                      </Box>
                    </div>
                  )}
                  {q.evaluationChecklist &&
                    typeof q.evaluationChecklist === "string" &&
                    q.evaluationChecklist.trim().length > 0 && (
                      <div key="evaluation-checklist">
                        <ExpandableSection
                          headerText="Evaluation Checklist"
                          variant="footer"
                        >
                          <Box variant="p">
                            <ul
                              style={{ margin: "8px 0", paddingLeft: "20px" }}
                            >
                              {q.evaluationChecklist
                                .split("\n")
                                .map((line) => line.trim())
                                .filter((line) => line.length > 0)
                                .map((line) => line.replace(/^[-*]\s*/, ""))
                                .map((item, i) => (
                                  <li key={i} style={{ marginBottom: "6px" }}>
                                    {item}
                                  </li>
                                ))}
                            </ul>
                          </Box>
                        </ExpandableSection>
                      </div>
                    )}
                  {q.expectedAnswer && (
                    <div key="expected-answer">
                      <ExpandableSection
                        headerText="Expected Answer / Evaluation Guide"
                        variant="footer"
                      >
                        <Box variant="p">{q.expectedAnswer}</Box>
                      </ExpandableSection>
                    </div>
                  )}
                </SpaceBetween>
              </Box>
            ))}
          </SpaceBetween>
        </Container>
      )}

      {/* Preparation Tips */}
      {interview.preparationTips && interview.preparationTips.length > 0 && (
        <Container
          header={<Header variant="h2">Interview Preparation Tips</Header>}
        >
          <ul style={{ margin: "0", paddingLeft: "20px" }}>
            {interview.preparationTips.map((tip, i) => (
              <li key={i} style={{ marginBottom: "8px" }}>
                {tip}
              </li>
            ))}
          </ul>
        </Container>
      )}
    </SpaceBetween>
  );
}

export default InterviewerDetail;
