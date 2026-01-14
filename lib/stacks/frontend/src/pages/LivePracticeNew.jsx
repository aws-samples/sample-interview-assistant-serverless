import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Alert,
  Flashbar,
  RadioGroup,
  FormField,
  Select,
  Checkbox,
} from "@cloudscape-design/components";
import { interviewPlanAPI } from "../services/api";

// Available voice options (matches backend - Nova Sonic supported voices)
const VOICE_OPTIONS = [
  // English (US) - Primary options
  {
    label: "Matthew - English US (Masculine)",
    value: "matthew",
    description: "Masculine-sounding US English voice",
  },
  {
    label: "Tiffany - English US (Feminine)",
    value: "tiffany",
    description: "Feminine-sounding US English voice",
  },

  // English (GB)
  {
    label: "Amy - English UK (Feminine)",
    value: "amy",
    description: "Feminine-sounding British English voice",
  },

  // French
  {
    label: "Florian - French (Masculine)",
    value: "florian",
    description: "Masculine-sounding French voice",
  },
  {
    label: "Ambre - French (Feminine)",
    value: "ambre",
    description: "Feminine-sounding French voice",
  },

  // Italian
  {
    label: "Lorenzo - Italian (Masculine)",
    value: "lorenzo",
    description: "Masculine-sounding Italian voice",
  },
  {
    label: "Beatrice - Italian (Feminine)",
    value: "beatrice",
    description: "Feminine-sounding Italian voice",
  },

  // German
  {
    label: "Lennart - German (Masculine)",
    value: "lennart",
    description: "Masculine-sounding German voice",
  },
  {
    label: "Greta - German (Feminine)",
    value: "greta",
    description: "Feminine-sounding German voice",
  },

  // Spanish
  {
    label: "Carlos - Spanish (Masculine)",
    value: "carlos",
    description: "Masculine-sounding Spanish voice",
  },
  {
    label: "Lupe - Spanish (Feminine)",
    value: "lupe",
    description: "Feminine-sounding Spanish voice",
  },
];

function LivePracticeNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [preparations, setPreparations] = useState([]);
  const [selectedPreparation, setSelectedPreparation] = useState([]);
  const [filteringText, setFilteringText] = useState("");
  const [flashMessages, setFlashMessages] = useState([]);

  // Mode selection state
  const [currentStep, setCurrentStep] = useState("preparation"); // 'preparation' or 'mode'
  const [selectedMode, setSelectedMode] = useState(null);

  // Audio recording preference state (default: false/unchecked)
  const [saveAudioRecording, setSaveAudioRecording] = useState(false);

  // Voice selection state
  const getSavedVoice = () => {
    const saved = localStorage.getItem("interviewerVoice");
    if (saved) {
      const found = VOICE_OPTIONS.find((v) => v.value === saved);
      return found || VOICE_OPTIONS[0];
    }
    return VOICE_OPTIONS[0]; // Default to Matthew
  };
  const [interviewerVoice, setInterviewerVoice] = useState(getSavedVoice());

  // Save voice to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("interviewerVoice", interviewerVoice.value);
  }, [interviewerVoice]);

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

      // Check if prepId is in URL parameters
      const prepId = searchParams.get("prepId");
      if (prepId) {
        // Find the preparation with this ID
        const selectedPrep = formattedPlans.find((prep) => prep.id === prepId);
        if (selectedPrep) {
          // Auto-select this preparation and skip to mode selection
          setSelectedPreparation([selectedPrep]);
          setCurrentStep("mode");
        } else {
          // prepId not found, show error
          setFlashMessages([
            {
              type: "error",
              content: "The specified interview preparation was not found.",
              dismissible: true,
              onDismiss: () => setFlashMessages([]),
              id: "prep-not-found",
            },
          ]);
        }
      }
    } catch (error) {
      console.error("Failed to load preparations:", error);
      setPreparations([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      completed: { color: "green", label: "Ready" },
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

  const handleContinueToModeSelection = () => {
    if (selectedPreparation.length === 0) {
      return;
    }
    setCurrentStep("mode");
  };

  const handleStartPractice = () => {
    if (selectedPreparation.length === 0 || !selectedMode) {
      return;
    }

    try {
      const prep = selectedPreparation[0];

      // Generate a unique session ID for this practice session
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Navigate to the live practice session with preparation ID, mode, and audio recording preference
      navigate(
        `/practice/session/${sessionId}?prepId=${prep.id}&mode=${selectedMode}&saveAudio=${saveAudioRecording}`,
      );
    } catch (error) {
      console.error("Failed to start practice session:", error);
      setFlashMessages([
        {
          type: "error",
          content: "Failed to start practice session. Please try again.",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "start-error",
        },
      ]);
    }
  };

  const handleBackToPreparationSelection = () => {
    setCurrentStep("preparation");
    setSelectedMode(null);
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

  // Preparation selection step (first)
  if (currentStep === "preparation") {
    return (
      <SpaceBetween size="l">
        <Flashbar items={flashMessages} />

        <Header
          variant="h1"
          description="Select an interview preparation to start live speech-to-speech practice"
          actions={
            <Button
              variant="link"
              iconName="arrow-left"
              onClick={() => navigate("/practice")}
            >
              Back to Sessions
            </Button>
          }
        >
          Select Interview Preparation
        </Header>

        <Alert type="info" header="Choose an existing preparation">
          Select an interview preparation that you've already created. If you
          don't have one yet, go to <strong>Prepare Interview</strong> to create
          a new preparation first.
        </Alert>

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
          ]}
          items={preparations}
          loading={loading}
          loadingText="Loading preparations..."
          selectionType="single"
          selectedItems={selectedPreparation}
          onSelectionChange={({ detail }) =>
            setSelectedPreparation(detail.selectedItems)
          }
          empty={
            <Box textAlign="center" color="inherit" padding="xxl">
              <SpaceBetween size="m">
                <Box variant="h2">No interview preparations available</Box>
                <Box variant="p" color="text-body-secondary">
                  You need to create an interview preparation first before
                  starting live practice.
                </Box>
                <Button
                  variant="primary"
                  iconName="add-plus"
                  onClick={() => navigate("/prepare/new")}
                >
                  Create Interview Preparation
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
              counter={`(${preparations.length})`}
              actions={
                <Button
                  variant="primary"
                  disabled={selectedPreparation.length === 0}
                  onClick={handleContinueToModeSelection}
                >
                  Continue
                </Button>
              }
            >
              Available Preparations
            </Header>
          }
        />
      </SpaceBetween>
    );
  }

  // Mode selection step (second)
  if (currentStep === "mode") {
    const selectedPrep = selectedPreparation[0];

    return (
      <SpaceBetween size="l">
        <Flashbar items={flashMessages} />

        <Header
          variant="h1"
          description={`Preparation: ${selectedPrep?.companyName || "N/A"} - ${selectedPrep?.interviewType || "N/A"}`}
          actions={
            <Button
              variant="link"
              iconName="arrow-left"
              onClick={handleBackToPreparationSelection}
            >
              Back to Preparation
            </Button>
          }
        >
          Configure Interview Settings
        </Header>

        <Container
          header={<Header variant="h2">Interview Configuration</Header>}
        >
          <SpaceBetween size="l">
            <FormField
              label="Interview Mode"
              description="Choose the mode that best fits your practice needs"
            >
              <RadioGroup
                value={selectedMode}
                onChange={({ detail }) => setSelectedMode(detail.value)}
                items={[
                  {
                    value: "light",
                    label: "Light Mode",
                    description:
                      "Recommended for most interview practice sessions. Optimized for high interactivity and real-time responsiveness with ultra-fast responses. Perfect for practicing natural conversation flow, communication skills, and quick thinking under pressure.",
                  },
                  {
                    value: "smart",
                    label: "Smart Mode",
                    description:
                      "Recommended for advanced technical interviews. Enhanced reasoning with deep knowledge of latest tech trends and complex topics. Best for deep technical discussions, sophisticated problem-solving, complex system design, and cutting-edge technologies.",
                  },
                ]}
              />
            </FormField>

            <FormField
              label="Interviewer Voice"
              description="Select the voice for the AI interviewer"
            >
              <Select
                selectedOption={interviewerVoice}
                onChange={({ detail }) =>
                  setInterviewerVoice(detail.selectedOption)
                }
                options={VOICE_OPTIONS}
              />
            </FormField>

            <FormField
              label="Audio Recording"
              description="Choose whether to save audio recording for playback later"
            >
              <Checkbox
                checked={saveAudioRecording}
                onChange={({ detail }) => setSaveAudioRecording(detail.checked)}
              >
                Save audio recording for playback
              </Checkbox>
              <Box
                variant="small"
                color="text-body-secondary"
                margin={{ top: "xs" }}
              >
                {saveAudioRecording ? (
                  <>
                    Audio will be securely stored on the server. You can replay
                    the entire interview session later.
                  </>
                ) : (
                  <>
                    {/* Transcription only. Audio will not be saved. Only text conversation will be stored. */}
                  </>
                )}
              </Box>
            </FormField>

            <Box textAlign="right">
              <Button
                variant="primary"
                disabled={!selectedMode}
                onClick={handleStartPractice}
              >
                Start Live Practice
              </Button>
            </Box>
          </SpaceBetween>
        </Container>

        <Alert type="info">
          Both modes provide high-quality interview practice. Choose Light Mode
          for rapid-fire conversational practice, or Smart Mode when you need
          deep technical evaluation and comprehensive feedback.
        </Alert>
      </SpaceBetween>
    );
  }
}

export default LivePracticeNew;
