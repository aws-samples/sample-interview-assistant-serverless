import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wizard,
  Container,
  SpaceBetween,
  FormField,
  FileUpload,
  Textarea,
  Input,
  Select,
  Button,
  Box,
  Header,
  Alert,
  ProgressBar,
  Spinner,
} from "@cloudscape-design/components";
import { sessionAPI } from "../services/api";

function PracticeWizard() {
  const navigate = useNavigate();
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  // Step 1: Setup
  const [companyName, setCompanyName] = useState("");
  const [resumeFile, setResumeFile] = useState([]);
  const [jdText, setJdText] = useState("");
  const [interviewType, setInterviewType] = useState({
    label: "Technical Skills",
    value: "technical",
  });
  const [questionCount, setQuestionCount] = useState({
    label: "3 Questions",
    value: "3",
  });
  const [difficulty, setDifficulty] = useState({
    label: "Medium",
    value: "medium",
  });

  // Step 2: Questions
  const [generatedQuestions, setGeneratedQuestions] = useState([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsProgress, setQuestionsProgress] = useState(0);

  // Step 3: Practice (placeholder for now)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [answerMode, setAnswerMode] = useState("text"); // 'text' or 'speech'
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // Socket.IO removed - using REST API polling instead
  // Question generation now uses direct API response or polling if needed

  const validateStep1 = () => {
    const hasResume = resumeFile.length > 0;
    const hasJd = jdText.trim().length > 0;
    return hasResume && hasJd;
  };

  const handleSubmitStep1 = async () => {
    try {
      setLoading(true);
      setError(null);

      const formData = {
        companyName: companyName,
        resumeFile: resumeFile[0],
        jdText: jdText,
        settings: {
          interviewType: interviewType.value,
          questionCount: parseInt(questionCount.value),
          difficulty: difficulty.value,
        },
      };

      const response = await sessionAPI.create(formData);
      const newSessionId = response.data.sessionId;
      setSessionId(newSessionId);

      // Start question generation
      // Note: If API returns questions immediately, use them; otherwise implement polling
      setQuestionsLoading(true);
      const questionsResponse =
        await sessionAPI.generateQuestions(newSessionId);

      // Check if questions are in the response or if we need to poll
      if (questionsResponse.data?.questions) {
        setGeneratedQuestions(questionsResponse.data.questions);
        setQuestionsLoading(false);
        setQuestionsProgress(100);
      }
      // TODO: Implement polling if API returns planId instead of immediate questions
      // Example: await planAPI.pollCandidatePlanUntilComplete(planId, { onProgress: (plan) => setQuestionsProgress(plan.progress) })

      setActiveStepIndex(1);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  const handleEditQuestion = (index, newText) => {
    const updated = [...generatedQuestions];
    updated[index].questionText = newText;
    setGeneratedQuestions(updated);
  };

  const handleRegenerateQuestion = async (index) => {
    // TODO: Implement question regeneration
    console.log("Regenerate question:", index);
  };

  const handleStartPractice = () => {
    setActiveStepIndex(2);
  };

  const handleSubmitAnswer = (questionId, answerText) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answerText,
    }));
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < generatedQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handleFinishPractice = async () => {
    try {
      setLoading(true);

      // Submit all answers
      for (const question of generatedQuestions) {
        if (answers[question.questionId]) {
          await sessionAPI.submitAnswer(sessionId, question.questionId, {
            answerText: answers[question.questionId],
          });
        }
      }

      // Navigate to feedback/results
      navigate(`/history/${sessionId}`);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit answers");
    } finally {
      setLoading(false);
    }
  };

  const handleStartRecording = () => {
    // TODO: Implement actual recording
    setIsRecording(true);
    setRecordingTime(0);
    console.log("Start recording...");
  };

  const handleStopRecording = () => {
    // TODO: Implement actual recording stop
    setIsRecording(false);
    console.log("Stop recording...");
  };

  const handlePlayQuestion = () => {
    // TODO: Implement TTS for question
    console.log("Play question audio...");
  };

  const steps = [
    {
      title: "Setup",
      info: <Box variant="small">Configure your practice session</Box>,
      content: (
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Session Information</Header>}>
            <SpaceBetween size="m">
              <FormField label="Company Name (Optional)" stretch>
                <Input
                  value={companyName}
                  onChange={({ detail }) => setCompanyName(detail.value)}
                  placeholder="e.g., Google, Amazon, Startup Inc..."
                />
              </FormField>

              <FormField
                label="Resume / CV"
                description="Upload your resume in PDF, DOCX, or TXT format"
                stretch
              >
                <FileUpload
                  onChange={({ detail }) => setResumeFile(detail.value)}
                  value={resumeFile}
                  i18nStrings={{
                    uploadButtonText: (e) =>
                      e ? "Choose files" : "Choose file",
                    dropzoneText: (e) => "Drop file to upload",
                    removeFileAriaLabel: (e) => `Remove file ${e + 1}`,
                  }}
                  accept=".pdf,.docx,.doc,.txt"
                />
              </FormField>

              <FormField
                label="Job Description"
                description="Paste the full job description"
                stretch
              >
                <Textarea
                  onChange={({ detail }) => setJdText(detail.value)}
                  value={jdText}
                  placeholder="Paste the job description here..."
                  rows={8}
                />
              </FormField>

              <FormField
                label="Interview Type"
                description="Type of interview you're preparing for"
                stretch
              >
                <Select
                  selectedOption={interviewType}
                  onChange={({ detail }) =>
                    setInterviewType(detail.selectedOption)
                  }
                  options={[
                    { label: "Phone Screening", value: "phone_screening" },
                    { label: "Technical Skills", value: "technical" },
                    { label: "Behavioral", value: "behavioral" },
                    { label: "System Design", value: "system_design" },
                    { label: "Case Interview", value: "case" },
                    { label: "General / Mixed", value: "general" },
                  ]}
                />
              </FormField>

              <FormField label="Number of Questions">
                <Select
                  selectedOption={questionCount}
                  onChange={({ detail }) =>
                    setQuestionCount(detail.selectedOption)
                  }
                  options={[
                    { label: "3 Questions", value: "3" },
                    { label: "5 Questions", value: "5" },
                    { label: "10 Questions", value: "10" },
                  ]}
                />
              </FormField>

              <FormField label="Difficulty Level">
                <Select
                  selectedOption={difficulty}
                  onChange={({ detail }) =>
                    setDifficulty(detail.selectedOption)
                  }
                  options={[
                    { label: "Easy", value: "easy" },
                    { label: "Medium", value: "medium" },
                    { label: "Hard", value: "hard" },
                  ]}
                />
              </FormField>
            </SpaceBetween>
          </Container>

          {error && (
            <Alert type="error" dismissible onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}
        </SpaceBetween>
      ),
      isOptional: false,
    },
    {
      title: "Review Questions",
      info: <Box variant="small">Review and customize generated questions</Box>,
      content: (
        <SpaceBetween size="l">
          {questionsLoading ? (
            <Container>
              <SpaceBetween size="m" alignItems="center">
                <Spinner size="large" />
                <Box variant="p">
                  AI is generating personalized questions based on your CV and
                  job description...
                </Box>
                <ProgressBar
                  value={questionsProgress}
                  variant="standalone"
                  label="Generation progress"
                />
              </SpaceBetween>
            </Container>
          ) : (
            <>
              <Alert type="info">
                Review the generated questions below. You can edit or regenerate
                any question before starting the practice.
              </Alert>

              {generatedQuestions.map((question, index) => (
                <Container
                  key={question.questionId}
                  header={
                    <Header variant="h3">
                      Question {index + 1}
                      <Box variant="small" color="text-body-secondary">
                        {" "}
                        ({question.category || "General"}) -{" "}
                        {question.difficulty || "Medium"}
                      </Box>
                    </Header>
                  }
                >
                  <SpaceBetween size="m">
                    <Textarea
                      value={question.questionText}
                      onChange={({ detail }) =>
                        handleEditQuestion(index, detail.value)
                      }
                      rows={3}
                    />
                    <Box>
                      <Button
                        variant="inline-link"
                        iconName="refresh"
                        onClick={() => handleRegenerateQuestion(index)}
                      >
                        Regenerate this question
                      </Button>
                    </Box>
                  </SpaceBetween>
                </Container>
              ))}
            </>
          )}

          {error && (
            <Alert type="error" dismissible onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}
        </SpaceBetween>
      ),
    },
    {
      title: "Practice",
      info: <Box variant="small">Answer the interview questions</Box>,
      content: (
        <SpaceBetween size="l">
          {/* Mode Selection */}
          <Container>
            <SpaceBetween size="m">
              <FormField label="Answer Mode" stretch>
                <Select
                  selectedOption={
                    answerMode === "text"
                      ? { label: "Text Input", value: "text" }
                      : { label: "Speech (Coming Soon)", value: "speech" }
                  }
                  onChange={({ detail }) =>
                    setAnswerMode(detail.selectedOption.value)
                  }
                  options={[
                    { label: "Text Input", value: "text" },
                    {
                      label: "Speech (Coming Soon)",
                      value: "speech",
                      disabled: true,
                    },
                  ]}
                />
              </FormField>

              {answerMode === "speech" && (
                <Alert type="info">
                  Speech-to-speech interview practice is coming soon! For now,
                  use text input.
                </Alert>
              )}
            </SpaceBetween>
          </Container>

          {generatedQuestions[currentQuestionIndex] && (
            <Container
              header={
                <Header
                  variant="h2"
                  description={`Question ${currentQuestionIndex + 1} of ${generatedQuestions.length}`}
                >
                  Interview Question
                </Header>
              }
            >
              <SpaceBetween size="l">
                {/* AI Interviewer Question */}
                <Container
                  header={
                    <Header
                      variant="h3"
                      actions={
                        <Button
                          iconName="volume-up"
                          variant="icon"
                          onClick={handlePlayQuestion}
                          ariaLabel="Play question audio"
                          disabled
                        />
                      }
                    >
                      🤖 AI Interviewer
                    </Header>
                  }
                >
                  <Box variant="p" fontSize="heading-m">
                    {generatedQuestions[currentQuestionIndex].questionText}
                  </Box>
                </Container>

                {/* Your Answer Section */}
                <Container
                  header={<Header variant="h3">👤 Your Answer</Header>}
                >
                  {answerMode === "text" ? (
                    <FormField stretch>
                      <Textarea
                        value={
                          answers[
                            generatedQuestions[currentQuestionIndex].questionId
                          ] || ""
                        }
                        onChange={({ detail }) =>
                          handleSubmitAnswer(
                            generatedQuestions[currentQuestionIndex].questionId,
                            detail.value,
                          )
                        }
                        placeholder="Type your answer here..."
                        rows={12}
                      />
                    </FormField>
                  ) : (
                    <SpaceBetween size="m" alignItems="center">
                      <Box textAlign="center" padding="xxl">
                        {isRecording ? (
                          <>
                            <Box variant="h2" color="text-status-error">
                              ⏺ Recording...
                            </Box>
                            <Box variant="p" padding={{ top: "s" }}>
                              {Math.floor(recordingTime / 60)}:
                              {(recordingTime % 60).toString().padStart(2, "0")}
                            </Box>
                          </>
                        ) : (
                          <Box variant="p" color="text-body-secondary">
                            Click the microphone to start recording your answer
                          </Box>
                        )}
                      </Box>

                      <SpaceBetween direction="horizontal" size="s">
                        {!isRecording ? (
                          <Button
                            iconName="microphone"
                            variant="primary"
                            onClick={handleStartRecording}
                          >
                            Start Recording
                          </Button>
                        ) : (
                          <>
                            <Button
                              iconName="close"
                              onClick={handleStopRecording}
                            >
                              Stop
                            </Button>
                            <Button
                              iconName="undo"
                              onClick={() => {
                                handleStopRecording();
                                setRecordingTime(0);
                              }}
                            >
                              Retry
                            </Button>
                          </>
                        )}
                      </SpaceBetween>

                      {/* Transcription (placeholder) */}
                      {answers[
                        generatedQuestions[currentQuestionIndex].questionId
                      ] && (
                        <Box padding="m" variant="code">
                          <Box variant="small" color="text-body-secondary">
                            Transcription:
                          </Box>
                          <Box padding={{ top: "xs" }}>
                            {
                              answers[
                                generatedQuestions[currentQuestionIndex]
                                  .questionId
                              ]
                            }
                          </Box>
                        </Box>
                      )}
                    </SpaceBetween>
                  )}
                </Container>

                {/* Tips */}
                <Alert type="info" header="Tips">
                  Be specific and use examples from your experience. Structure
                  your answer clearly (situation, action, result).
                </Alert>

                {/* Navigation Buttons */}
                <Box>
                  <SpaceBetween direction="horizontal" size="s">
                    {currentQuestionIndex < generatedQuestions.length - 1 ? (
                      <Button variant="primary" onClick={handleNextQuestion}>
                        Next Question
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={handleFinishPractice}
                        loading={loading}
                      >
                        Finish & Get Feedback
                      </Button>
                    )}
                    {currentQuestionIndex > 0 && (
                      <Button
                        onClick={() =>
                          setCurrentQuestionIndex(currentQuestionIndex - 1)
                        }
                      >
                        Previous Question
                      </Button>
                    )}
                    <Button variant="link">Skip Question</Button>
                  </SpaceBetween>
                </Box>
              </SpaceBetween>
            </Container>
          )}

          {error && (
            <Alert type="error" dismissible onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}
        </SpaceBetween>
      ),
    },
  ];

  return (
    <Wizard
      i18nStrings={{
        stepNumberLabel: (stepNumber) => `Step ${stepNumber}`,
        collapsedStepsLabel: (stepNumber, stepsCount) =>
          `Step ${stepNumber} of ${stepsCount}`,
        skipToButtonLabel: (step, stepNumber) => `Skip to ${step.title}`,
        navigationAriaLabel: "Steps",
        cancelButton: "Cancel",
        previousButton: "Previous",
        nextButton: "Next",
        submitButton: "Start Practice",
        optional: "optional",
      }}
      onNavigate={({ detail }) => {
        if (detail.requestedStepIndex === 1 && activeStepIndex === 0) {
          if (validateStep1()) {
            handleSubmitStep1();
          }
        } else {
          setActiveStepIndex(detail.requestedStepIndex);
        }
      }}
      onCancel={() => navigate("/")}
      onSubmit={handleStartPractice}
      activeStepIndex={activeStepIndex}
      steps={steps}
      isLoadingNextStep={loading || questionsLoading}
      allowSkipTo={false}
    />
  );
}

export default PracticeWizard;
