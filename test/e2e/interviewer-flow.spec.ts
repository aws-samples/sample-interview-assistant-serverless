import { test, expect, chromium, Page, BrowserContext } from "@playwright/test";
import { AuthHelper } from "./helpers/auth.helper";
import { InterviewerHelper } from "./helpers/interviewer.helper";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

// Load test environment variables
dotenv.config({ path: ".env.test" });
dotenv.config({ path: ".env.test.local", override: true });

/**
 * Interviewer Experience E2E Test
 *
 * This test validates the complete interviewer workflow:
 * 1. Authenticates as interviewer
 * 2. Creates interview schedule with AI-generated questions
 * 3. Starts live interview
 * 4. Opens Jitsi meeting in a separate tab (SAME window)
 * 5. Automatically accepts Jitsi tab sharing (fully automated)
 * 6. Plays audio files in Jitsi to simulate candidate responses
 * 7. Captures transcription and saves interview session
 *
 * Technical Notes:
 * - Both tabs (Jitsi + Interviewer) are in the SAME browser context (same window)
 * - **FULLY AUTOMATED**: Jitsi tab capture is auto-selected and auto-accepted via Chromium flags:
 *   - --auto-select-tab-capture-source-by-title=Jitsi Meet (auto-selects Jitsi tab)
 *   - --auto-accept-this-tab-capture (auto-accepts the tab capture)
 *   - --enable-experimental-web-platform-features
 * - Uses Playwright's grantPermissions() for microphone/camera access
 * - Tab sharing captures audio from Jitsi meeting tab
 * - Audio files are played in the Jitsi tab to generate transcription
 * - No manual intervention required
 */

const TEST_CONFIG = {
  testDataRoot: process.env.TEST_DATA_ROOT || "test-data/",
  testUserEmail: process.env.TEST_USER_EMAIL || "",
  testUserPassword: process.env.TEST_USER_PASSWORD || "",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
};

// Discover all interviewer_* test data folders
const testDataRoot = TEST_CONFIG.testDataRoot;
const interviewerFolders = fs
  .readdirSync(testDataRoot, { withFileTypes: true })
  .filter(
    (dirent) => dirent.isDirectory() && dirent.name.startsWith("interviewer_"),
  )
  .map((dirent) => dirent.name);

console.log(
  `\n📁 Found ${interviewerFolders.length} interviewer test data folders:`,
);
interviewerFolders.forEach((folder) => console.log(`   - ${folder}`));

