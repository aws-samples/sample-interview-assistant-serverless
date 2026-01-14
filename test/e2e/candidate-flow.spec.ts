import { test, expect } from "@playwright/test";
import { AuthHelper } from "./helpers/auth.helper";
import { InterviewHelper } from "./helpers/interview.helper";
import { scanTestScenarios, TestScenario } from "./helpers/test-data.helper";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

// Load test environment variables
// Load .env.test first (defaults), then .env.test.local (overrides)
dotenv.config({ path: ".env.test" });
dotenv.config({ path: ".env.test.local", override: true });

/**
 * Environment Variables:
 * - FRONTEND_URL: CloudFront distribution URL (REQUIRED)
 * - TEST_USER_EMAIL: Test user email for authentication (REQUIRED)
 * - TEST_USER_PASSWORD: Test user password for authentication (REQUIRED)
 * - INTERVIEW_MODE: Controls interview mode selection ('light' | 'smart', default: 'light')
 *   - 'light': Selects Light Mode (default)
 *   - 'smart': Selects Smart Mode
 * - TEST_DATA_ROOT: Root directory for test data (default: test-data/)
 */

// Test configuration
const TEST_CONFIG = {
  testDataRoot: process.env.TEST_DATA_ROOT || "test-data/",
  // Authentication is always required for serverless deployment
  testUserEmail: process.env.TEST_USER_EMAIL || "",
  testUserPassword: process.env.TEST_USER_PASSWORD || "",
  // Interview mode can be set per scenario via config.json
  // Falls back to environment variable or 'light' default
  interviewModeDefault: process.env.INTERVIEW_MODE?.toLowerCase() || "light",
};

// Scan test scenarios dynamically from test-data directory
// Tests will run if test scenarios are found, otherwise they will be skipped
// Only scan subdirectories prefixed with 'candidate_' for candidate experience tests
const testScenarios = scanTestScenarios(TEST_CONFIG.testDataRoot, "candidate_");

