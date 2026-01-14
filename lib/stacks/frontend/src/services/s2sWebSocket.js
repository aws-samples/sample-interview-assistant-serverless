/**
 * S2S (Speech-to-Speech) WebSocket Service
 * Handles WebSocket connection to backend for Nova Sonic S2S communication
 */

class S2SWebSocketService {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.listeners = new Map();
    this.sessionId = null;
    this.promptName = "interview_practice";
    this.contentName = "audio_content";
    this.audioContentCounter = 0;
  }

  /**
   * Connect to S2S WebSocket endpoint via pre-signed URL
   * @param {string} sessionId - Practice session ID
   * @param {string} token - Auth token (used for REST API authentication)
   * @param {string} userId - User ID (required - must be the authenticated user)
   * @param {string} practiceSessionId - Optional practice session ID for loading questions
   * @param {string} mode - Interview mode ('light' or 'smart')
   * @param {string} sessionType - Session type ('practiceSession', 'candidateAssistant', 'interviewerAssistant')
   */
  connect(
    sessionId,
    token = "",
    userId,
    practiceSessionId = null,
    mode = "light",
    sessionType = "practiceSession",
  ) {
    return new Promise(async (resolve, reject) => {
      try {
        this.sessionId = sessionId;

        // Step 1: Call backend REST API to get pre-signed WebSocket URL
        // This endpoint uses SigV4 authentication and returns a URL with auth in query params
        const API_BASE_URL =
          process.env.REACT_APP_API_URL || "http://localhost:8000";
        const voiceId = localStorage.getItem("interviewerVoice") || "matthew";

        console.log(
          "[S2S] Requesting pre-signed WebSocket URL from backend...",
        );

        const response = await fetch(`${API_BASE_URL}/api/get-ws-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`, // JWT token for REST API authentication
          },
          body: JSON.stringify({
            session_id: sessionId,
            user_id: userId,
            practice_session_id: practiceSessionId,
            mode: mode,
            voice_id: voiceId,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(
            `Failed to get WebSocket URL: ${response.statusText} - ${error}`,
          );
        }

        const {
          wsUrl,
          expiresIn,
          userId: returnedUserId,
          mode: returnedMode,
          voiceId: returnedVoiceId,
          practiceSessionId: returnedPracticeSessionId,
        } = await response.json();
        console.log(
          `[S2S] Received pre-signed WebSocket URL (expires in ${expiresIn}s)`,
        );

        // Store application parameters to send after connection
        const appParams = {
          userId: returnedUserId,
          mode: returnedMode,
          voiceId: returnedVoiceId,
          practiceSessionId: returnedPracticeSessionId,
        };

        // Step 2: Connect directly to pre-signed URL (no custom headers needed!)
        // The URL contains ONLY SigV4 authentication (no application parameters)
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log("[S2S] WebSocket connected via pre-signed URL");
          this.isConnected = true;

          // Step 3: Send initialization message with application parameters
          // These parameters are sent AFTER connection, not in the URL
          console.log(
            "[S2S] Sending initialization message with application parameters...",
          );
          const initMessage = {
            type: "init",
            sessionType: sessionType,
            ...appParams,
          };
          this.ws.send(JSON.stringify(initMessage));
          console.log("[S2S] Initialization message sent:", initMessage);

          this.emit("connect");
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log(
            "[S2S] WebSocket disconnected:",
            event.code,
            event.reason,
          );
          this.isConnected = false;
          this.emit("disconnect", { code: event.code, reason: event.reason });
        };

        this.ws.onerror = (error) => {
          console.error("[S2S] WebSocket error:", error);
          this.emit("error", error);
          reject(error);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error("[S2S] Failed to parse WebSocket message:", error);
          }
        };
      } catch (error) {
        console.error("[S2S] Failed to connect to S2S WebSocket:", error);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(message) {
    if (!message.event) return;

    const eventType = Object.keys(message.event)[0];
    const eventData = message.event[eventType];

    // Only log important events (skip noisy ones)
    const noisyEvents = [
      "audioOutput",
      "textOutput",
      "contentStart",
      "contentEnd",
      "usageEvent",
    ];
    if (!noisyEvents.includes(eventType)) {
      console.log("[S2S] Received event:", eventType);
    }

    // Emit specific event
    this.emit(eventType, eventData);

    // Handle specific events
    switch (eventType) {
      case "audioOutput":
        // Audio output from Nova Sonic - ready to play
        this.emit("audio:output", eventData.content);
        break;

      case "textOutput":
        // Text transcription from Nova Sonic
        this.emit("text:output", {
          role: eventData.role,
          content: eventData.content,
          contentId: eventData.contentId,
        });
        break;

      case "contentStart":
        // Emit for UI state management
        this.emit("contentStart", eventData);
        break;

      case "contentEnd":
        this.emit("contentEnd", eventData);
        this.emit("response:complete");
        break;

      case "toolUse":
        console.log("[S2S] Tool use:", eventData.toolName);
        this.emit("tool:use", eventData);

        // Special handling for interviewAgentTool to show thinking state
        if (eventData.toolName === "interviewAgentTool") {
          console.log(
            "[S2S] Interview agent tool invoked - interviewer is thinking",
          );
          this.emit("interviewer:thinking", { toolName: eventData.toolName });
        }
        break;

      case "toolResult":
        this.emit("tool:result", eventData);
        break;

      case "candidateTip":
        // Candidate coaching tip from the interview agent
        console.log(
          "[S2S] Candidate tip received:",
          eventData.tip?.substring(0, 50) + "...",
        );
        this.emit("candidate:tip", {
          tip: eventData.tip,
          timestamp: eventData.timestamp,
          questionNumber: eventData.questionNumber,
        });
        break;

      default:
        // Generic event handling
        break;
    }
  }

  /**
   * Initialize S2S session with backend
   */
  async initializeSession() {
    if (!this.isConnected) {
      throw new Error("WebSocket not connected");
    }

    // Send sessionStart event
    const sessionStartEvent = {
      event: {
        sessionStart: {
          promptName: this.promptName,
        },
      },
    };

    this.send(sessionStartEvent);
  }

  /**
   * Start a new prompt/conversation
   * @param {Object} audioOutputConfig - Audio output configuration
   */
  async startPrompt(audioOutputConfig = null) {
    if (!this.isConnected) {
      throw new Error("WebSocket not connected");
    }

    const defaultAudioConfig = {
      mediaType: "audio/lpcm",
      sampleRateHertz: 24000,
      sampleSizeBits: 16,
      channelCount: 1,
      voiceId: "tiffany",
      encoding: "base64",
      audioType: "SPEECH",
    };

    const promptStartEvent = {
      event: {
        promptStart: {
          promptName: this.promptName,
          audioOutputConfig: audioOutputConfig || defaultAudioConfig,
        },
      },
    };

    this.send(promptStartEvent);
  }

  /**
   * Start audio content stream
   */
  startAudioContent() {
    if (!this.isConnected) {
      throw new Error("WebSocket not connected");
    }

    this.audioContentCounter++;
    this.contentName = `audio_content_${this.audioContentCounter}`;

    const contentStartEvent = {
      event: {
        contentStart: {
          promptName: this.promptName,
          contentName: this.contentName,
          type: "AUDIO",
          interactive: true,
          role: "USER",
          audioInputConfiguration: {
            mediaType: "audio/lpcm",
            sampleRateHertz: 16000,
            sampleSizeBits: 16,
            channelCount: 1,
            audioType: "SPEECH",
            encoding: "base64",
          },
        },
      },
    };

    this.send(contentStartEvent);
  }

  /**
   * Send audio chunk to backend
   * @param {string} base64Audio - Base64 encoded PCM audio
   */
  sendAudioChunk(base64Audio) {
    if (!this.isConnected) {
      console.warn("Cannot send audio: WebSocket not connected");
      return;
    }

    const audioInputEvent = {
      event: {
        audioInput: {
          promptName: this.promptName,
          contentName: this.contentName,
          content: base64Audio,
        },
      },
    };

    this.send(audioInputEvent);
  }

  /**
   * Complete audio content stream
   */
  completeAudioContent() {
    if (!this.isConnected) {
      throw new Error("WebSocket not connected");
    }

    const contentEndEvent = {
      event: {
        contentEnd: {
          promptName: this.promptName,
          contentName: this.contentName,
        },
      },
    };

    this.send(contentEndEvent);
  }

  /**
   * Send raw message to WebSocket
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("Cannot send message: WebSocket not ready");
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    if (this.ws) {
      console.log("Disconnecting S2S WebSocket...");
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.sessionId = null;
    }
    // Clear all listeners on disconnect
    this.listeners.clear();
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners() {
    this.listeners.clear();
  }

  /**
   * Subscribe to events
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Unsubscribe from events
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to listeners
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Check if connected
   */
  isSocketConnected() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const s2sWebSocketService = new S2SWebSocketService();
export default s2sWebSocketService;
