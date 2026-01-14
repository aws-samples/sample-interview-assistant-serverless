"""
Web Search Tool

Reusable DuckDuckGo search tool for AI agents.
Can be used by multiple agents for web research, company information, and general queries.
"""

import json
import logging
import re
from strands.tools import tool
from ddgs import DDGS
import os
import boto3
from botocore.config import Config
from utils.retry_utils import with_retry, AGGRESSIVE_RETRY_CONFIG, retry_config

# Model settings
NOVA_GROUNDING_MODEL_ID = os.getenv(
    "NOVA_GROUNDING_MODEL_ID",
    "us.amazon.nova-2-lite-v1:0",  # Region-specific model required for nova_grounding
)
REGION = os.getenv("AWS_REGION", "us-east-1")

logger = logging.getLogger(__name__)


@tool
def ddg_search(query: str) -> str:
    """
    Search the web using DuckDuckGo for information.

    Useful for:
    - Company information, news, and culture
    - Industry trends and developments
    - Interview preparation resources
    - General web research
    - Recent events and updates

    Returns up to 5 search results with title, snippet, and link.

    Args:
        query: Search query string (e.g., "Amazon company culture 2025", "Software Engineer interview tips")

    Returns:
        JSON string containing search results with title, snippet, and link

    Example:
        >>> results = ddg_search("Google interview process 2025")
        >>> print(results)
        [
          {
            "index": 1,
            "title": "Google Interview Process Guide",
            "snippet": "Complete guide to Google's interview process...",
            "link": "https://example.com/google-interview"
          },
          ...
        ]
    """
    max_results = 2

    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))

        # Format results
        formatted_results = []
        for idx, result in enumerate(results):
            formatted_results.append(
                {
                    "index": idx + 1,
                    "title": result.get("title", "No title"),
                    "snippet": result.get("body", "No snippet"),
                    "link": result.get("href", "No link"),
                }
            )

        logger.info(
            f"DuckDuckGo search completed for query: {query[:50]}... ({len(formatted_results)} results)"
        )
        return json.dumps(formatted_results, indent=2)

    except Exception as e:
        logger.error(f"DuckDuckGo search error for query '{query}': {e}")
        return json.dumps({"error": str(e), "query": query})


def _nova_grounding_search_impl(query: str, client, model_id: str) -> dict:
    """
    Internal implementation of Nova Grounding search.

    This function is separated to allow retry logic to be applied at a higher level.
    """
    # Prepare the conversation in the format expected by Bedrock
    conversation = [
        {
            "role": "user",
            "content": [{"text": query}],
        }
    ]

    # Configure tools that the AI model can use
    # Enable Nova Web Grounding functionality
    toolConfiguration = {
        "tools": [
            {
                "systemTool": {
                    "name": "nova_grounding"  # Enables the model to search for real-time information
                }
            }
        ]
    }

    logger.info(f"Nova Grounding search for query: {query[:50]}...")

    # System prompt to instruct model to use nova_grounding
    system_prompt = [{"text": "Always call the built-in tool nova_grounding"}]

    # Inference configuration
    inference_config = {"maxTokens": 10000, "temperature": 0}

    # Make the API call to Bedrock
    response = client.converse(
        modelId=model_id,
        messages=conversation,
        system=system_prompt,
        toolConfig=toolConfiguration,
        inferenceConfig=inference_config,
    )

    # Extract request ID for debugging
    request_id = response["ResponseMetadata"]["RequestId"]
    logger.info(f"Request ID: {request_id}")

    # Extract the response content
    message = response["output"]["message"]

    # Format the response to match ddg_search structure
    formatted_results = []

    # Extract text content, filtering out tool-related and thinking content
    if "content" in message:
        text_content = ""

        for content_item in message["content"]:
            # Skip tool use and tool result items
            if "toolUse" in content_item or "toolResult" in content_item:
                continue

            # Skip citation-only items (they're not text content)
            if "citationsContent" in content_item and "text" not in content_item:
                continue

            # Extract text blocks
            if "text" in content_item:
                text = content_item["text"]

                # Remove <thinking> tags and their content
                text = re.sub(r"<thinking>.*?</thinking>", "", text, flags=re.DOTALL)
                text = re.sub(r"</?thinking[^>]*>", "", text)

                # Clean up whitespace
                text = text.strip()

                # Only add non-empty text
                if text:
                    text_content += text + " "

        # Create a single formatted result
        formatted_results.append(
            {
                "index": 1,
                "title": "Web Search Results (Nova Grounding)",
                "snippet": text_content.strip(),
                "link": "Grounded web sources",
            }
        )

    logger.info(
        f"Nova Grounding search completed for query: {query[:50]}... (1 result)"
    )
    return formatted_results


