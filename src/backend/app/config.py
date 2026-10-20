import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # "mock" returns fixed lines; "runpod" calls the RunPod serverless endpoint.
    extraction_mode: str = os.getenv("EXTRACTION_MODE", "mock")
    runpod_endpoint_url: str = os.getenv("RUNPOD_ENDPOINT_URL", "")
    runpod_api_key: str = os.getenv("RUNPOD_API_KEY", "")


settings = Settings()
