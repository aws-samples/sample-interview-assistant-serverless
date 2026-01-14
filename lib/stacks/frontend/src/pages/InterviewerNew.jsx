import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  FormField,
  FileUpload,
  Input,
  Button,
  Box,
  Alert,
  Spinner,
  ExpandableSection,
  RadioGroup,
  Flashbar,
  DatePicker,
  Select,
  Link,
  Table,
  Badge,
} from "@cloudscape-design/components";
import ReactMarkdown from "react-markdown";
import { interviewerAPI, planAPI } from "../services/api";

function InterviewerNew() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [flashMessages, setFlashMessages] = useState([]);

  // Interview Details
  const [interviewName, setInterviewName] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState(null);
  const [dateError, setDateError] = useState(null);
  const [timeError, setTimeError] = useState(null);

  // Generate time slot options (30-minute intervals from 8:00 to 20:00)
  const generateTimeSlots = () => {
    const slots = [];
    for (let hour = 8; hour <= 20; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const hourStr = hour.toString().padStart(2, "0");
        const minuteStr = minute.toString().padStart(2, "0");
        const timeValue = `${hourStr}:${minuteStr}`;
        const displayTime = `${hourStr}:${minuteStr}`;
        slots.push({
          label: displayTime,
          value: timeValue,
        });
      }
    }
    return slots;
  };

  const timeSlotOptions = generateTimeSlots();

  // Resume
  const [resumeInputType, setResumeInputType] = useState("file"); // 'file' or 'url'
  const [resumeFile, setResumeFile] = useState([]);
  const [resumeUrl, setResumeUrl] = useState("");
  const [resumeUrlLoading, setResumeUrlLoading] = useState(false);
  const [resumeUrlError, setResumeUrlError] = useState(null);
  const [resumeText, setResumeText] = useState(""); // Store fetched resume content

  // Job Description
  const [jdInputType, setJdInputType] = useState("file"); // 'file' or 'url'
  const [jdFile, setJdFile] = useState([]);
  const [jdUrl, setJdUrl] = useState("");
  const [jdUrlLoading, setJdUrlLoading] = useState(false);
  const [jdUrlError, setJdUrlError] = useState(null);
  const [jdText, setJdText] = useState(""); // Store fetched JD content

  // Interview Type
  const [interviewType, setInterviewType] = useState({
    label: "General / Mixed",
    value: "general",
  });

  // Question Bank Configuration
  const [questionSource, setQuestionSource] = useState("ai"); // 'ai' or 'csv'
  const [csvFile, setCsvFile] = useState([]); // CSV file for manual questions
  const [csvQuestions, setCsvQuestions] = useState([]); // Parsed CSV questions
  const [csvError, setCsvError] = useState(null);

  // Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [resumeSummary, setResumeSummary] = useState("");
  const [jdSummary, setJdSummary] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [savedInterviewId, setSavedInterviewId] = useState(null);

  // Async plan tracking
  const [planId, setPlanId] = useState(null);
  const [planStatus, setPlanStatus] = useState(null); // 'pending', 'processing', 'completed', 'failed'
  const [pollingAttempts, setPollingAttempts] = useState(0);

  const validateInputs = () => {
    if (!interviewName.trim()) return false;
    if (!scheduledDate) return false;
    if (!scheduledTime || !scheduledTime.value) return false;

    // Resume validation: either file or URL with fetched content
    const hasResume = resumeFile.length > 0 || resumeText.trim().length > 0;

    // JD validation: either file or URL with fetched content
    const hasJD = jdFile.length > 0 || jdText.trim().length > 0;

    // Question validation depends on question source
    if (questionSource === "ai") {
      // AI generation only needs resume + JD
      return hasResume && hasJD;
    } else {
      // Manual entry requires CSV questions
      const hasCsvQuestions = csvQuestions.length > 0;
      return hasResume && hasJD && hasCsvQuestions;
    }
  };

  // CSV Template Download for Interviewers
  const handleDownloadTemplate = () => {
    // Use actual newlines within quoted fields (standard CSV format, Excel/Sheets compatible)
    const csvContent = `question,category,difficulty,time,instructions,evaluation,answer
"Tell me about yourself","Behavioral","easy","5 minutes","Ask the candidate to share their professional journey and what brings them to this interview. Listen for clear communication, relevant experience, and enthusiasm.","- Clear and concise summary of background
- Highlights relevant experience
- Shows enthusiasm and motivation
- Good communication skills",""
"Explain your biggest technical challenge","Technical Skills","hard","10-12 minutes","Ask for a specific technical problem they solved. Probe for details on the problem, their approach, alternatives considered, and lessons learned.","- Clearly explains the technical problem
- Describes solution approach and reasoning
- Discusses trade-offs and alternatives
- Shows learning and growth from experience",""
"How do you handle conflicts in a team?","Behavioral","medium","8-10 minutes","Ask for a real example of team conflict they experienced. Focus on their specific actions, not general philosophy. Probe for resolution and lessons.","- Provides specific example (not hypothetical)
- Takes ownership where appropriate
- Shows empathy for others' perspectives
- Describes concrete resolution steps
- Reflects on lessons learned",""
"Design a URL shortener service like bit.ly","System Design","hard","30-40 minutes","Give 30-40 minutes for whiteboard design. Ask about scale (billions of URLs), API design, data storage, caching, and handling spikes. Probe trade-offs.","- Clarifies requirements and constraints
- Designs RESTful API (POST, GET endpoints)
- Chooses appropriate data store (NoSQL for scale)
- Discusses hashing strategy
- Considers caching (Redis) and CDN
- Addresses analytics and monitoring","Key components: API Gateway, hash generation service, database (e.g., DynamoDB), caching layer (Redis), analytics service"`;

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "interviewer_questions_template.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CSV Parsing for Interviewer Questions
  const parseCSV = (text) => {
    // Proper CSV parser that handles multi-line quoted fields
    const parseCSVRow = (text, startIndex = 0) => {
      const row = [];
      let current = "";
      let inQuotes = false;
      let i = startIndex;

      while (i < text.length) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"' && inQuotes && nextChar === '"') {
          // Escaped quote (two consecutive quotes)
          current += '"';
          i += 2;
          continue;
        } else if (char === '"') {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
          continue;
        } else if (char === "," && !inQuotes) {
          // Field separator
          row.push(current.trim());
          current = "";
          i++;
          continue;
        } else if ((char === "\n" || char === "\r") && !inQuotes) {
          // End of row
          row.push(current.trim());
          // Skip \r\n or \n\r combinations
          if (
            (char === "\r" && nextChar === "\n") ||
            (char === "\n" && nextChar === "\r")
          ) {
            i += 2;
          } else {
            i++;
          }
          return { row, nextIndex: i };
        } else {
          // Regular character
          current += char;
          i++;
        }
      }

      // End of text
      if (current || row.length > 0) {
        row.push(current.trim());
      }
      return { row, nextIndex: i };
    };

    // Parse all rows
    const rows = [];
    let index = 0;
    while (index < text.length) {
      const { row, nextIndex } = parseCSVRow(text, index);
      if (row.length > 0 && row.some((cell) => cell.trim())) {
        rows.push(row);
      }
      index = nextIndex;
      if (index === text.length) break;
    }

    if (rows.length < 2) {
      throw new Error("CSV file is empty or has no data rows");
    }

    // Parse header
    const header = rows[0].map((h) =>
      h.toLowerCase().replace(/^"|"$/g, "").trim(),
    );
    const questionIndex = header.indexOf("question");
    const categoryIndex = header.indexOf("category");
    const difficultyIndex = header.indexOf("difficulty");
    const timeIndex = header.indexOf("time");
    const instructionsIndex = header.indexOf("instructions");
    const evaluationIndex = header.indexOf("evaluation");
    const answerIndex = header.indexOf("answer");

    if (questionIndex === -1) {
      throw new Error('CSV must have a "question" column');
    }

    // Parse data rows
    const questions = [];
    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];

      const question = (values[questionIndex] || "")
        .replace(/^"|"$/g, "")
        .trim();
      const category =
        categoryIndex !== -1
          ? (values[categoryIndex] || "").replace(/^"|"$/g, "").trim() ||
            "General"
          : "General";
      const difficulty =
        difficultyIndex !== -1
          ? (values[difficultyIndex] || "").replace(/^"|"$/g, "").trim() ||
            "medium"
          : "medium";
      const time =
        timeIndex !== -1
          ? (values[timeIndex] || "").replace(/^"|"$/g, "").trim()
          : "";
      const instructions =
        instructionsIndex !== -1
          ? (values[instructionsIndex] || "").replace(/^"|"$/g, "").trim()
          : "";
      const evaluation =
        evaluationIndex !== -1
          ? (values[evaluationIndex] || "").replace(/^"|"$/g, "").trim()
          : "";
      const answer =
        answerIndex !== -1
          ? (values[answerIndex] || "").replace(/^"|"$/g, "").trim()
          : "";

      if (question) {
        questions.push({
          id: i,
          question,
          category,
          difficulty,
          time,
          instructions,
          evaluation,
          answer,
          source: "csv",
        });
      }
    }

    return questions;
  };

  // Handle CSV Upload
  const handleCsvUpload = async ({ detail }) => {
    const files = detail.value;
    setCsvFile(files);
    setCsvError(null);
    setCsvQuestions([]);

    if (files.length === 0) return;

    const file = files[0];

    // Validate file type
    if (!file.name.endsWith(".csv")) {
      setCsvError("Please upload a CSV file");
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseCSV(text);

      if (parsed.length === 0) {
        setCsvError("No valid questions found in CSV file");
        return;
      }

      setCsvQuestions(parsed);
      setCsvError(null);
    } catch (error) {
      setCsvError(error.message || "Failed to parse CSV file");
      setCsvQuestions([]);
    }
  };

  // Fetch Resume from URL
  const handleFetchResumeFromUrl = async () => {
    if (!resumeUrl.trim()) {
      setResumeUrlError("Please enter a URL");
      return;
    }

    // Validate URL format
    try {
      new URL(resumeUrl);
    } catch (e) {
      setResumeUrlError("Please enter a valid URL");
      return;
    }

    try {
      setResumeUrlLoading(true);
      setResumeUrlError(null);

      const response = await interviewerAPI.scrapeResume(resumeUrl);
      const data = response.data;

      if (data.status === "success") {
        const extractedText = data.text || "";
        const formattedContent = `${extractedText}\n\nSource URL: ${resumeUrl}`;
        setResumeText(formattedContent);
        setResumeUrlError(null);
      } else {
        throw new Error(data.error || "Failed to extract resume");
      }
    } catch (error) {
      console.error("Error fetching resume:", error);

      // Parse error message for better display
      let errorMessage = "Failed to fetch resume from URL";
      const errorStr = error.message || String(error);

      if (errorStr.includes("404") || errorStr.includes("Not Found")) {
        errorMessage =
          "The resume URL was not found (404). Please check the URL and try again.";
      } else if (errorStr.includes("403") || errorStr.includes("Forbidden")) {
        errorMessage =
          "Access to this URL is forbidden. The website may be blocking automated access.";
      } else if (errorStr.includes("timeout")) {
        errorMessage = "Request timed out. Please try again later.";
      } else if (errorStr.includes("Failed to fetch")) {
        errorMessage = "Network error. Please check your internet connection.";
      } else {
        errorMessage = errorStr;
      }

      setResumeUrlError(errorMessage);
    } finally {
      setResumeUrlLoading(false);
    }
  };

  // Fetch Job Description from URL
  const handleFetchJdFromUrl = async () => {
    if (!jdUrl.trim()) {
      setJdUrlError("Please enter a URL");
      return;
    }

    // Validate URL format
    try {
      new URL(jdUrl);
    } catch (e) {
      setJdUrlError("Please enter a valid URL");
      return;
    }

    try {
      setJdUrlLoading(true);
      setJdUrlError(null);

      const response = await interviewerAPI.scrapeJobDescription(jdUrl);
      const data = response.data;

      if (data.status === "success") {
        const extractedText = data.text || "";
        const title = data.title || "";
        const formattedContent = `${title ? `Job Title: ${title}\n\n` : ""}${extractedText}\n\nSource URL: ${jdUrl}`;
        setJdText(formattedContent);
        setJdUrlError(null);
      } else {
        throw new Error(data.error || "Failed to extract job description");
      }
    } catch (error) {
      console.error("Error fetching job description:", error);

      // Parse error message for better display
      let errorMessage = "Failed to fetch job description from URL";
      const errorStr = error.message || String(error);

      if (errorStr.includes("404") || errorStr.includes("Not Found")) {
        errorMessage =
          "The job posting URL was not found (404). Please check the URL and try again.";
      } else if (errorStr.includes("403") || errorStr.includes("Forbidden")) {
        errorMessage =
          "Access to this URL is forbidden. The website may be blocking automated access.";
      } else if (errorStr.includes("timeout")) {
        errorMessage = "Request timed out. Please try again later.";
      } else if (errorStr.includes("Failed to fetch")) {
        errorMessage = "Network error. Please check your internet connection.";
      } else {
        errorMessage = errorStr;
      }

      setJdUrlError(errorMessage);
    } finally {
      setJdUrlLoading(false);
    }
  };

  // Poll plan status for async processing using new planAPI
  const pollPlanStatus = async (planId) => {
    try {
      // Use the new planAPI polling function
      const completedPlan = await planAPI.pollInterviewerPlanUntilComplete(
        planId,
        {
          pollInterval: 10000, // Poll every 10 seconds
          maxAttempts: 60, // Max 10 minutes (60 * 10s = 600s)
          onProgress: (plan) => {
            setPlanStatus(plan.status);
            setPollingAttempts((prev) => prev + 1);
            console.log(`Plan ${planId} status: ${plan.status}`);
          },
        },
      );

      // Plan succeeded - extract result
      const result = completedPlan.result;
      setResumeSummary(result.resumeSummary || "");
      setJdSummary(result.jdSummary || "");
      setGeneratedPlan(result.interviewPlan || null);
      setIsProcessing(false);
      setLoading(false);

      // Don't show success message yet - user needs to review and save
    } catch (pollError) {
      console.error("Error polling plan status:", pollError);

      const errorMsg = pollError.message || "Interview plan generation failed";
      setError(errorMsg);
      setIsProcessing(false);
      setLoading(false);

      setFlashMessages([
        {
          type: "error",
          content: errorMsg,
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "schedule-error",
        },
      ]);
    }
  };

  const handleGenerateInterviewPlan = async () => {
    try {
      setLoading(true);
      setIsProcessing(true);
      setError(null);
      setPlanId(null);
      setPlanStatus(null);
      setPollingAttempts(0);
      setIsSaved(false);
      setSavedInterviewId(null);

      // Validate inputs
      if (!validateInputs()) {
        throw new Error("Please fill in all required fields");
      }

      // Prepare data for API call
      // IMPORTANT: Pass actual file objects, not FormData converted to plain object
      const scheduleData = {
        interviewName: interviewName,
        scheduledDate: scheduledDate,
        scheduledTime: scheduledTime.value,
        interviewType: interviewType.value, // Interview type (technical, behavioral, etc.)
        useAiGeneration: questionSource === "ai", // Flag to indicate AI generation
      };

      // Add resume (file or text from URL)
      if (resumeFile.length > 0) {
        scheduleData.resumeFile = resumeFile[0];
      } else if (resumeText.trim().length > 0) {
        const resumeBlob = new Blob([resumeText], { type: "text/plain" });
        scheduleData.resumeFile = new File(
          [resumeBlob],
          "resume_from_url.txt",
          { type: "text/plain" },
        );
      }

      // Add job description (file or text from URL)
      if (jdFile.length > 0) {
        scheduleData.jdFile = jdFile[0];
      } else if (jdText.trim().length > 0) {
        scheduleData.jdText = jdText;
      }

      // Add questions based on mode
      if (questionSource === "ai") {
        // AI generation mode - no manual questions needed
        scheduleData.questionBankText = ""; // Empty string signals AI generation
      } else {
        // Manual question mode - use CSV questions
        // Send as JSON to preserve full question structure (instructions, evaluation, etc.)
        // Backend will detect JSON format and parse accordingly, falling back to old text format
        // Note: reasoning is NOT included - it will be LLM-generated to explain why this question was selected
        const csvQuestionData = csvQuestions.map((q, idx) => ({
          id: idx + 1,
          question: q.question,
          category: q.category || "General",
          difficulty: q.difficulty || "medium",
          time: q.time || "",
          instructions: q.instructions || "",
          evaluation: q.evaluation || "",
          answer: q.answer || "",
        }));
        scheduleData.questionBankText = JSON.stringify(csvQuestionData);
      }

      // Call API through service (it will create FormData internally)
      // API now returns planId immediately and processing happens in background
      const response = await interviewerAPI.schedule(scheduleData);
      const data = response.data;

      // Get planId and start polling
      const newPlanId = data.planId;
      setPlanId(newPlanId);
      setPlanStatus("pending");

      console.log(`Interview plan ${newPlanId} started, beginning to poll...`);

      // Start polling for plan status
      pollPlanStatus(newPlanId);
    } catch (err) {
      console.error("Error generating interview plan:", err);
      setError(err.message || "Failed to generate interview plan");
      setIsProcessing(false);
      setLoading(false);
    }
  };

  const handleSaveInterviewSchedule = async () => {
    try {
      if (
        !generatedPlan ||
        !generatedPlan.questions ||
        generatedPlan.questions.length === 0
      ) {
        setFlashMessages([
          {
            type: "warning",
            content:
              "No interview plan to save. Please generate the plan first.",
            dismissible: true,
            onDismiss: () => setFlashMessages([]),
            id: "no-plan",
          },
        ]);
        return;
      }

      if (!planId) {
        setFlashMessages([
          {
            type: "error",
            content: "No plan ID found. Please regenerate the interview plan.",
            dismissible: true,
            onDismiss: () => setFlashMessages([]),
            id: "no-plan-id",
          },
        ]);
        return;
      }

      setLoading(true);

      // Mark the existing plan as saved (updates status from 'generated' to 'completed')
      await planAPI.markInterviewerScheduleSaved(planId);

      setIsSaved(true);

      setFlashMessages([
        {
          type: "success",
          content:
            "Interview schedule saved successfully! You can now proceed to conduct the interview.",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "save-success",
        },
      ]);
    } catch (err) {
      console.error("Error saving interview schedule:", err);
      setFlashMessages([
        {
          type: "error",
          content: `Failed to save: ${err.message}`,
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "save-error",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleProceedToInterview = () => {
    // Navigate to interview list where user can start the live interview
    // In future, we could navigate directly to the live interview page with the interview ID
    navigate("/interviewer/create");
  };

  return (
    <SpaceBetween size="l">
      <div key="page-header">
        <Header
          variant="h1"
          description="Schedule a new interview with candidate information and question bank"
          actions={
            <Button
              iconName="arrow-left"
              onClick={() => navigate("/interviewer/create")}
            >
              Back to List
            </Button>
          }
        >
          Schedule New Interview
        </Header>
      </div>

      <Flashbar items={flashMessages} />

      {/* Input Section */}
      <div key="input-section">
        <Container header={<Header variant="h2">Interview Details</Header>}>
          <SpaceBetween size="l">
            {/* Interview Name */}
            <div key="interview-name-field">
              <FormField label="Interview Name" stretch required>
                <Input
                  value={interviewName}
                  onChange={({ detail }) => setInterviewName(detail.value)}
                  placeholder="e.g., John Doe - Senior Engineer Interview"
                />
              </FormField>
            </div>

            {/* Scheduled Date & Time */}
            <div key="datetime-fields">
              <SpaceBetween size="m" direction="horizontal">
                <div key="date-field">
                  <FormField
                    label="Scheduled Date"
                    errorText={dateError}
                    required
                    stretch
                  >
                    <DatePicker
                      onChange={({ detail }) => setScheduledDate(detail.value)}
                      value={scheduledDate}
                      placeholder="YYYY/MM/DD"
                    />
                  </FormField>
                </div>

                <div key="time-field">
                  <FormField
                    label="Scheduled Time"
                    errorText={timeError}
                    required
                    stretch
                  >
                    <Select
                      selectedOption={scheduledTime}
                      onChange={({ detail }) =>
                        setScheduledTime(detail.selectedOption)
                      }
                      options={timeSlotOptions}
                      placeholder="Select time"
                      filteringType="auto"
                    />
                  </FormField>
                </div>
              </SpaceBetween>
            </div>

            {/* Interview Type */}
            <div key="interview-type-field">
              <FormField
                label="Interview Type"
                description="Select the type of interview to conduct"
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
            </div>

            {/* Resume */}
            <div key="resume-field">
              <FormField
                label="Resume / CV"
                description="Upload resume or provide a URL to fetch it"
                stretch
                required
              >
                <SpaceBetween size="m">
                  <div key="resume-radio-group">
                    <RadioGroup
                      value={resumeInputType}
                      onChange={({ detail }) =>
                        setResumeInputType(detail.value)
                      }
                      items={[
                        {
                          value: "file",
                          label: "Upload File",
                          description:
                            "Upload resume in PDF, DOCX, or TXT format",
                        },
                        {
                          value: "url",
                          label: "Enter URL",
                          description: "Provide a link to the resume",
                        },
                      ]}
                    />
                  </div>

                  {resumeInputType === "file" ? (
                    <div key="resume-file-upload">
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
                    </div>
                  ) : (
                    <SpaceBetween size="s" key="resume-url-section">
                      <div key="resume-url-input">
                        <FormField
                          label="Resume URL"
                          errorText={resumeUrlError}
                        >
                          <Input
                            value={resumeUrl}
                            onChange={({ detail }) =>
                              setResumeUrl(detail.value)
                            }
                            placeholder="https://..."
                            type="url"
                          />
                        </FormField>
                      </div>

                      <div key="resume-fetch-button">
                        <Button
                          onClick={handleFetchResumeFromUrl}
                          loading={resumeUrlLoading}
                          disabled={!resumeUrl.trim()}
                        >
                          {resumeUrlLoading ? "Fetching..." : "Fetch Resume"}
                        </Button>
                      </div>

                      {resumeText && (
                        <div key="resume-preview">
                          <Box>
                            <Alert
                              type="success"
                              header="Resume Content Loaded"
                            >
                              Content has been extracted from the URL. You can
                              review it below.
                            </Alert>
                            <Box margin={{ top: "s" }}>
                              <ExpandableSection
                                headerText="Preview Extracted Content"
                                defaultExpanded
                              >
                                <Box
                                  padding="s"
                                  backgroundColor="background-container-content"
                                >
                                  <pre
                                    style={{
                                      whiteSpace: "pre-wrap",
                                      fontFamily: "monospace",
                                      fontSize: "12px",
                                    }}
                                  >
                                    {resumeText}
                                  </pre>
                                </Box>
                              </ExpandableSection>
                            </Box>
                          </Box>
                        </div>
                      )}
                    </SpaceBetween>
                  )}
                </SpaceBetween>
              </FormField>
            </div>

            {/* Job Description */}
            <div key="jd-field">
              <FormField
                label="Job Description"
                description="Upload job description file or provide a URL"
                stretch
                required
              >
                <SpaceBetween size="m">
                  <div key="jd-radio-group">
                    <RadioGroup
                      value={jdInputType}
                      onChange={({ detail }) => setJdInputType(detail.value)}
                      items={[
                        {
                          value: "file",
                          label: "Upload File",
                          description:
                            "Upload job description in PDF, DOCX, or TXT format",
                        },
                        {
                          value: "url",
                          label: "Enter URL",
                          description: "Provide a link to the job posting",
                        },
                      ]}
                    />
                  </div>

                  {jdInputType === "file" ? (
                    <div key="jd-file-upload">
                      <FileUpload
                        onChange={({ detail }) => setJdFile(detail.value)}
                        value={jdFile}
                        i18nStrings={{
                          uploadButtonText: (e) =>
                            e ? "Choose files" : "Choose file",
                          dropzoneText: (e) => "Drop file to upload",
                          removeFileAriaLabel: (e) => `Remove file ${e + 1}`,
                        }}
                        accept=".pdf,.docx,.doc,.txt"
                      />
                    </div>
                  ) : (
                    <SpaceBetween size="s" key="jd-url-section">
                      <div key="jd-url-input">
                        <FormField
                          label="Job Posting URL"
                          errorText={jdUrlError}
                        >
                          <Input
                            value={jdUrl}
                            onChange={({ detail }) => setJdUrl(detail.value)}
                            placeholder="https://..."
                            type="url"
                          />
                        </FormField>
                      </div>

                      <div key="jd-fetch-button">
                        <Button
                          onClick={handleFetchJdFromUrl}
                          loading={jdUrlLoading}
                          disabled={!jdUrl.trim()}
                        >
                          {jdUrlLoading
                            ? "Fetching..."
                            : "Fetch Job Description"}
                        </Button>
                      </div>

                      {jdText && (
                        <div key="jd-preview">
                          <Box>
                            <Alert
                              type="success"
                              header="Job Description Loaded"
                            >
                              Content has been extracted from the URL. You can
                              review it below.
                            </Alert>
                            <Box margin={{ top: "s" }}>
                              <ExpandableSection
                                headerText="Preview Extracted Content"
                                defaultExpanded
                              >
                                <Box
                                  padding="s"
                                  backgroundColor="background-container-content"
                                >
                                  <pre
                                    style={{
                                      whiteSpace: "pre-wrap",
                                      fontFamily: "monospace",
                                      fontSize: "12px",
                                    }}
                                  >
                                    {jdText}
                                  </pre>
                                </Box>
                              </ExpandableSection>
                            </Box>
                          </Box>
                        </div>
                      )}
                    </SpaceBetween>
                  )}
                </SpaceBetween>
              </FormField>
            </div>

            {/* Question Source Selection */}
            <div key="question-source-field">
              <FormField
                label="Question Source"
                description="Choose how you want to generate interview questions"
                stretch
              >
                <SpaceBetween size="m">
                  <div key="question-source-radio">
                    <RadioGroup
                      value={questionSource}
                      onChange={({ detail }) => setQuestionSource(detail.value)}
                      items={[
                        {
                          value: "ai",
                          label: "AI Selected Questions",
                          description:
                            "Let AI research and select personalized questions based on your inputs",
                        },
                        {
                          value: "csv",
                          label: "Upload Custom Questions (CSV)",
                          description:
                            "Upload your own prepared questions in CSV format",
                        },
                      ]}
                    />
                  </div>

                  {/* Manual CSV Upload */}
                  {questionSource === "csv" && (
                    <div key="csv-upload-section">
                      <Container>
                        <SpaceBetween size="m">
                          <div key="csv-alert">
                            <Alert type="info">
                              Upload a CSV file with interview question details.
                              The system will use your provided fields and
                              generate any missing ones.
                              <br />
                              <strong>Required:</strong> question
                              <br />
                              <strong>
                                Auto-generated if not provided:
                              </strong>{" "}
                              category, difficulty, time, instructions,
                              evaluation, answer
                              <br />
                              <strong>Always LLM-generated:</strong> reasoning
                              (explains why question was selected for this
                              candidate)
                              <br />
                              <Link onFollow={handleDownloadTemplate}>
                                Download CSV Template
                              </Link>{" "}
                              to see the full format with examples
                            </Alert>
                          </div>

                          <div key="csv-upload-field">
                            <FormField
                              label="CSV File"
                              description="Upload a CSV file containing your interview questions"
                              stretch
                              errorText={csvError}
                              required
                            >
                              <FileUpload
                                onChange={handleCsvUpload}
                                value={csvFile}
                                i18nStrings={{
                                  uploadButtonText: (e) =>
                                    e ? "Choose files" : "Choose file",
                                  dropzoneText: (e) =>
                                    "Drop CSV file to upload",
                                  removeFileAriaLabel: (e) =>
                                    `Remove file ${e + 1}`,
                                }}
                                accept=".csv"
                              />
                            </FormField>
                          </div>

                          {/* CSV Questions Preview */}
                          {csvQuestions.length > 0 && (
                            <div key="csv-preview">
                              <Box>
                                <Alert
                                  type="success"
                                  header={`${csvQuestions.length} questions loaded`}
                                >
                                  Your questions have been successfully parsed
                                  from the CSV file.
                                </Alert>

                                <Box margin={{ top: "s" }}>
                                  <ExpandableSection
                                    headerText="Preview Questions"
                                    defaultExpanded
                                  >
                                    <Table
                                      columnDefinitions={[
                                        {
                                          id: "id",
                                          header: "#",
                                          cell: (item) => item.id,
                                          width: 50,
                                        },
                                        {
                                          id: "question",
                                          header: "Question",
                                          cell: (item) => item.question,
                                          width: 250,
                                        },
                                        {
                                          id: "category",
                                          header: "Category",
                                          cell: (item) => (
                                            <Badge>
                                              <div
                                                style={{
                                                  whiteSpace: "nowrap",
                                                  overflow: "hidden",
                                                  textOverflow: "ellipsis",
                                                  maxWidth: "120px",
                                                }}
                                              >
                                                {item.category}
                                              </div>
                                            </Badge>
                                          ),
                                          width: 140,
                                        },
                                        {
                                          id: "difficulty",
                                          header: "Difficulty",
                                          cell: (item) => (
                                            <Badge
                                              color={
                                                item.difficulty === "hard"
                                                  ? "red"
                                                  : item.difficulty === "medium"
                                                    ? "blue"
                                                    : "green"
                                              }
                                            >
                                              {item.difficulty}
                                            </Badge>
                                          ),
                                          width: 100,
                                        },
                                        {
                                          id: "time",
                                          header: "Time",
                                          cell: (item) =>
                                            item.time ? (
                                              <Box
                                                variant="small"
                                                color="text-body-secondary"
                                              >
                                                {item.time}
                                              </Box>
                                            ) : (
                                              <Box
                                                variant="small"
                                                color="text-status-inactive"
                                              >
                                                -
                                              </Box>
                                            ),
                                          width: 120,
                                        },
                                        {
                                          id: "instructions",
                                          header: "Instructions",
                                          cell: (item) =>
                                            item.instructions ? (
                                              <Box
                                                variant="small"
                                                color="text-body-secondary"
                                              >
                                                <div
                                                  style={{
                                                    maxWidth: "200px",
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                  }}
                                                >
                                                  {item.instructions}
                                                </div>
                                              </Box>
                                            ) : (
                                              <Box
                                                variant="small"
                                                color="text-status-inactive"
                                              >
                                                -
                                              </Box>
                                            ),
                                          width: 220,
                                        },
                                        {
                                          id: "evaluation",
                                          header: "Evaluation Criteria",
                                          cell: (item) =>
                                            item.evaluation ? (
                                              <Box
                                                variant="small"
                                                color="text-body-secondary"
                                              >
                                                <div
                                                  style={{
                                                    maxWidth: "200px",
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                  }}
                                                >
                                                  {item.evaluation}
                                                </div>
                                              </Box>
                                            ) : (
                                              <Box
                                                variant="small"
                                                color="text-status-inactive"
                                              >
                                                -
                                              </Box>
                                            ),
                                          width: 220,
                                        },
                                        {
                                          id: "answer",
                                          header: "Expected Answer",
                                          cell: (item) =>
                                            item.answer ? (
                                              <Box
                                                variant="small"
                                                color="text-body-secondary"
                                              >
                                                <div
                                                  style={{
                                                    maxWidth: "200px",
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                  }}
                                                >
                                                  {item.answer}
                                                </div>
                                              </Box>
                                            ) : (
                                              <Box
                                                variant="small"
                                                color="text-status-inactive"
                                              >
                                                -
                                              </Box>
                                            ),
                                          width: 220,
                                        },
                                      ]}
                                      items={csvQuestions}
                                      variant="embedded"
                                      wrapLines={false}
                                    />
                                  </ExpandableSection>
                                </Box>
                              </Box>
                            </div>
                          )}
                        </SpaceBetween>
                      </Container>
                    </div>
                  )}

                  {/* AI Generation Info */}
                  {questionSource === "ai" && (
                    <div key="ai-info">
                      <Alert type="info">
                        <strong>AI Question Generation</strong>
                        <br />
                        AI will analyze the candidate's resume and job
                        description to:
                        <ul style={{ marginTop: "8px", marginBottom: "0" }}>
                          <li>
                            Search the question bank for relevant questions
                            matching the candidate's background and job
                            requirements
                          </li>
                          <li>
                            Retrieve questions with interviewer instructions and
                            evaluation criteria
                          </li>
                          <li>
                            Fall back to AI-generated questions if no suitable
                            matches are found in the question bank
                          </li>
                        </ul>
                      </Alert>
                    </div>
                  )}
                </SpaceBetween>
              </FormField>
            </div>

            <div key="generate-button">
              <Box>
                <Button
                  variant="primary"
                  onClick={handleGenerateInterviewPlan}
                  disabled={!validateInputs() || isProcessing}
                  loading={loading}
                >
                  {questionSource === "ai"
                    ? "AI Research & Selected Questions"
                    : "Generate Interview Plan with Custom Questions"}
                </Button>
              </Box>
            </div>
          </SpaceBetween>
        </Container>
      </div>

      {/* Processing with Job Status */}
      {isProcessing && (
        <div key="processing-section">
          <Container>
            <SpaceBetween size="m" alignItems="center">
              <div key="spinner">
                <Spinner size="large" />
              </div>
              <div key="processing-title">
                <Box variant="h3">Scheduling interview...</Box>
              </div>
              <div key="processing-desc">
                <Box variant="p" color="text-body-secondary">
                  AI is analyzing the resume, job description, and question bank
                  to create an interview plan with optimized question flow. This
                  may take 1-2 minutes.
                </Box>
              </div>

              {/* Plan Status Display */}
              {planStatus && (
                <div
                  key="plan-status"
                  style={{ textAlign: "center", marginTop: "16px" }}
                >
                  <Box textAlign="center">
                    <strong>Status:</strong>{" "}
                    {planStatus === "pending"
                      ? "Queued"
                      : planStatus === "processing"
                        ? "Processing"
                        : planStatus}
                  </Box>
                  {planId && (
                    <Box
                      textAlign="center"
                      variant="small"
                      color="text-body-secondary"
                    >
                      Plan ID: {planId}
                    </Box>
                  )}
                  {pollingAttempts > 0 && (
                    <Box
                      textAlign="center"
                      variant="small"
                      color="text-body-secondary"
                    >
                      Checking status ({pollingAttempts} checks, ~
                      {Math.round((pollingAttempts * 10) / 60)} min elapsed)
                    </Box>
                  )}
                </div>
              )}
            </SpaceBetween>
          </Container>
        </div>
      )}

      {/* Interview Plan */}
      {generatedPlan && !isProcessing && (
        <>
          <div key="success-alert">
            <Alert
              type="success"
              header="Interview Plan Generated Successfully!"
            >
              Review the interview questions and plan below. Once you're
              satisfied, save the interview schedule to proceed.
            </Alert>
          </div>

          <div key="action-buttons">
            <Container>
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  onClick={handleSaveInterviewSchedule}
                  disabled={isSaved}
                  loading={loading}
                >
                  {isSaved
                    ? "Interview Schedule Saved ✓"
                    : "Save Interview Schedule"}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleProceedToInterview}
                  disabled={!isSaved}
                >
                  Proceed to Interview
                </Button>
              </SpaceBetween>
            </Container>
          </div>

          {/* Summaries */}
          <div key="summaries-section">
            <ExpandableSection
              headerText="Candidate Summary"
              defaultExpanded={false}
              variant="container"
            >
              <Box variant="p">
                <div style={{ lineHeight: "1.6" }}>
                  <ReactMarkdown>{resumeSummary}</ReactMarkdown>
                </div>
              </Box>
            </ExpandableSection>
          </div>

          {/* Job Description Summary */}
          {jdSummary && (
            <div key="jd-summary-section">
              <ExpandableSection
                headerText="Job Description Summary"
                defaultExpanded={false}
                variant="container"
              >
                <Box variant="p">
                  <div style={{ lineHeight: "1.6" }}>
                    <ReactMarkdown>{jdSummary}</ReactMarkdown>
                  </div>
                </Box>
              </ExpandableSection>
            </div>
          )}

          {/* Interview Questions Flow */}
          {generatedPlan.questions && generatedPlan.questions.length > 0 && (
            <div key="questions-flow">
              <Container
                header={
                  <Header
                    variant="h2"
                    description="Follow this question sequence for an optimal interview flow"
                  >
                    Interview Question Flow ({generatedPlan.questions.length}{" "}
                    Questions)
                  </Header>
                }
              >
                <SpaceBetween size="m">
                  {generatedPlan.questions.map((q, index) => (
                    <div key={q.questionId || index}>
                      <Box
                        padding={{ vertical: "s", horizontal: "m" }}
                        backgroundColor="background-container-content"
                      >
                        <SpaceBetween size="xs">
                          <div key="question-header">
                            <SpaceBetween direction="horizontal" size="xs">
                              <Box variant="strong" color="text-status-info">
                                Q{index + 1}
                              </Box>
                              {q.category && <Badge>{q.category}</Badge>}
                              {q.difficulty && (
                                <Badge
                                  color={
                                    q.difficulty === "hard"
                                      ? "red"
                                      : q.difficulty === "medium"
                                        ? "blue"
                                        : "green"
                                  }
                                >
                                  {q.difficulty}
                                </Badge>
                              )}
                              {q.estimatedTime && (
                                <Box
                                  variant="small"
                                  color="text-body-secondary"
                                >
                                  {q.estimatedTime}
                                </Box>
                              )}
                            </SpaceBetween>
                          </div>
                          <div key="question-text">
                            <Box variant="h4">{q.questionText}</Box>
                          </div>
                          {q.reasoning && (
                            <div key="reasoning">
                              <Box variant="small" color="text-body-secondary">
                                <strong>Why this question:</strong>{" "}
                                <span style={{ whiteSpace: "pre-wrap" }}>
                                  {q.reasoning}
                                </span>
                              </Box>
                            </div>
                          )}
                          {q.instructions && (
                            <div key="instructions">
                              <ExpandableSection
                                headerText="Interviewer Instructions"
                                variant="footer"
                              >
                                <Box variant="p">
                                  <div style={{ lineHeight: "1.6" }}>
                                    <ReactMarkdown>
                                      {q.instructions}
                                    </ReactMarkdown>
                                  </div>
                                </Box>
                              </ExpandableSection>
                            </div>
                          )}
                          {q.evaluationChecklist && (
                            <div key="evaluation-checklist">
                              <ExpandableSection
                                headerText="Evaluation Checklist"
                                variant="footer"
                              >
                                <Box variant="p">
                                  <div style={{ lineHeight: "1.6" }}>
                                    <ReactMarkdown>
                                      {q.evaluationChecklist}
                                    </ReactMarkdown>
                                  </div>
                                </Box>
                              </ExpandableSection>
                            </div>
                          )}
                          {q.expectedAnswer && (
                            <div key="expected-answer">
                              <ExpandableSection
                                headerText="Expected Answer"
                                variant="footer"
                              >
                                <Box variant="p">
                                  <div style={{ lineHeight: "1.6" }}>
                                    <ReactMarkdown>
                                      {q.expectedAnswer}
                                    </ReactMarkdown>
                                  </div>
                                </Box>
                              </ExpandableSection>
                            </div>
                          )}
                        </SpaceBetween>
                      </Box>
                    </div>
                  ))}
                </SpaceBetween>
              </Container>
            </div>
          )}

          {/* Preparation Tips */}
          {generatedPlan.preparationTips &&
            generatedPlan.preparationTips.length > 0 && (
              <div key="prep-tips">
                <Container
                  header={
                    <Header variant="h2">Interview Preparation Tips</Header>
                  }
                >
                  <ul style={{ margin: "0", paddingLeft: "20px" }}>
                    {generatedPlan.preparationTips.map((tip, i) => (
                      <li key={i} style={{ marginBottom: "8px" }}>
                        <Box variant="p">{tip}</Box>
                      </li>
                    ))}
                  </ul>
                </Container>
              </div>
            )}
        </>
      )}

      {error && (
        <div key="error-alert">
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
    </SpaceBetween>
  );
}

export default InterviewerNew;
