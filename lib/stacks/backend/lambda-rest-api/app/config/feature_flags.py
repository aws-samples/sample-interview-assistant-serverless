"""
Feature flags configuration for the backend.
"""

import os
from typing import Dict, Any

# Default feature flag values
DEFAULT_FLAGS = {
    "NO_AUTH": False,  # When True, authentication is bypassed on localhost
    "USE_NOVA_GROUNDING": False,  # When True, uses Nova grounding for web search; when False, uses DuckDuckGo
    "ENABLE_DIRECT_AUTH": False,  # When False, uses Midway OAuth; when True, uses direct Cognito authentication
}

# Environment variable prefix for feature flags
ENV_PREFIX = "FEATURE_FLAG_"


def get_feature_flags() -> Dict[str, Any]:
    """
    Get feature flags from environment variables or use defaults.

    Returns:
        Dict[str, Any]: Dictionary of feature flags
    """
    flags = DEFAULT_FLAGS.copy()

    # Override defaults with environment variables
    for flag_name in DEFAULT_FLAGS:
        env_var_name = f"{ENV_PREFIX}{flag_name}"
        if env_var_name in os.environ:
            # Convert string value to appropriate type
            env_value = os.environ[env_var_name]
            if isinstance(DEFAULT_FLAGS[flag_name], bool):
                flags[flag_name] = env_value.lower() in ("true", "yes", "1", "t")
            elif isinstance(DEFAULT_FLAGS[flag_name], int):
                try:
                    flags[flag_name] = int(env_value)
                except ValueError:
                    pass
            elif isinstance(DEFAULT_FLAGS[flag_name], float):
                try:
                    flags[flag_name] = float(env_value)
                except ValueError:
                    pass
            else:
                flags[flag_name] = env_value

    environment = os.environ.get("STACK_ENVIRONMENT", "dev").lower()
    is_lambda = "AWS_LAMBDA_FUNCTION_NAME" in os.environ
    if (
        flags["NO_AUTH"]
        and is_lambda
        and environment in ("prod", "production", "staging")
    ):
        raise RuntimeError(
            f"Security Error: NO_AUTH mode cannot be enabled in {environment} environment. "
            "This feature is only allowed for local development."
        )

    return flags


# Export feature flags
feature_flags = get_feature_flags()