test.describe("Interviewer Experience - End-to-End Flow", () => {
  // Run a test for each interviewer_* folder
  for (const testFolder of interviewerFolders) {
    test(`Complete interviewer workflow: ${testFolder}`, async () => {
      // Set longer timeout for this complex test
      test.setTimeout(900000); // 15 minutes

      console.log("\n" + "=".repeat(80));
      console.log(`🧪 INTERVIEWER E2E TEST: ${testFolder}`);
      console.log("🤖 FULLY AUTOMATED TEST");
      console.log("=".repeat(80));
      console.log(
        "✅ Jitsi tab capture will be auto-selected and auto-accepted",
      );
      console.log("✅ No manual intervention required");
      console.log("✅ Test captures Jitsi tab with audio");
      console.log("=".repeat(80) + "\n");

      // Launch Chromium with flags for automated screen sharing (Jitsi tab capture)
      const browser = await chromium.launch({
        headless: false, // Must be headed for screen sharing
        args: [
          // Screen capture enablement
          "--enable-usermedia-screen-capturing", // Enable screen capture
          "--allow-http-screen-capture", // Allow non-HTTPS screen capture
          "--autoplay-policy=no-user-gesture-required", // Allow audio autoplay

          // Auto-select and auto-accept Jitsi tab capture
          "--auto-select-tab-capture-source-by-title=Jitsi Meet", // Auto-select Jitsi tab
          "--auto-accept-this-tab-capture", // Auto-accept the selected tab
          "--enable-experimental-web-platform-features",

          // Additional flags for automation
          "--disable-features=PreloadMediaEngagementData",
          "--disable-blink-features=AutomationControlled",
        ],
      });

      let browserContext: BrowserContext | undefined;
      let jitsiPage: Page | undefined;
      let interviewerPage: Page | undefined;
      let questionSource: "ai" | "csv" = "ai"; // Default to AI
      const browserErrors: string[] = []; // Collect browser errors throughout test

      try {
        // Step 1: Create browser context (shared by both tabs)
        await test.step("Setup browser context", async () => {
          console.log("Creating browser context...");
          browserContext = await browser.newContext({
            permissions: ["microphone", "camera"],
          });

          // Grant display capture permission programmatically
          await browserContext.grantPermissions(["microphone", "camera"], {
            origin: TEST_CONFIG.frontendUrl,
          });

          interviewerPage = await browserContext.newPage();

          // Capture console logs from browser
          interviewerPage.on("console", (msg) => {
            const type = msg.type();
            const text = msg.text();

            // Log errors and warnings from browser
            if (type === "error") {
              console.error(`🌐 Browser Error: ${text}`);
              // Collect critical errors for later assertion
              browserErrors.push(text);
            } else if (type === "warning") {
              console.warn(`🌐 Browser Warning: ${text}`);
            }

            // Specifically log NotReadableError
            if (
              text.includes("NotReadableError") ||
              text.includes("could not start")
            ) {
              console.error(`🌐 Browser Media Error: ${text}`);
            }
          });

          console.log("✅ Browser context created with interviewer tab");
        });

        // Step 2: Authenticate interviewer EARLY (before Jitsi)
        await test.step("Interviewer authenticates", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          console.log("🔐 Authenticating interviewer...");
          const authHelper = new AuthHelper(interviewerPage);
          await authHelper.login(
            TEST_CONFIG.testUserEmail,
            TEST_CONFIG.testUserPassword,
          );

          // Wait for localStorage to be populated after redirect
          console.log(
            "⏳ Waiting for auth token to persist in localStorage...",
          );
          await interviewerPage.waitForTimeout(3000);

          // Retry auth check with timeout
          let isAuth = false;
          for (let i = 0; i < 5; i++) {
            isAuth = await authHelper.isAuthenticated();
            if (isAuth) {
              console.log(`✅ Auth check succeeded on attempt ${i + 1}`);
              break;
            }
            console.log(`🔄 Auth check attempt ${i + 1}/5 - waiting...`);
            await interviewerPage.waitForTimeout(2000);
          }

          if (!isAuth) {
            // Debug: Check current URL and page state
            const currentUrl = interviewerPage.url();
            const pageTitle = await interviewerPage.title();
            console.error(`❌ Authentication failed after 5 attempts`);
            console.error(`   Current URL: ${currentUrl}`);
            console.error(`   Page title: ${pageTitle}`);

            // Take screenshot for debugging
            await interviewerPage.screenshot({
              path: "auth-failure.png",
              fullPage: true,
            });
          }

          expect(isAuth).toBeTruthy();
          console.log("✅ Interviewer authenticated");
        });

        // Step 4: Navigate to Schedule Interview
        await test.step("Navigate to Schedule Interview", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          console.log(
            "⏳ Navigating to Schedule Interview page (extended timeout: 60s)...",
          );
          await interviewerHelper.navigateToScheduleInterview();
          await interviewerPage.waitForTimeout(3000); // Additional wait for page stability
        });

        // Step 5: Click Schedule New Interview button
        await test.step("Click Schedule New Interview button", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          console.log(
            "⏳ Clicking Schedule New Interview button (extended timeout: 60s)...",
          );
          await interviewerHelper.clickScheduleNewInterview();
          await interviewerPage.waitForTimeout(3000); // Additional wait for modal/form to load
        });

        // Step 6: Fill interview schedule form
        await test.step("Fill interview schedule form", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          console.log(
            "⏳ Filling interview schedule form (extended timeout: 90s)...",
          );
          const interviewerHelper = new InterviewerHelper(interviewerPage);

          // Use test data from the current test folder
          const testDataFolder = path.join(
            TEST_CONFIG.testDataRoot,
            testFolder,
          );
          const cvPath = path.join(testDataFolder, "CV.pdf");
          const jdPath = path.join(testDataFolder, "JobDescription.pdf");
          const configPath = path.join(testDataFolder, "config.json");

          // Verify files exist
          if (!fs.existsSync(cvPath)) {
            throw new Error(`CV not found: ${cvPath}`);
          }
          if (!fs.existsSync(jdPath)) {
            throw new Error(`Job description not found: ${jdPath}`);
          }
          if (!fs.existsSync(configPath)) {
            throw new Error(`Config file not found: ${configPath}`);
          }

          // Read config.json to get test settings
          const configContent = fs.readFileSync(configPath, "utf-8");
          const config = JSON.parse(configContent);
          const interviewType = config.interviewType || "general";
          questionSource = config.questionSource || "ai"; // Assign to outer scope

          console.log(
            `📋 Test config - Interview Type: ${interviewType}, Question Source: ${questionSource}`,
          );

          // If questionSource is CSV, find the CSV file in the test data directory
          let csvPath: string | undefined;
          if (questionSource === "csv") {
            const csvFiles = fs
              .readdirSync(testDataFolder)
              .filter((file) => file.endsWith(".csv"));
            if (csvFiles.length === 0) {
              throw new Error(
                `No CSV file found in ${testDataFolder} but questionSource is set to 'csv'`,
              );
            }
            csvPath = path.join(testDataFolder, csvFiles[0]);
            console.log(`📄 Found CSV file: ${csvFiles[0]}`);
          }

          // Generate future date/time for scheduling
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const scheduledDate = tomorrow.toISOString().split("T")[0]; // YYYY-MM-DD
          const scheduledTime = "10:00"; // 10:00 AM

          await interviewerHelper.fillInterviewScheduleForm({
            interviewName: "E2E Test Interview - Senior Engineer",
            scheduledDate: scheduledDate.replace(/-/g, "/"), // YYYY/MM/DD
            scheduledTime: scheduledTime,
            cvPath: cvPath,
            jdPath: jdPath,
            questionSource: questionSource as "ai" | "csv",
            interviewType: interviewType,
            csvPath: csvPath,
          });

          // Additional wait for form submission and processing
          await interviewerPage.waitForTimeout(5000);
          console.log("✅ Interview schedule form filled successfully");
        });

        // Step 7: Generate interview plan
        await test.step(`Generate interview plan (${questionSource})`, async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          await interviewerHelper.generateInterviewPlan(questionSource);
        });

        // Step 8: Save interview schedule
        await test.step("Save interview schedule", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          await interviewerHelper.saveInterviewSchedule();
        });

        // Step 9: Proceed to interview list
        await test.step("Proceed to interview list", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          await interviewerHelper.proceedToInterview();
        });

        // Step 10: Start interview from list
        await test.step("Start interview from list", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          await interviewerHelper.startInterviewFromList();
        });

        // Step 11: Setup Jitsi meeting NOW (just before screen sharing)
        await test.step("Setup Jitsi meeting for screen sharing", async () => {
          if (!browserContext) {
            throw new Error("Browser context not initialized");
          }
          console.log("Creating Jitsi meeting tab in same window...");
          jitsiPage = await browserContext.newPage();

          // Generate a unique meeting room name
          const roomName = `e2e-test-${Date.now()}`;
          const jitsiUrl = `https://meet.jit.si/${roomName}`;

          console.log(`Navigating to Jitsi meeting: ${jitsiUrl}`);
          await jitsiPage.goto(jitsiUrl, {
            waitUntil: "networkidle",
            timeout: 30000,
          });

          // Wait and join meeting
          await jitsiPage.waitForTimeout(3000);

          // Enter name if prompted
          try {
            const nameInput = jitsiPage.locator(
              'input[name="displayName"], input[placeholder*="name" i]',
            );
            if (await nameInput.isVisible({ timeout: 5000 })) {
              await nameInput.fill("E2E Test Candidate");
              console.log("✅ Entered name: E2E Test Candidate");

              // Try multiple selector strategies for the Join button
              const joinButtonSelectors = [
                'button:has-text("Join")',
                'button[aria-label*="Join" i]',
                'div[role="button"]:has-text("Join")',
                "button.prejoin-btn",
                '[data-testid="prejoin.joinMeeting"]',
              ];

              let buttonClicked = false;
              for (const selector of joinButtonSelectors) {
                try {
                  const joinButton = jitsiPage.locator(selector).first();
                  if (await joinButton.isVisible({ timeout: 5000 })) {
                    console.log(
                      `🔍 Found Join button with selector: ${selector}`,
                    );
                    await joinButton.click();
                    console.log("✅ Join button clicked successfully");
                    buttonClicked = true;
                    break;
                  }
                } catch (e) {
                  console.log(
                    `⚠️ Join button not found with selector: ${selector}`,
                  );
                }
              }

              if (!buttonClicked) {
                console.warn(
                  "⚠️ WARNING: Join button not found with any selector",
                );
                console.warn("   Taking screenshot for debugging...");
                await jitsiPage.screenshot({
                  path: "jitsi-join-button-not-found.png",
                  fullPage: true,
                });
                console.warn(
                  "   Meeting may auto-join or button selector needs update",
                );
              }
            }
          } catch (e) {
            console.log(`⚠️ No name input, meeting auto-joined. Error: ${e}`);
          }

          await jitsiPage.waitForTimeout(3000);
          console.log(
            "✅ Jitsi meeting active in same browser window as interviewer app",
          );
        });

        // Step 12: Configure live interview settings
        await test.step("Configure live interview settings", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          await interviewerHelper.configureInterviewLiveSettings(true);
        });

        // Step 13: Start live interview session (Jitsi tab capture auto-accepted)
        await test.step("Start live interview session", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          await interviewerHelper.startLiveInterviewSession();

          // Wait for Jitsi tab capture to be automatically accepted and initialized
          await interviewerPage.waitForTimeout(5000);

          console.log(
            "✅ Jitsi tab capture auto-selected and auto-accepted via Chromium flags",
          );
        });

        // Step 14: Wait for interview session to be active
        await test.step("Verify interview session is active", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);
          await interviewerHelper.waitForInterviewSessionActive();
        });

        // Step 15: Play audio files to generate transcription
        await test.step("Play audio and capture transcription", async () => {
          if (!interviewerPage || !jitsiPage) {
            throw new Error("Pages not initialized");
          }

          const interviewerHelper = new InterviewerHelper(interviewerPage);
          const testDataFolder = path.join(
            TEST_CONFIG.testDataRoot,
            testFolder,
          );

          console.log(
            "🎵 Playing audio in Jitsi tab (should be captured via screen sharing)",
          );

          // Bring Jitsi tab to front so audio is audible
          await jitsiPage.bringToFront();
          await jitsiPage.waitForTimeout(2000);

          // Play all audio files in Jitsi meeting tab
          await interviewerHelper.playAudioSequence(jitsiPage, testDataFolder);

          // Switch back to interviewer tab
          await interviewerPage.bringToFront();

          // Wait for transcription to process
          console.log("⏳ Waiting 15 seconds for transcription to process...");
          await interviewerPage.waitForTimeout(15000);

          // Verify transcription is working by checking for "Live Transcription" heading
          const transcriptionHeading = interviewerPage.getByRole("heading", {
            name: /live transcription/i,
          });
          const isVisible = await transcriptionHeading.isVisible();
          console.log(`Live Transcription section visible: ${isVisible}`);

          // Check if there are actual transcript message bubbles (Speaker 0 labels)
          const speakerLabels = interviewerPage.locator("text=/Speaker \\d+/i");
          let numTranscripts = await speakerLabels.count();
          console.log(`📝 Transcript messages found: ${numTranscripts}`);

          if (numTranscripts > 0) {
            console.log(
              `✅ SUCCESS: ${numTranscripts} transcription messages captured!`,
            );
          } else {
            console.warn("⚠️ WARNING: No transcription messages captured yet");
            console.warn("   Did you check the 'Share tab audio' checkbox?");
            console.warn("   Waiting additional 10 seconds...");

            await interviewerPage.waitForTimeout(10000);

            // Check again
            numTranscripts = await speakerLabels.count();
            console.log(
              `📝 Transcript messages found (after waiting): ${numTranscripts}`,
            );

            if (numTranscripts > 0) {
              console.log(
                `✅ SUCCESS: ${numTranscripts} transcription messages captured after waiting!`,
              );
            } else {
              console.warn(
                "⚠️ Screen sharing may not be capturing Jitsi tab audio",
              );

              // Take screenshot for debugging
              await interviewerPage.screenshot({
                path: "interviewer-no-transcript.png",
                fullPage: true,
              });
            }
          }

          // ASSERTION: Verify minimum transcription threshold
          // Calculate expected minimum: at least 60% of audio files should produce transcriptions
          const audioFiles = fs
            .readdirSync(testDataFolder)
            .filter((file) => file.endsWith(".wav") || file.endsWith(".mp3"));
          const expectedMinTranscripts = Math.ceil(audioFiles.length * 0.6); // At least 60% success rate

          console.log(
            `🔍 Transcription validation: ${numTranscripts} actual vs ${expectedMinTranscripts} minimum expected (60% of ${audioFiles.length} audio files)`,
          );

          // Assert minimum transcription threshold
          if (numTranscripts < expectedMinTranscripts) {
            throw new Error(
              `Expected at least ${expectedMinTranscripts} transcriptions (60% of ${audioFiles.length} audio files), but got ${numTranscripts}. This indicates transcription pipeline failure.`,
            );
          }
          console.log("✅ Transcription threshold validation passed");
        });

        // Step 16: End interview session
        await test.step("End and save interview session", async () => {
          if (!interviewerPage) {
            throw new Error("Interviewer page not initialized");
          }
          const interviewerHelper = new InterviewerHelper(interviewerPage);

          console.log("🛑 Ending interview session...");
          await interviewerHelper.endInterviewSession();

          console.log("⏳ Waiting 10 seconds for data to finalize...");
          await interviewerPage.waitForTimeout(10000);

          console.log("💾 Saving interview session...");
          await interviewerHelper.saveInterviewSessionFromModal();

          // Wait for multipart upload to complete
          console.log(
            "⏳ Waiting 10 seconds for multipart upload to complete...",
          );
          await interviewerPage.waitForTimeout(10000);

          // Try to get summary (may not be available if no transcription)
          const summary = await interviewerHelper.getInterviewSessionSummary();
          if (summary) {
            console.log("✅ Interview saved with summary");
          } else {
            console.log("✅ Interview saved (no summary available)");
          }

          // Final wait to ensure all API calls complete
          console.log("⏳ Final wait for all uploads to complete...");
          await interviewerPage.waitForTimeout(15000);
          console.log("✅ All uploads should be complete now");

          // ASSERTION: Verify no error messages in UI
          const errorAlerts = interviewerPage.locator(
            '[data-testid="awsui-alert-error"], [data-alert-type="error"], .awsui-alert-type-error, [role="alert"]',
          );
          const errorCount = await errorAlerts.count();

          if (errorCount > 0) {
            console.error(`❌ Found ${errorCount} error alert(s) in UI`);
            // Log error messages for debugging
            for (let i = 0; i < errorCount; i++) {
              const errorText = await errorAlerts.nth(i).textContent();
              console.error(`   Error ${i + 1}: ${errorText}`);
            }
          }

          if (errorCount > 0) {
            throw new Error(
              `Expected no error alerts in UI, but found ${errorCount}. Check console logs above for details.`,
            );
          }
          console.log("✅ No error alerts found in UI");

          // ASSERTION: Check browser console for critical errors
          // Check for specific error patterns in collected browser errors
          const has500Error = browserErrors.some((err) => err.includes("500"));
          const hasUploadError = browserErrors.some(
            (err) =>
              err.includes("Failed to complete multipart upload") ||
              err.includes("multipart upload"),
          );

          if (has500Error || hasUploadError) {
            console.error("❌ Critical errors detected in browser console:");
            browserErrors
              .filter(
                (err) =>
                  err.includes("500") ||
                  err.includes("Failed to complete") ||
                  err.includes("multipart"),
              )
              .forEach((err) => console.error(`   ${err}`));
          } else {
            console.log(
              `✅ No critical upload errors (checked ${browserErrors.length} total browser errors)`,
            );
          }

          if (has500Error) {
            throw new Error(
              "HTTP 500 error detected during video upload. This indicates server-side failure in multipart upload completion.",
            );
          }
          if (hasUploadError) {
            throw new Error(
              "Video upload error detected. Video recording may not be properly saved to S3.",
            );
          }

          // ASSERTION: Verify save modal appeared with success state
          const saveModal = interviewerPage.locator('[role="dialog"]');
          const isSaveModalVisible = await saveModal.isVisible();
          if (!isSaveModalVisible) {
            throw new Error(
              "Save modal should be visible after ending interview",
            );
          }
          console.log("✅ Save modal is visible");

          // Check for success indicators in the save modal
          const successIndicators = interviewerPage.locator(
            "text=/saved successfully|success/i",
          );
          const hasSuccessMessage = (await successIndicators.count()) > 0;
          if (!hasSuccessMessage) {
            throw new Error("Expected success message after saving interview");
          }
          console.log("✅ Success message confirmed in save modal");
        });
      } finally {
        // Cleanup: Close pages, context, and browser
        if (jitsiPage) await jitsiPage.close();
        if (interviewerPage) await interviewerPage.close();
        if (browserContext) await browserContext.close();
        await browser.close();
        console.log("✅ Cleanup completed");
      }
    }); // End test()
  } // End for loop
}); // End test.describe()
