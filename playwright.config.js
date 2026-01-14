"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const dotenv = __importStar(require("dotenv"));
// Load environment variables
dotenv.config({ path: ".env.test" });
dotenv.config({ path: ".env.test.local", override: true });
/**
 * Playwright configuration for Interview Assistant E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
exports.default = (0, test_1.defineConfig)({
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
            use: { ...test_1.devices["Desktop Chrome"] },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxheXdyaWdodC5jb25maWcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwbGF5d3JpZ2h0LmNvbmZpZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDJDQUF5RDtBQUN6RCwrQ0FBaUM7QUFFakMsNkJBQTZCO0FBQzdCLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNyQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxFQUFFLGlCQUFpQixFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBRTNEOzs7R0FHRztBQUNILGtCQUFlLElBQUEsbUJBQVksRUFBQztJQUMxQixPQUFPLEVBQUUsWUFBWTtJQUVyQixvQ0FBb0M7SUFDcEMsYUFBYSxFQUFFLEtBQUs7SUFFcEIsZ0ZBQWdGO0lBQ2hGLFVBQVUsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO0lBRTVCLHNCQUFzQjtJQUN0QixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUUvQixxQ0FBcUM7SUFDckMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7SUFFdkMscUJBQXFCO0lBQ3JCLFFBQVEsRUFBRTtRQUNSLENBQUMsTUFBTSxDQUFDO1FBQ1IsQ0FBQyxNQUFNLENBQUM7UUFDUixDQUFDLE1BQU0sRUFBRSxFQUFFLFVBQVUsRUFBRSwyQkFBMkIsRUFBRSxDQUFDO0tBQ3REO0lBRUQsZ0RBQWdEO0lBQ2hELEdBQUcsRUFBRTtRQUNILDREQUE0RDtRQUM1RCxvRkFBb0Y7UUFDcEYsOERBQThEO1FBQzlELE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVk7UUFFakMsaURBQWlEO1FBQ2pELEtBQUssRUFBRSxnQkFBZ0I7UUFFdkIsMkJBQTJCO1FBQzNCLFVBQVUsRUFBRSxpQkFBaUI7UUFFN0Isc0JBQXNCO1FBQ3RCLEtBQUssRUFBRSxtQkFBbUI7UUFFMUIsdUNBQXVDO1FBQ3ZDLGFBQWEsRUFBRSxLQUFLO1FBRXBCLGlDQUFpQztRQUNqQyxpQkFBaUIsRUFBRSxLQUFLO1FBRXhCLGtEQUFrRDtRQUNsRCxXQUFXLEVBQUUsQ0FBQyxZQUFZLENBQUM7UUFFM0IsNkRBQTZEO1FBQzdELFNBQVMsRUFBRSxJQUFJO1FBRWYsK0VBQStFO1FBQy9FLGdCQUFnQixFQUFFO1lBQ2hCLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksSUFBSSx1QkFBdUI7U0FDNUQ7UUFFRCxtREFBbUQ7UUFDbkQsYUFBYSxFQUFFO1lBQ2IsSUFBSSxFQUFFO2dCQUNKLGdDQUFnQztnQkFDaEMsb0NBQW9DO2FBQ3JDO1NBQ0Y7S0FDRjtJQUVELHVCQUF1QjtJQUN2QixPQUFPLEVBQUUsS0FBSztJQUNkLE1BQU0sRUFBRTtRQUNOLE9BQU8sRUFBRSxLQUFLO0tBQ2Y7SUFFRCwyQ0FBMkM7SUFDM0MsUUFBUSxFQUFFO1FBQ1I7WUFDRSxJQUFJLEVBQUUsVUFBVTtZQUNoQixHQUFHLEVBQUUsRUFBRSxHQUFHLGNBQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFO1NBQ3RDO1FBRUQsSUFBSTtRQUNKLHVCQUF1QjtRQUN2Qiw4Q0FBOEM7UUFDOUMsS0FBSztRQUVMLElBQUk7UUFDSixzQkFBc0I7UUFDdEIsNkNBQTZDO1FBQzdDLEtBQUs7UUFFTCxzQ0FBc0M7UUFDdEMsSUFBSTtRQUNKLDZCQUE2QjtRQUM3QixzQ0FBc0M7UUFDdEMsS0FBSztRQUNMLElBQUk7UUFDSiw2QkFBNkI7UUFDN0Isd0NBQXdDO1FBQ3hDLEtBQUs7S0FDTjtJQUVEOzs7OztPQUtHO0NBQ0osQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBkZXZpY2VzIH0gZnJvbSBcIkBwbGF5d3JpZ2h0L3Rlc3RcIjtcbmltcG9ydCAqIGFzIGRvdGVudiBmcm9tIFwiZG90ZW52XCI7XG5cbi8vIExvYWQgZW52aXJvbm1lbnQgdmFyaWFibGVzXG5kb3RlbnYuY29uZmlnKHsgcGF0aDogXCIuZW52LnRlc3RcIiB9KTtcbmRvdGVudi5jb25maWcoeyBwYXRoOiBcIi5lbnYudGVzdC5sb2NhbFwiLCBvdmVycmlkZTogdHJ1ZSB9KTtcblxuLyoqXG4gKiBQbGF5d3JpZ2h0IGNvbmZpZ3VyYXRpb24gZm9yIEludGVydmlldyBBc3Npc3RhbnQgRTJFIHRlc3RzXG4gKiBAc2VlIGh0dHBzOi8vcGxheXdyaWdodC5kZXYvZG9jcy90ZXN0LWNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgdGVzdERpcjogXCIuL3Rlc3QvZTJlXCIsXG5cbiAgLyogUnVuIHRlc3RzIGluIGZpbGVzIGluIHBhcmFsbGVsICovXG4gIGZ1bGx5UGFyYWxsZWw6IGZhbHNlLFxuXG4gIC8qIEZhaWwgdGhlIGJ1aWxkIG9uIENJIGlmIHlvdSBhY2NpZGVudGFsbHkgbGVmdCB0ZXN0Lm9ubHkgaW4gdGhlIHNvdXJjZSBjb2RlICovXG4gIGZvcmJpZE9ubHk6ICEhcHJvY2Vzcy5lbnYuQ0ksXG5cbiAgLyogUmV0cnkgb24gQ0kgb25seSAqL1xuICByZXRyaWVzOiBwcm9jZXNzLmVudi5DSSA/IDEgOiAwLFxuXG4gIC8qIE9wdCBvdXQgb2YgcGFyYWxsZWwgdGVzdHMgb24gQ0kgKi9cbiAgd29ya2VyczogcHJvY2Vzcy5lbnYuQ0kgPyAxIDogdW5kZWZpbmVkLFxuXG4gIC8qIFJlcG9ydGVyIHRvIHVzZSAqL1xuICByZXBvcnRlcjogW1xuICAgIFtcImh0bWxcIl0sXG4gICAgW1wibGlzdFwiXSxcbiAgICBbXCJqc29uXCIsIHsgb3V0cHV0RmlsZTogXCJ0ZXN0LXJlc3VsdHMvcmVzdWx0cy5qc29uXCIgfV0sXG4gIF0sXG5cbiAgLyogU2hhcmVkIHNldHRpbmdzIGZvciBhbGwgdGhlIHByb2plY3RzIGJlbG93ICovXG4gIHVzZToge1xuICAgIC8qIEJhc2UgVVJMIHRvIHVzZSBpbiBhY3Rpb25zIGxpa2UgYGF3YWl0IHBhZ2UuZ290bygnLycpYCAqL1xuICAgIC8vIFJFUVVJUkVEOiBTZXQgRlJPTlRFTkRfVVJMIGluIC5lbnYudGVzdC5sb2NhbCB0byB5b3VyIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIFVSTFxuICAgIC8vIEV4YW1wbGU6IEZST05URU5EX1VSTD1odHRwczovL2QxMjM0NTY3ODkwYWJjLmNsb3VkZnJvbnQubmV0XG4gICAgYmFzZVVSTDogcHJvY2Vzcy5lbnYuRlJPTlRFTkRfVVJMLFxuXG4gICAgLyogQ29sbGVjdCB0cmFjZSB3aGVuIHJldHJ5aW5nIHRoZSBmYWlsZWQgdGVzdCAqL1xuICAgIHRyYWNlOiBcIm9uLWZpcnN0LXJldHJ5XCIsXG5cbiAgICAvKiBTY3JlZW5zaG90IG9uIGZhaWx1cmUgKi9cbiAgICBzY3JlZW5zaG90OiBcIm9ubHktb24tZmFpbHVyZVwiLFxuXG4gICAgLyogVmlkZW8gb24gZmFpbHVyZSAqL1xuICAgIHZpZGVvOiBcInJldGFpbi1vbi1mYWlsdXJlXCIsXG5cbiAgICAvKiBNYXhpbXVtIHRpbWUgZWFjaCBhY3Rpb24gY2FuIHRha2UgKi9cbiAgICBhY3Rpb25UaW1lb3V0OiAxNTAwMCxcblxuICAgIC8qIE1heGltdW0gdGltZSBmb3IgbmF2aWdhdGlvbiAqL1xuICAgIG5hdmlnYXRpb25UaW1lb3V0OiAzMDAwMCxcblxuICAgIC8qIEdyYW50IG1pY3JvcGhvbmUgcGVybWlzc2lvbnMgZm9yIGF1ZGlvIHRlc3RzICovXG4gICAgcGVybWlzc2lvbnM6IFtcIm1pY3JvcGhvbmVcIl0sXG5cbiAgICAvKiBCeXBhc3MgQ29udGVudCBTZWN1cml0eSBQb2xpY3kgZm9yIEF1ZGlvV29ya2xldCBsb2FkaW5nICovXG4gICAgYnlwYXNzQ1NQOiB0cnVlLFxuXG4gICAgLyogU2V0IE9yaWdpbiBoZWFkZXIgdG8gbWF0Y2ggdGhlIENsb3VkRnJvbnQgZG9tYWluIGZvciBBdWRpb1dvcmtsZXQgbG9hZGluZyAqL1xuICAgIGV4dHJhSFRUUEhlYWRlcnM6IHtcbiAgICAgIE9yaWdpbjogcHJvY2Vzcy5lbnYuRlJPTlRFTkRfVVJMIHx8IFwiaHR0cDovL2xvY2FsaG9zdDozMDAwXCIsXG4gICAgfSxcblxuICAgIC8qIFVzZSBmYWtlIG1lZGlhIGRldmljZXMgZm9yIG1pY3JvcGhvbmUgdGVzdGluZyAqL1xuICAgIGxhdW5jaE9wdGlvbnM6IHtcbiAgICAgIGFyZ3M6IFtcbiAgICAgICAgXCItLXVzZS1mYWtlLXVpLWZvci1tZWRpYS1zdHJlYW1cIixcbiAgICAgICAgXCItLXVzZS1mYWtlLWRldmljZS1mb3ItbWVkaWEtc3RyZWFtXCIsXG4gICAgICBdLFxuICAgIH0sXG4gIH0sXG5cbiAgLyogQ29uZmlndXJlIHRpbWVvdXQgKi9cbiAgdGltZW91dDogNjAwMDAsXG4gIGV4cGVjdDoge1xuICAgIHRpbWVvdXQ6IDEwMDAwLFxuICB9LFxuXG4gIC8qIENvbmZpZ3VyZSBwcm9qZWN0cyBmb3IgbWFqb3IgYnJvd3NlcnMgKi9cbiAgcHJvamVjdHM6IFtcbiAgICB7XG4gICAgICBuYW1lOiBcImNocm9taXVtXCIsXG4gICAgICB1c2U6IHsgLi4uZGV2aWNlc1tcIkRlc2t0b3AgQ2hyb21lXCJdIH0sXG4gICAgfSxcblxuICAgIC8vIHtcbiAgICAvLyAgICAgbmFtZTogJ2ZpcmVmb3gnLFxuICAgIC8vICAgICB1c2U6IHsgLi4uZGV2aWNlc1snRGVza3RvcCBGaXJlZm94J10gfSxcbiAgICAvLyB9LFxuXG4gICAgLy8ge1xuICAgIC8vICAgICBuYW1lOiAnd2Via2l0JyxcbiAgICAvLyAgICAgdXNlOiB7IC4uLmRldmljZXNbJ0Rlc2t0b3AgU2FmYXJpJ10gfSxcbiAgICAvLyB9LFxuXG4gICAgLy8gLyogVGVzdCBhZ2FpbnN0IG1vYmlsZSB2aWV3cG9ydHMgKi9cbiAgICAvLyB7XG4gICAgLy8gICAgIG5hbWU6ICdNb2JpbGUgQ2hyb21lJyxcbiAgICAvLyAgICAgdXNlOiB7IC4uLmRldmljZXNbJ1BpeGVsIDUnXSB9LFxuICAgIC8vIH0sXG4gICAgLy8ge1xuICAgIC8vICAgICBuYW1lOiAnTW9iaWxlIFNhZmFyaScsXG4gICAgLy8gICAgIHVzZTogeyAuLi5kZXZpY2VzWydpUGhvbmUgMTInXSB9LFxuICAgIC8vIH0sXG4gIF0sXG5cbiAgLypcbiAgICogTk9URTogVGVzdHMgcnVuIGFnYWluc3QgZGVwbG95ZWQgaW5mcmFzdHJ1Y3R1cmUgb25seVxuICAgKiBMb2NhbCBkZXZlbG9wbWVudCBzZXJ2ZXJzIGFyZSBub3Qgc3VwcG9ydGVkIGluIHRoZSBzZXJ2ZXJsZXNzIGFyY2hpdGVjdHVyZVxuICAgKiBZb3UgbXVzdCBkZXBsb3kgdGhlIGFwcGxpY2F0aW9uIGZpcnN0IHVzaW5nOiBucG0gcnVuIGNkayBkZXBsb3kgXCIqXFwvKipcIlxuICAgKiBUaGVuIGNvbmZpZ3VyZSBGUk9OVEVORF9VUkwgaW4gLmVudi50ZXN0LmxvY2FsIHdpdGggeW91ciBDbG91ZEZyb250IFVSTFxuICAgKi9cbn0pO1xuIl19