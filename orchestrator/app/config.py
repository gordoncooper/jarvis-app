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
    session_db_path: str = "/var/lib/jarvis/sessions.sqlite"
    memory_inject_limit: int = 40
    memory_extract_model: str = "jarvis-local"
    memory_extract_timeout: float = 3.0

    # Intent router (D-0033 slice 3). off | shadow | on.
    #   shadow — classify, log the verdict beside the deterministic route,
    #            act on neither. Scores the model against real traffic before
    #            it can affect a turn.
    #   on     — the verdict decides when the deterministic pass had no answer.
    router_classifier: str = "off"
    classifier_model: str = "jarvis-local"  # local GPU; never a cloud hop
    classifier_timeout: float = 4.0
    # Below this the verdict is ignored and the deterministic route stands.
    classifier_min_confidence: float = 0.6
    # Writes are confirm-gated anyway, but a misfire still costs Gordon a
    # confirm prompt he did not ask for, so they need more certainty.
    classifier_min_confidence_write: float = 0.8

    whisper_base: str = "http://jarvis-whisper.inference.svc.cluster.local:8000"
    whisper_model: str = "Systran/faster-whisper-small"

    piper_base: str = "http://piper.apps.svc.cluster.local:8000"
    piper_model: str = "tts-1"
    piper_voice: str = "alloy"  # → en_GB-northern_english_male-medium (D-0014)

    hands_base: str = "http://openclaw.agents.svc.cluster.local:4001"

    # D-0012: only the orchestrator may read Prometheus; glass reads /v1/pulse.
    prometheus_base: str = "http://prometheus.monitoring.svc.cluster.local:9090"
    prometheus_timeout: float = 3.0

    # Real weather for the CMD header. Unset lat/lon -> chip hidden, never faked.
    weather_lat: float | None = None
    weather_lon: float | None = None
    weather_place: str = ""
    weather_tz: str = "America/Los_Angeles"
    weather_timeout: float = 4.0


settings = Settings()
