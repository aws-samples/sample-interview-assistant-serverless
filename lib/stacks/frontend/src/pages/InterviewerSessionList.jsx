import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Spinner,
  Alert,
  Table,
  Modal,
  Flashbar,
} from "@cloudscape-design/components";
import { interviewerAPI } from "../services/api";

function InterviewerSessionList() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [flashMessages, setFlashMessages] = useState([]);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await interviewerAPI.listInterviewSessions();

      // Axios returns response.data with the actual data
      const data = response.data;
      setSessions(data.sessions || []);
    } catch (err) {
      console.error("Failed to load sessions:", err);
      setError(err.message || "Failed to load interview sessions");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (session) => {
    setSelectedSession(session);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedSession) return;

    try {
      setDeleting(true);
      await interviewerAPI.deleteInterviewSession(selectedSession.sessionId);

      // Axios doesn't throw on 2xx, so just check for success response
      setFlashMessages([
        {
          type: "success",
          content: "Interview session deleted successfully",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "delete-success",
        },
      ]);

      // Reload sessions
      await loadSessions();
      setShowDeleteModal(false);
      setSelectedSession(null);
    } catch (err) {
      console.error("Failed to delete session:", err);
      setFlashMessages([
        {
          type: "error",
          content: err.message || "Failed to delete interview session",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "delete-error",
        },
      ]);
    } finally {
      setDeleting(false);
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
    });
  };

  const columnDefinitions = [
    {
      id: "interviewName",
      header: "Interview Name",
      cell: (item) => item.interviewName || "N/A",
      sortingField: "interviewName",
      width: 250,
    },
    {
      id: "timestamp",
      header: "Date",
      cell: (item) => formatDate(item.timestamp),
      sortingField: "timestamp",
      width: 180,
    },
    {
      id: "duration",
      header: "Duration",
      cell: (item) => item.duration || "N/A",
      width: 100,
    },
    {
      id: "summaryPreview",
      header: "Summary Preview",
      cell: (item) => {
        // Extract the summary text - item.summary is an object with nested structure
        const summaryText =
          typeof item.summary === "object"
            ? item.summary?.summary || ""
            : item.summary || "";
        const preview =
          summaryText.length > 30
            ? `${summaryText.substring(0, 30)}...`
            : summaryText;
        return (
          <Box variant="p" color="text-body-secondary">
            {preview || "No summary available"}
          </Box>
        );
      },
      width: 400,
    },
    {
      id: "actions",
      header: "Actions",
      cell: (item) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Button
            variant="primary"
            onClick={() => navigate(`/interviewer/sessions/${item.sessionId}`)}
          >
            View Details
          </Button>
          <Button onClick={() => handleDeleteClick(item)}>Delete</Button>
        </SpaceBetween>
      ),
      minWidth: 220,
    },
  ];

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: "s" }}>
            Loading interview sessions...
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <SpaceBetween size="l">
      <Flashbar items={flashMessages} />

      <Header
        variant="h1"
        description="View and manage completed interview sessions"
        actions={
          <Button
            variant="primary"
            iconName="microphone"
            onClick={() => navigate("/interviewer/live")}
          >
            Start New Interview
          </Button>
        }
      >
        Interview Sessions
      </Header>

      {error && (
        <Alert
          type="error"
          dismissible
          onDismiss={() => setError(null)}
          header="Error loading sessions"
        >
          {error}
        </Alert>
      )}

      <Container>
        {sessions.length === 0 ? (
          <Box textAlign="center" padding="xxl">
            <Box variant="h3" padding={{ bottom: "s" }}>
              No interview sessions found
            </Box>
            <Box
              variant="p"
              color="text-body-secondary"
              padding={{ bottom: "m" }}
            >
              Start conducting interviews to see them here
            </Box>
            <Button
              variant="primary"
              iconName="microphone"
              onClick={() => navigate("/interviewer/live")}
            >
              Start New Interview
            </Button>
          </Box>
        ) : (
          <Table
            columnDefinitions={columnDefinitions}
            items={sessions}
            loadingText="Loading sessions"
            sortingDisabled={false}
            variant="container"
            empty={
              <Box textAlign="center" padding="l">
                No sessions found
              </Box>
            }
            header={
              <Header
                counter={`(${sessions.length})`}
                description="Completed interview sessions with AI-generated assessments"
              >
                Sessions
              </Header>
            }
          />
        )}
      </Container>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        onDismiss={() => !deleting && setShowDeleteModal(false)}
        header="Delete Interview Session"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleDeleteConfirm}
                loading={deleting}
              >
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box variant="p">
            Are you sure you want to delete this interview session?
          </Box>
          <Box variant="p">
            <strong>Interview:</strong> {selectedSession?.interviewName}
          </Box>
          <Box variant="p">
            <strong>Date:</strong> {formatDate(selectedSession?.timestamp)}
          </Box>
          <Alert type="warning">
            This action cannot be undone. The transcript and assessment will be
            permanently deleted.
          </Alert>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}

export default InterviewerSessionList;
