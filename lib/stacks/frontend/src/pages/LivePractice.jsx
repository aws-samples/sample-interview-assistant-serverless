import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Table,
  Badge,
  Spinner,
  TextFilter,
  StatusIndicator,
  Modal,
  Flashbar,
} from "@cloudscape-design/components";
import { sessionAPI } from "../services/api";

function LivePractice() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [filteringText, setFilteringText] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [flashMessages, setFlashMessages] = useState([]);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const response = await sessionAPI.list();

      // Axios returns data in response.data
      const data = response.data;
      setSessions(data.sessions || []);
    } catch (error) {
      console.error("Failed to load sessions:", error);
      setSessions([]);
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

  const formatDuration = (seconds) => {
    if (!seconds) return "N/A";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleDeleteClick = () => {
    if (selectedSessions.length === 0) return;
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      setShowDeleteModal(false);
      setLoading(true);

      // Delete all selected items
      const deletePromises = selectedSessions.map((session) =>
        sessionAPI.delete(session.sessionId),
      );

      await Promise.all(deletePromises);

      // If we reach here, all deletes succeeded
      setFlashMessages([
        {
          type: "success",
          content: `Successfully deleted ${selectedSessions.length} practice session(s)`,
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "delete-success",
        },
      ]);
      setSelectedSessions([]);
      await loadSessions(); // Reload the list
    } catch (error) {
      console.error("Failed to delete sessions:", error);
      setFlashMessages([
        {
          type: "error",
          content: "Failed to delete some practice sessions. Please try again.",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "delete-error",
        },
      ]);
      await loadSessions(); // Reload to show current state
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: "s" }}>
            Loading practice sessions...
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <SpaceBetween size="l">
      <Flashbar items={flashMessages} />

      <Modal
        visible={showDeleteModal}
        onDismiss={() => setShowDeleteModal(false)}
        header="Delete practice sessions"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleDeleteConfirm}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box variant="p">
            Are you sure you want to delete{" "}
            <strong>{selectedSessions.length}</strong> practice session
            {selectedSessions.length > 1 ? "s" : ""}?
          </Box>
          <Box variant="p" color="text-status-error">
            <strong>Warning:</strong> This action cannot be undone. All audio
            recordings and transcriptions will be permanently deleted.
          </Box>
        </SpaceBetween>
      </Modal>

      <Header
        variant="h1"
        description="Speech-to-speech interview practice with Nova Sonic AI"
        actions={
          <Button
            variant="primary"
            iconName="add-plus"
            onClick={() => navigate("/practice/new")}
          >
            Start Practice Session
          </Button>
        }
      >
        Live Practice
      </Header>

      {/* Session history */}
      {sessions.length > 0 ? (
        <Table
          columnDefinitions={[
            {
              id: "date",
              header: "Date",
              cell: (item) => formatDate(item.createdAt),
              sortingField: "createdAt",
            },
            {
              id: "sessionId",
              header: "Session ID",
              cell: (item) => item.sessionId || "N/A",
            },
            {
              id: "duration",
              header: "Duration",
              cell: (item) => formatDuration(item.duration),
            },
            {
              id: "messages",
              header: "Messages",
              cell: (item) => item.messageCount || 0,
            },
            {
              id: "status",
              header: "Status",
              cell: (item) => getStatusBadge(item.status),
            },
            {
              id: "score",
              header: "Score",
              cell: (item) => {
                if (item.status !== "completed") return "N/A";

                try {
                  // Parse analysis if it's a string
                  let analysis = item.analysis;
                  if (typeof analysis === "string") {
                    analysis = JSON.parse(analysis);
                  }

                  if (analysis?.overall_score) {
                    const score = analysis.overall_score;
                    return (
                      <StatusIndicator
                        type={score >= 7 ? "success" : "warning"}
                      >
                        {score.toFixed(1)}/10
                      </StatusIndicator>
                    );
                  }
                } catch (error) {
                  console.error("Failed to parse analysis:", error);
                }

                return "N/A";
              },
            },
            {
              id: "actions",
              header: "Actions",
              cell: (item) => (
                <Button
                  variant="inline-link"
                  iconName="view"
                  onClick={() =>
                    navigate(`/practice/session/${item.sessionId}/view`)
                  }
                >
                  View Details
                </Button>
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
            <Box textAlign="center" color="inherit" padding="xxl">
              <SpaceBetween size="m">
                <Box variant="h2">No practice sessions yet</Box>
                <Box variant="p" color="text-body-secondary">
                  Start your first speech-to-speech practice session to improve
                  your interview skills!
                </Box>
                <Button
                  variant="primary"
                  iconName="add-plus"
                  onClick={() => navigate("/practice/new")}
                >
                  Create First Session
                </Button>
              </SpaceBetween>
            </Box>
          }
          filter={
            <TextFilter
              filteringText={filteringText}
              filteringPlaceholder="Search sessions..."
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
              actions={
                selectedSessions.length > 0 && (
                  <Button onClick={handleDeleteClick} disabled={loading}>
                    Delete
                  </Button>
                )
              }
            >
              Practice Sessions
            </Header>
          }
        />
      ) : (
        <Container>
          <Box textAlign="center" padding="xxl">
            <SpaceBetween size="m">
              <Box variant="h2">Welcome to Live Practice</Box>
              <Box variant="p" color="text-body-secondary">
                Practice your interview skills with real-time speech-to-speech
                AI interviewer powered by Amazon Nova Sonic.
              </Box>
              <Box variant="p" color="text-body-secondary">
                Click "Start Practice Session" above to begin your first
                session.
              </Box>
            </SpaceBetween>
          </Box>
        </Container>
      )}
    </SpaceBetween>
  );
}

export default LivePractice;
