# Interview Assistant - Lambda REST API

This directory contains the REST API backend for the Interview Assistant application, deployed as an AWS Lambda function with API Gateway.

## Architecture

This is a **serverless REST API** built with:

- **FastAPI** - Modern Python web framework for building APIs
- **Mangum** - ASGI adapter that wraps FastAPI for AWS Lambda compatibility
- **AWS Lambda** - Serverless compute (Docker container deployment)
- **API Gateway HTTP API** - RESTful endpoint routing with JWT authorization
- **Amazon Cognito** - User authentication and JWT token validation

The application is containerized using Docker and deployed to AWS Lambda (up to 10GB container support).

### Key Components

**Core Infrastructure:**

- **main.py** - Lambda handler with Mangum adapter, mounts all sub-applications
- **auth.py** - JWT token validation using AWS Cognito JWKS
- **Dockerfile** - Container definition for Lambda deployment

**API Applications (3):**

- **candidate_api.py** - 15 endpoints for candidates (interview prep, practice sessions, CV/JD uploads)
- **interviewer_api.py** - 14 endpoints for interviewers (scheduling, live sessions)
- **analytics_api.py** - 2 endpoints for usage analytics

**Services (8):**

- **candidate_planner_service.py** - Generates interview preparation plans
- **interviewer_planner_service.py** - Creates interview schedules
- **interview_planner_service.py** - Generates interview questions
- **interview_analysis_service.py** - Analyzes candidate practice session performance
- **interviewer_session_service.py** - Generates structured summaries for live interviewer sessions
- **services/database_service.py** - DynamoDB interface (SESSION-PREP, SESSION-HISTORY tables)
- **services/memory_service.py** - Amazon Bedrock AgentCore Memory integration
- **services/knowledgebase_service.py** - Knowledge base queries

**Prompts & Models:**

- **candidate_planner_prompts.py** - Prompts for generating candidate preparation plans
- **interviewer_planner_prompts.py** - Prompts for interview scheduling and setup
- **interview_planner_prompts.py** - Prompts for generating interview questions
- **interview_analysis_prompts.py** - Prompts for analyzing candidate practice sessions
- **interviewer_session_prompts.py** - Prompts for generating live interviewer session summaries
- Pydantic models for request/response validation (\*\_models.py files)

**Tools & Utilities:**

- **tools/web_search.py** - DuckDuckGo and Nova Grounding search for AI agents
- **utils/retry_utils.py** - Retry logic with exponential backoff
- **config/feature_flags.py** - Runtime feature toggles

> **Note:** WebSocket/Speech-to-Speech functionality is handled separately by Amazon Bedrock AgentCore Runtime (not included in this Lambda function).

## Interview Flow (REST API)

The REST API supports the following interview preparation workflow:

### Candidate Flow:

1. **Upload & Parse** - User uploads CV/resume and job description (PDF, text, or URL)
2. **Generate Plan** - System uses AI to create personalized interview preparation plan
3. **Review Questions** - Candidate reviews generated interview questions
4. **Practice Session** - Create practice session (S2S handled by AgentCore Runtime separately)
5. **Get Feedback** - Retrieve comprehensive feedback and performance analytics

### Interviewer Flow:

1. **Schedule Interview** - Create interview session with candidate details
2. **Generate Questions** - System generates relevant interview questions
3. **Conduct Interview** - Use live assistant (S2S handled by AgentCore Runtime separately)
4. **Review Session** - Access session history and candidate performance

## Environment Variables

The following environment variables are configured by the CDK stack and available in the Lambda function:

| Variable              | Description                                  | Set By |
| --------------------- | -------------------------------------------- | ------ |
| AWS_REGION            | AWS region (auto-provided by Lambda runtime) | Lambda |
| STACK_PREFIX          | CDK stack name prefix                        | CDK    |
| STACK_SUFFIX          | Environment (dev/staging/prod)               | CDK    |
| DATA_BUCKET           | S3 bucket name for file storage              | CDK    |
| SESSION_PREP_TABLE    | DynamoDB table for interview prep sessions   | CDK    |
| SESSION_HISTORY_TABLE | DynamoDB table for session history           | CDK    |
| AGENTCORE_MEMORY_ID   | AgentCore Memory ID (optional)               | CDK    |
| COGNITO_USER_POOL_ID  | Cognito User Pool ID                         | CDK    |
| COGNITO_APP_CLIENT_ID | Cognito App Client ID                        | CDK    |

### AI Model Configuration (via Feature Flags or Code):

- **NOVA_GROUNDING_MODEL_ID** - for web grounding
- **ANALYSIS_MODEL_ID** - for interview analysis
- **CANDIDATE_PLANNER_MODEL_ID** - for candidate planning
- **INTERVIEW_PLANNER_MODEL_ID** - for interview planning
- **INTERVIEW_SESSION_MODEL_ID** - for live sessions
- **COACHING_MODEL_ID** - for coaching feedback

