# Test Directory

Centralized location for all project tests.

## Structure

```
test/
├── backend/          # Backend unit tests (pytest)
│   ├── README.md                              # Backend test documentation
│   ├── test_interview_question_model.py       # Data model tests
│   ├── test_question_progression_logic.py     # Progression logic tests
│   ├── test_ai_agent_progression.py           # AI agent tests
│   ├── test_websocket_events.py               # WebSocket event tests
│   └── test_progression_persistence.py        # API and storage tests
├── e2e/              # End-to-end tests (Playwright)
│   ├── README.md              # E2E test documentation
│   ├── candidate-flow.spec.ts # Candidate experience E2E tests
│   ├── interviewer-flow.spec.ts # Interviewer experience E2E tests (to be implemented)
│   └── helpers/               # Test helper utilities
│       ├── auth.helper.ts
│       ├── interview.helper.ts
│       └── test-data.helper.ts  # Test data scanning with configurable prefix
├── venv/             # Shared virtual environment (gitignored)
├── .gitignore        # Test-specific gitignore
└── README.md         # This file
```

## Setup

### 1. Create Virtual Environment

```bash
cd test
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r ../lib/stacks/backend/lambda-rest-api/app/requirements.txt
```

## Running Tests

### End-to-End Tests (Playwright)

E2E tests validate the complete user journey against deployed infrastructure.

**Test Organization:**

- **Candidate Experience Tests** (`candidate-flow.spec.ts`) - Tests the candidate's journey through interview preparation and practice sessions
  - Scans test data directories prefixed with `candidate_`
- **Interviewer Experience Tests** (`interviewer-flow.spec.ts`) - Tests the interviewer's journey (to be implemented)
  - Will scan test data directories prefixed with `interviewer_`

**Test Data Organization:**

Test scenarios are organized in the `test-data/` directory:

- `candidate_*` folders - Candidate experience test scenarios (e.g., `candidate_TechnicalInterview/`)
- `interviewer_*` folders - Interviewer experience test scenarios (future)

Each test scenario directory contains:

- `config.json` - Test configuration (company name, job title, interview mode, file names)
- CV and Job Description files (PDFs)
- Numerically-prefixed audio files (e.g., `1_response.wav`, `2_response.wav`)

**Prerequisites:**

- Application deployed to AWS
- Test environment configured (see [e2e/README.md](e2e/README.md))

**Quick Start:**

```bash
# Install Playwright browsers (first time only)
npx playwright install

# Configure test environment
cp ../.env.test ../.env.test.local
# Edit .env.test.local with your CloudFront URL and test credentials

# Run all E2E tests
npm run test:e2e

# Run only candidate experience tests
npx playwright test candidate-flow

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run specific test scenario
npx playwright test --grep "Scenario: candidate_TechnicalInterview"
```

**Note:** E2E tests run against deployed serverless infrastructure only.

See [e2e/README.md](e2e/README.md) for detailed configuration, test scenarios, and troubleshooting.

### Backend Unit Tests (pytest)

Backend unit tests validate the question progression tracking feature implementation.

**Test Coverage:**

- Data models (InterviewQuestion with progression fields)
- Progression detection logic and confidence thresholds
- AI agent analysis and decision-making
- WebSocket event generation
- API payload handling and DynamoDB persistence

**Quick Start:**

```bash
cd test
source venv/bin/activate
pip install pytest

# Run all backend tests
python -m pytest backend/ -v

# Run specific test file
python -m pytest backend/test_interview_question_model.py -v

# Run with coverage
pip install pytest-cov
python -m pytest backend/ --cov=backend --cov-report=html -v
```

**Test Suite:**

- `test_interview_question_model.py` - 18 tests for data model validation
- `test_question_progression_logic.py` - 12 tests for progression logic
- `test_ai_agent_progression.py` - 15 tests for AI analysis
- `test_websocket_events.py` - 15 tests for event generation
- `test_progression_persistence.py` - 13 tests for persistence

**Total: 73 tests**

See [backend/README.md](backend/README.md) for detailed documentation, test descriptions, and examples.

## Writing New Tests

### Backend Unit Tests

Create test files in `test/backend/` with the naming convention `test_*.py`.

**Import Setup:**

```python
import sys
from pathlib import Path

# Add Lambda app directory to path
project_root = Path(__file__).parent.parent.parent
lambda_app_path = project_root / "lib" / "stacks" / "backend" / "lambda-rest-api" / "app"
sys.path.insert(0, str(lambda_app_path))

# Now you can import Lambda modules
from interviewer_planner_service import InterviewerPlannerService
```

### Environment Variables

Set required environment variables at the beginning of your test:

```python
import os

os.environ['KNOWLEDGE_BASE_ID'] = 'YOUR_KB_ID'
os.environ['AWS_REGION'] = 'us-east-1'
```

### Guidelines

1. **Use async/await** for tests that involve async Lambda functions
2. **Mock external services** when appropriate (S3, DynamoDB, Bedrock)
3. **Use descriptive test names** that explain what is being tested
4. **Add logging** to help debug test failures
5. **Keep tests independent** - each test should be able to run standalone

### CI/CD Integration

Tests can be integrated into CI/CD pipelines:

```bash
# Run all backend tests
cd test
source venv/bin/activate
python -m pytest backend/ -v

# Run specific test
python -m pytest backend/test_kb_query.py -v
```

### Notes

- The `venv/` directory is gitignored
- Tests use the same dependencies as the Lambda functions
- Import paths are set up to reference Lambda app code without modification
