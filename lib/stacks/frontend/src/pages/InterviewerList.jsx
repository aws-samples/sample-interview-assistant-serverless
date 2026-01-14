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
  Flashbar,
  Modal,
} from "@cloudscape-design/components";
import { interviewerAPI } from "../services/api";

function InterviewerList() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [interviews, setInterviews] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [filteringText, setFilteringText] = useState("");
  const [flashMessages, setFlashMessages] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    loadInterviews();
  }, []);

  const loadInterviews = async () => {
    try {
      setLoading(true);
      const response = await interviewerAPI.listScheduledInterviews();

      // Axios returns data in response.data
      const data = response.data;

      // Transform API data to table format
      const scheduledInterviews = data.interviews || [];
      const formattedInterviews = scheduledInterviews.map((interview) => ({
        id: interview.id,
        interviewName: interview.interviewName || "N/A",
        scheduledDate: interview.scheduledDate,
        status: interview.status || "scheduled",
        questionsGenerated: interview.questionCount || 0,
        createdAt: interview.timestamp,
      }));

      setInterviews(formattedInterviews);
    } catch (error) {
      console.error("Failed to load scheduled interviews:", error);
      setInterviews([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = () => {
    if (selectedItems.length === 0) return;
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      setShowDeleteModal(false);
      setLoading(true);

      // Delete all selected items
      const deletePromises = selectedItems.map((item) =>
        interviewerAPI.deleteScheduledInterview(item.id),
      );

      await Promise.all(deletePromises);

      // If we reach here, all deletes succeeded
      setFlashMessages([
        {
          type: "success",
          content: `Successfully deleted ${selectedItems.length} scheduled interview(s)`,
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "delete-success",
        },
      ]);
      setSelectedItems([]);
      await loadInterviews(); // Reload the list
    } catch (error) {
      console.error("Failed to delete scheduled interviews:", error);
      setFlashMessages([
        {
          type: "error",
          content:
            "Failed to delete some scheduled interviews. Please try again.",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "delete-error",
        },
      ]);
      await loadInterviews(); // Reload to show current state
    } finally {
      setLoading(false);
    }
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
            Loading scheduled interviews...
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
        header="Delete scheduled interviews"
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
            <strong>{selectedItems.length}</strong> scheduled interview
            {selectedItems.length > 1 ? "s" : ""}?
          </Box>
          <Box variant="p" color="text-status-error">
            <strong>Warning:</strong> This action cannot be undone.
          </Box>
        </SpaceBetween>
      </Modal>

      <Header
        variant="h1"
        description="Schedule and manage interviews with candidates"
        actions={
          <Button
            variant="primary"
            iconName="add-plus"
            onClick={() => navigate("/interviewer/new")}
          >
            Schedule New Interview
          </Button>
        }
      >
        Schedule Interview
      </Header>

      <Table
        columnDefinitions={[
          {
            id: "scheduledDate",
            header: "Scheduled Date",
            cell: (item) => formatDate(item.scheduledDate),
            sortingField: "scheduledDate",
          },
          {
            id: "interviewName",
            header: "Interview Name",
            cell: (item) => item.interviewName || "N/A",
          },
          {
            id: "questions",
            header: "Questions",
            cell: (item) => item.questionsGenerated || 0,
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
                  onClick={() => navigate(`/interviewer/${item.id}`)}
                >
                  View Details
                </Button>
                <Button
                  variant="inline-link"
                  onClick={() =>
                    navigate(`/interviewer/live?interviewId=${item.id}`)
                  }
                >
                  Start Interview
                </Button>
              </SpaceBetween>
            ),
          },
        ]}
        items={interviews}
        loading={loading}
        loadingText="Loading scheduled interviews..."
        selectionType="multi"
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) =>
          setSelectedItems(detail.selectedItems)
        }
        empty={
          <Box textAlign="center" color="inherit" padding="xxl">
            <SpaceBetween size="m">
              <Box variant="h2">No scheduled interviews yet</Box>
              <Box variant="p" color="text-body-secondary">
                Schedule your first interview with a candidate to get started!
              </Box>
              <Button
                variant="primary"
                iconName="add-plus"
                onClick={() => navigate("/interviewer/new")}
              >
                Schedule First Interview
              </Button>
            </SpaceBetween>
          </Box>
        }
        filter={
          <TextFilter
            filteringText={filteringText}
            filteringPlaceholder="Search scheduled interviews..."
            onChange={({ detail }) => setFilteringText(detail.filteringText)}
          />
        }
        header={
          <Header
            counter={
              selectedItems.length
                ? `(${selectedItems.length}/${interviews.length})`
                : `(${interviews.length})`
            }
            actions={
              selectedItems.length > 0 && (
                <Button onClick={handleDeleteClick} disabled={loading}>
                  Delete
                </Button>
              )
            }
          >
            Interview List
          </Header>
        }
      />
    </SpaceBetween>
  );
}

export default InterviewerList;
