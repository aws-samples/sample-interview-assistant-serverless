import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Header,
  SpaceBetween,
  FormField,
  FileUpload,
  Textarea,
  Input,
  Button,
  Box,
  Alert,
  Spinner,
  ExpandableSection,
  Badge,
  Select,
  RadioGroup,
  Link,
  Table,
  Flashbar,
} from "@cloudscape-design/components";
import { interviewPlanAPI, planAPI } from "../services/api";

function PrepareInterviewNew() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [flashMessages, setFlashMessages] = useState([]);

  // Step 1: Input
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

  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [interviewType, setInterviewType] = useState({
    label: "Technical Skills",
    value: "technical",
  });

  // Question Source
  const [questionSource, setQuestionSource] = useState("ai"); // 'ai' or 'csv'
  const [csvFile, setCsvFile] = useState([]);
  const [customQuestions, setCustomQuestions] = useState([]);
  const [csvError, setCsvError] = useState(null);

  // Step 2: Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [planId, setPlanId] = useState(null);
  const [planStatus, setPlanStatus] = useState(null); // 'pending', 'processing', 'completed', 'failed'
  const [pollingAttempts, setPollingAttempts] = useState(0);
  const [searchResults, setSearchResults] = useState(null);
  const [generatedQuestions, setGeneratedQuestions] = useState(null);
  const [resumeSummary, setResumeSummary] = useState("");
  const [jdSummary, setJdSummary] = useState("");

  const validateInputs = () => {
    // Resume validation: either file or URL with fetched content
    const hasResume = resumeFile.length > 0 || resumeText.trim().length > 0;

    // JD validation: either file or URL with fetched content
    const hasJD = jdFile.length > 0 || jdText.trim().length > 0;

    if (questionSource === "csv") {
      return hasResume && hasJD && customQuestions.length > 0;
    }

    return hasResume && hasJD;
  };

  // CSV Template Download
  const handleDownloadTemplate = () => {
    const csvContent =
      "question,category,answer\n" +
      '"Tell me about yourself",Behavioral,"Current role → Past experience → Why this company"\n' +
      '"Explain your biggest technical challenge",Technical,"Describe problem → Your approach → Result with metrics"\n' +
      '"Design a scalable system",System Design,"Components → Scale considerations → Trade-offs"\n' +
      '"Why do you want to work here?",Company-Specific,"Research: Recent news + Company values + Role alignment"\n' +
      '"What are your salary expectations?",General,';

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "question_template.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CSV Parsing
  const parseCSV = (text) => {
    const lines = text.split("\n").filter((line) => line.trim());
    if (lines.length < 2) {
      throw new Error("CSV file is empty or has no data rows");
    }

    // Parse header
    const header = lines[0]
      .toLowerCase()
      .split(",")
      .map((h) => h.trim().replace(/"/g, ""));
    const questionIndex = header.indexOf("question");
    const categoryIndex = header.indexOf("category");
    const answerIndex = header.indexOf("answer");

    if (questionIndex === -1) {
      throw new Error('CSV must have a "question" column');
    }

    // Parse rows
    const questions = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Simple CSV parsing (handles quoted fields)
      const values = [];
      let current = "";
      let inQuotes = false;

      for (let char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          values.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const question = values[questionIndex]?.replace(/^"|"$/g, "") || "";
      const category =
        categoryIndex !== -1
          ? values[categoryIndex]?.replace(/^"|"$/g, "") || "General"
          : "General";
      const answer =
        answerIndex !== -1
          ? values[answerIndex]?.replace(/^"|"$/g, "") || ""
          : "";

      if (question) {
        questions.push({
          id: i,
          question,
          category,
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
    setCustomQuestions([]);

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

      setCustomQuestions(parsed);
      setCsvError(null);
    } catch (error) {
      setCsvError(error.message || "Failed to parse CSV file");
      setCustomQuestions([]);
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

      // Call backend API to scrape resume through service
      const response = await interviewPlanAPI.scrapeResume(resumeUrl);

      const data = response.data;

      if (data.status === "success") {
        const extractedText = data.text || "";

        // Store fetched content
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

      // Call backend API to scrape job description through service
      const response = await interviewPlanAPI.scrapeJobDescription(jdUrl);

      const data = response.data;

      if (data.status === "success") {
        const extractedText = data.text || "";
        const title = data.title || "";

        // Add title and source URL to the extracted content
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

  const handleGenerate = async () => {
    try {
      setLoading(true);
      setIsProcessing(true);
      setError(null);
      setPlanId(null);
      setPlanStatus(null);
      setPollingAttempts(0);

      // Validate inputs
      const hasResume = resumeFile.length > 0 || resumeText.trim().length > 0;
      const hasJD = jdFile.length > 0 || jdText.trim().length > 0;

      if (!hasResume) {
        throw new Error("Please upload a resume or fetch from URL");
      }
      if (!hasJD) {
        throw new Error("Please upload a job description or fetch from URL");
      }

      // Prepare FormData for API call
      const formData = new FormData();

      // Add resume (file or text from URL)
      if (resumeFile.length > 0) {
        formData.append("resumeFile", resumeFile[0]);
      } else if (resumeText.trim().length > 0) {
        // Create a text file from fetched content
        const resumeBlob = new Blob([resumeText], { type: "text/plain" });
        formData.append("resumeFile", resumeBlob, "resume_from_url.txt");
      }

      // Add job description (file or text from URL)
      if (jdFile.length > 0) {
        formData.append("jdFile", jdFile[0]);
      } else if (jdText.trim().length > 0) {
        formData.append("jdText", jdText);
      }

      formData.append("companyName", companyName || "");
      formData.append("jobTitle", jobTitle || "");
      formData.append("interviewType", interviewType.value);
      formData.append("questionCount", "5");
      formData.append("difficulty", "medium");

      // Add custom questions if using CSV source
      if (questionSource === "csv" && customQuestions.length > 0) {
        formData.append("customQuestions", JSON.stringify(customQuestions));
      }

      // Step 1: Submit plan generation and get planId
      const response = await interviewPlanAPI.generate(formData);
      const { planId: newPlanId, status } = response.data;

      if (!newPlanId) {
        throw new Error(
          "Failed to start plan generation - no plan ID returned",
        );
      }

      setPlanId(newPlanId);
      setPlanStatus(status);
      console.log(`Plan ${newPlanId} submitted, starting to poll...`);

      // Step 2: Poll for completion using new planAPI
      const completedPlan = await planAPI.pollCandidatePlanUntilComplete(
        newPlanId,
        {
          pollInterval: 10000, // Poll every 10 seconds
          maxAttempts: 60, // Max 10 minutes (60 * 10s = 600s)
          onProgress: (plan) => {
            setPlanStatus(plan.status);
            setPollingAttempts((prev) => prev + 1);
            console.log(
              `Plan ${newPlanId} status: ${plan.status} (attempt ${pollingAttempts + 1})`,
            );
          },
        },
      );

      // Step 3: Process completed plan result
      const data = completedPlan.result;

      if (!data) {
        throw new Error("Plan completed but no result returned");
      }

      // Store summaries
      setResumeSummary(data.resumeSummary || "");
      setJdSummary(data.jdSummary || "");

      // Parse company research results
      const companyResearch = data.interviewPlan?.companyResearch || {};
      if (companyResearch.companyName || companyResearch.culture?.length > 0) {
        setSearchResults({
          companyInfo: {
            name: companyResearch.companyName || companyName || "Company",
            industry: companyResearch.industry || "Technology",
          },
          industryTrends: companyResearch.culture || [],
          interviewProcess: companyResearch.interviewProcess || [],
        });
      }

      // Parse questions - keep in order for interview flow
      const questions = data.interviewPlan?.questions || [];
      const parsedQuestions = questions.map((q, index) => ({
        id: q.questionId || `q${index + 1}`,
        question: q.questionText,
        category: q.category || "General",
        reasoning: q.reasoning || "",
        difficulty: q.difficulty || "medium",
        expectedAnswer: q.expectedAnswer || "",
        source: q.source || "ai",
        order: index + 1,
      }));

      setGeneratedQuestions({
        questions: parsedQuestions,
        totalQuestions: questions.length,
        preparationTips: data.interviewPlan?.preparationTips || [],
      });

      setIsProcessing(false);
      setPlanStatus("completed");
    } catch (err) {
      console.error("Error generating interview plan:", err);
      setError(err.message || "Failed to generate questions");
      setIsProcessing(false);
      setPlanStatus("failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveQuestions = async () => {
    try {
      if (
        !generatedQuestions ||
        !generatedQuestions.questions ||
        generatedQuestions.questions.length === 0
      ) {
        setFlashMessages([
          {
            type: "warning",
            content: "No questions to save. Please generate questions first.",
            dismissible: true,
            onDismiss: () => setFlashMessages([]),
            id: "no-questions",
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
      await planAPI.markCandidatePlanSaved(planId);

      setFlashMessages([
        {
          type: "success",
          content:
            "Interview preparation saved successfully! You can now use it in Live Practice.",
          dismissible: true,
          onDismiss: () => setFlashMessages([]),
          id: "save-success",
        },
      ]);
    } catch (err) {
      console.error("Error saving interview plan:", err);
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

  const handleStartPractice = () => {
    // Navigate to Live Practice with these questions
    navigate("/practice");
  };

  const getDifficultyBadge = (difficulty) => {
    const colors = {
      easy: "green",
      medium: "blue",
      hard: "red",
    };
    return <Badge color={colors[difficulty]}>{difficulty}</Badge>;
  };

  return (
    <SpaceBetween size="l">
      <div key="page-header">
        <Header
          variant="h1"
          description="Prepare for your interview with AI-powered research and question generation"
        >
          Prepare Interview
        </Header>
      </div>

      {/* Input Section */}
      <div key="input-section">
        <Container header={<Header variant="h2">Interview Information</Header>}>
          <SpaceBetween size="l">
            {/* Company Name */}
            <div key="company-name-field">
              <FormField label="Company Name (Optional)" stretch>
                <Input
                  value={companyName}
                  onChange={({ detail }) => setCompanyName(detail.value)}
                  placeholder="e.g., Google, Amazon, Startup Inc..."
                />
              </FormField>
            </div>

            {/* Job Title */}
            <div key="job-title-field">
              <FormField label="Job Title (Optional)" stretch>
                <Input
                  value={jobTitle}
                  onChange={({ detail }) => setJobTitle(detail.value)}
                  placeholder="e.g., Senior Software Engineer, Product Manager..."
                />
              </FormField>
            </div>

            {/* Resume */}
            <div key="resume-field">
              <FormField
                label="Resume / CV"
                description="Upload your resume or provide a URL to fetch it"
                stretch
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
                            "Upload your resume in PDF, DOCX, or TXT format",
                        },
                        {
                          value: "url",
                          label: "Enter URL",
                          description:
                            "Provide a link to your resume (e.g., LinkedIn profile, Google Drive, personal website)",
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
                          description="Enter the URL to your resume"
                          errorText={resumeUrlError}
                        >
                          <Input
                            value={resumeUrl}
                            onChange={({ detail }) =>
                              setResumeUrl(detail.value)
                            }
                            placeholder="https://www.linkedin.com/in/yourname/ or https://drive.google.com/..."
                            type="url"
                          />
                        </FormField>
                      </div>

                      <div key="resume-fetch-button">
                        <Box>
                          <Button
                            onClick={handleFetchResumeFromUrl}
                            loading={resumeUrlLoading}
                            disabled={!resumeUrl.trim()}
                          >
                            {resumeUrlLoading ? "Fetching..." : "Fetch Resume"}
                          </Button>
                        </Box>
                      </div>

                      {resumeText && (
                        <div key="resume-preview-box">
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
                          description:
                            "Provide a link to the job posting (e.g., LinkedIn, company career page)",
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
                          description="Enter the URL to the job posting"
                          errorText={jdUrlError}
                        >
                          <Input
                            value={jdUrl}
                            onChange={({ detail }) => setJdUrl(detail.value)}
                            placeholder="https://www.linkedin.com/jobs/view/..."
                            type="url"
                          />
                        </FormField>
                      </div>

                      <div key="jd-fetch-button">
                        <Box>
                          <Button
                            onClick={handleFetchJdFromUrl}
                            loading={jdUrlLoading}
                            disabled={!jdUrl.trim()}
                          >
                            {jdUrlLoading
                              ? "Fetching..."
                              : "Fetch Job Description"}
                          </Button>
                        </Box>
                      </div>

                      {jdText && (
                        <div key="jd-preview-box">
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

            {/* Interview Type */}
            <div key="interview-type-field">
              <FormField
                label="Interview Type"
                description="Select the type of interview you're preparing for"
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

            {/* Question Source */}
            <div key="question-source-field">
              <FormField
                label="Question Source"
                description="Choose how you want to generate interview questions"
                stretch
              >
                <RadioGroup
                  value={questionSource}
                  onChange={({ detail }) => setQuestionSource(detail.value)}
                  items={[
                    {
                      value: "ai",
                      label: "AI Generated Questions",
                      description:
                        "Let AI research and generate personalized questions based on your inputs",
                    },
                    {
                      value: "csv",
                      label: "Upload Custom Questions (CSV)",
                      description:
                        "Upload your own prepared questions in CSV format",
                    },
                  ]}
                />
              </FormField>
            </div>

            {/* CSV Upload Section */}
            {questionSource === "csv" && (
              <div key="csv-upload-section">
                <Container>
                  <SpaceBetween size="m">
                    <div key="csv-alert">
                      <Alert type="info">
                        Upload a CSV file with your custom questions.
                        <br />
                        <strong>Format:</strong> question, category (optional)
                        <br />
                        <Link onFollow={handleDownloadTemplate}>
                          Download CSV Template
                        </Link>
                      </Alert>
                    </div>

                    <div key="csv-upload-field">
                      <FormField
                        label="CSV File"
                        description="Upload a CSV file containing your interview questions"
                        stretch
                        errorText={csvError}
                      >
                        <FileUpload
                          onChange={handleCsvUpload}
                          value={csvFile}
                          i18nStrings={{
                            uploadButtonText: (e) =>
                              e ? "Choose files" : "Choose file",
                            dropzoneText: (e) => "Drop CSV file to upload",
                            removeFileAriaLabel: (e) => `Remove file ${e + 1}`,
                          }}
                          accept=".csv"
                        />
                      </FormField>
                    </div>

                    {/* CSV Questions Preview */}
                    {customQuestions.length > 0 && (
                      <div key="csv-preview">
                        <Box>
                          <Alert
                            type="success"
                            header={`${customQuestions.length} questions loaded`}
                          >
                            Your questions have been successfully parsed from
                            the CSV file.
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
                                  },
                                  {
                                    id: "category",
                                    header: "Category",
                                    cell: (item) => (
                                      <Badge>{item.category}</Badge>
                                    ),
                                    width: 150,
                                  },
                                  {
                                    id: "answer",
                                    header: "Suggested Answer",
                                    cell: (item) =>
                                      item.answer ? (
                                        <Box
                                          variant="small"
                                          color="text-body-secondary"
                                        >
                                          {item.answer}
                                        </Box>
                                      ) : (
                                        <Box
                                          variant="small"
                                          color="text-status-inactive"
                                        >
                                          -
                                        </Box>
                                      ),
                                  },
                                ]}
                                items={customQuestions}
                                variant="embedded"
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

            <div key="generate-button">
              <Box>
                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  disabled={!validateInputs() || isProcessing}
                  loading={loading}
                >
                  {questionSource === "csv"
                    ? "Generate with Custom Questions"
                    : "AI Research & Generate Questions"}
                </Button>
              </Box>
            </div>
          </SpaceBetween>
        </Container>
      </div>

      {/* Processing */}
      {isProcessing && (
        <div key="processing-section">
          <Container>
            <SpaceBetween size="m" alignItems="center">
              <div key="spinner">
                <Spinner size="large" />
              </div>
              <div key="processing-title">
                <Box variant="h3">
                  AI is researching and generating interview questions...
                </Box>
              </div>
              <div key="processing-desc">
                <Box variant="p" color="text-body-secondary">
                  This may take a few minutes. AI is analyzing your resume, job
                  description, and researching company interview patterns.
                </Box>
              </div>
              {planStatus && (
                <div key="plan-status">
                  <Alert type="info">
                    <SpaceBetween size="xs">
                      <Box>
                        <strong>Status:</strong>{" "}
                        {planStatus === "pending"
                          ? "Queued"
                          : planStatus === "processing"
                            ? "Processing"
                            : planStatus}
                      </Box>
                      {planId && (
                        <Box variant="small" color="text-body-secondary">
                          Plan ID: {planId}
                        </Box>
                      )}
                      {pollingAttempts > 0 && (
                        <Box variant="small" color="text-body-secondary">
                          Checking status ({pollingAttempts} checks, ~
                          {Math.round((pollingAttempts * 10) / 60)} min elapsed)
                        </Box>
                      )}
                    </SpaceBetween>
                  </Alert>
                </div>
              )}
            </SpaceBetween>
          </Container>
        </div>
      )}

      {/* Generated Questions */}
      {generatedQuestions && !isProcessing && (
        <>
          <div key="success-alert">
            <Alert type="success" header="Questions Generated Successfully!">
              AI has generated {generatedQuestions.totalQuestions} personalized
              interview questions based on your resume, the job description, and
              our research.
            </Alert>
          </div>

          <div key="flashbar">
            <Flashbar items={flashMessages} />
          </div>

          <div key="questions-container">
            <Container
              header={
                <Header
                  variant="h2"
                  description="Interview questions in order - practice them sequentially"
                  actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <div key="save-btn">
                        <Button onClick={handleSaveQuestions}>
                          Save Preparation
                        </Button>
                      </div>
                      <div key="practice-btn">
                        <Button variant="primary" onClick={handleStartPractice}>
                          Start Practice Now
                        </Button>
                      </div>
                    </SpaceBetween>
                  }
                >
                  Interview Questions ({generatedQuestions.totalQuestions})
                </Header>
              }
            >
              <SpaceBetween size="m">
                {generatedQuestions.questions.map((q, index) => (
                  <div key={index} style={{ width: "100%" }}>
                    {/* Interviewer Question - Left aligned */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-start",
                        marginBottom: "12px",
                      }}
                    >
                      <div
                        style={{
                          maxWidth: "75%",
                          backgroundColor: "#f2f3f3",
                          padding: "16px 20px",
                          borderRadius: "12px",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                        }}
                      >
                        <SpaceBetween size="xs">
                          <div key="badges">
                            <SpaceBetween direction="horizontal" size="xs">
                              <div key="order-badge">
                                <Badge color="grey">Q{q.order}</Badge>
                              </div>
                              <div key="category-badge">
                                <Badge>{q.category}</Badge>
                              </div>
                              <div key="difficulty-badge">
                                {getDifficultyBadge(q.difficulty)}
                              </div>
                              {q.source === "user" && (
                                <div key="user-badge">
                                  <Badge color="blue">From Question Bank</Badge>
                                </div>
                              )}
                              {q.source === "ai" && (
                                <div key="ai-badge">
                                  <Badge color="green">AI Generated</Badge>
                                </div>
                              )}
                            </SpaceBetween>
                          </div>
                          <div key="question-text">
                            <Box
                              variant="h3"
                              fontSize="heading-m"
                              color="text-body-default"
                            >
                              {q.question}
                            </Box>
                          </div>
                          {q.reasoning && (
                            <div key="reasoning">
                              <Box variant="small" color="text-body-secondary">
                                <em>{q.reasoning}</em>
                              </Box>
                            </div>
                          )}
                        </SpaceBetween>
                      </div>
                    </div>

                    {/* Answer Strategy - Right aligned */}
                    {q.expectedAnswer && (
                      <div
                        style={{ display: "flex", justifyContent: "flex-end" }}
                      >
                        <div
                          style={{
                            maxWidth: "75%",
                            backgroundColor: "#e3f2fd",
                            padding: "16px 20px",
                            borderRadius: "12px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                          }}
                        >
                          <SpaceBetween size="xs">
                            <div key="answer-title">
                              <Box variant="strong" color="text-status-info">
                                Answer Strategy
                              </Box>
                            </div>
                            <div key="answer-text">
                              <Box variant="p" color="text-body-default">
                                {q.expectedAnswer}
                              </Box>
                            </div>
                          </SpaceBetween>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </SpaceBetween>
            </Container>
          </div>

          {/* Preparation Tips */}
          {generatedQuestions.preparationTips &&
            generatedQuestions.preparationTips.length > 0 && (
              <div key="preparation-tips">
                <Container
                  header={
                    <Header
                      variant="h2"
                      description="Key preparation advice based on research"
                    >
                      Preparation Tips
                    </Header>
                  }
                >
                  <ul style={{ margin: "0", paddingLeft: "20px" }}>
                    {generatedQuestions.preparationTips.map((tip, i) => (
                      <li key={i} style={{ marginBottom: "8px" }}>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </Container>
              </div>
            )}

          {/* Research Findings */}
          {searchResults && (
            <div key="research-findings">
              <Container
                header={
                  <Header
                    variant="h2"
                    description="AI researched from Glassdoor, Blind, Reddit, and web sources"
                  >
                    Research Findings
                  </Header>
                }
              >
                <SpaceBetween size="m">
                  <div key="company-info">
                    <ExpandableSection
                      headerText="Company Information"
                      defaultExpanded
                    >
                      <SpaceBetween size="s">
                        <div key="company-name">
                          <Box>
                            <Box variant="awsui-key-label">Company</Box>
                            <Box variant="p">
                              {searchResults.companyInfo.name}
                            </Box>
                          </Box>
                        </div>
                        <div key="company-industry">
                          <Box>
                            <Box variant="awsui-key-label">Industry</Box>
                            <Box variant="p">
                              {searchResults.companyInfo.industry}
                            </Box>
                          </Box>
                        </div>
                      </SpaceBetween>
                    </ExpandableSection>
                  </div>

                  {searchResults.industryTrends &&
                    searchResults.industryTrends.length > 0 && (
                      <div key="company-culture">
                        <ExpandableSection headerText="Company Culture & Values">
                          <SpaceBetween size="xs">
                            {searchResults.industryTrends.map((trend, i) => (
                              <Box key={i} variant="p">
                                • {trend}
                              </Box>
                            ))}
                          </SpaceBetween>
                        </ExpandableSection>
                      </div>
                    )}

                  {searchResults.interviewProcess &&
                    searchResults.interviewProcess.length > 0 && (
                      <div key="interview-process">
                        <ExpandableSection headerText="Interview Process Insights">
                          <SpaceBetween size="xs">
                            {searchResults.interviewProcess.map(
                              (insight, i) => (
                                <Box key={i} variant="p">
                                  • {insight}
                                </Box>
                              ),
                            )}
                          </SpaceBetween>
                        </ExpandableSection>
                      </div>
                    )}
                </SpaceBetween>
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

export default PrepareInterviewNew;
