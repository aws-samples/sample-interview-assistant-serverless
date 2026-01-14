import json
from live_practice_prompts import (
    DEFAULT_INFERENCE_CONFIG,
    LIVE_PRACTICE_SYSTEM_PROMPT,
)
from live_practice_service import (
    AUDIO_INPUT_CONFIG,
    AUDIO_OUTPUT_CONFIG,
    TOOL_CONFIG,
    get_audio_output_config,
)


class S2sEvent:
    # Import configurations from live_practice_service
    DEFAULT_INFER_CONFIG = DEFAULT_INFERENCE_CONFIG
    DEFAULT_SYSTEM_PROMPT = LIVE_PRACTICE_SYSTEM_PROMPT
    DEFAULT_AUDIO_INPUT_CONFIG = AUDIO_INPUT_CONFIG
    DEFAULT_AUDIO_OUTPUT_CONFIG = AUDIO_OUTPUT_CONFIG
    DEFAULT_TOOL_CONFIG = TOOL_CONFIG

    @staticmethod
    def session_start(model_id, inference_config=DEFAULT_INFER_CONFIG):
        if model_id == "amazon.nova-2-sonic-v1:0":
            return {
                "event": {
                    "sessionStart": {
                        "inferenceConfiguration": inference_config,
                        "turnDetectionConfiguration": {"endpointingSensitivity": "LOW"},
                    }
                }
            }
        else:
            return {
                "event": {"sessionStart": {"inferenceConfiguration": inference_config}}
            }

    @staticmethod
    def prompt_start(
        prompt_name,
        audio_output_config=DEFAULT_AUDIO_OUTPUT_CONFIG,
        tool_config=DEFAULT_TOOL_CONFIG,
    ):
        return {
            "event": {
                "promptStart": {
                    "promptName": prompt_name,
                    "textOutputConfiguration": {"mediaType": "text/plain"},
                    "audioOutputConfiguration": audio_output_config,
                    "toolUseOutputConfiguration": {"mediaType": "application/json"},
                    "toolConfiguration": tool_config,
                }
            }
        }

    @staticmethod
    def content_start_text(prompt_name, content_name):
        return {
            "event": {
                "contentStart": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "type": "TEXT",
                    "interactive": True,
                    "role": "SYSTEM",
                    "textInputConfiguration": {"mediaType": "text/plain"},
                }
            }
        }

    @staticmethod
    def text_input(prompt_name, content_name, system_prompt):
        print(f"text_input system_prompt: {system_prompt}")

        return {
            "event": {
                "textInput": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "content": system_prompt,
                }
            }
        }

    @staticmethod
    def content_end(prompt_name, content_name):
        return {
            "event": {
                "contentEnd": {"promptName": prompt_name, "contentName": content_name}
            }
        }

    @staticmethod
    def content_start_audio(
        prompt_name, content_name, audio_input_config=DEFAULT_AUDIO_INPUT_CONFIG
    ):
        return {
            "event": {
                "contentStart": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "type": "AUDIO",
                    "interactive": True,
                    "audioInputConfiguration": audio_input_config,
                }
            }
        }

    @staticmethod
    def audio_input(prompt_name, content_name, content):
        return {
            "event": {
                "audioInput": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "content": content,
                }
            }
        }

    @staticmethod
    def content_start_tool(prompt_name, content_name, tool_use_id):
        return {
            "event": {
                "contentStart": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "interactive": False,
                    "type": "TOOL",
                    "role": "TOOL",
                    "toolResultInputConfiguration": {
                        "toolUseId": tool_use_id,
                        "type": "TEXT",
                        "textInputConfiguration": {"mediaType": "text/plain"},
                    },
                }
            }
        }

    @staticmethod
    def text_input_tool(prompt_name, content_name, content):
        print(f"text_input_tool content: {content}")
        return {
            "event": {
                "toolResult": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "content": content,
                    # "role": "TOOL"
                }
            }
        }

    @staticmethod
    def prompt_end(prompt_name):
        return {"event": {"promptEnd": {"promptName": prompt_name}}}

    @staticmethod
    def session_end():
        return {"event": {"sessionEnd": {}}}
