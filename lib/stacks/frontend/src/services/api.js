import axios from "axios";

const API_BASE_URL = process.env.REACT_APP_API_URL;

// Timeout configurations (in milliseconds)
const TIMEOUTS = {
  DEFAULT: 120000, // 2 minutes for standard requests
  LONG_RUNNING: 360000, // 6 minutes for interview plan generation with web search
  UPLOAD: 180000, // 3 minutes for file uploads
};

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: TIMEOUTS.DEFAULT, // Default timeout for all requests
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = localStorage.getItem("authToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Enhanced error handling with timeout detection
    if (error.code === "ECONNABORTED" && error.message.includes("timeout")) {
      console.error("API Request Timeout:", error.config?.url);
      error.isTimeout = true;
      error.userMessage =
        "Request timed out. The operation is taking longer than expected. Please try again.";
    } else if (error.response) {
      // Server responded with error status
      console.error("API Error:", error.response.status, error.response.data);
    } else if (error.request) {
      // Request made but no response received
      console.error("API No Response:", error.message);
      error.userMessage =
        "Unable to connect to server. Please check your connection.";
    } else {
      // Something else happened
      console.error("API Error:", error.message);
    }
    return Promise.reject(error);
  },
);

// Session APIs
export const sessionAPI = {
  // Create new practice session
  create: async (data) => {
    const formData = new FormData();
    if (data.cvFile) formData.append("cvFile", data.cvFile);
    if (data.jdFile) formData.append("jdFile", data.jdFile);
    if (data.cvText) formData.append("cvText", data.cvText);
    if (data.jdText) formData.append("jdText", data.jdText);
    if (data.settings)
      formData.append("settings", JSON.stringify(data.settings));

    return apiClient.post("/api/candidate/practice-sessions", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  // Save practice session (with transcription and optional audio)
  save: async (data) => {
    return apiClient.post("/api/candidate/practice-sessions", data);
  },

  // Get session by ID
  get: async (sessionId) => {
    return apiClient.get(`/api/candidate/practice-sessions/${sessionId}`);
  },

  // List all sessions
  list: async (params = {}) => {
    return apiClient.get("/api/candidate/practice-sessions", { params });
  },

  // Update session
  update: async (sessionId, data) => {
    return apiClient.put(`/api/candidate/practice-sessions/${sessionId}`, data);
  },

  // Delete session
  delete: async (sessionId) => {
    return apiClient.delete(`/api/candidate/practice-sessions/${sessionId}`);
  },

  // Generate questions for session
  generateQuestions: async (sessionId) => {
    return apiClient.post(`/api/candidate/sessions/${sessionId}/questions`);
  },

  // Submit answer
  submitAnswer: async (sessionId, questionId, data) => {
    return apiClient.post(
      `/api/candidate/sessions/${sessionId}/questions/${questionId}/answer`,
      data,
    );
  },

  // Get feedback
  getFeedback: async (sessionId) => {
    return apiClient.get(`/api/candidate/sessions/${sessionId}/feedback`);
  },
};

// Analytics APIs
export const analyticsAPI = {
  // Get overall analytics
  getOverview: async (params = {}) => {
    return apiClient.get("/api/analytics/overview", { params });
  },

  // Get score trends
  getTrends: async (params = {}) => {
    return apiClient.get("/api/analytics/trends", { params });
  },

  // Get detailed session analytics
  getSessionAnalytics: async (sessionId) => {
    return apiClient.get(`/api/analytics/sessions/${sessionId}`);
  },
};

// Interview Plan APIs
export const interviewPlanAPI = {
  // Scrape resume from URL
  scrapeResume: async (url) => {
    return apiClient.post("/api/candidate/scrape-resume", { url });
  },

  // Scrape job description from URL
  scrapeJobDescription: async (url) => {
    return apiClient.post("/api/candidate/scrape-jd", { url });
  },

  // Generate interview plan (async - returns jobId immediately)
  generate: async (data) => {
    // If data is already FormData, use it directly; otherwise build FormData from object
    let formData = data;
    if (!(data instanceof FormData)) {
      formData = new FormData();
      if (data.resumeFile) formData.append("resumeFile", data.resumeFile);
      if (data.jdText) formData.append("jdText", data.jdText);
      if (data.jdFile) formData.append("jdFile", data.jdFile);
      if (data.companyName) formData.append("companyName", data.companyName);
      if (data.jobTitle) formData.append("jobTitle", data.jobTitle);
      if (data.interviewType)
        formData.append("interviewType", data.interviewType);
      if (data.questionCount)
        formData.append("questionCount", data.questionCount);
      if (data.difficulty) formData.append("difficulty", data.difficulty);
      if (data.customQuestions)
        formData.append(
          "customQuestions",
          JSON.stringify(data.customQuestions),
        );
    }

    return apiClient.post("/api/candidate/generate-interview-plan", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: TIMEOUTS.DEFAULT, // Returns immediately with jobId
    });
  },

  // Save interview plan
  save: async (data) => {
    return apiClient.post("/api/candidate/save-interview-plan", data);
  },

  // Get all interview plans
  list: async (params = {}) => {
    return apiClient.get("/api/candidate/interview-plans", { params });
  },

  // Get interview plan by ID
  get: async (planId) => {
    return apiClient.get(`/api/candidate/interview-plans/${planId}`);
  },

  // Delete interview plan
  delete: async (planId) => {
    return apiClient.delete(`/api/candidate/interview-plans/${planId}`);
  },
};

// Interview Plan Polling APIs (fully replaced jobAPI)
export const planAPI = {
  // Get candidate plan status by ID
  getCandidatePlanStatus: async (planId) => {
    return apiClient.get(`/api/candidate/plans/${planId}`);
  },

  // Get interviewer plan status by ID
  getInterviewerPlanStatus: async (planId) => {
    return apiClient.get(`/api/interviewer/plans/${planId}`);
  },

  // Poll for candidate plan completion with optional timeout
  pollCandidatePlanUntilComplete: async (planId, options = {}) => {
    const {
      pollInterval = 10000, // Poll every 10 seconds (default)
      maxAttempts = 60, // Max 10 minutes (60 * 10s = 600s) (default)
      onProgress = null, // Callback for progress updates
    } = options;

    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await planAPI.getCandidatePlanStatus(planId);
        const plan = response.data;

        // Call progress callback if provided
        if (onProgress) {
          onProgress(plan);
        }

        // Check if plan is generated (ready for review) or completed (saved)
        if (plan.status === "generated" || plan.status === "completed") {
          return plan;
        }

        // Check if plan failed
        if (plan.status === "failed") {
          throw new Error(plan.errorMessage || "Plan generation failed");
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        attempts++;
      } catch (error) {
        // If it's a network error, keep trying
        if (error.response?.status >= 500 || error.code === "ECONNABORTED") {
          console.warn("Polling error, retrying...", error.message);
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          attempts++;
          continue;
        }
        // For other errors (404, 403, etc.), throw immediately
        throw error;
      }
    }

    throw new Error(
      "Plan polling timeout - plan generation is taking longer than expected",
    );
  },

  // Poll for interviewer plan completion with optional timeout
  pollInterviewerPlanUntilComplete: async (planId, options = {}) => {
    const {
      pollInterval = 10000, // Poll every 10 seconds (default)
      maxAttempts = 60, // Max 10 minutes (60 * 10s = 600s) (default)
      onProgress = null, // Callback for progress updates
    } = options;

    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await planAPI.getInterviewerPlanStatus(planId);
        const plan = response.data;

        // Call progress callback if provided
        if (onProgress) {
          onProgress(plan);
        }

        // Check if plan is generated (ready for review) or completed (saved)
        if (plan.status === "generated" || plan.status === "completed") {
          return plan;
        }

        // Check if plan failed
        if (plan.status === "failed") {
          throw new Error(plan.errorMessage || "Plan generation failed");
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        attempts++;
      } catch (error) {
        // If it's a network error, keep trying
        if (error.response?.status >= 500 || error.code === "ECONNABORTED") {
          console.warn("Polling error, retrying...", error.message);
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          attempts++;
          continue;
        }
        // For other errors (404, 403, etc.), throw immediately
        throw error;
      }
    }

    throw new Error(
      "Plan polling timeout - plan generation is taking longer than expected",
    );
  },

  // Mark candidate plan as saved/completed
  markCandidatePlanSaved: async (planId) => {
    return apiClient.post(`/api/candidate/mark-plan-saved/${planId}`);
  },

  // Mark interviewer schedule as saved/completed
  markInterviewerScheduleSaved: async (planId) => {
    return apiClient.post(`/api/interviewer/mark-schedule-saved/${planId}`);
  },
};

