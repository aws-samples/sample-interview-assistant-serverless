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
import { interviewPlanAPI } from "../services/api";

function PrepareInterviewDetail() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadPlanDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const loadPlanDetail = async () => {
    try {
      setLoading(true);
      const response = await interviewPlanAPI.get(planId);

      // Axios returns data in response.data
      const data = response.data;
      setPlan(data.plan);
    } catch (err) {
      console.error("Failed to load plan detail:", err);
      setError(err.message || "Failed to load interview preparation");
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
            Loading interview preparation...
          </Box>
        </Box>
      </Container>
    );
  }

  if (error || !plan) {
    return (
      <Container>
        <Alert type="error" header="Error loading preparation">
          {error || "Interview preparation not found"}
        </Alert>
        <Box margin={{ top: "m" }}>
          <Button onClick={() => navigate("/prepare")}>Back to List</Button>
        </Box>
      </Container>
    );
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => navigate("/prepare")}>Back to List</Button>
            <Button
              variant="primary"
              onClick={() => navigate(`/practice/new?prepId=${planId}`)}
            >
              Start Practice
            </Button>
          </SpaceBetween>
        }
      >
        Interview Preparation Details
      </Header>

      {/* Basic Info */}
      <Container header={<Header variant="h2">Basic Information</Header>}>
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Company</Box>
            <Box variant="p">{plan.companyName || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Job Title</Box>
            <Box variant="p">{plan.jobTitle || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Interview Type</Box>
            <Box variant="p">{plan.interviewType || "N/A"}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Created</Box>
            <Box variant="p">{formatDate(plan.timestamp)}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">Total Questions</Box>
            <Box variant="p">{plan.questions?.length || 0}</Box>
          </Box>
        </SpaceBetween>
      </Container>

      {/* Company Research */}
      {plan.companyResearch && (
        <Container header={<Header variant="h2">Company Research</Header>}>
          <SpaceBetween size="m">
            {plan.companyResearch.culture &&
              plan.companyResearch.culture.length > 0 && (
                <ExpandableSection headerText="Company Culture">
                  <ul style={{ margin: "0", paddingLeft: "20px" }}>
                    {plan.companyResearch.culture.map((item, i) => (
                      <li key={i} style={{ marginBottom: "8px" }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </ExpandableSection>
              )}

            {plan.companyResearch.interviewProcess &&
              plan.companyResearch.interviewProcess.length > 0 && (
                <ExpandableSection headerText="Interview Process">
                  <ul style={{ margin: "0", paddingLeft: "20px" }}>
                    {plan.companyResearch.interviewProcess.map((item, i) => (
                      <li key={i} style={{ marginBottom: "8px" }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </ExpandableSection>
              )}
          </SpaceBetween>
        </Container>
      )}

      {/* Interview Questions */}
      <Container
        header={
          <Header variant="h2">
            Interview Questions ({plan.questions?.length || 0})
          </Header>
        }
      >
        <SpaceBetween size="m">
          {plan.questions?.map((q, index) => (
            <div key={index} style={{ width: "100%" }}>
              {/* Interviewer Question - Left aligned */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-start",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    maxWidth: "75%",
                    backgroundColor: "#f2f3f3",
                    padding: "16px 20px",
                    borderRadius: "12px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  }}
                >
                  <SpaceBetween size="xs">
                    <SpaceBetween direction="horizontal" size="xs">
                      <Badge color="grey">Q{index + 1}</Badge>
                      <Badge>{q.category}</Badge>
                      {getDifficultyBadge(q.difficulty)}
                      {q.source === "user" && (
                        <Badge color="blue">From Question Bank</Badge>
                      )}
                      {q.source === "ai" && (
                        <Badge color="green">AI Generated</Badge>
                      )}
                    </SpaceBetween>
                    <Box
                      variant="h3"
                      fontSize="heading-m"
                      color="text-body-default"
                    >
                      {q.questionText}
                    </Box>
                    {q.reasoning && (
                      <Box variant="small" color="text-body-secondary">
                        <em>{q.reasoning}</em>
                      </Box>
                    )}
                  </SpaceBetween>
                </div>
              </div>

              {/* Answer Strategy - Right aligned */}
              {q.expectedAnswer && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div
                    style={{
                      maxWidth: "75%",
                      backgroundColor: "#e3f2fd",
                      padding: "16px 20px",
                      borderRadius: "12px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                    }}
                  >
                    <SpaceBetween size="xs">
                      <Box variant="strong" color="text-status-info">
                        Answer Strategy
                      </Box>
                      <Box variant="p" color="text-body-default">
                        {q.expectedAnswer}
                      </Box>
                    </SpaceBetween>
                  </div>
                </div>
              )}
            </div>
          ))}
        </SpaceBetween>
      </Container>

      {/* Preparation Tips */}
      {plan.preparationTips && plan.preparationTips.length > 0 && (
        <Container header={<Header variant="h2">Preparation Tips</Header>}>
          <ul style={{ margin: "0", paddingLeft: "20px" }}>
            {plan.preparationTips.map((tip, i) => (
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

export default PrepareInterviewDetail;
