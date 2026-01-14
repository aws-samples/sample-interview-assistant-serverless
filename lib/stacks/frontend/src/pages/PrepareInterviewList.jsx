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
import { interviewPlanAPI } from "../services/api";

function PrepareInterviewList() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [preparations, setPreparations] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [filteringText, setFilteringText] = useState("");
  const [flashMessages, setFlashMessages] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    loadPreparations();
  }, []);

  const loadPreparations = async () => {
    try {
      setLoading(true);
      const response = await interviewPlanAPI.list();

      // Axios returns data in response.data
      const data = response.data;

      // Transform API data to table format
      const plans = data.plans || [];
      const formattedPlans = plans.map((plan) => ({
        id: plan.id,
        companyName: plan.companyName || "N/A",
        jobTitle: plan.jobTitle || "N/A",
        interviewType: plan.interviewType || "N/A",
        status: "completed",
        questionsGenerated: plan.questionCount || 0,
        createdAt: plan.timestamp,
      }));

      setPreparations(formattedPlans);
    } catch (error) {
      console.error("Failed to load preparations:", error);
      setPreparations([]);
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
        interviewPlanAPI.delete(item.id),
      );

      await Promise.all(deletePromises);

      // If we reach here, all deletes succeeded
      setFlashMessages([
        {
          type: "success",
          content: `Successfully deleted ${selectedItems.length} interview preparation(s)`,
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "delete-success",
        },
      ]);
      setSelectedItems([]);
      await loadPreparations(); // Reload the list
    } catch (error) {
      console.error("Failed to delete preparations:", error);
      setFlashMessages([
        {
          type: "error",
          content:
            "Failed to delete some interview preparations. Please try again.",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "delete-error",
        },
      ]);
      await loadPreparations(); // Reload to show current state
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      completed: { color: "green", label: "Completed" },
      processing: { color: "blue", label: "Processing" },
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

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: "s" }}>
            Loading interview preparations...
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
        header="Delete interview preparations"
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
            <strong>{selectedItems.length}</strong> interview preparation
            {selectedItems.length > 1 ? "s" : ""}?
          </Box>
          <Box variant="p" color="text-status-error">
            <strong>Warning:</strong> This action cannot be undone.
          </Box>
        </SpaceBetween>
      </Modal>

      <Header
        variant="h1"
        description="AI-powered interview preparation with company research and question generation"
        actions={
          <Button
            variant="primary"
            iconName="add-plus"
            onClick={() => navigate("/prepare/new")}
          >
            New Interview Preparation
          </Button>
        }
      >
        Prepare Interview
      </Header>

      <Table
        columnDefinitions={[
          {
            id: "date",
            header: "Date",
            cell: (item) => formatDate(item.createdAt),
            sortingField: "createdAt",
          },
          {
            id: "company",
            header: "Company",
            cell: (item) => item.companyName || "N/A",
          },
          {
            id: "jobTitle",
            header: "Job Title",
            cell: (item) => item.jobTitle || "N/A",
          },
          {
            id: "type",
            header: "Interview Type",
            cell: (item) => item.interviewType,
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
                  onClick={() => navigate(`/prepare/${item.id}`)}
                >
                  View Details
                </Button>
                <Button
                  variant="inline-link"
                  onClick={() => navigate(`/practice/new?prepId=${item.id}`)}
                >
                  Start Practice
                </Button>
              </SpaceBetween>
            ),
          },
        ]}
        items={preparations}
        loading={loading}
        loadingText="Loading preparations..."
        selectionType="multi"
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) =>
          setSelectedItems(detail.selectedItems)
        }
        empty={
          <Box textAlign="center" color="inherit" padding="xxl">
            <SpaceBetween size="m">
              <Box variant="h2">No interview preparations yet</Box>
              <Box variant="p" color="text-body-secondary">
                Start by simulating an interview flow to get personalized
                questions and insights!
              </Box>
              <Button
                variant="primary"
                iconName="add-plus"
                onClick={() => navigate("/prepare/new")}
              >
                Create First Preparation
              </Button>
            </SpaceBetween>
          </Box>
        }
        filter={
          <TextFilter
            filteringText={filteringText}
            filteringPlaceholder="Search preparations..."
            onChange={({ detail }) => setFilteringText(detail.filteringText)}
          />
        }
        header={
          <Header
            counter={
              selectedItems.length
                ? `(${selectedItems.length}/${preparations.length})`
                : `(${preparations.length})`
            }
            actions={
              selectedItems.length > 0 && (
                <Button onClick={handleDeleteClick} disabled={loading}>
                  Delete
                </Button>
              )
            }
          >
            Interview Preparations
          </Header>
        }
      />
    </SpaceBetween>
  );
}

export default PrepareInterviewList;
