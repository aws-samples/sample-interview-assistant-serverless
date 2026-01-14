import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.test" });
dotenv.config({ path: ".env.test.local", override: true });

/**
 * Playwright configuration for Interview Assistant E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./test/e2e",

  /* Run tests in files in parallel */
  fullyParallel: false,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use */
  reporter: [
    ["html"],
    ["list"],
    ["json", { outputFile: "test-results/results.json" }],
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    // REQUIRED: Set FRONTEND_URL in .env.test.local to your CloudFront distribution URL
    // Example: FRONTEND_URL=https://d1234567890abc.cloudfront.net
    baseURL: process.env.FRONTEND_URL,

    /* Collect trace when retrying the failed test */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video on failure */
    video: "retain-on-failure",

    /* Maximum time each action can take */
    actionTimeout: 15000,

    /* Maximum time for navigation */
    navigationTimeout: 30000,

    /* Grant microphone permissions for audio tests */
    permissions: ["microphone"],

    /* Bypass Content Security Policy for AudioWorklet loading */
    bypassCSP: true,

    /* Set Origin header to match the CloudFront domain for AudioWorklet loading */
    extraHTTPHeaders: {
      Origin: process.env.FRONTEND_URL || "http://localhost:3000",
    },

    /* Use fake media devices for microphone testing */
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },

  /* Configure timeout */
  timeout: 60000,
  expect: {
    timeout: 10000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    // {
    //     name: 'firefox',
    //     use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //     name: 'webkit',
    //     use: { ...devices['Desktop Safari'] },
    // },

    // /* Test against mobile viewports */
    // {
    //     name: 'Mobile Chrome',
    //     use: { ...devices['Pixel 5'] },
    // },
    // {
    //     name: 'Mobile Safari',
    //     use: { ...devices['iPhone 12'] },
    // },
  ],

  /*
   * NOTE: Tests run against deployed infrastructure only
   * Local development servers are not supported in the serverless architecture
   * You must deploy the application first using: npm run cdk deploy "*\/**"
   * Then configure FRONTEND_URL in .env.test.local with your CloudFront URL
   */
});
