"""Real local weather for the CMD header (replaces the shipped WEATHER_STUB).

Open-Meteo, no API key, cached for 10 minutes. If WEATHER_LAT / WEATHER_LON are
unset or the call fails, this returns None and glass hides the chip — the header
never shows a made-up temperature.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("jarvis.orchestrator.weather")

CACHE_TTL_SEC = 600.0
ENDPOINT = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes -> short lowercase text for the header chip.
WMO: dict[int, str] = {
    0: "clear",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "rime fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    56: "freezing drizzle",
    57: "freezing drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    66: "freezing rain",
    67: "freezing rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "light showers",
    81: "showers",
    82: "violent showers",
    85: "snow showers",
    86: "snow showers",
    95: "thunderstorm",
    96: "thunderstorm, hail",
    99: "thunderstorm, hail",
}

_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

_lock = asyncio.Lock()
_cache: tuple[float, dict[str, Any] | None] | None = None


def _bearing(deg: Any) -> str | None:
    try:
        value = float(deg)
    except (TypeError, ValueError):
        return None
    return _COMPASS[int((value % 360) / 22.5 + 0.5) % 16]


async def _fetch() -> dict[str, Any] | None:
    lat, lon = settings.weather_lat, settings.weather_lon
    if lat is None or lon is None:
        return None
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "kmh",
        "timezone": settings.weather_tz or "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=settings.weather_timeout) as client:
            r = await client.get(ENDPOINT, params=params)
            if r.status_code >= 400:
                log.info("weather HTTP %s", r.status_code)
                return None
            body = r.json()
    except Exception:  # noqa: BLE001
        log.info("weather unreachable")
        return None

    cur = body.get("current") if isinstance(body, dict) else None
    if not isinstance(cur, dict):
        return None
    temp = cur.get("temperature_2m")
    if temp is None:
        return None
    code = cur.get("weather_code")
    wind = cur.get("wind_speed_10m")
    heading = _bearing(cur.get("wind_direction_10m"))
    return {
        "temp_c": round(float(temp), 1),
        "text": WMO.get(int(code), "—") if isinstance(code, (int, float)) else None,
        "humidity": cur.get("relative_humidity_2m"),
        "wind_kmh": round(float(wind)) if isinstance(wind, (int, float)) else None,
        "wind_dir": heading,
        "place": settings.weather_place or None,
    }


async def get_weather() -> dict[str, Any] | None:
    global _cache
    now = time.monotonic()
    cached = _cache
    if cached and now - cached[0] < CACHE_TTL_SEC:
        return cached[1]
    async with _lock:
        cached = _cache
        now = time.monotonic()
        if cached and now - cached[0] < CACHE_TTL_SEC:
            return cached[1]
        body = await _fetch()
        # Cache misses too, so a dead endpoint cannot be polled every 2s.
        _cache = (time.monotonic(), body)
        return body
