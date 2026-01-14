"""Memory Service - Handles AgentCore Memory retrieval and management"""

import logging
import os
from typing import Optional
from bedrock_agentcore.memory import MemoryClient

logger = logging.getLogger(__name__)


class MemoryService:
    """Service for retrieving and managing user memory from AgentCore Memory"""

    def __init__(self, region_name: str = None):
        """
        Initialize Memory Service.

        Args:
            region_name: AWS region for AgentCore Memory client
        """
        self.region_name = region_name or os.getenv("AWS_REGION", "us-east-1")
        self.memory_client = MemoryClient(region_name=self.region_name)

        # Extract memory ID from ARN or use as-is
        # ARN format: arn:aws:bedrock-agentcore:region:account:memory/MEMORY_ID
        ac_memory_env = os.getenv("AC_MEMORY_ID", "")
        if ac_memory_env.startswith("arn:"):
            # Extract memory ID from ARN
            self.ac_memory_id = (
                ac_memory_env.split("/")[-1] if "/" in ac_memory_env else ac_memory_env
            )
        else:
            self.ac_memory_id = ac_memory_env

        logger.info(f"MemoryService initialized with memory ID: {self.ac_memory_id}")

    def retrieve_user_memory(self, user_id: str) -> Optional[str]:
        """
        Retrieve user's long-term memory from AgentCore Memory.

        Args:
            user_id: User email or identifier

        Returns:
            Formatted string with user preferences and communication style, or None
        """
        if not self.ac_memory_id:
            logger.info("AC_MEMORY_ID not configured, skipping memory retrieval")
            return None

        try:
            # Sanitize user_id for namespace (remove invalid characters)
            # Namespace pattern: [a-zA-Z0-9/*][a-zA-Z0-9-_/*]*
            sanitized_user_id = user_id.replace("@", "-").replace(".", "-")

            # Namespace format from CDK: /users/{actorId}/communicationstyle
            namespace = f"/users/{sanitized_user_id}/communicationstyle"
            logger.info(f"Retrieving user memory from namespace: {namespace}")
            logger.info(f"Using memory ID: {self.ac_memory_id}")

            # Query the memory system for communication preferences
            preferences = self.memory_client.retrieve_memories(
                memory_id=self.ac_memory_id,
                namespace=namespace,
                query="communication style preferences anxiety strengths feedback interview practice experience",
                top_k=5,  # Return up to 5 most relevant results
            )

            if preferences and len(preferences) > 0:
                logger.info(f"Retrieved {len(preferences)} relevant preference records")

                # Format the memory into a structured string
                memory_parts = []
                for i, record in enumerate(preferences):
                    content = record.get("content", "")
                    if content:
                        memory_parts.append(f"- {content}")

                if memory_parts:
                    formatted_memory = "\n".join(memory_parts)
                    logger.info(
                        f"Formatted user memory: {len(formatted_memory)} characters"
                    )
                    return formatted_memory
                else:
                    logger.info("No usable content in memory records")
                    return None
            else:
                logger.info("No matching preference records found")
                return None

        except Exception as e:
            logger.warning(f"Error retrieving user memory (non-fatal): {e}")
            return None

    def save_conversation_history(
        self, user_id: str, session_id: str, transcription: list
    ) -> bool:
        """
        Save conversation history to AgentCore Memory.

        Args:
            user_id: User email or identifier
            session_id: Session identifier
            transcription: List of messages in format [{"role": "USER", "content": "...", "timestamp": "..."}, ...]

        Returns:
            True if successful, False otherwise
        """
        if not self.ac_memory_id:
            logger.info("AC_MEMORY_ID not configured, skipping memory save")
            return False

        try:
            # Sanitize user_id for actor_id
            sanitized_user_id = user_id.replace("@", "-").replace(".", "-")

            # Convert transcription from List[dict] to List[tuple] format
            # From: [{"role": "USER", "content": "Hi", "timestamp": "..."}, ...]
            # To:   [("Hi", "USER"), ...]
            messages = [(msg["content"], msg["role"]) for msg in transcription]

            logger.info(f"Converted {len(messages)} messages for AgentCore Memory")

            # Save the conversation history to short-term memory
            ac_response = self.memory_client.create_event(
                memory_id=self.ac_memory_id,
                actor_id=sanitized_user_id,
                session_id=session_id,
                messages=messages,
            )

            logger.info(
                f"Conversation History saved to AgentCore Memory for sessionId: {session_id}"
            )
            return True

        except Exception as e:
            logger.warning(f"Error saving conversation to memory (non-fatal): {e}")
            return False
