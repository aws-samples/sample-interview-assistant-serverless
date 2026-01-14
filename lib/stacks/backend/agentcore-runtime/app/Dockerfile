FROM --platform=linux/arm64 public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt requirements.txt

# Install all dependencies (gets awscrt 0.28.2 from smithy-http)
RUN pip install --no-cache-dir -r requirements.txt

# Install amazon-transcribe without dependencies to avoid awscrt downgrade
RUN pip install --no-cache-dir --no-deps amazon-transcribe==0.6.4

# Set environment variables for Lambda
ENV PYTHONUNBUFFERED=1 \
    AWS_DEFAULT_REGION=us-east-1 \
    PYTHONDONTWRITEBYTECODE=1

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

# Expose port (AgentCore Runtime requires single port 8080)
EXPOSE 8080

ENV PORT=8080
ENV LOGLEVEL=INFO

# OpenTelemetry Configuration
# Disable automatic instrumentation for common libraries to reduce noise
# Only manually instrumented spans will be captured
ENV OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=botocore,boto3,requests,urllib3,httpx,aiohttp-client,asyncio,threading,logging,system_metrics,psutil,sqlite3,redis,pymongo,sqlalchemy,django,flask,tornado,pyramid,falcon,starlette,fastapi,websockets

# Copy application code (S2S/WebSocket implementation)
COPY . .

# Health check for AgentCore Runtime server
# Checks if the server is responding on port 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health').read()" || exit 1

# Run with OpenTelemetry instrumentation
CMD ["opentelemetry-instrument", "python", "-m", "server"]