@tool
def nova_grounding_search(query: str) -> str:
    """
    Search the web using Amazon Nova Web Grounding for information.

    This function implements a dual-layer retry strategy:
    1. **Boto3 Layer**: Uses adaptive retry mode with 5 max attempts (from retry_config)
       - Handles standard AWS SDK retries
       - Automatic exponential backoff
    2. **Application Layer**: Additional retry loop for edge cases
       - Catches errors that boto3 might not retry
       - Handles specific Bedrock errors (throttling, timeouts, stream errors)
       - Up to 5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s)
       - Max backoff capped at 60s

    Useful for:
    - Company information, news, and culture
    - Industry trends and developments
    - Interview preparation resources
    - General web research
    - Recent events and updates

    Args:
        query: Search query string (e.g., "Amazon company culture 2025", "Software Engineer interview tips")

    Returns:
        JSON string containing search results with title, snippet, and link

    Example:
        >>> results = nova_grounding_search("Google interview process 2025")
        >>> print(results)
        [
          {
            "index": 1,
            "title": "Web Search Results",
            "snippet": "Complete information about Google's interview process...",
            "link": "source_1, source_2"
          }
        ]
    """
    import time
    from botocore.exceptions import ClientError

    try:
        # Create a Bedrock runtime client with retry configuration
        model_id = NOVA_GROUNDING_MODEL_ID
        endpoint = f"https://bedrock-runtime.{REGION}.amazonaws.com"

        # Use the retry_config from retry_utils for consistent retry behavior
        # This provides boto3-level retries with adaptive mode
        session = boto3.Session(region_name=REGION)
        client = session.client(
            "bedrock-runtime",
            region_name=REGION,
            endpoint_url=endpoint,
            config=retry_config,  # Uses adaptive retry mode with 5 max attempts
        )

        # Application-level retry loop for additional resilience
        # This catches errors that boto3's retry logic might not handle
        max_attempts = AGGRESSIVE_RETRY_CONFIG.max_attempts
        last_error = None

        for attempt in range(1, max_attempts + 1):
            try:
                formatted_results = _nova_grounding_search_impl(query, client, model_id)
                return json.dumps(formatted_results, indent=2)

            except ClientError as e:
                last_error = e
                error_code = e.response.get("Error", {}).get("Code", "Unknown")
                http_status = e.response.get("ResponseMetadata", {}).get(
                    "HTTPStatusCode", 0
                )

                # Check if this is a retryable error beyond what boto3 handles
                is_retryable = (
                    500 <= http_status < 600  # 5xx server errors
                    or http_status == 429  # Throttling
                    or error_code
                    in [
                        "ThrottlingException",
                        "ServiceUnavailableException",
                        "ModelTimeoutException",
                        "ModelStreamErrorException",
                    ]
                )

                if not is_retryable or attempt >= max_attempts:
                    logger.error(
                        f"Nova Grounding non-retryable error or max attempts reached: "
                        f"{error_code} (HTTP {http_status})"
                    )
                    raise

                # Calculate exponential backoff
                backoff = min(2 ** (attempt - 1), 60)
                logger.warning(
                    f"Nova Grounding attempt {attempt}/{max_attempts} failed "
                    f"with {error_code} (HTTP {http_status}). Retrying in {backoff}s..."
                )
                time.sleep(backoff)

            except Exception as e:
                # Non-ClientError exceptions (connection errors, etc.)
                logger.error(
                    f"Nova Grounding unexpected error for query '{query}': {e}",
                    exc_info=True,
                )
                raise

        # If we've exhausted retries
        if last_error:
            raise last_error

    except Exception as e:
        logger.error(
            f"Nova Grounding search failed for query '{query}': {e}", exc_info=True
        )
        return json.dumps({"error": str(e), "query": query})
