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
# A single timeout must not blank the header for a full TTL, so a failed poll
# keeps serving the last good reading and retries on this shorter interval.
RETRY_AFTER_SEC = 60.0
# Past this, a reading we can no longer refresh is dropped rather than shown stale.
MAX_STALE_SEC = 3 * 3600.0
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
# (next_attempt_monotonic, last_good_payload, last_good_monotonic)
_next_attempt: float = 0.0
_last_good: dict[str, Any] | None = None
_last_good_at: float = 0.0


def _bearing(deg: Any) -> str | None:
    try:
        value = float(deg)
    except (TypeError, ValueError):
        return None
    return _COMPASS[int((value % 360) / 22.5 + 0.5) % 16]


async def _fetch(lat: float | None = None, lon: float | None = None) -> dict[str, Any] | None:
    # A caller-supplied point is not the house, so it must not wear the house name.
    house = lat is None or lon is None
    if house:
        lat, lon = settings.weather_lat, settings.weather_lon
    if lat is None or lon is None:
        return None
    if not (-90.0 <= float(lat) <= 90.0 and -180.0 <= float(lon) <= 180.0):
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
        "place": (settings.weather_place or None) if house else None,
        "lat": float(lat),
        "lon": float(lon),
    }


async def get_weather() -> dict[str, Any] | None:
    """Last good reading, refreshed on a timer. Never a fabricated one."""
    global _next_attempt, _last_good, _last_good_at
    now = time.monotonic()
    if now < _next_attempt:
        return _fresh_enough(now)
    async with _lock:
        now = time.monotonic()
        if now < _next_attempt:
            return _fresh_enough(now)
        body = await _fetch()
        now = time.monotonic()
        if body is not None:
            _last_good = body
            _last_good_at = now
            _next_attempt = now + CACHE_TTL_SEC
        else:
            # Hold the previous reading and come back sooner than a full TTL.
            _next_attempt = now + RETRY_AFTER_SEC
        return _fresh_enough(now)


def _fresh_enough(now: float) -> dict[str, Any] | None:
    if _last_good is None:
        return None
    if now - _last_good_at > MAX_STALE_SEC:
        return None
    return _last_good


# Point readings stay off the house cache. A browser location must not
# replace the configured reading that pulse and weather.now already use.
_at: dict[tuple[float, float], tuple[float, dict[str, Any] | None, float]] = {}


def _point(lat: float, lon: float) -> tuple[float, float] | None:
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return None
    if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0):
        return None
    return (round(lat_f, 2), round(lon_f, 2))


async def get_weather_at(lat: float, lon: float) -> dict[str, Any] | None:
    """Weather for a caller-supplied point. None when the point or the service fails."""
    key = _point(lat, lon)
    if key is None:
        return None
    now = time.monotonic()
    slot = _at.get(key)
    if slot and now < slot[0] and slot[1] is not None and now - slot[2] <= MAX_STALE_SEC:
        return slot[1]
    async with _lock:
        now = time.monotonic()
        slot = _at.get(key)
        if slot and now < slot[0] and slot[1] is not None and now - slot[2] <= MAX_STALE_SEC:
            return slot[1]
        body = await _fetch(key[0], key[1])
        now = time.monotonic()
        if body is not None:
            _at[key] = (now + CACHE_TTL_SEC, body, now)
            return body
        if slot and slot[1] is not None and now - slot[2] <= MAX_STALE_SEC:
            _at[key] = (now + RETRY_AFTER_SEC, slot[1], slot[2])
            return slot[1]
        _at[key] = (now + RETRY_AFTER_SEC, None, now)
        return None


def _reset_for_tests() -> None:
    global _next_attempt, _last_good, _last_good_at
    _next_attempt = 0.0
    _last_good = None
    _last_good_at = 0.0
    _at.clear()