// Question Bank APIs
export const questionBankAPI = {
  // List questions
  list: async (params = {}) => {
    return apiClient.get("/api/candidate/api/questions", { params });
  },

  // Create question
  create: async (data) => {
    return apiClient.post("/api/candidate/api/questions", data);
  },

  // Update question
  update: async (questionId, data) => {
    return apiClient.put(`/api/candidate/api/questions/${questionId}`, data);
  },

  // Delete question
  delete: async (questionId) => {
    return apiClient.delete(`/api/candidate/api/questions/${questionId}`);
  },

  // Import questions from CSV
  importCSV: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/api/candidate/api/questions/import", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

// Audio APIs
export const audioAPI = {
  // Get session audio URL via presigned URL
  getSessionAudioUrl: async (sessionId) => {
    try {
      const response = await apiClient.post("/api/candidate/audio/get-url", {
        sessionId: sessionId,
      });
      return response.data.url;
    } catch (error) {
      console.error("Failed to fetch audio URL:", error);
      throw error;
    }
  },
};

// User/Settings APIs
export const userAPI = {
  // Get user profile
  getProfile: async () => {
    return apiClient.get("/user/profile");
  },

  // Update profile
  updateProfile: async (data) => {
    return apiClient.put("/user/profile", data);
  },

  // Get settings
  getSettings: async () => {
    return apiClient.get("/user/settings");
  },

  // Update settings
  updateSettings: async (data) => {
    return apiClient.put("/user/settings", data);
  },
};

// Interviewer APIs (Scheduled Interviews)
export const interviewerAPI = {
  // Schedule a new interview
  schedule: async (data) => {
    const formData = new FormData();
    if (data.interviewName)
      formData.append("interviewName", data.interviewName);
    if (data.scheduledDate)
      formData.append("scheduledDate", data.scheduledDate);
    if (data.scheduledTime)
      formData.append("scheduledTime", data.scheduledTime);
    if (data.interviewType)
      formData.append("interviewType", data.interviewType);
    if (data.resumeFile) formData.append("resumeFile", data.resumeFile);
    if (data.jdText) formData.append("jdText", data.jdText);
    if (data.jdFile) formData.append("jdFile", data.jdFile);
    if (data.questionBankText !== undefined)
      formData.append("questionBankText", data.questionBankText);
    if (data.useAiGeneration !== undefined)
      formData.append("useAiGeneration", String(data.useAiGeneration));

    return apiClient.post("/api/interviewer/schedule-interview", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: TIMEOUTS.LONG_RUNNING, // Extended timeout for file processing + AI
    });
  },

  // Get all scheduled interviews
  listScheduledInterviews: async (params = {}) => {
    return apiClient.get("/api/interviewer/scheduled-interviews", { params });
  },

  // Get scheduled interview by ID
  getScheduledInterview: async (interviewId) => {
    return apiClient.get(
      `/api/interviewer/scheduled-interviews/${interviewId}`,
    );
  },

  // Delete scheduled interview
  deleteScheduledInterview: async (interviewId) => {
    return apiClient.delete(
      `/api/interviewer/scheduled-interviews/${interviewId}`,
    );
  },

  // Interview Sessions
  // Save interview session
  saveInterviewSession: async (data) => {
    const formData = new FormData();
    if (data.sessionId) formData.append("sessionId", data.sessionId);
    if (data.interviewId) formData.append("interviewId", data.interviewId);
    if (data.interviewName)
      formData.append("interviewName", data.interviewName);
    if (data.transcript) formData.append("transcript", data.transcript);
    if (data.transcriptArray)
      formData.append("transcriptArray", data.transcriptArray);
    if (data.duration) formData.append("duration", data.duration);

    // Add video frames if provided (similar to audio handling in practice sessions)
    if (data.videoFrames) {
      formData.append("videoFrames", data.videoFrames);
    }

    // Add video recording flag
    if (data.videoRecordingRequested !== undefined) {
      formData.append("videoRecordingRequested", data.videoRecordingRequested);
    }

    // Add video location (PATH B: S3 location from MediaRecorder)
    if (data.videoLocation) {
      formData.append("videoLocation", data.videoLocation);
    }

    // Add question progression tracking data
    if (data.questionStatuses) {
      formData.append("questionStatuses", data.questionStatuses);
    }

    // Add current question index
    if (data.currentQuestionIndex !== undefined) {
      formData.append("currentQuestionIndex", data.currentQuestionIndex);
    }

    return apiClient.post("/api/interviewer/interview-sessions", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  // Get all interview sessions
  listInterviewSessions: async (params = {}) => {
    return apiClient.get("/api/interviewer/interview-sessions", { params });
  },

  // Get interview session by ID
  getInterviewSession: async (sessionId) => {
    return apiClient.get(`/api/interviewer/interview-sessions/${sessionId}`);
  },

  // Delete interview session
  deleteInterviewSession: async (sessionId) => {
    return apiClient.delete(`/api/interviewer/interview-sessions/${sessionId}`);
  },

  // Get job status for async interview scheduling
  getJobStatus: async (jobId) => {
    return apiClient.get(`/api/interviewer/jobs/${jobId}`);
  },
};

// Candidate Interview Session API
export const candidateAPI = {
  // Save candidate interview session
  saveInterviewSession: async (sessionData) => {
    const formData = new FormData();
    formData.append("sessionId", sessionData.sessionId);
    formData.append("interviewId", sessionData.interviewId || "");
    formData.append("interviewName", sessionData.interviewName);
    formData.append("transcript", sessionData.transcript);
    formData.append("transcriptArray", sessionData.transcriptArray);
    formData.append("duration", sessionData.duration);

    // Add video frames if provided (similar to audio handling in practice sessions)
    if (sessionData.videoFrames) {
      formData.append("videoFrames", sessionData.videoFrames);
    }

    // Add video recording flag
    if (sessionData.videoRecordingRequested !== undefined) {
      formData.append(
        "videoRecordingRequested",
        sessionData.videoRecordingRequested,
      );
    }

    // Add video location (PATH B: S3 location from MediaRecorder)
    if (sessionData.videoLocation) {
      formData.append("videoLocation", sessionData.videoLocation);
    }

    return apiClient.post(
      "/api/candidate/candidate-interview-sessions",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
  },

  // Get all candidate interview sessions
  listInterviewSessions: async (params = {}) => {
    return apiClient.get("/api/candidate/candidate-interview-sessions", {
      params,
    });
  },

  // Get candidate interview session by ID
  getInterviewSession: async (sessionId) => {
    return apiClient.get(
      `/api/candidate/candidate-interview-sessions/${sessionId}`,
    );
  },

  // Delete candidate interview session
  deleteInterviewSession: async (sessionId) => {
    return apiClient.delete(
      `/api/candidate/candidate-interview-sessions/${sessionId}`,
    );
  },
};

export default apiClient;
