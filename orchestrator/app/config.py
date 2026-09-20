from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    litellm_base: str = "http://litellm.inference.svc.cluster.local:4000"
    litellm_api_key: str = ""
    talker_model: str = "jarvis-local"
    mock_llm: bool = False

    persona_path: str = "/etc/jarvis/persona.txt"
    briefing_path: str = "/etc/jarvis/briefing.md"
    greeting: str = "Good evening, Gordon."
    briefing_blurb: str = "Jarvis lab · LAN rack · ask me anything."

    max_history: int = 24
    cors_origins: list[str] = ["*"]
    host: str = "0.0.0.0"
    port: int = 8080

    memory_db_path: str = "/var/lib/jarvis/promoted.sqlite"
    memory_inject_limit: int = 40

    whisper_base: str = "http://jarvis-whisper.inference.svc.cluster.local:8000"
    whisper_model: str = "Systran/faster-whisper-small"

    piper_base: str = "http://piper.apps.svc.cluster.local:8000"
    piper_model: str = "tts-1"
    piper_voice: str = "alloy"  # → en_GB-northern_english_male-medium (D-0014)


settings = Settings()
