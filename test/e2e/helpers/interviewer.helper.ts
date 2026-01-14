import { Page, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Helper class for Interviewer Experience E2E tests
 * Provides utility methods for interviewer workflow automation
 */
export class InterviewerHelper {
  constructor(private page: Page) {}

  /**
   * Navigate to Schedule Interview page
   */
  async navigateToScheduleInterview() {
    const navLink = this.page.getByRole("link", {
      name: /schedule interview/i,
    });
    await navLink.waitFor({ state: "visible", timeout: 30000 });
    await navLink.click();
    await expect(this.page).toHaveURL(/.*interviewer\/(new|create)/, {
      timeout: 30000,
    });
  }

  /**
   * Click Schedule New Interview button from the landing page
   */
  async clickScheduleNewInterview() {
    console.log("Clicking Schedule New Interview button...");

    const button = this.page.getByRole("button", {
      name: /schedule new interview/i,
    });
    await button.waitFor({ state: "visible", timeout: 30000 });
    await button.click();

    // Wait for form page to load
    await this.page.waitForLoadState("networkidle");

    console.log("✅ Navigated to interview form");
  }

  /**
   * Fill interview schedule form
   */
  async fillInterviewScheduleForm(config: {
    interviewName: string;
    scheduledDate: string;
    scheduledTime: string;
    cvPath: string;
    jdPath: string;
    questionSource?: "ai" | "csv";
    interviewType?: string;
    csvPath?: string;
  }) {
    console.log(`Filling interview schedule form: ${config.interviewName}`);

    // Wait for form to load
    await this.page.waitForLoadState("networkidle");

    // Interview Name - match the actual placeholder text
    await this.page
      .getByPlaceholder(/john doe.*senior engineer interview/i)
      .fill(config.interviewName);

    // Scheduled Date
    await this.page.getByPlaceholder("YYYY/MM/DD").fill(config.scheduledDate);

    // Scheduled Time - use Select component
    await this.page.getByRole("button", { name: /select time/i }).click();
    await this.page
      .getByRole("option", { name: config.scheduledTime })
      .first()
      .click();

    // Interview Type - Select from dropdown if provided
    if (config.interviewType) {
      console.log(`Selecting interview type: ${config.interviewType}`);

      // Map config values to display labels
      const interviewTypeMap: { [key: string]: string } = {
        phone_screening: "Phone Screening",
        technical: "Technical Skills",
        behavioral: "Behavioral",
        system_design: "System Design",
        case: "Case Interview",
        general: "General / Mixed",
      };

      const displayLabel =
        interviewTypeMap[config.interviewType] || config.interviewType;

      // Find and click the Interview Type select button
      const interviewTypeSelect = this.page
        .locator("button")
        .filter({
          has: this.page.locator("span", {
            hasText:
              /General \/ Mixed|Phone Screening|Technical Skills|Behavioral|System Design|Case Interview/i,
          }),
        })
        .first();

      await interviewTypeSelect.click();
      await this.page.waitForTimeout(500);

      // Select the option
      await this.page.getByRole("option", { name: displayLabel }).click();
      await this.page.waitForTimeout(500);

      console.log(`✅ Interview type set to: ${displayLabel}`);
    }

    // Upload CV
    const cvFileInput = this.page.locator('input[type="file"]').nth(0);
    await cvFileInput.setInputFiles(config.cvPath);
    await this.page.waitForTimeout(1000);

    // Upload Job Description
    const jdFileInput = this.page.locator('input[type="file"]').nth(1);
    await jdFileInput.setInputFiles(config.jdPath);
    await this.page.waitForTimeout(1000);

    // Question Source (default to AI)
    if (config.questionSource === "csv") {
      console.log("Selecting CSV question source...");
      await this.page
        .getByRole("radio", { name: /upload custom questions/i })
        .click();
      await this.page.waitForTimeout(1000);

      // Upload CSV file if provided
      if (config.csvPath) {
        console.log(`Uploading CSV file: ${config.csvPath}`);
        // The CSV file input is the third file input on the page (after CV and JD)
        const csvFileInput = this.page.locator('input[type="file"]').nth(2);
        await csvFileInput.setInputFiles(config.csvPath);
        await this.page.waitForTimeout(2000); // Wait for CSV parsing
        console.log("✅ CSV file uploaded and parsed");
      } else {
        console.warn(
          "⚠️ WARNING: questionSource is 'csv' but no csvPath provided",
        );
      }
    }

    console.log("✅ Interview schedule form filled");
  }

  /**
   * Generate interview plan with AI or custom questions
   */
  async generateInterviewPlan(questionSource: "ai" | "csv" = "ai") {
    console.log(
      `Generating interview plan with ${questionSource === "ai" ? "AI" : "custom questions"}...`,
    );

    // Click the appropriate button based on question source
    const buttonText =
      questionSource === "ai"
        ? /ai research & selected questions/i
        : /generate interview plan with custom questions/i;

    await this.page.getByRole("button", { name: buttonText }).click();

    // Wait for plan generation to complete (can take 1-2 minutes)
    console.log("⏳ Waiting for interview plan generation...");
    await expect(
      this.page.getByText(/interview plan generated successfully/i),
    ).toBeVisible({ timeout: 300000 }); // Max 5 minutes

    console.log("✅ Interview plan generated successfully");
  }

  /**
   * Save interview schedule
   */
  async saveInterviewSchedule() {
    console.log("Saving interview schedule...");

    await this.page
      .getByRole("button", { name: /save interview schedule/i })
      .click();

    // Wait for success message
    await expect(
      this.page.getByText(/interview schedule saved successfully/i),
    ).toBeVisible({ timeout: 30000 });

    console.log("✅ Interview schedule saved");
  }

  /**
   * Click Proceed to Interview button
   */
  async proceedToInterview() {
    await this.page
      .getByRole("button", { name: /proceed to interview/i })
      .click();

    // Should navigate to interviewer list
    await expect(this.page).toHaveURL(/.*interviewer\/create/, {
      timeout: 30000,
    });
  }

  /**
   * Start interview from list (first interview in table)
   */
  async startInterviewFromList() {
    console.log("Starting interview from list...");

    // Wait for table to load
    await this.page.waitForSelector("table tbody tr", { timeout: 60000 });

    // Click "Start Interview" button for first row
    const startButton = this.page
      .getByRole("button", { name: /start interview/i })
      .first();
    await startButton.waitFor({ state: "visible", timeout: 30000 });
    await startButton.click();

    // Should navigate to InterviewerLive page
    await expect(this.page).toHaveURL(/.*interviewer\/live/, {
      timeout: 30000,
    });

    console.log("✅ Navigated to InterviewerLive page");
  }

  /**
   * Configure interview live settings
   */
  async configureInterviewLiveSettings(saveVideoRecording: boolean = true) {
    console.log("Configuring interview live settings...");

    // Check "Save video recording" checkbox if needed
    if (saveVideoRecording) {
      const checkbox = this.page.getByRole("checkbox", {
        name: /save video recording/i,
      });
      await checkbox.check();
      console.log("✅ Video recording enabled");
    }
  }

  /**
   * Start live interview session
   * Note: This will trigger browser's screen sharing dialog
   */
  async startLiveInterviewSession() {
    console.log("Starting live interview session...");

    // Ensure the interviewer page is in focus before clicking
    await this.page.bringToFront();
    console.log("✅ Interviewer page brought to front");
    await this.page.waitForTimeout(500);

    const startButton = this.page.getByRole("button", {
      name: /start with selected interview/i,
    });

    // Verify button is visible before clicking
    const isVisible = await startButton.isVisible();
    console.log(`🔍 Start button visible: ${isVisible}`);

    // Click once and wait for any async state updates
    console.log(
      "🖱️  Attempting first click on 'Start with selected interview' button...",
    );
    await startButton.click();
    console.log("✅  click executed");
  }

  /**
   * Wait for interview session to be active
   * Checks for both success and error states
   */
  async waitForInterviewSessionActive() {
    console.log("Waiting for interview session to become active...");

    try {
      // Wait for either success or error state
      const result = await Promise.race([
        // Success: Listening indicator appears
        this.page
          .getByText(/listening\.\.\./i)
          .first()
          .waitFor({
            state: "visible",
            timeout: 30000,
          })
          .then(() => ({ success: true })),

        // Error: Check for error messages
        this.page
          .locator("text=/error|could not start|failed|notreadable/i")
          .first()
          .waitFor({
            state: "visible",
            timeout: 30000,
          })
          .then(async () => {
            const errorElements = this.page.locator(
              "text=/error|could not start|failed|notreadable/i",
            );
            const errorText =
              (await errorElements.first().textContent()) || "Unknown error";
            return { success: false, error: errorText };
          }),
      ]);

      if (!result.success && "error" in result) {
        throw new Error(`Screen sharing failed: ${result.error}`);
      }

      console.log("✅ Interview session is active");
    } catch (error) {
      console.error("❌ Failed to start interview session");
      console.error(`   Error: ${error}`);

      // Take screenshot for debugging
      await this.page.screenshot({
        path: "screen-share-error.png",
        fullPage: true,
      });
      console.log("📸 Screenshot saved: screen-share-error.png");

      // Try to get browser console logs
      try {
        const pageContent = await this.page.content();
        if (pageContent.includes("NotReadableError")) {
          console.error(
            "   Detected NotReadableError - screen/tab sharing failed to start",
          );
          console.error(
            "   This is a known limitation of automated browser screen sharing",
          );
        }
      } catch (e) {
        // Ignore errors getting page content
      }

      // Check for specific error states on the page
      const errorStates = await this.page.evaluate(() => {
        const errors: string[] = [];

        // Check for error alerts or messages
        const errorElements = document.querySelectorAll(
          '[role="alert"], .error, .alert-error',
        );
        errorElements.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) errors.push(text);
        });

        return errors;
      });

      if (errorStates.length > 0) {
        console.error("   Page error states:", errorStates);
      }

      throw error;
    }
  }

  /**
   * Verify transcription is working
   */
  async verifyTranscriptionWorking(timeoutMs: number = 60000) {
    console.log("Verifying transcription is working...");

    // Wait for transcript container to appear
    await this.page.waitForSelector('[data-testid="transcript"]', {
      timeout: timeoutMs,
      state: "visible",
    });

    console.log("✅ Transcription container visible");
  }

  /**
   * End interview session
   */
  async endInterviewSession() {
    console.log("Ending interview session...");

    await this.page
      .getByRole("button", { name: /end & save interview/i })
      .click();

    // Wait for save modal
    await expect(this.page.getByText(/save interview session/i)).toBeVisible({
      timeout: 30000,
    });

    console.log("✅ Save modal appeared");
  }

  /**
   * Save interview session from modal
   */
  async saveInterviewSessionFromModal() {
    console.log("Saving interview session from modal...");

    await this.page.getByRole("button", { name: /save interview/i }).click();

    // Wait for success alert
    await expect(
      this.page.getByText(/interview saved successfully/i),
    ).toBeVisible({ timeout: 60000 }); // AI analysis can take time

    console.log("✅ Interview session saved successfully");
  }

  /**
   * Get interview session summary
   */
  async getInterviewSessionSummary() {
    try {
      // Try to find summary heading first
      const summaryHeading = this.page.getByRole("heading", {
        name: /summary/i,
      });

      if (
        await summaryHeading.isVisible({ timeout: 2000 }).catch(() => false)
      ) {
        // Get the container that holds the summary
        const summaryContainer = summaryHeading.locator(
          "xpath=ancestor::div[@class][1]",
        );
        const summaryText = await summaryContainer.textContent();
        console.log("Interview Summary:", summaryText);
        return summaryText;
      }

      console.log("⚠️ Summary section not found, skipping");
      return null;
    } catch (error) {
      console.warn("⚠️ Could not extract summary:", error);
      return null;
    }
  }

  /**
   * Play audio file in the Jitsi meeting tab
   * This simulates a candidate speaking in the meeting
   */
  async playAudioInJitsi(jitsiPage: Page, audioPath: string) {
    console.log(`🔊 Playing audio: ${path.basename(audioPath)}`);

    // Read audio file as base64
    const audioBuffer = fs.readFileSync(audioPath);
    const audioBase64 = audioBuffer.toString("base64");
    const mimeType = audioPath.endsWith(".mp3") ? "audio/mp3" : "audio/wav";

    // Inject and play audio in the page
    await jitsiPage.evaluate(
      async ({ base64, mime }) => {
        return new Promise<void>((resolve) => {
          const audio = new Audio(`data:${mime};base64,${base64}`);
          audio.onended = () => resolve();
          audio.onerror = () => {
            console.error("Audio playback error");
            resolve();
          };
          audio.play().catch((e) => {
            console.error("Audio play() failed:", e);
            resolve();
          });
        });
      },
      { base64: audioBase64, mime: mimeType },
    );

    console.log("✅ Audio playback completed");
  }

  /**
   * Play audio file directly in the current page (for testing system audio capture)
   * This plays audio as if it's coming from the browser/system
   */
  async playAudioInCurrentPage(audioPath: string) {
    console.log(
      `🔊 Playing audio in current page: ${path.basename(audioPath)}`,
    );

    // Read audio file as base64
    const audioBuffer = fs.readFileSync(audioPath);
    const audioBase64 = audioBuffer.toString("base64");
    const mimeType = audioPath.endsWith(".mp3") ? "audio/mp3" : "audio/wav";

    // Inject and play audio in the page
    await this.page.evaluate(
      async ({ base64, mime }) => {
        return new Promise<void>((resolve) => {
          const audio = new Audio(`data:${mime};base64,${base64}`);
          audio.volume = 1.0; // Max volume
          audio.onended = () => {
            console.log("✅ Audio ended");
            resolve();
          };
          audio.onerror = (e) => {
            console.error("Audio playback error:", e);
            resolve();
          };
          audio.play().catch((e) => {
            console.error("Audio play() failed:", e);
            resolve();
          });
        });
      },
      { base64: audioBase64, mime: mimeType },
    );

    console.log("✅ Audio playback completed in current page");
  }

  /**
   * Play multiple audio files sequentially in the current page
   * @param testDataFolder Path to the test data folder containing audio files
   * @param numFiles Number of audio files to play (optional - plays all if not specified)
   */
  async playAudioSequenceInCurrentPage(
    testDataFolder: string,
    numFiles?: number,
  ) {
    // Get all audio files (sorted numerically)
    const audioFiles = fs
      .readdirSync(testDataFolder)
      .filter((f) => f.match(/^\d+.*\.(wav|mp3)$/i))
      .sort((a, b) => {
        const numA = parseInt(a.match(/^(\d+)/)?.[1] || "0");
        const numB = parseInt(b.match(/^(\d+)/)?.[1] || "0");
        return numA - numB;
      });

    const filesToPlay = numFiles
      ? Math.min(numFiles, audioFiles.length)
      : audioFiles.length;

    console.log(
      `🎵 Playing ${filesToPlay} audio files in current page from ${testDataFolder} (${audioFiles.length} total available)`,
    );

    // Play audio files
    for (let i = 0; i < filesToPlay; i++) {
      const audioPath = path.join(testDataFolder, audioFiles[i]);
      await this.playAudioInCurrentPage(audioPath);

      // Wait between audio files
      await this.page.waitForTimeout(3000);
    }

    console.log(
      `✅ Completed playing ${filesToPlay} audio files in current page`,
    );
  }

  /**
   * Play multiple audio files sequentially in the Jitsi meeting
   * @param jitsiPage The Jitsi meeting page
   * @param testDataFolder Path to the test data folder containing audio files
   * @param numFiles Number of audio files to play (optional - plays all if not specified)
   */
  async playAudioSequence(
    jitsiPage: Page,
    testDataFolder: string,
    numFiles?: number,
  ) {
    // Get all audio files (sorted numerically)
    const audioFiles = fs
      .readdirSync(testDataFolder)
      .filter((f) => f.match(/^\d+.*\.(wav|mp3)$/i))
      .sort((a, b) => {
        const numA = parseInt(a.match(/^(\d+)/)?.[1] || "0");
        const numB = parseInt(b.match(/^(\d+)/)?.[1] || "0");
        return numA - numB;
      });

    const filesToPlay = numFiles
      ? Math.min(numFiles, audioFiles.length)
      : audioFiles.length;

    console.log(
      `🎵 Playing ${filesToPlay} audio files from ${testDataFolder} (${audioFiles.length} total available)`,
    );

    // Play audio files
    for (let i = 0; i < filesToPlay; i++) {
      const audioPath = path.join(testDataFolder, audioFiles[i]);
      await this.playAudioInJitsi(jitsiPage, audioPath);

      // Wait between audio files
      await jitsiPage.waitForTimeout(3000);
    }

    console.log(`✅ Completed playing ${filesToPlay} audio files`);
  }
}