test.describe("Candidate Experience - End-to-End Flow with Dynamic Test Scenarios", () => {
  // Generate one test per scenario
  testScenarios.forEach((scenario: TestScenario) => {
    test.describe(`Scenario: ${scenario.name}`, () => {
      let authHelper: AuthHelper;
      let interviewHelper: InterviewHelper;

      test.beforeEach(async ({ page, context }) => {
        authHelper = new AuthHelper(page);
        interviewHelper = new InterviewHelper(page);

        // Grant microphone permissions for audio tests
        // Must include origin to ensure permissions are granted for the specific domain
        const baseURL = process.env.FRONTEND_URL || "http://localhost:3000";
        await context.grantPermissions(["microphone"], { origin: baseURL });
        console.log(`🎤 Granted microphone permissions for origin: ${baseURL}`);

        // Add network request logging for debugging
        page.on("requestfailed", (request) => {
          console.log(
            `❌ Failed request: ${request.url()} - ${request.failure()?.errorText}`,
          );
        });

        page.on("response", (response) => {
          if (response.url().includes("audio-processor")) {
            console.log(
              `📋 AudioWorklet response: ${response.url()} - Status: ${response.status()}`,
            );
          }
        });

        // Intercept audio-processor.js to ensure proper CORS headers
        await page.route("**/audio-processor.js", (route) => {
          console.log(`🔧 Intercepting audio-processor.js request`);
          route.continue({
            headers: {
              ...route.request().headers(),
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/javascript",
            },
          });
        });

        console.log(`Scenario: ${scenario.name}`);
        console.log(`Config: ${scenario.config}`);
        // Construct file paths from scenario config
        const cvPath = path.join(
          scenario.folderPath,
          scenario.config.cvFilename,
        );
        const jobDescPath = path.join(
          scenario.folderPath,
          scenario.config.jobDescriptionFilename,
        );

        // Verify test fixtures exist
        if (!fs.existsSync(cvPath)) {
          throw new Error(`CV fixture not found at: ${cvPath}`);
        }
        if (!fs.existsSync(jobDescPath)) {
          throw new Error(
            `Job description fixture not found at: ${jobDescPath}`,
          );
        }

        // Verify all audio files for this scenario exist
        for (const audioPath of scenario.audioFilePaths) {
          if (!fs.existsSync(audioPath)) {
            throw new Error(`Audio file not found at: ${audioPath}`);
          }
        }

        // Setup audio BEFORE any page navigation (must be done before page loads)
        await interviewHelper.setupMultipleAudioFiles(scenario.audioFilePaths);

        console.log(`✅ Scenario "${scenario.name}" loaded`);
        console.log(`   - Company: ${scenario.config.companyName}`);
        console.log(`   - Job Title: ${scenario.config.jobTitle}`);
        console.log(
          `   - Interview Mode: ${scenario.config.interviewMode || "light"}`,
        );
        console.log(`   - Audio files: ${scenario.audioFilePaths.length}`);
      });

      test("Complete practice interview flow - Start to Feedback", async ({
        page,
      }) => {
        const numCycles = scenario.audioFilePaths.length;
        test.setTimeout(600000 + numCycles * 180000); // Base 10 min + 3 min per cycle

        // Step 1: Authentication (required for serverless deployment)
        await test.step("User authenticates with Cognito", async () => {
          await authHelper.login(
            TEST_CONFIG.testUserEmail,
            TEST_CONFIG.testUserPassword,
          );

          // Verify successful authentication
          const isAuth = await authHelper.isAuthenticated();
          expect(isAuth).toBeTruthy();

          // Try to get user ID (optional - may not be visible in all UI variations)
          const userId = await authHelper.getUserId();
          if (userId) {
            console.log("User ID:", userId);
          } else {
            console.log("User ID not found in UI (this is okay)");
          }
        });

        // Step 2: Navigate to Prepare Interview
        await test.step("Navigate to Prepare Interview", async () => {
          // The navigation uses CloudScape SideNavigation component
          // Try multiple approaches to handle different DOM structures
          const navLink = page.getByRole("link", {
            name: /prepare interview/i,
          });

          // Wait for the link to be visible and clickable
          await navLink.waitFor({ state: "visible", timeout: 10000 });
          await navLink.click();

          // Wait for Prepare Interview page to load
          await expect(page).toHaveURL(/.*prepare/, { timeout: 10000 });
        });

        // Step 2b: Click New Interview Preparation button
        await test.step("Click New Interview Preparation", async () => {
          await page
            .getByRole("button", { name: /new interview preparation/i })
            .click();

          // Wait for interview creation form/modal to appear
          await page.waitForTimeout(1000);
        });

        // Step 3: Fill out interview preparation form
        await test.step("Fill out interview preparation form", async () => {
          const cvPath = path.join(
            scenario.folderPath,
            scenario.config.cvFilename,
          );
          const jobDescPath = path.join(
            scenario.folderPath,
            scenario.config.jobDescriptionFilename,
          );

          // Fill in Company Name
          await page
            .getByPlaceholder(/e\.g\., Google, Amazon/i)
            .fill(scenario.config.companyName);

          // Fill in Job Title
          await page
            .getByPlaceholder(/e\.g\., Senior Software Engineer/i)
            .fill(scenario.config.jobTitle);

          // Upload CV file
          const cvFileInput = page.locator('input[type="file"]').nth(0);
          await cvFileInput.setInputFiles(cvPath);
          await page.waitForTimeout(1000);

          // Upload Job Description file
          const jobDescFileInput = page.locator('input[type="file"]').nth(1);
          await jobDescFileInput.setInputFiles(jobDescPath);
          await page.waitForTimeout(1000);
        });

        // Step 4: Click AI Research & Generate Questions
        await test.step("Click AI Research & Generate Questions", async () => {
          await page
            .getByRole("button", { name: /ai research & generate questions/i })
            .click();

          // Wait for research and question generation to complete
          // Look for the success message: "Questions Generated Successfully!"
          console.log("⏳ Waiting for AI question generation to complete...");
          await expect(
            page.getByText(/questions generated successfully/i),
          ).toBeVisible({ timeout: 300000 }); // Max 5 minutes
          console.log("✅ Questions generated successfully!");
        });

        // Step 5a: Save preparation
        await test.step("Save interview preparation", async () => {
          await interviewHelper.savePreparation();
        });

        // Step 5b: Navigate to Live Practice
        await test.step("Navigate to Live Practice", async () => {
          await interviewHelper.startPracticeNow();
        });

        // Step 5c: Start practice session
        await test.step("Start practice session", async () => {
          await interviewHelper.startPracticeSession();
        });

        // Step 5d: Select preparation and start interview
        await test.step("Select preparation and begin interview", async () => {
          await interviewHelper.selectFirstPreparationAndContinue();
        });

        // Step 5e: Configure interview settings
        await test.step("Configure interview settings", async () => {
          const interviewMode = scenario.config.interviewMode || "light";
          await interviewHelper.configureInterviewSettings(
            interviewMode,
            true,
            true,
          );
        });

        // Step 5f: Start live practice session
        await test.step("Start live practice session", async () => {
          await interviewHelper.startLivePracticeSession();
        });

        // Step 6: Audio interaction - conduct cycles based on scenario audio files
        await test.step(`Conduct ${numCycles} question-answer cycles with audio`, async () => {
          console.log(`Starting playback of ${numCycles} audio files...`);

          // Setup audio completion listener
          interviewHelper.setupAudioCompletionListener();

          // Trigger audio playback - automatically detects if assistant speaks first
          const result = await interviewHelper.triggerAudioPlayback(
            numCycles,
            240000, // 240s max per audio file
          );

          if (result.success) {
            console.log(`✅ All audio files played successfully!`);
          } else {
            console.warn("⚠️ Audio playback did not complete successfully");
          }

          // Wait a moment for final responses to settle
          await page.waitForTimeout(3000);
        });

        // Step 7: Complete interview and get feedback
        await test.step("Complete interview and view feedback", async () => {
          // Extract session ID and prep ID from current URL BEFORE exiting
          const currentUrl = page.url();
          const sessionIdMatch = currentUrl.match(/session\/([^?&]+)/);
          const sessionId = sessionIdMatch ? sessionIdMatch[1] : null;

          if (sessionId) {
            console.log(`📋 Extracted session ID: ${sessionId}`);
          } else {
            console.warn("⚠️ Could not extract session ID from URL");
          }

          // Click Exit button to end the session
          const exitButton = page.getByRole("button", { name: /exit/i });
          await exitButton.click();

          // Wait for save session modal to appear and click save
          await page.waitForTimeout(1000);
          const saveButton = page.getByRole("button", {
            name: /save session/i,
          });

          if (
            await saveButton.isVisible({ timeout: 10000 }).catch(() => false)
          ) {
            await saveButton.click();
            console.log("✅ Clicked Save Session button");
          }

          // Wait for practice sessions page to load
          await page.waitForLoadState("networkidle", { timeout: 15000 });
          console.log("📋 Practice sessions page loaded");

          // Wait for the sessions table to be rendered by checking for table body rows
          // This is more reliable than waiting for a button that may not exist yet
          await page.waitForSelector("table tbody tr", { timeout: 60000 });
          console.log("✅ Practice Sessions table rows visible");

          // Now wait for "View Details" button to be visible (indicates sessions are fully loaded)
          await expect(
            page.getByRole("button", { name: /view details/i }).first(),
          ).toBeVisible({ timeout: 10000 });
          console.log("✅ View Details button visible");

          // Click "View Details" button for the first session in the table
          await page
            .getByRole("button", { name: /view details/i })
            .first()
            .click();
          console.log("✅ Clicked View Details button");

          // Wait for session details page to load
          await page.waitForURL(/.*\/view/, { timeout: 15000 });
          console.log("📋 Navigated to session details page");

          // Wait for page to fully load
          await page.waitForLoadState("networkidle", { timeout: 15000 });
          console.log("📋 Session details page fully loaded");

          // Wait for session data to load (spinner disappears and content appears)
          // Look for the Interview Feedback heading specifically to verify feedback is loaded
          await expect(
            page.getByRole("heading", {
              level: 2,
              name: /interview feedback/i,
            }),
          ).toBeVisible({ timeout: 30000 });
          console.log("📋 Session data loaded and Interview Feedback visible");

          // Check details on session detail page
          await interviewHelper.getFeedbackSummary();
        });
      });
    });
  });

  // Fallback: No test scenarios found
  if (testScenarios.length === 0) {
    test("No candidate test scenarios configured", async () => {
      test.skip(
        true,
        "No candidate test scenarios found in test-data directory. Please add test scenarios with 'candidate_' prefix or check TEST_DATA_ROOT configuration.",
      );
    });
  }
});
