# Backend Unit Tests

Comprehensive test suite for the Interview Assistant backend, covering both interviewer and candidate experiences.

## Overview

This test suite validates the backend implementation across two main areas:

### Interviewer Experience (Question Progression Tracking)

- **Data Models:** InterviewQuestion model with progression tracking fields
- **AI Logic:** Question progression detection and confidence thresholds
- **WebSocket Events:** Real-time progression event generation
- **Persistence:** API payload handling and DynamoDB storage

### Candidate Experience (Interview Preparation)

- **Data Models:** InterviewPlan with expectedAnswer fields for candidates
- **API Endpoints:** Candidate API request/response validation
- **Planning Service:** Resume/JD summarization and question generation
- **Practice Sessions:** Audio/video recording and transcription management

## Test Structure

```
test/backend/
├── README.md                                      # This file
│
├── Interviewer Experience Tests (102 tests)
│   │
│   ├── Live Interview Tests (65 tests)
│   │   ├── test_interview_question_model.py       # 12 tests - Data model validation
│   │   ├── test_question_progression_logic.py     # 13 tests - Progression detection logic
│   │   ├── test_ai_agent_progression.py           # 15 tests - AI agent analysis
│   │   ├── test_websocket_events.py               # 13 tests - WebSocket event generation
│   │   └── test_progression_persistence.py        # 12 tests - API and storage persistence
│   │
│   └── Interview Management Tests (37 tests)
│       ├── test_interviewer_api_endpoints.py      # 17 tests - API endpoint validation
│       ├── test_interviewer_session_management.py # 11 tests - Session CRUD operations
│       └── test_interviewer_plan_generation.py    #  9 tests - Plan generation logic
│
└── Candidate Experience Tests (70 tests)
    ├── test_candidate_interview_plan_model.py     # 10 tests - Candidate plan data models
    ├── test_candidate_planner_service.py          # 19 tests - Candidate planner logic
    ├── test_candidate_api_endpoints.py            # 20 tests - API endpoint validation
    └── test_candidate_practice_session.py         # 21 tests - Practice session management
```

**Total: 172 tests**

## Setup

### 1. Create Virtual Environment

```bash
cd test
python3 -m venv venv
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate     # On Windows
```

### 2. Install Dependencies

```bash
pip install pytest
pip install -r ../lib/stacks/backend/lambda-rest-api/app/requirements.txt
```

## Running Tests

### Run All Backend Tests

```bash
cd test
source venv/bin/activate
python -m pytest backend/ -v
```

### Run Specific Test File

```bash
# Interviewer Experience Tests
python -m pytest backend/test_interview_question_model.py -v
python -m pytest backend/test_question_progression_logic.py -v
python -m pytest backend/test_ai_agent_progression.py -v
python -m pytest backend/test_websocket_events.py -v
python -m pytest backend/test_progression_persistence.py -v

# Candidate Experience Tests
python -m pytest backend/test_candidate_interview_plan_model.py -v
python -m pytest backend/test_candidate_planner_service.py -v
python -m pytest backend/test_candidate_api_endpoints.py -v
python -m pytest backend/test_candidate_practice_session.py -v

# Run only interviewer tests
python -m pytest backend/test_interview_*.py backend/test_question_*.py backend/test_ai_agent_*.py backend/test_websocket_*.py backend/test_progression_*.py -v

# Run only candidate tests
python -m pytest backend/test_candidate_*.py -v
```

### Run Specific Test Function

```bash
python -m pytest backend/test_interview_question_model.py::TestInterviewQuestionModel::test_default_initialization -v
```

### Run with Coverage

```bash
pip install pytest-cov
python -m pytest backend/ --cov=backend --cov-report=html -v
```

## Test Coverage

### test_interview_question_model.py (18 tests)

Validates the `InterviewQuestion` Pydantic model with progression tracking fields:

- ✅ Default field initialization
- ✅ Status values (not_started, in_progress, completed)
- ✅ Timestamp fields (startTime, endTime in milliseconds)
- ✅ Sequence ordering (sequenceOrder as 0-indexed position)
- ✅ JSON serialization/deserialization
- ✅ Backwards compatibility with old questions
- ✅ Field validation and constraints

**Key Tests:**

- `test_default_initialization` - Verifies default status="not_started"
- `test_json_serialization` - Ensures proper JSON format
- `test_backwards_compatibility` - Old questions still work

### test_question_progression_logic.py (12 tests)

Tests the core progression detection logic and decision rules:

- ✅ Confidence threshold (0.65) validation
- ✅ Next question detection for questions 1 through N-1
- ✅ Last question completion detection
- ✅ Follow-up question handling (should NOT trigger progression)
- ✅ Transition phrase detection
- ✅ Boundary conditions and edge cases

**Key Tests:**

- `test_confidence_threshold` - Validates 0.65 threshold
- `test_should_advance_next_question_started` - Tests advancement logic
- `test_follow_up_question_detection` - Prevents false positives

