import { Page, expect } from "@playwright/test";
import * as fs from "fs";

/**
 * Interview Helper for Interview Assistant E2E Tests
 * Handles UI interactions for interview practice flow
 * Uses audio-based cycle tracking (instead of message visibility)
 */
export class InterviewHelper {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Upload a file (job description or CV)
   */
  async uploadFile(filePath: string): Promise<void> {
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at path: ${filePath}`);
    }

    // Try to find and use the file input directly
    const fileInput = this.page.locator('input[type="file"]').first();
    const fileInputCount = await fileInput.count();

    if (fileInputCount > 0) {
      // Set files directly on the input
      await fileInput.setInputFiles(filePath);
      console.log("File uploaded via direct input method");
    } else {
      // Look for attachment button
      console.log("No file input found, trying attachment button...");
      const attachmentButton = this.page
        .locator(
          'button[aria-label*="attach" i], button:has-text("📎"), [data-testid="attach-file"], button:has(svg[data-icon*="attach" i])',
        )
        .first();

      if (
        await attachmentButton.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        await attachmentButton.click();
        await this.page.waitForTimeout(500);

        const fileInputAfterClick = this.page
          .locator('input[type="file"]')
          .first();
        await fileInputAfterClick.setInputFiles(filePath);
        console.log("File uploaded after clicking attachment button");
      } else {
        throw new Error("Could not find file input or attachment button");
      }
    }

    await this.page.waitForTimeout(2000);
  }

  /**
   * Upload CV file (legacy method)
   */
  async uploadCV(cvPath: string): Promise<void> {
    return this.uploadFile(cvPath);
  }

  /**
   * Enter job description
   */
  async enterJobDescription(jobDescription: string): Promise<void> {
    const textarea = this.page
      .locator(
        'textarea[placeholder*="job description" i], textarea[name*="job" i]',
      )
      .first();
    await textarea.fill(jobDescription);
    await expect(textarea).toHaveValue(jobDescription);
  }

  /**
   * Save interview preparation
   */
  async savePreparation(): Promise<void> {
    await this.page
      .getByRole("button", { name: /save preparation/i })
      .click({ timeout: 300000 });
    await this.page.waitForTimeout(2000);
  }

  /**
   * Start practice session (from Live Practice page)
   */
  async startPracticeSession(): Promise<void> {
    await this.page
      .getByRole("button", { name: /start practice session/i })
      .click();
    await expect(this.page.getByText(/available preparations/i)).toBeVisible({
      timeout: 10000,
    });
  }

  /**
   * Select first preparation and continue
   */
  async selectFirstPreparationAndContinue(): Promise<void> {
    await this.page.waitForSelector("table tbody tr", { timeout: 10000 });

    const firstRow = this.page.locator("table tbody tr").first();
    await firstRow.waitFor({ state: "visible", timeout: 5000 });

    const radioButton = firstRow.locator('input[type="radio"]').first();
    if ((await radioButton.count()) > 0) {
      await radioButton.click();
      console.log("Selected first preparation via radio button");
    } else {
      await firstRow.click();
      console.log("Selected first preparation via row click");
    }

    await this.page.waitForTimeout(500);

    const continueButton = this.page.getByRole("button", { name: /continue/i });
    await expect(continueButton).toBeVisible({ timeout: 5000 });
    await continueButton.click();

    await expect(
      this.page.getByText(/configure interview settings/i),
    ).toBeVisible({ timeout: 10000 });
  }

  /**
   * Configure interview settings
   */
  async configureInterviewSettings(
    interviewMode: string = "light",
    selectMode: boolean = true,
    saveAudioRecording: boolean = true,
  ): Promise<void> {
    await expect(
      this.page.getByText(/configure interview settings/i),
    ).toBeVisible({ timeout: 10000 });

    const modeToSelect =
      interviewMode === "smart" ? "Smart Mode" : "Light Mode";

    if (selectMode) {
      const modeLabel = this.page.getByText(modeToSelect);
      const modeContainer = modeLabel.locator("..").locator("..");
      const radioButton = modeContainer.locator('input[type="radio"]').first();

      if (await radioButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        const isChecked = await radioButton.isChecked();
        if (!isChecked) {
          await radioButton.click();
          console.log(`✅ Selected ${modeToSelect}`);
          await this.page.waitForTimeout(500);
        } else {
          console.log(`✅ ${modeToSelect} already selected`);
        }
      }
    }

    if (saveAudioRecording) {
      const audioLabel = this.page.getByText(
        "Save audio recording for playback",
      );
      const audioContainer = audioLabel.locator("..").locator("..");
      const checkbox = audioContainer.locator('input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        const isChecked = await checkbox.isChecked();
        if (!isChecked) {
          await checkbox.click();
          console.log("✅ Enabled Save audio recording for playback");
          await this.page.waitForTimeout(500);
        }
      }
    }

    const startButton = this.page.getByRole("button", {
      name: /start live practice/i,
    });
    await expect(startButton).toBeVisible({ timeout: 5000 });
    await startButton.click();
    console.log("✅ Clicked Start Live Practice");

    // Wait for the practice session page to load by checking for unique content
    // Check for the "Connecting to interview session..." text
    await expect(
      this.page.getByText(/connecting to interview session/i).first(),
    ).toBeVisible({
      timeout: 15000,
    });
    console.log("✅ Live Practice Session page loaded");

    const statusBadge = this.page.locator('span[class*="badge"]');
    await expect(statusBadge.first()).toBeVisible({ timeout: 10000 });
    console.log("✅ Session interface ready");
  }

  /**
   * Start the live practice session
   */
  async startLivePracticeSession(): Promise<void> {
    await this.page.waitForTimeout(2000);

    let startButton;

    // Strategy 1: Exact match
    startButton = this.page.getByRole("button", { name: /^start$/i });
    if (!(await startButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Strategy 2: Contains match
      startButton = this.page.locator('button:has-text("Start")').first();
    }

    if (!(await startButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Strategy 3: Iterate through buttons
      const buttons = this.page.locator("button");
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const text = await btn.textContent();
        if (text && text.trim().toLowerCase() === "start") {
          startButton = btn;
          break;
        }
      }
    }

    await expect(startButton).toBeVisible({ timeout: 10000 });
    await expect(startButton).toBeEnabled({ timeout: 5000 });

    await startButton.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);
    await startButton.click();

    console.log("✅ Clicked Start button to begin live practice session");
    await this.page.waitForTimeout(3000);
  }

  /**
   * Setup multiple audio files for microphone input
   * Must be called BEFORE navigating to the page
   */
  async setupMultipleAudioFiles(audioPaths: string[]): Promise<void> {
    console.log(
      `Setting up ${audioPaths.length} audio files for microphone input...`,
    );

    // Read and encode audio files
    const audioBuffers = audioPaths.map((path) => {
      const buffer = fs.readFileSync(path);
      return buffer.toString("base64");
    });

    await this.page.addInitScript((base64Audios: string[]) => {
      // --- AUDIO DETECTION VIA ANALYSER NODE ---
      // This approach analyzes the actual audio signal instead of tracking events

      // Global function to check if audio is currently playing by analyzing frequency data
      (window as any).isAudioPlaying = () => {
        const analyser = (window as any).__audioAnalyser;
        if (!analyser) {
          return false;
        }

        // Get frequency data from the analyser
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        // Check if there's any significant audio signal
        // If sum of frequencies > threshold, audio is playing
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }

        // Threshold: if average frequency > 1, consider it as audio playing
        const average = sum / dataArray.length;
        return average > 1;
      };
      // --- END AUDIO DETECTION ---

      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      let callCount = 0;

      const decodedAudioBuffers: AudioBuffer[] = [];
      let audioContext: AudioContext | null = null;

      navigator.mediaDevices.getUserMedia = async function (constraints: any) {
        if (constraints.audio) {
          try {
            callCount++;
            (window as any).__lastGetUserMediaCallNumber = callCount;
            console.log(`🎤 getUserMedia call #${callCount}`);

            if (!audioContext) {
              audioContext = new (window.AudioContext ||
                (window as any).webkitAudioContext)();
              (window as any).__audioContext = audioContext;
              console.log("🎤 Audio context created");

              // Create analyser node for audio detection
              const analyser = audioContext.createAnalyser();
              analyser.fftSize = 2048;
              analyser.connect(audioContext.destination);
              (window as any).__audioAnalyser = analyser;
              console.log("🎧 Audio analyser created and connected");
            }

            // Decode audio buffers on first call
            if (decodedAudioBuffers.length === 0) {
              console.log(`🎤 Decoding ${base64Audios.length} audio files...`);
              for (let i = 0; i < base64Audios.length; i++) {
                const binaryString = atob(base64Audios[i]);
                const bytes = new Uint8Array(binaryString.length);
                for (let j = 0; j < binaryString.length; j++) {
                  bytes[j] = binaryString.charCodeAt(j);
                }
                const decodedBuffer = await audioContext.decodeAudioData(
                  bytes.buffer,
                );
                decodedAudioBuffers.push(decodedBuffer);
              }
              (window as any).__audioBuffers = decodedAudioBuffers;
              console.log(
                `🎤 ${decodedAudioBuffers.length} audio buffers created and stored`,
              );
            }

            // Create NEW destination for each getUserMedia call
            const destination = audioContext.createMediaStreamDestination();
            (window as any).__audioDestination = destination;
            (window as any).__audioDestinationCallNumber = callCount;
            console.log(`🎤 Created new destination for call #${callCount}`);

            return destination.stream;
          } catch (error) {
            console.error("Failed to create custom audio stream:", error);
            return originalGetUserMedia(constraints);
          }
        }
        return originalGetUserMedia(constraints);
      };

      // Implement triggerTestAudio for multiple audio buffers
      (window as any).triggerTestAudio = (cycleIndex: number = 0) => {
        console.log(
          `\n🎵 triggerTestAudio called with cycleIndex=${cycleIndex}`,
        );
        const context = (window as any).__audioContext;
        const audioBuffers = (window as any).__audioBuffers;
        const destination = (window as any).__audioDestination;
        const destCallNumber = (window as any).__audioDestinationCallNumber;
        const lastCallNumber = (window as any).__lastGetUserMediaCallNumber;

        console.log(`📋 State check:`);
        console.log(`   - context: ${!!context}`);
        console.log(
          `   - audioBuffers: ${!!audioBuffers}, length: ${audioBuffers?.length || 0}`,
        );
        console.log(`   - destination: ${!!destination}`);
        console.log(`   - destCallNumber: ${destCallNumber}`);
        console.log(`   - lastCallNumber: ${lastCallNumber}`);

        if (
          !context ||
          !audioBuffers ||
          !destination ||
          audioBuffers.length === 0
        ) {
          console.error(
            "❌ Missing context, buffers, or destination for audio playback",
          );
          return false;
        }

        // Ensure cycleIndex is valid
        if (cycleIndex < 0 || cycleIndex >= audioBuffers.length) {
          console.error(
            `❌ Invalid cycle index ${cycleIndex}, available buffers: ${audioBuffers.length}`,
          );
          return false;
        }

        // If destination is stale, return false (this forces waiting for next getUserMedia call)
        if (destCallNumber !== lastCallNumber) {
          console.error(
            `❌ Destination stale (call #${destCallNumber} vs latest #${lastCallNumber})`,
          );
          return false;
        }

        try {
          // Check if audio context is still running
          if (context.state !== "running") {
            console.error(`❌ AudioContext not running: ${context.state}`);
            return false;
          }

          // Check if destination stream is actually active
          const stream = destination.stream;
          const audioTracks = stream.getAudioTracks();
          console.log(
            `📋 Audio track info: tracks=${audioTracks.length}, readyState=${audioTracks[0]?.readyState}`,
          );

          if (
            audioTracks.length === 0 ||
            audioTracks[0].readyState !== "live"
          ) {
            console.error(
              `❌ Audio track not live: tracks=${audioTracks.length}, readyState=${audioTracks[0]?.readyState}`,
            );
            return false;
          }

          const buffer = audioBuffers[cycleIndex];
          console.log(
            `🎵 Buffer info: index=${cycleIndex}, duration=${buffer?.duration}s, sampleRate=${buffer?.sampleRate}Hz`,
          );

          // Create new source (old one cannot be restarted)
          const source = context.createBufferSource();
          source.buffer = buffer;

          // Get the analyser node
          const analyser = (window as any).__audioAnalyser;

          // Connect to both the destination stream AND the analyser for monitoring
          source.connect(destination);
          if (analyser) {
            source.connect(analyser);
          }

          // Start playing from the beginning
          source.start(0);

          // Track audio activity: record when this audio playback started and calculate when it will end
          const bufferDuration = buffer.duration;
          const startTime = context.currentTime;
          const endTime = startTime + bufferDuration;

          (window as any).__lastAudioStartTime = startTime;
          (window as any).__lastAudioEndTime = endTime;

          console.log(
            `🎵 Audio started playing at context time ${startTime}s (duration: ${bufferDuration}s, will end at: ${endTime}s)`,
          );
          console.log(
            `✅ Audio response #${cycleIndex + 1} triggered (using buffer ${cycleIndex})`,
          );
          return true;
        } catch (error) {
          console.error("❌ Audio trigger failed:", error);
          return false;
        }
      };
    }, audioBuffers);

    // Register AudioWorklet processor inline for Playwright tests
    // The external audio-processor.js fails to load in Playwright due to CORS/CSP
    // We inline the processor code to ensure audio capture actually works
    await this.page.addInitScript(() => {
      const OriginalAudioContext =
        window.AudioContext || (window as any).webkitAudioContext;

      // Create wrapper that loads processor inline instead of external file
      const MockedAudioContext = function (this: any, ...args: any[]) {
        const ctx = new OriginalAudioContext(...args);

        const origAddModule = ctx.audioWorklet.addModule.bind(ctx.audioWorklet);
        ctx.audioWorklet.addModule = async function (url: any) {
          console.log(
            `🎭 [Test] Loading AudioWorklet processor inline for: ${url}`,
          );

          // Inline the actual AudioWorkletProcessor code
          const processorCode = `
            class AudioCaptureProcessor extends AudioWorkletProcessor {
              constructor() {
                super();
                this.bufferSize = 4096;
                this.buffer = new Float32Array(this.bufferSize);
                this.bufferIndex = 0;
              }

              process(inputs, outputs, parameters) {
                const input = inputs[0];
                if (input && input.length > 0) {
                  const inputChannel = input[0];
                  if (inputChannel && inputChannel.length > 0) {
                    for (let i = 0; i < inputChannel.length; i++) {
                      this.buffer[this.bufferIndex] = inputChannel[i];
                      this.bufferIndex++;
                      if (this.bufferIndex >= this.bufferSize) {
                        const audioDataCopy = new Float32Array(this.buffer);
                        this.port.postMessage({ audioData: audioDataCopy });
                        this.bufferIndex = 0;
                      }
                    }
                  }
                }
                return true;
              }
            }
            registerProcessor("audio-capture-processor", AudioCaptureProcessor);
          `;

          // Create Blob URL and load processor
          const blob = new Blob([processorCode], {
            type: "application/javascript",
          });
          const blobUrl = URL.createObjectURL(blob);
          await origAddModule.call(this, blobUrl);
          console.log(
            `✅ [Test] AudioWorklet processor loaded inline successfully`,
          );
        };

        return ctx;
      } as any;

      Object.setPrototypeOf(MockedAudioContext, OriginalAudioContext);
      MockedAudioContext.prototype = OriginalAudioContext.prototype;

      window.AudioContext = MockedAudioContext;
      if ((window as any).webkitAudioContext) {
        (window as any).webkitAudioContext = MockedAudioContext;
      }

      console.log(
        "✅ [Test] AudioWorklet wrapper installed - will load processor inline",
      );
    });

    console.log(
      `✅ Audio files setup complete: ${audioPaths.length} files loaded`,
    );
  }

  /**
   * Setup audio completion listener
   */
  setupAudioCompletionListener(): void {
    console.log(
      "✅ Audio completion detection initialized (via addInitScript console capture)",
    );
  }

  /**
   * Wait for silence (no browser audio playback) for a specified duration
   * @param silenceDurationMs Required duration of silence in milliseconds (default 5000ms)
   * @param timeoutMs Maximum time to wait WHILE IN SILENCE (not total time - audio playback time doesn't count)
   * @param returnImmediatelyIfSilent If true, returns immediately if already silent (for initial check)
   * @returns true if silence detected, false if timeout
   *
   * NOTE: This method is smart about timeouts:
   * - While audio is actively playing, time doesn't count toward the timeout
   * - Timeout only applies to time spent waiting IN SILENCE without reaching the required duration
   * - This allows for very long AI responses without timing out
   */
  private async waitForSilence(
    silenceDurationMs: number = 5000,
    timeoutMs: number = 60000,
    returnImmediatelyIfSilent: boolean = false,
  ): Promise<boolean> {
    const startTime = Date.now();
    let silenceStartTime: number | null = null;
    let totalSilenceTimeMs = 0; // Track cumulative time spent waiting in silence
    let totalAudioTimeMs = 0; // Track cumulative time spent during audio playback
    let lastCheckTime = Date.now();

    console.log(
      `  👂 Listening for ${silenceDurationMs}ms of silence (timeout: ${timeoutMs}ms while silent)...`,
    );

    while (true) {
      const audioStatus = await this.page.evaluate(() => {
        // Use analyser to detect actual audio signal
        const isPlaying = (window as any).isAudioPlaying();

        // Check the mock input specifically (User Mic)
        const context = (window as any).__audioContext;
        const lastEndTime = (window as any).__lastAudioEndTime;

        let mockInputPlaying = false;
        if (context && lastEndTime) {
          mockInputPlaying = context.currentTime < lastEndTime;
        }

        // Audio is playing if EITHER the app is outputting sound OR the mock mic is running
        const audioPlaying = isPlaying || mockInputPlaying;

        return {
          audioPlaying: audioPlaying,
          reason: isPlaying
            ? "signal detected"
            : mockInputPlaying
              ? "mock mic"
              : "silence",
        };
      });

      // Calculate time since last check
      const now = Date.now();
      const intervalMs = now - lastCheckTime;
      lastCheckTime = now;

      if (!audioStatus.audioPlaying) {
        // Audio is silent - accumulate silence time
        totalSilenceTimeMs += intervalMs;

        if (silenceStartTime === null) {
          silenceStartTime = Date.now();
          console.log(`  🔇 Silence started (${audioStatus.reason})`);

          // If we should return immediately when silent, do so
          if (returnImmediatelyIfSilent) {
            console.log(`  ✅ Already silent - returning immediately`);
            return true;
          }
        }

        const currentSilenceDuration = Date.now() - silenceStartTime;

        // Check if we've achieved the required silence duration
        if (currentSilenceDuration >= silenceDurationMs) {
          const totalElapsed = Date.now() - startTime;
          console.log(`  ✅ ${silenceDurationMs}ms of silence detected`);
          console.log(
            `     Total time: ${Math.round(totalElapsed / 1000)}s (${Math.round(totalSilenceTimeMs / 1000)}s silent + ${Math.round(totalAudioTimeMs / 1000)}s audio)`,
          );
          return true;
        }

        // Check if we've been waiting in silence too long (timeout protection)
        // This timeout ONLY counts time spent in silence, NOT time during audio playback
        if (totalSilenceTimeMs > timeoutMs) {
          const totalElapsed = Date.now() - startTime;
          console.warn(
            `  ⏱️ Timeout: spent ${Math.round(totalSilenceTimeMs / 1000)}s waiting in silence (${Math.round(totalElapsed / 1000)}s total including ${Math.round(totalAudioTimeMs / 1000)}s audio)`,
          );
          return false;
        }
      } else {
        // Audio is playing - accumulate audio time (does NOT count toward timeout)
        totalAudioTimeMs += intervalMs;

        // Reset silence timer when audio plays
        if (silenceStartTime !== null) {
          const silenceDuration = Date.now() - silenceStartTime;
          console.log(
            `  🔊 Audio playing again (${audioStatus.reason}) - was silent for ${Math.round(silenceDuration / 1000)}s`,
          );
        }
        silenceStartTime = null;
      }

      await this.page.waitForTimeout(200);
    }
  }

  /**
   * Monitor for audio to start playing within a specified duration
   * @param durationMs Duration to monitor in milliseconds
   * @returns true if audio starts playing, false if remains silent
   */
  private async monitorForAudioStart(durationMs: number): Promise<boolean> {
    const startTime = Date.now();
    console.log(
      `  👂 Monitoring for ${durationMs}ms to detect if audio starts...`,
    );

    while (Date.now() - startTime < durationMs) {
      const audioStatus = await this.page.evaluate(() => {
        const isPlaying = (window as any).isAudioPlaying();
        const context = (window as any).__audioContext;
        const lastEndTime = (window as any).__lastAudioEndTime;

        let mockInputPlaying = false;
        if (context && lastEndTime) {
          mockInputPlaying = context.currentTime < lastEndTime;
        }

        return {
          audioPlaying: isPlaying || mockInputPlaying,
          reason: isPlaying
            ? "signal detected"
            : mockInputPlaying
              ? "mock mic"
              : "silence",
        };
      });

      if (audioStatus.audioPlaying) {
        console.log(`  🔊 Audio detected: ${audioStatus.reason}`);
        return true;
      }

      await this.page.waitForTimeout(200);
    }

    console.log(`  🔇 No audio detected during monitoring period`);
    return false;
  }

  /**
   * Trigger audio playback - automatically detects if assistant speaks first
   * Flow: Monitor for 5s → Play first audio → Wait 5s silence → Play next audio → Repeat
   * @param numAudioFiles Number of audio files to play
   * @param maxWaitPerCycle Maximum time to wait for silence between audio files (milliseconds)
   * @returns Object with success status
   */
  async triggerAudioPlayback(
    numAudioFiles: number = 1,
    maxWaitPerCycle: number = 240000,
  ): Promise<{ success: boolean }> {
    console.log(`🎤 Starting audio playback for ${numAudioFiles} files...`);

    // Verify triggerTestAudio exists
    const triggerTestAudioExists = await this.page.evaluate(() => {
      return typeof (window as any).triggerTestAudio === "function";
    });

    if (!triggerTestAudioExists) {
      console.error(
        "❌ triggerTestAudio function not found! Audio mocking may not be set up correctly.",
      );
      return { success: false };
    }

    // Step 1: Monitor for 10 seconds to detect if assistant speaks first (allow time for S2S initialization)
    console.log(
      `⏳ Monitoring for 10 seconds to detect if assistant speaks first...`,
    );
    const assistantSpokeFirst = await this.monitorForAudioStart(10000);

    if (assistantSpokeFirst) {
      console.log(
        `🎯 Assistant spoke first - waiting for response to complete...`,
      );
      // Wait for assistant's audio to finish
      await this.waitForSilence(5000, maxWaitPerCycle);
      console.log(`✅ Assistant audio complete`);
    } else {
      console.log(`🎯 No audio detected - user speaks first`);
    }

    // Step 2: Play all audio files sequentially with 5-second silence detection between them
    for (let audioIndex = 0; audioIndex < numAudioFiles; audioIndex++) {
      console.log(`\n🔄 ════════════════════════════════════════`);
      console.log(`🔄 Audio ${audioIndex + 1}/${numAudioFiles}`);

      // Trigger the test audio with retry for stale destination
      console.log(`🎤 Playing test audio ${audioIndex + 1}...`);
      let triggered = false;
      let retryCount = 0;
      const maxRetries = 30; // 30 retries × 1s = 30s max wait

      while (!triggered && retryCount < maxRetries) {
        triggered = await this.page.evaluate((index: number) => {
          if (typeof (window as any).triggerTestAudio !== "function") {
            return false;
          }
          try {
            return (window as any).triggerTestAudio(index);
          } catch (error) {
            console.error("❌ Failed to trigger audio:", error);
            return false;
          }
        }, audioIndex);

        if (!triggered) {
          retryCount++;
          if (retryCount === 1) {
            console.log(
              `  ⏳ Audio track not ready, waiting for recording to restart...`,
            );
          }
          if (retryCount % 5 === 0) {
            console.log(`  ⏳ Still waiting... (${retryCount}s elapsed)`);
          }
          await this.page.waitForTimeout(1000);
        }
      }

      if (!triggered) {
        console.warn(
          `⚠️ Failed to trigger audio ${audioIndex + 1} after ${maxRetries} retries`,
        );
        return { success: false };
      }

      console.log(`✅ Test audio ${audioIndex + 1} triggered`);

      // Wait for 5 seconds of silence before next audio
      console.log(`⏳ Waiting for 5 seconds of silence...`);
      const silenceDetected = await this.waitForSilence(5000, maxWaitPerCycle);

      if (!silenceDetected) {
        console.warn(
          `⚠️ Timeout waiting for silence after audio ${audioIndex + 1}`,
        );
        return { success: false };
      }

      console.log(`✅ 5 seconds of silence detected`);
    }

    console.log(
      `\n✅ All ${numAudioFiles} audio files completed successfully!`,
    );
    return { success: true };
  }

  /**
   * Wait for conversation transcription to appear
   */
  async waitForConversationTranscription(
    timeoutMs: number = 45000,
  ): Promise<boolean> {
    try {
      await expect(
        this.page.getByText(/conversation transcription/i),
      ).toBeVisible({ timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for conversation completion
   */
  async waitForConversationCompletion(
    timeoutMs: number = 30000,
  ): Promise<boolean> {
    try {
      const exitButton = this.page.getByRole("button", { name: /exit/i });
      await exitButton.waitFor({ state: "visible", timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start practice now (navigates to Live Practice page)
   */
  async startPracticeNow(): Promise<void> {
    await this.page
      .getByRole("button", { name: /start practice now/i })
      .click();
    await this.page.waitForTimeout(2000);
  }

  /**
   * Get feedback summary from the Practice Session Details page
   */
  async getFeedbackSummary(): Promise<string | null> {
    try {
      console.log("📦 Extracting feedback container...");
      const feedbackHeading = this.page.getByRole("heading", {
        level: 2,
        name: /interview feedback/i,
      });

      // Strategy 1: Look for awsui-container ancestor
      let feedbackContainer = feedbackHeading.locator(
        'xpath=ancestor::*[contains(@class, "awsui-container")][1]',
      );
      let feedbackText = null;

      if ((await feedbackContainer.count()) > 0) {
        feedbackText = await feedbackContainer.textContent();
        console.log("✅ Retrieved feedback summary (via awsui-container)");
      } else {
        // Strategy 2: Look for broader parent div
        console.log("📦 Container not found, trying broader parent div...");
        feedbackContainer = feedbackHeading.locator(
          'xpath=ancestor::div[contains(@class, "awsui")]',
        );
        if ((await feedbackContainer.count()) > 0) {
          feedbackText = await feedbackContainer.first().textContent();
          console.log("✅ Retrieved feedback summary (via awsui parent div)");
        } else {
          // Strategy 3: Use page.evaluate
          console.log("📦 AWS classes not found, trying general parent...");
          feedbackText = await this.page.evaluate(() => {
            const heading = Array.from(document.querySelectorAll("h2")).find(
              (h) => h.textContent?.includes("Interview Feedback"),
            );
            if (heading) {
              let parent = heading.parentElement;
              while (
                parent &&
                !parent.textContent?.includes("Detailed Evaluation")
              ) {
                parent = parent.parentElement;
              }
              if (parent) {
                return parent.textContent || null;
              }
            }
            return null;
          });
          if (feedbackText) {
            console.log("✅ Retrieved feedback summary (via page.evaluate)");
          }
        }
      }

      if (feedbackText && feedbackText.trim().length > 50) {
        console.log(`📊 Feedback length: ${feedbackText.length} characters`);
        return feedbackText;
      }

      console.warn(
        `⚠️ Could not extract feedback content (length: ${feedbackText?.trim().length || 0})`,
      );
      return null;
    } catch (error) {
      console.error("❌ Error getting feedback summary:", error);
      return null;
    }
  }
}
