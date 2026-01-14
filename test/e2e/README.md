# E2E Tests - Candidate Experience Flow

End-to-end tests for the **Candidate Experience** in the Interview Assistant application using Playwright.

**Note:** This test suite specifically covers the candidate's journey through interview preparation and practice sessions. It only processes test data directories prefixed with `candidate_`. For interviewer experience tests, see `interviewer-flow.spec.ts` (to be implemented).

## Overview

This test suite covers the complete candidate user journey from start through interview completion:

- ✅ User authentication (Cognito required)
- ✅ CV and job description upload
- ✅ Interview practice session start
- ✅ WebSocket connection establishment
- ✅ Audio interaction simulation
- ✅ Feedback retrieval

**Note:** Tests run against deployed serverless infrastructure only. You must deploy the application before running E2E tests.

## Prerequisites

1. **Node.js 22+** installed
2. **Playwright browsers** installed:
   ```bash
   npx playwright install
   ```
3. **Application deployed** to AWS using CDK:
   ```bash
   npm run cdk deploy "*/**"
   ```
4. **Test user created** in Cognito User Pool with valid credentials
5. **Test environment configured** (see Configuration section below)

## Configuration

### 1. Get Your CloudFront URL

After deploying the application, get your CloudFront distribution URL from the CDK output:

```bash
# Option 1: Look for the output after deployment
# InterviewAssistantStack.FrontendURL = https://d1234567890abc.cloudfront.net

# Option 2: Query CloudFormation stack outputs
aws cloudformation describe-stacks --stack-name InterviewAssistantStack \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendURL`].OutputValue' --output text

# Option 3: Check AWS Console
# CloudFormation > InterviewAssistantStack > Outputs > FrontendURL
```

### 2. Create `.env.test.local`

Copy `.env.test` to `.env.test.local` and configure:

```bash
cp .env.test .env.test.local
```

### 3. Update Environment Variables

Edit `.env.test.local` with your deployment details:

```bash
# Frontend CloudFront URL (REQUIRED)
FRONTEND_URL=https://d1234567890abc.cloudfront.net

# Test credentials (REQUIRED)
TEST_USER_EMAIL=your-test-user@example.com
TEST_USER_PASSWORD=YourSecurePassword123!

# Interview mode (optional - can be overridden per test scenario)
INTERVIEW_MODE=light

# Test data directory (optional)
TEST_DATA_ROOT=test_data/
```

**Important:**

- All tests require authentication - there is no localhost/local mode for the serverless architecture

## Test Structure

```
test/e2e/
├── README.md                           # This file
├── candidate-flow.spec.ts             # Candidate experience E2E test suite
├── interviewer-flow.spec.ts           # Interviewer experience E2E test suite (to be implemented)
├── helpers/
│   ├── auth.helper.ts                 # Authentication utilities
│   ├── interview.helper.ts            # Interview flow utilities (shared)
│   └── test-data.helper.ts            # Test data scanning with configurable prefix
```

## Test Data Organization

Test scenarios are organized in the `test-data/` directory with specific naming conventions:

- **Candidate tests** scan subdirectories prefixed with `candidate_` (e.g., `candidate_TechnicalInterview/`)
- **Interviewer tests** will scan subdirectories prefixed with `interviewer_` (e.g., `interviewer_ConductInterview/`)

Each test scenario directory should contain:

- `config.json` - Test configuration (company name, job title, interview mode, file names)
- CV file (e.g., `CV.pdf`)
- Job description file (e.g., `JobDescription.pdf`)
- Numerically-prefixed audio files (e.g., `1_response.wav`, `2_response.wav`, etc.)

## Running Tests

### All E2E Tests

```bash
npm run test:e2e
```

### Headed Mode (see browser)

```bash
npm run test:e2e:headed
```

### Debug Mode

```bash
npm run test:e2e:debug
```

### UI Mode (interactive)

```bash
npm run test:e2e:ui
```

### Specific Browser

```bash
npm run test:e2e:chromium
```

### Mobile Tests Only

```bash
npm run test:e2e:mobile
```

### View Test Report

```bash
npm run test:e2e:report
```

### Run Specific Test

```bash
# Run only candidate flow tests
npx playwright test candidate-flow

# Run a specific test scenario
npx playwright test --grep "Scenario: candidate_TechnicalInterview"