### Optional Configuration:

- **FEATURE_FLAG_NO_AUTH** - Disable authentication for local testing (default: false)
- **USE_NOVA_GROUNDING** - Enable Nova grounding for web search (default: true)

## Observability

The Lambda function uses **AWS X-Ray** for distributed tracing (enabled via CDK):

- Automatic request/response tracing
- Integration with API Gateway traces
- DynamoDB and Bedrock API call tracking
- Error and exception tracking
- Performance metrics

CloudWatch Logs capture all application logs with structured JSON formatting.

## Building and Deploying

### Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed (for container builds)
- CDK deployed with ECR repository created

### Build Docker Container

```bash
# Build for Lambda (ARM64 architecture)
docker build --platform=linux/arm64 -t interview-lambda:latest .

# Tag for ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker tag interview-lambda:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/<repo-name>:latest

# Push to ECR
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/<repo-name>:latest
```

### Deploy via CDK

```bash
# From repository root
npm run cdk deploy */*/backend/lambda-rest-api
```

The CDK stack will:

1. Pull the Docker image from ECR
2. Create/update the Lambda function
3. Configure API Gateway routes
4. Set up IAM roles and permissions
5. Configure environment variables

### Local Testing (Optional)

For local development/testing with Docker:

```bash
# Set up environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run locally (requires AWS credentials)
export AWS_REGION="us-east-1"
export DATA_BUCKET="your-bucket"
export SESSION_PREP_TABLE="your-table"
export SESSION_HISTORY_TABLE="your-table"
# ... other environment variables

# Start with uvicorn (not Lambda)
uvicorn main:app --reload --port 8000
```

> **Note:** Local testing runs FastAPI directly with uvicorn. In Lambda, the Mangum adapter wraps the FastAPI app.

## API Endpoints

All endpoints are served through API Gateway at `https://<api-gateway-url>/api/*` with JWT authentication (except `/health`).

### Health Check (No Auth)

- `GET /health` - Health check for monitoring/ALB

### Candidate API (`/api/candidate/*`) - 15 endpoints

**Interview Preparation:**

- `POST /api/candidate/scrape-jd` - Parse job description from URL
- `POST /api/candidate/scrape-resume` - Parse resume from URL
- `POST /api/candidate/generate-interview-plan` - Generate AI interview prep plan
- `POST /api/candidate/save-interview-plan` - Save interview plan to DynamoDB
- `GET /api/candidate/interview-plans` - List all interview plans
- `GET /api/candidate/interview-plans/{plan_id}` - Get specific plan
- `DELETE /api/candidate/interview-plans/{plan_id}` - Delete plan

**Practice Sessions:**

- `POST /api/candidate/practice-sessions` - Create new practice session
- `GET /api/candidate/practice-sessions` - List all practice sessions
- `GET /api/candidate/practice-sessions/{session_id}` - Get session details
- `GET /api/candidate/practice-sessions/{session_id}/audio` - Get session audio recording
- `DELETE /api/candidate/practice-sessions/{session_id}` - Delete session

**Jobs & Sessions:**

- `GET /api/candidate/jobs/{job_id}` - Get job details
- `GET /api/candidate/sessions` - Get user sessions
- `GET /api/candidate/health` - Candidate API health check

### Interviewer API (`/api/interviewer/*`) - 14 endpoints

**Interview Management:**

- `POST /api/interviewer/generate-interview-plan` - Generate interview plan
- `POST /api/interviewer/save-interview-plan` - Save interview plan
- `GET /api/interviewer/interview-plans` - List all interview plans
- `GET /api/interviewer/interview-plans/{plan_id}` - Get specific plan
- `DELETE /api/interviewer/interview-plans/{plan_id}` - Delete plan

**Sessions:**

- `POST /api/interviewer/sessions` - Create interview session
- `GET /api/interviewer/sessions` - List all sessions
- `GET /api/interviewer/sessions/{session_id}` - Get session details
- `GET /api/interviewer/sessions/{session_id}/audio` - Get session audio
- `DELETE /api/interviewer/sessions/{session_id}` - Delete session

**Analysis:**

- `POST /api/interviewer/analyze-session` - Analyze interview session
- `GET /api/interviewer/session-feedback/{session_id}` - Get session feedback

**Utility:**

- `GET /api/interviewer/jobs/{job_id}` - Get job details
- `GET /api/interviewer/health` - Interviewer API health check

### Analytics API (`/api/analytics/*`) - 2 endpoints

- `GET /api/analytics/sessions` - Get session analytics
- `GET /api/analytics/feedback` - Get feedback analytics

### Response Format

All API responses follow this format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message",
  "error": "Error message if success=false"
}
```

### Authentication

All endpoints (except `/health`) require a valid JWT token from Amazon Cognito:

```bash
Authorization: Bearer <jwt-token>
```

The JWT is validated against the Cognito User Pool configured in the CDK stack.
