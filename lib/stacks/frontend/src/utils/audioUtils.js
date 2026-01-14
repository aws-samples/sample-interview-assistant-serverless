/**
 * Audio utilities for S2S (Speech-to-Speech) functionality
 * Handles PCM audio recording at 16kHz and playback at 24kHz
 */

/**
 * Audio Recorder for capturing microphone input
 * Captures audio at 16kHz, 16-bit, mono PCM format
 * Uses AudioWorkletNode instead of deprecated ScriptProcessorNode
 */
export class AudioRecorder {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.isRecording = false;
    this.onAudioData = null; // Callback for audio chunks
  }

  /**
   * Initialize and start recording
   * @param {Function} onAudioData - Callback function(base64AudioChunk)
   */
  async start(onAudioData) {
    try {
      this.onAudioData = onAudioData;

      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Create audio context at 16kHz
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 16000,
      });

      // Load AudioWorklet module
      try {
        await this.audioContext.audioWorklet.addModule(
          new URL("./audio-processor.js", import.meta.url),
        );
      } catch (error) {
        console.error("Failed to load AudioWorklet module:", error);
        throw error;
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(
        this.mediaStream,
      );

      // Create AudioWorkletNode for audio data capture
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-capture-processor",
      );

      // Handle messages from the worklet
      this.workletNode.port.onmessage = (event) => {
        if (!this.isRecording) return;

        const inputData = event.data.audioData;

        // Convert float32 audio to int16 PCM
        const pcmData = this.float32ToInt16(inputData);

        // Convert to base64
        const base64Audio = this.arrayBufferToBase64(pcmData.buffer);

        // Send to callback
        if (this.onAudioData) {
          this.onAudioData(base64Audio);
        }
      };

      // Connect nodes
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      this.isRecording = true;
      console.log("Audio recording started at 16kHz (using AudioWorklet)");
    } catch (error) {
      console.error("Failed to start audio recording:", error);
      throw error;
    }
  }

  /**
   * Stop recording and cleanup
   */
  stop() {
    this.isRecording = false;

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.onmessage = null;
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    console.log("Audio recording stopped");
  }

  /**
   * Convert Float32Array to Int16Array (PCM 16-bit)
   */
  float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

/**
 * Audio Player for playing back received audio
 * Plays audio at 16kHz, 16-bit, mono PCM format (matches input sample rate)
 * Uses sequential playback to avoid overlapping audio chunks
 */
export class AudioPlayer {
  constructor() {
    this.audioContext = null;
    this.sourceSampleRate = 16000; // Nova Sonic output is 16kHz (matches input)
    this.audioQueue = [];
    this.isPlaying = false;
    this.nextScheduledTime = 0; // Track when next chunk should play
    this.activeSourceNodes = []; // Track active audio sources for immediate stopping
    this.onPlaybackComplete = null; // Callback when all audio finishes playing
    this.playbackCompleteCalled = false; // Flag to prevent multiple callback invocations
  }

