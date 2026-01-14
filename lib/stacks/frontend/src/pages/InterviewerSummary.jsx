import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  ColumnLayout,
  Badge,
  ExpandableSection,
  Tabs,
  Textarea,
  StatusIndicator,
} from "@cloudscape-design/components";

function InterviewerSummary() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("summary");
  const [additionalFeedback, setAdditionalFeedback] = useState("");

  // Mock interview data
  const interviewData = {
    candidateName: "John Doe",
    position: "Senior Frontend Engineer",
    date: new Date().toLocaleDateString(),
    duration: "45:32",
    sections: [
      {
        title: "Introduction",
        duration: "5:12",
        notes: "Strong communication, confident",
      },
      {
        title: "Technical Skills",
        duration: "25:45",
        notes: "Deep React knowledge, good understanding of state management",
      },
      {
        title: "Behavioral",
        duration: "12:15",
        notes: "Clear examples, STAR format used effectively",
      },
      {
        title: "Questions & Closing",
        duration: "2:20",
        notes: "Asked thoughtful questions about team culture",
      },
    ],
    overallScore: 85,
    recommendation: "Strong Hire",
  };

  const aiSummary = {
    strengths: [
      "Excellent technical knowledge of React and modern web development",
      "Strong problem-solving approach with clear explanations",
      "Good communication skills and cultural fit",
      "Demonstrated leadership experience with concrete examples",
    ],
    concerns: [
      "Limited experience with TypeScript (mentioned but not deep)",
      "Could benefit from more exposure to large-scale system design",
    ],
    keyHighlights: [
      {
        timestamp: "08:45",
        content: "Explained React performance optimization techniques clearly",
        tag: "Technical Excellence",
      },
      {
        timestamp: "23:10",
        content: "Shared leadership example showing conflict resolution skills",
        tag: "Soft Skills",
      },
      {
        timestamp: "35:22",
        content: "Asked insightful questions about engineering practices",
        tag: "Culture Fit",
      },
    ],
    recommendations: [
      "Strong candidate for Senior Frontend Engineer role",
      "Consider additional technical deep-dive on system design if moving forward",
      "Would be a good fit for the Growth team based on interests expressed",
    ],
  };

  const fullTranscript = [
    {
      time: "00:00",
      speaker: "Interviewer",
      content:
        "Hi John, thanks for joining today. Let's start with you telling me a bit about yourself.",
    },
    {
      time: "00:15",
      speaker: "John Doe",
      content:
        "Thanks for having me! I'm a frontend engineer with about 5 years of experience, primarily focused on React...",
    },
    // More transcript items...
  ];

  const handleExportSummary = () => {
    console.log("Export summary as PDF/DOCX");
  };

  const handleSaveFeedback = () => {
    console.log("Save additional feedback:", additionalFeedback);
  };

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={`${interviewData.position} - ${interviewData.date}`}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="download" onClick={handleExportSummary}>
              Export Summary
            </Button>
            <Button variant="primary" onClick={() => navigate("/")}>
              Done
            </Button>
          </SpaceBetween>
        }
      >
        Interview Summary: {interviewData.candidateName}
      </Header>

      {/* Overview Stats */}
      <Container>
        <ColumnLayout columns={4} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Overall Score</Box>
            <Box variant="h1" color="text-status-success">
              {interviewData.overallScore}/100
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Recommendation</Box>
            <Box padding={{ top: "xs" }}>
              <Badge color="green">{interviewData.recommendation}</Badge>
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Duration</Box>
            <Box variant="h2" color="text-body-secondary">
              {interviewData.duration}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Sections Completed</Box>
            <Box variant="h2" color="text-body-secondary">
              {interviewData.sections.length}
            </Box>
          </div>
        </ColumnLayout>
      </Container>

      {/* Tabs for different views */}
      <Tabs
        activeTabId={activeTab}
        onChange={({ detail }) => setActiveTab(detail.activeTabId)}
        tabs={[
          {
            id: "summary",
            label: "AI Summary",
            content: (
              <SpaceBetween size="l">
                <Container header={<Header variant="h2">Strengths</Header>}>
                  <SpaceBetween size="s">
                    {aiSummary.strengths.map((strength, index) => (
                      <Box key={index} variant="p">
                        • {strength}
                      </Box>
                    ))}
                  </SpaceBetween>
                </Container>

                <Container
                  header={<Header variant="h2">Areas for Consideration</Header>}
                >
                  <SpaceBetween size="s">
                    {aiSummary.concerns.map((concern, index) => (
                      <Box key={index} variant="p">
                        • {concern}
                      </Box>
                    ))}
                  </SpaceBetween>
                </Container>

                <Container
                  header={<Header variant="h2">🌟 Key Highlights</Header>}
                >
                  <SpaceBetween size="m">
                    {aiSummary.keyHighlights.map((highlight, index) => (
                      <Box key={index} padding="s">
                        <SpaceBetween size="xs">
                          <SpaceBetween direction="horizontal" size="xs">
                            <Box variant="small" color="text-body-secondary">
                              [{highlight.timestamp}]
                            </Box>
                            <Badge color="blue">{highlight.tag}</Badge>
                          </SpaceBetween>
                          <Box variant="p">{highlight.content}</Box>
                        </SpaceBetween>
                      </Box>
                    ))}
                  </SpaceBetween>
                </Container>

                <Container
                  header={<Header variant="h2">📋 Recommendations</Header>}
                >
                  <SpaceBetween size="s">
                    {aiSummary.recommendations.map((rec, index) => (
                      <Box key={index} variant="p">
                        {index + 1}. {rec}
                      </Box>
                    ))}
                  </SpaceBetween>
                </Container>
              </SpaceBetween>
            ),
          },
          {
            id: "sections",
            label: "Section Breakdown",
            content: (
              <SpaceBetween size="l">
                {interviewData.sections.map((section, index) => (
                  <ExpandableSection
                    key={index}
                    headerText={section.title}
                    variant="container"
                    defaultExpanded={index === 0}
                  >
                    <ColumnLayout columns={2} variant="text-grid">
                      <div>
                        <Box variant="awsui-key-label">Duration</Box>
                        <Box variant="p">{section.duration}</Box>
                      </div>
                      <div>
                        <Box variant="awsui-key-label">Status</Box>
                        <StatusIndicator type="success">
                          Completed
                        </StatusIndicator>
                      </div>
                    </ColumnLayout>
                    <Box padding={{ top: "m" }}>
                      <Box variant="awsui-key-label">Notes</Box>
                      <Box variant="p" padding={{ top: "xs" }}>
                        {section.notes}
                      </Box>
                    </Box>
                  </ExpandableSection>
                ))}
              </SpaceBetween>
            ),
          },
          {
            id: "transcript",
            label: "Full Transcript",
            content: (
              <Container
                header={
                  <Header
                    variant="h2"
                    description="Complete conversation transcript"
                  >
                    Interview Transcript
                  </Header>
                }
              >
                <SpaceBetween size="m">
                  {fullTranscript.map((item, index) => (
                    <Box key={index} padding="s">
                      <SpaceBetween size="xxs">
                        <SpaceBetween direction="horizontal" size="xs">
                          <Box variant="small" color="text-body-secondary">
                            [{item.time}]
                          </Box>
                          <Box variant="strong">{item.speaker}:</Box>
                        </SpaceBetween>
                        <Box variant="p" padding={{ left: "l" }}>
                          {item.content}
                        </Box>
                      </SpaceBetween>
                    </Box>
                  ))}
                </SpaceBetween>
              </Container>
            ),
          },
          {
            id: "feedback",
            label: "Additional Feedback",
            content: (
              <Container
                header={
                  <Header
                    variant="h2"
                    description="Add your own notes and observations"
                  >
                    Interviewer Notes
                  </Header>
                }
              >
                <SpaceBetween size="m">
                  <Textarea
                    value={additionalFeedback}
                    onChange={({ detail }) =>
                      setAdditionalFeedback(detail.value)
                    }
                    placeholder="Add any additional feedback, observations, or notes about the interview..."
                    rows={12}
                  />
                  <Box>
                    <Button variant="primary" onClick={handleSaveFeedback}>
                      Save Feedback
                    </Button>
                  </Box>
                </SpaceBetween>
              </Container>
            ),
          },
        ]}
      />
    </SpaceBetween>
  );
}

export default InterviewerSummary;
