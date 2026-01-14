import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  Table,
  Box,
  Button,
  SpaceBetween,
  Badge,
  Pagination,
  TextFilter,
} from "@cloudscape-design/components";
import { sessionAPI } from "../services/api";

function SessionHistory() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [filteringText, setFilteringText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const response = await sessionAPI.list({
        sortBy: "createdAt",
        order: "desc",
      });
      setSessions(response.data.sessions || []);
    } catch (error) {
      console.error("Failed to load sessions:", error);
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
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <Button variant="primary" onClick={() => navigate("/practice")}>
            New Practice Session
          </Button>
        }
      >
        Practice Session History
      </Header>

      <Container>
        <Table
          columnDefinitions={[
            {
              id: "date",
              header: "Date",
              cell: (item) => formatDate(item.createdAt),
              sortingField: "createdAt",
            },
            {
              id: "jobRole",
              header: "Job Role",
              cell: (item) => item.jobRole || "N/A",
            },
            {
              id: "questions",
              header: "Questions",
              cell: (item) => item.questionCount || 0,
            },
            {
              id: "score",
              header: "Average Score",
              cell: (item) =>
                item.averageScore
                  ? `${item.averageScore.toFixed(1)}/100`
                  : "N/A",
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
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    variant="inline-link"
                    onClick={() => navigate(`/history/${item.sessionId}`)}
                  >
                    View
                  </Button>
                  <Button
                    variant="inline-link"
                    onClick={() => console.log("Delete", item.sessionId)}
                  >
                    Delete
                  </Button>
                </SpaceBetween>
              ),
            },
          ]}
          items={sessions}
          loading={loading}
          loadingText="Loading sessions..."
          selectionType="multi"
          selectedItems={selectedSessions}
          onSelectionChange={({ detail }) =>
            setSelectedSessions(detail.selectedItems)
          }
          empty={
            <Box textAlign="center" color="inherit">
              <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                <b>No sessions found</b>
              </Box>
              <Button onClick={() => navigate("/practice")}>
                Start First Session
              </Button>
            </Box>
          }
          filter={
            <TextFilter
              filteringText={filteringText}
              filteringPlaceholder="Find sessions"
              onChange={({ detail }) => setFilteringText(detail.filteringText)}
            />
          }
          header={
            <Header
              counter={
                selectedSessions.length
                  ? `(${selectedSessions.length}/${sessions.length})`
                  : `(${sessions.length})`
              }
            >
              All Sessions
            </Header>
          }
          pagination={
            <Pagination
              currentPageIndex={currentPage}
              onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)}
              pagesCount={Math.ceil(sessions.length / 10)}
            />
          }
        />
      </Container>
    </SpaceBetween>
  );
}

export default SessionHistory;