  /**
   * Initialize audio context
   * @param {boolean} resetScheduling - Whether to reset nextScheduledTime (default: false)
   */
  async initialize(resetScheduling = false) {
    if (!this.audioContext) {
      // Create AudioContext at 16kHz to match Nova Sonic output sample rate
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 16000,
      });
      this.nextScheduledTime = this.audioContext.currentTime;
      this.activeSourceNodes = [];
      this.isPlaying = false;
    } else if (resetScheduling) {
      // Only reset scheduling when explicitly requested
      this.nextScheduledTime = this.audioContext.currentTime;
      this.activeSourceNodes = [];
      this.isPlaying = false;
    }
  }

  /**
   * Play audio from base64 PCM data (queues audio for sequential playback)
   * @param {string} base64Audio - Base64 encoded PCM audio
   */
  async play(base64Audio) {
    try {
      await this.initialize();

      // Clean and pad base64 string
      const cleanedBase64 = base64Audio.replace(/[\s\r\n]+/g, "");
      let paddedBase64 = cleanedBase64;
      while (paddedBase64.length % 4 !== 0) {
        paddedBase64 += "=";
      }

      // Decode base64 to ArrayBuffer
      const binaryString = atob(paddedBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert Int16 PCM to Float32 using DataView for explicit little-endian reading
      const int16Array = new Int16Array(len / 2);
      const dataView = new DataView(bytes.buffer);
      for (let i = 0; i < int16Array.length; i++) {
        int16Array[i] = dataView.getInt16(i * 2, true); // true = little-endian
      }

      // Normalize to Float32 [-1, 1]
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      // Create audio buffer at the SOURCE sample rate (16kHz)
      const audioBuffer = this.audioContext.createBuffer(
        1, // mono
        float32Array.length,
        this.sourceSampleRate, // 16kHz
      );
      audioBuffer.getChannelData(0).set(float32Array);

      const duration = audioBuffer.duration;

      // Create source node
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;

      // Adjust playback rate if needed (should be 1.0 for 16kHz → 16kHz)
      const playbackRate = this.sourceSampleRate / this.audioContext.sampleRate;
      sourceNode.playbackRate.value = playbackRate;

      sourceNode.connect(this.audioContext.destination);

      // Calculate start time for this chunk
      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(currentTime, this.nextScheduledTime);

      // Schedule this chunk to play at the right time
      sourceNode.start(startTime);

      // Update next scheduled time
      this.nextScheduledTime = startTime + duration;

      // Track active source nodes for stopping
      this.activeSourceNodes.push(sourceNode);

      // Track when audio finishes
      sourceNode.onended = () => {
        // Remove from active sources
        const index = this.activeSourceNodes.indexOf(sourceNode);
        if (index > -1) {
          this.activeSourceNodes.splice(index, 1);
        }

        // Check if queue is empty and all audio has finished
        // Guard against null audioContext (can happen after cleanup)
        if (!this.audioContext) {
          this.isPlaying = false;
          return;
        }
        const now = this.audioContext.currentTime;
        if (now >= this.nextScheduledTime - 0.01) {
          // Small tolerance
          this.isPlaying = false;

          // Call playback complete callback if set (only once per playback session)
          if (this.onPlaybackComplete && !this.playbackCompleteCalled) {
            console.log(
              "[AudioPlayer] All audio playback completed, calling callback",
            );
            this.playbackCompleteCalled = true; // Prevent duplicate calls
            this.onPlaybackComplete();
          }
        }
      };

      this.isPlaying = true;
    } catch (error) {
      console.error("Failed to play audio:", error);
      throw error;
    }
  }

  /**
   * Stop playback and reset queue (doesn't stop already-playing audio)
   */
  stop() {
    this.isPlaying = false;
    if (this.audioContext) {
      this.nextScheduledTime = this.audioContext.currentTime;
    }
    // Note: Can't stop already-scheduled sources, but they'll finish naturally
  }

  /**
   * Immediately stop all audio playback
   */
  stopImmediately() {
    // Stop all active source nodes
    this.activeSourceNodes.forEach((sourceNode) => {
      try {
        sourceNode.stop();
        sourceNode.disconnect();
      } catch (error) {
        // Ignore errors if already stopped
      }
    });

    // Clear the active sources array
    this.activeSourceNodes = [];

    // Reset playback state
    this.isPlaying = false;
    if (this.audioContext) {
      this.nextScheduledTime = this.audioContext.currentTime;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.stopImmediately(); // Stop all audio immediately before cleanup
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    // Reset all state
    this.nextScheduledTime = 0;
    this.isPlaying = false;
    this.activeSourceNodes = [];
  }
}

/**
 * Check if browser supports required audio features
 */
export function checkAudioSupport() {
  const hasGetUserMedia = !!(
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia
  );
  const hasAudioContext = !!(window.AudioContext || window.webkitAudioContext);

  return {
    supported: hasGetUserMedia && hasAudioContext,
    getUserMedia: hasGetUserMedia,
    audioContext: hasAudioContext,
  };
}