### test_ai_agent_progression.py (15 tests)

Validates the AI agent's `analyze_question_progression` function:

- ✅ JSON response format validation
- ✅ Error handling and fallback behavior
- ✅ Speaker label parsing (`[Speaker spk_0]:` format)
- ✅ Category context for topic shift detection
- ✅ Confidence score ranges and scenarios
- ✅ Transition phrase and rephrasing detection

**Key Tests:**

- `test_valid_json_response_format` - Required fields present
- `test_speaker_label_format` - Speaker identification
- `test_confidence_score_ranges` - Various confidence scenarios

### test_websocket_events.py (15 tests)

Tests WebSocket `questionProgression` event generation:

- ✅ Event structure and payload format
- ✅ Question ID generation (q0, q1, q2...)
- ✅ 0-indexed question indices
- ✅ Status transitions in events
- ✅ Timestamp format (milliseconds since epoch)
- ✅ Event sequence ordering

**Key Tests:**

- `test_question_progression_event_structure` - Complete event format
- `test_question_id_generation` - ID format (q{index})
- `test_event_json_serialization` - JSON compatibility

### test_progression_persistence.py (13 tests)

Tests API payload handling and DynamoDB persistence:

- ✅ Frontend save payload structure
- ✅ API form data parameters
- ✅ JSON parsing and serialization
- ✅ DynamoDB metadata structure
- ✅ Time calculation and coverage percentage
- ✅ Backwards compatibility with old sessions

**Key Tests:**

- `test_frontend_save_payload_structure` - Payload format
- `test_dynamodb_metadata_structure` - Storage format
- `test_backwards_compatibility_no_progression_data` - Old sessions

---

## Candidate Experience Tests

### test_candidate_interview_plan_model.py (10 tests)

Validates candidate-specific data models with `expectedAnswer` fields:

- ✅ InterviewQuestion with expectedAnswer for candidate prep
- ✅ STAR format behavioral question answers
- ✅ Company-specific questions with research context
- ✅ InterviewPlan with preparation tips
- ✅ CompanyResearch model structure
- ✅ Complete candidate plan integration

**Key Tests:**

- `test_candidate_question_with_expected_answer` - Expected answers for candidates
- `test_behavioral_question_with_star_format` - STAR format guidance
- `test_complete_candidate_plan` - Full preparation plan validation

### test_candidate_planner_service.py (19 tests)

Tests CandidatePlannerService logic and AI-powered plan generation:

- ✅ Resume summarization output format
- ✅ Job description summarization
- ✅ Company research data structure
- ✅ Question generation with expectedAnswer
- ✅ Preparation tips generation
- ✅ Question count and difficulty validation
- ✅ STAR format for behavioral questions
- ✅ Technical question depth by difficulty
- ✅ Custom questions from CSV integration
- ✅ Error handling and fallbacks

**Key Tests:**

- `test_question_generation_with_expected_answers` - Questions include answers
- `test_expected_answer_star_format` - Behavioral answers use STAR
- `test_asynchronous_plan_generation_flow` - Async job processing

### test_candidate_api_endpoints.py (20 tests)

Validates candidate API request/response formats:

- ✅ `/scrape-jd` and `/scrape-resume` endpoints
- ✅ `/generate-interview-plan` multipart form data
- ✅ Asynchronous plan generation with job ID
- ✅ `/plans/{plan_id}` polling for status
- ✅ `/save-interview-plan` persistence
- ✅ `/interview-plans` list and detail endpoints
- ✅ `/practice-sessions` CRUD operations
- ✅ Video/audio multipart upload endpoints
- ✅ Authentication and error handling
- ✅ Request validation and filtering

**Key Tests:**

- `test_generate_interview_plan_response_immediate` - Returns job ID immediately
- `test_plans_polling_endpoint` - Status polling flow
- `test_video_upload_endpoints` - Multipart upload flow

### test_candidate_practice_session.py (21 tests)

Tests practice session management and media handling:

- ✅ Practice session data structure
- ✅ Transcription entry format
- ✅ Complete conversation transcriptions
- ✅ Session metadata and duration tracking
- ✅ Audio/video S3 key formatting
- ✅ Multipart upload initialization and tracking
- ✅ Session status lifecycle
- ✅ Session-to-plan associations
- ✅ Presigned URL generation
- ✅ Video frame capture for thumbnails
- ✅ Session analytics aggregation

**Key Tests:**

- `test_complete_transcription_conversation` - Alternating speakers
- `test_multipart_upload_initiation` - Large file upload flow
- `test_session_analytics_aggregation` - Cross-session analytics

---

## Interviewer Management Tests

### test_interviewer_api_endpoints.py (17 tests)

Validates interviewer API endpoints for scheduling and session management:

