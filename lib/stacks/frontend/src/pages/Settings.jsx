import React, { useState, useEffect } from "react";
import {
  Container,
  Header,
  SpaceBetween,
  FormField,
  Select,
  Button,
  Box,
  Flashbar,
} from "@cloudscape-design/components";

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

function Settings() {
  // Load saved voice from localStorage or use default
  const getSavedVoice = () => {
    const saved = localStorage.getItem("interviewerVoice");
    if (saved) {
      const found = VOICE_OPTIONS.find((v) => v.value === saved);
      return found || VOICE_OPTIONS[0];
    }
    return VOICE_OPTIONS[0]; // Default to Matthew
  };

  const [interviewerVoice, setInterviewerVoice] = useState(getSavedVoice());
  const [turnSensitivity, setTurnSensitivity] = useState({
    label: "Medium",
    value: "medium",
  });
  const [interviewStyle, setInterviewStyle] = useState({
    label: "Professional",
    value: "professional",
  });
  const [feedbackDetail, setFeedbackDetail] = useState({
    label: "Detailed",
    value: "detailed",
  });
  const [language, setLanguage] = useState({ label: "English", value: "en" });
  const [flashMessages, setFlashMessages] = useState([]);

  // Save voice to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("interviewerVoice", interviewerVoice.value);
  }, [interviewerVoice]);

  const handleSave = () => {
    console.log("Saving settings...");
    // Voice is already saved to localStorage via useEffect
    setFlashMessages([
      {
        type: "success",
        content: "Settings saved successfully!",
        dismissible: true,
        onDismiss: () => setFlashMessages([]),
        id: "settings-saved",
      },
    ]);
  };

  return (
    <SpaceBetween size="l">
      <Flashbar items={flashMessages} />

      <Header
        variant="h1"
        description="Configure your interview practice preferences"
      >
        Settings
      </Header>

      <Container header={<Header variant="h2">AI Settings</Header>}>
        <SpaceBetween size="m">
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
            label="Turn Sensitivity (Coming Soon)"
            description="How quickly the AI detects when you've finished speaking"
          >
            <Select
              selectedOption={turnSensitivity}
              onChange={({ detail }) =>
                setTurnSensitivity(detail.selectedOption)
              }
              options={[
                { label: "High", value: "high" },
                { label: "Medium", value: "medium" },
                { label: "Low", value: "low" },
              ]}
              disabled
            />
          </FormField>

          <FormField
            label="Interview Style (Coming Soon)"
            description="Tone and approach of the AI interviewer"
          >
            <Select
              selectedOption={interviewStyle}
              onChange={({ detail }) =>
                setInterviewStyle(detail.selectedOption)
              }
              options={[
                { label: "Professional", value: "professional" },
                { label: "Casual", value: "casual" },
                { label: "Challenging", value: "challenging" },
              ]}
              disabled
            />
          </FormField>

          <FormField
            label="Feedback Detail Level (Coming Soon)"
            description="How detailed should the feedback be"
          >
            <Select
              selectedOption={feedbackDetail}
              onChange={({ detail }) =>
                setFeedbackDetail(detail.selectedOption)
              }
              options={[
                { label: "Brief", value: "brief" },
                { label: "Detailed", value: "detailed" },
                { label: "Comprehensive", value: "comprehensive" },
              ]}
              disabled
            />
          </FormField>

          <FormField
            label="Language (Coming Soon)"
            description="Interview and feedback language"
          >
            <Select
              selectedOption={language}
              onChange={({ detail }) => setLanguage(detail.selectedOption)}
              options={[
                { label: "English", value: "en" },
                { label: "Spanish", value: "es" },
                { label: "French", value: "fr" },
                { label: "German", value: "de" },
              ]}
              disabled
            />
          </FormField>
        </SpaceBetween>
      </Container>

      <Box float="right">
        <Button variant="primary" onClick={handleSave}>
          Save Changes
        </Button>
      </Box>
    </SpaceBetween>
  );
}

export default Settings;