# Run the complete flow test
npx playwright test --grep "Complete practice interview flow - Start to Feedback"
```

## Test Scenarios

### 1. Complete Candidate Practice Interview Flow - Start to Feedback

**Description:** Full end-to-end candidate experience flow from authentication to post-interview feedback

**Test Data:** Scans all subdirectories in `test-data/` prefixed with `candidate_`

**Steps:**

1. Candidate authenticates
2. Navigates to Prepare Interview
3. Clicks "New Interview Preparation"
4. Provides CV PDF (from test scenario config)
5. Provides Job Description PDF (from test scenario config)
6. Clicks "AI Research & Generate Questions" and waits for completion
7. Saves interview preparation
8. Navigates to Live Practice
9. Starts practice session
10. Selects previously saved interview preparation
11. Configures interview settings (light/smart mode, save audio)
12. Starts live practice session
13. AI Interviewer conducts interview with pre-recorded audio responses (from test scenario audio files)
14. Candidate exits and saves the session
15. Views session details and feedback

**Expected Duration:** ~15 min (varies based on number of audio files in test scenario)

### 2. Complete Interviewer Experience Flow - Jitsi Meeting to Interview Session

**Description:** Full end-to-end interviewer experience flow with dual-context (Jitsi + Interviewer app)

**Test Data:** Scans all subdirectories in `test-data/` prefixed with `interviewer_`

**Technical Requirements:**

- **Chromium only** (uses Chromium-specific flags for automated screen sharing)
- **Headed mode required** (screen sharing doesn't work in headless mode)
- **Two browser contexts** (Jitsi meeting tab + Interviewer app tab)

**Steps:**

1. **Setup Jitsi Meeting (First Tab)**
   - Opens `https://moderated.jitsi.net/`
   - Clicks "Get me a moderated meeting!"
   - Clicks "Join as moderator"
   - Enters name "interviewer" and joins meeting

2. **Interviewer Authentication (Second Tab)**
   - Authenticates with Cognito
   - Navigates to Schedule Interview page

3. **Create Interview Schedule**
   - Fills interview name, date, and time
   - Uploads candidate CV PDF
   - Uploads Job Description PDF
   - Clicks "AI Research & Selected Questions"
   - Waits for interview plan generation (1-2 minutes)
   - Clicks "Save Interview Schedule"
   - Clicks "Proceed to Interview"

4. **Start Interview from List**
   - Navigates to InterviewerList page
   - Clicks "Start Interview" for newly created schedule

5. **Configure Live Interview**
   - Checks "Save video recording for playback" checkbox
   - Clicks "Start with Selected Interview"

6. **Screen Sharing (Automated with Chromium Flags)**
   - Browser triggers screen sharing dialog
   - Chromium flags auto-accept with system audio enabled
   - Selects Jitsi meeting tab for sharing
   - **Note:** If screen sharing dialog appears manually, the flags may not be working correctly

7. **Interview Session Active**
   - Waits for "Listening..." status indicator
   - Verifies transcription is working
   - Runs interview for 30 seconds to capture transcription

8. **End and Save Interview**
   - Clicks "End & Save Interview"
   - Saves interview session with AI analysis
   - Verifies interview summary is generated

**Expected Duration:** ~15-20 minutes

**Known Limitations:**

- Screen sharing automation only works reliably in Chromium
- If Chromium flags fail, test will pause at screen sharing dialog
- Jitsi meeting may require manual interaction if connection fails

## Performance Benchmarks

Expected test execution times for candidate experience tests:

| Test Suite                        | Duration |
| --------------------------------- | -------- |
| Complete Candidate Interview Flow | 15min    |

**Total Suite Runtime:** ~15 minutes per test scenario (serial execution)

**Note:** Actual duration varies based on:

- Number of audio files in the test scenario
- Interview mode (light vs smart)
- Network latency to AWS services

## Best Practices

1. **Use `data-testid` attributes** for stable selectors
2. **Keep tests independent** - each test should be self-contained
3. **Use helper functions** to reduce duplication
4. **Add meaningful assertions** - verify state changes
5. **Handle async operations** properly with `waitFor` methods
6. **Clean up after tests** - logout, clear state
7. **Use fixtures** for test data
8. **Document new tests** with clear descriptions

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Tests](https://playwright.dev/docs/debug)
- [CI/CD Integration](https://playwright.dev/docs/ci)
