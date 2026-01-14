import os
import boto3
from botocore.config import Config


class KnowledgeBase:
    def __init__(self, region: str = "us-east-1", kb_id: str = ""):
        # check if environment variable is set, if yes use it, otherwise set to ''
        if "BD_KB_ID" in os.environ:
            self.kb_id = os.environ["BD_KB_ID"]
        else:
            self.kb_id = ""

        config = Config(retries={"max_attempts": 10, "mode": "standard"})
        # First ensure required environment variables are set
        if "AWS_DEFAULT_REGION" not in os.environ:
            self.region = "us-east-1"
            os.environ["AWS_DEFAULT_REGION"] = self.region
        else:
            self.region = region

        self.bedrock_agent_client = boto3.client(
            service_name="bedrock-agent-runtime", config=config, region_name=self.region
        )

    def kb_search(self, user_question):
        numberOfResults = 3
        response = self.bedrock_agent_client.retrieve(
            retrievalQuery={"text": user_question},
            knowledgeBaseId=self.kb_id,
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": numberOfResults,
                    "overrideSearchType": "HYBRID",
                }
            },
        )

        contexts = []
        retrievalResults = response.get("retrievalResults")
        for retrievedResult in retrievalResults:
            print(type(retrievedResult))
            print(str(retrievedResult))

            text = retrievedResult.get("content").get("text")
            # Remove the "Document 1: " prefix if it exists
            if text.startswith("Document 1: "):
                text = text[len("Document 1: ") :]
            contexts.append(text)
        contexts_string = ", ".join(contexts)
        return contexts_string


# knowledgebase = KnowledgeBase()