- ✅ `/schedule-interview` POST request/response
- ✅ Scheduling with AI-generated or CSV questions
- ✅ `/scheduled-interviews` list and detail endpoints
- ✅ `/scheduled-interviews/{id}` DELETE operation
- ✅ `/interview-sessions` CRUD operations
- ✅ Session with questionStatuses persistence
- ✅ `/plans/{plan_id}` polling for status
- ✅ `/mark-schedule-saved/{plan_id}` marking
- ✅ Video upload endpoints for sessions
- ✅ Authentication and validation
- ✅ Date/time format validation

**Key Tests:**

- `test_schedule_interview_request` - Interview scheduling payload
- `test_create_interview_session_request` - Session with progression data
- `test_plans_polling_endpoint` - Async plan polling

### test_interviewer_session_management.py (11 tests)

Tests interviewer session management with question progression:

- ✅ Session data structure with questionStatuses
- ✅ Question progression tracking persistence
- ✅ Question coverage calculation
- ✅ Transcription with speaker roles (interviewer/candidate)
- ✅ Session metadata including progression data
- ✅ Session-to-interview associations
- ✅ Session filtering and deletion
- ✅ Question time tracking

**Key Tests:**

- `test_question_statuses_persistence` - QuestionStatuses storage format
- `test_session_with_question_progression_data` - Complete progression data
- `test_calculate_question_coverage` - Coverage percentage calculation

### test_interviewer_plan_generation.py (9 tests)

Tests interviewer interview plan generation:

- ✅ Interviewer plan structure with scheduling
- ✅ Questions with evaluationChecklist (not expectedAnswer)
- ✅ Async plan generation flow
- ✅ CSV question import
- ✅ Resume/JD summarization for interviewer context
- ✅ Question sequencing
- ✅ Scheduled date/time format
- ✅ Plan status options

**Key Tests:**

- `test_interviewer_question_with_evaluation_criteria` - Questions have checklists
- `test_csv_question_import` - Manual question upload
- `test_plan_generation_async_flow` - Async job processing

## Test Data Examples

### Sample Question with Progression Data

```python
{
    "questionText": "What is your experience with Python?",
    "category": "Technical Skills",
    "focus": "Programming Languages",
    "status": "completed",
    "startTime": 1704412800000,  # Milliseconds since epoch
    "endTime": 1704413100000,    # 5 minutes later
    "sequenceOrder": 0
}
```

### Sample WebSocket Event

```json
{
  "event": {
    "questionProgression": {
      "questionId": "q3",
      "questionIndex": 3,
      "status": "in_progress",
      "timestamp": 1704413400000,
      "totalQuestions": 8
    }
  }
}
```

### Sample Metadata for DynamoDB

```python
{
    "interviewId": "interview-123",
    "questionStatuses": {
        "q0": {"status": "completed", "startTime": 1704412800000, "endTime": 1704413100000},
        "q1": {"status": "in_progress", "startTime": 1704413100000, "endTime": None}
    },
    "currentQuestionIndex": 1
}
```

## Testing Best Practices

### Writing New Tests

1. **Use descriptive test names** that explain what is being tested
2. **Follow AAA pattern:** Arrange, Act, Assert
3. **Test one thing per test** - keep tests focused
4. **Use realistic test data** matching production formats
5. **Include edge cases** (empty data, null values, boundaries)

### Example Test Structure

```python
def test_feature_description(self):
    """Clear description of what this test validates"""
    # Arrange - Set up test data
    question = InterviewQuestion(
        questionText="Test question",
        category="Technical",
        focus="Testing"
    )

    # Act - Perform the action
    result = question.status

    # Assert - Verify the outcome
    assert result == "not_started"
```

## Continuous Integration

### Running Tests in CI/CD

```bash
#!/bin/bash
cd test
python3 -m venv venv
source venv/bin/activate
pip install pytest
pip install -r ../lib/stacks/backend/lambda-rest-api/app/requirements.txt
python -m pytest backend/ -v --junitxml=test-results.xml
```

### Test Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed
- `2` - Test execution was interrupted
- `3` - Internal error occurred

## Troubleshooting

### Import Errors

If you encounter import errors, ensure the Lambda app path is correctly added:

```python
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
lambda_app_path = project_root / "lib" / "stacks" / "backend" / "lambda-rest-api" / "app"
sys.path.insert(0, str(lambda_app_path))
```

### Missing Dependencies

```bash
pip install pytest pydantic
```

### Test Discovery Issues

Ensure all test files:

- Are named `test_*.py`
- Contain classes named `Test*`
- Have methods named `test_*`

## Related Documentation

- [Feature Documentation](../../docs/Feature-InterviewProgressionTracking.md)
- [Main Test README](../README.md)
- [E2E Tests](../e2e/README.md)

## Contributing

When adding new tests:

1. Follow existing test structure and naming conventions
2. Update this README with new test descriptions
3. Ensure tests are isolated and don't depend on external services
4. Add docstrings explaining what each test validates
5. Run full test suite before committing

## Test Statistics

- **Total Tests:** 73
- **Test Files:** 5
- **Coverage Areas:** Data Models, Business Logic, Events, Persistence
- **Execution Time:** ~5-10 seconds (all tests)
