import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  Box,
  Button,
  SpaceBetween,
  Table,
  Badge,
  Spinner,
  ColumnLayout,
  StatusIndicator,
} from "@cloudscape-design/components";
import { sessionAPI, analyticsAPI } from "../services/api";

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalSessions: 0,
    averageScore: 0,
    lastPracticeDate: null,
  });
  const [recentSessions, setRecentSessions] = useState([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // Load analytics overview
      const analyticsResponse = await analyticsAPI.getOverview({ limit: 30 });
      setStats(analyticsResponse.data);

      // Load recent sessions
      const sessionsResponse = await sessionAPI.list({
        limit: 5,
        sortBy: "createdAt",
        order: "desc",
      });
      const sessions = sessionsResponse.data.sessions || [];

      // Fetch full details for each session to get analysis/score data
      const sessionsWithDetails = await Promise.all(
        sessions.map(async (session) => {
          try {
            const detailResponse = await sessionAPI.get(session.sessionId);
            // Handle both wrapped (session property) and unwrapped responses
            const detailData =
              detailResponse.data.session || detailResponse.data;
            return {
              ...session,
              ...detailData,
            };
          } catch (error) {
            console.error(
              `Failed to load details for session ${session.sessionId}:`,
              error,
            );
            return session;
          }
        }),
      );

      setRecentSessions(sessionsWithDetails);
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      completed: { color: "green", label: "Completed" },
      in_progress: { color: "blue", label: "In Progress" },
      pending: { color: "grey", label: "Pending" },
      failed: { color: "red", label: "Failed" },
    };
    const config = statusMap[status] || { color: "grey", label: status };
    return <Badge color={config.color}>{config.label}</Badge>;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: "s" }}>
            Loading dashboard...
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <SpaceBetween size="l">
      {/* Header */}
      <Header
        variant="h1"
        actions={
          <Button variant="primary" onClick={() => navigate("/practice")}>
            Start New Practice Session
          </Button>
        }
      >
        Interview Practice Dashboard
      </Header>

      {/* Statistics Cards */}
      <Container>
        <ColumnLayout columns={3} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Total Practice Sessions</Box>
            <Box
              variant="h1"
              color="text-body-secondary"
              padding={{ top: "xs" }}
            >
              {stats.totalSessions}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Average Score</Box>
            <Box
              variant="h1"
              color="text-body-secondary"
              padding={{ top: "xs" }}
            >
              {stats.averageScore > 0
                ? `${stats.averageScore.toFixed(1)}/10`
                : "N/A"}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Last Practice</Box>
            <Box
              variant="h1"
              color="text-body-secondary"
              padding={{ top: "xs" }}
            >
              {stats.lastPracticeDate
                ? formatDate(stats.lastPracticeDate)
                : "Never"}
            </Box>
          </div>
        </ColumnLayout>
      </Container>

      {/* Recent Sessions */}
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <Button onClick={() => navigate("/history")}>View All</Button>
            }
          >
            Recent Practice Sessions
          </Header>
        }
      >
        {recentSessions.length === 0 ? (
          <Box textAlign="center" padding="l">
            <Box variant="p" color="text-body-secondary">
              No practice sessions yet. Start your first session to begin
              practicing!
            </Box>
            <Box padding={{ top: "s" }}>
              <Button variant="primary" onClick={() => navigate("/practice")}>
                Create First Session
              </Button>
            </Box>
          </Box>
        ) : (
          <Table
            columnDefinitions={[
              {
                id: "date",
                header: "Date",
                cell: (item) => formatDate(item.createdAt),
                sortingField: "createdAt",
              },
              {
                id: "duration",
                header: "Duration",
                cell: (item) => {
                  if (!item.duration) return "N/A";
                  const mins = Math.floor(item.duration / 60);
                  const secs = item.duration % 60;
                  return `${mins}:${secs.toString().padStart(2, "0")}`;
                },
              },
              {
                id: "messages",
                header: "Messages",
                cell: (item) => item.messageCount || 0,
              },
              {
                id: "score",
                header: "Score",
                cell: (item) => {
                  // Check if analysis is completed and has overall_score (out of 10)
                  if (
                    item.analysisStatus === "completed" &&
                    item.analysis?.overall_score
                  ) {
                    const score = item.analysis.overall_score;
                    return (
                      <StatusIndicator
                        type={score >= 7 ? "success" : "warning"}
                      >
                        {score.toFixed(1)}/10
                      </StatusIndicator>
                    );
                  }
                  return "N/A";
                },
              },
              {
                id: "status",
                header: "Status",
                cell: (item) => getStatusBadge(item.status),
              },
              {
                id: "actions",
                header: "Actions",
                cell: (item) => (
                  <Button
                    variant="inline-link"
                    onClick={() =>
                      navigate(`/practice/session/${item.sessionId}/view`)
                    }
                  >
                    View Details
                  </Button>
                ),
              },
            ]}
            items={recentSessions}
            loadingText="Loading sessions..."
            empty={
              <Box textAlign="center" color="inherit">
                <b>No sessions</b>
                <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                  No sessions to display.
                </Box>
              </Box>
            }
          />
        )}
      </Container>

      {/* Quick Tips */}
      <Container header={<Header variant="h2">Getting Started</Header>}>
        <SpaceBetween size="s">
          <Box variant="p">
            Welcome to Interview Practice Assistant! Here's how to get started:
          </Box>
          <ol>
            <li>Upload your CV and target job description</li>
            <li>AI will generate personalized interview questions</li>
            <li>Practice answering questions (text-based for now)</li>
            <li>Receive detailed feedback and suggestions for improvement</li>
          </ol>
          <Box variant="p">
            <strong>Pro tip:</strong> Practice regularly to track your
            improvement over time!
          </Box>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}

export default Dashboard;
