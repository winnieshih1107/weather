"""
FastAPI app serving the CWA temperature dashboard's API.

This is the single entrypoint used both for local development (`uvicorn
app:app`) and for Vercel, which auto-detects a top-level `app` FastAPI
instance and deploys it as one serverless function.

The frontend lives in frontend/ and is served by this same app via
StaticFiles, rather than relying on Vercel's public/** CDN convention:
Vercel's FastAPI framework preset routes every path to this one function
regardless of vercel.json rewrites, and separately, a directory literally
named "public" is deliberately excluded from the function's own bundle
(confirmed live: it doesn't exist at /var/task at runtime). Naming it
anything else avoids that exclusion, so the function can read and serve it
itself -- fully self-contained, no dependence on ambiguous platform
static/function precedence.

Vercel Functions are stateless and ephemeral between requests, so unlike a
traditional always-on server, this fetches fresh from CWA on every request
rather than polling on a background loop into an in-memory cache. That
actually matches what was asked for (immediately up to date data on load)
at the cost of a bit of per-request latency for the CWA round trip.
"""

import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import cwa_forecast
import fetch_weather

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

load_dotenv()  # no-op on Vercel: CWA_TOKEN / WINDY_API_KEY come from its env vars instead
WINDY_API_KEY = os.environ.get("WINDY_API_KEY", "")

SENTINEL_VALUES = {"-99", "-99.0", "-999", "-999.0", ""}

app = FastAPI(title="CWA Temperature Dashboard API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_float(value):
    if value is None or value in SENTINEL_VALUES:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def records_to_stations(records: list[dict]) -> list[dict]:
    stations = []
    for r in records:
        stations.append(
            {
                "id": r.get("StationId"),
                "name": r.get("StationName"),
                "county": r.get("County"),
                "lat": _to_float(r.get("Lat")),
                "lon": _to_float(r.get("Lon")),
                "temperature": _to_float(r.get("AirTemperature")),
                "humidity": _to_float(r.get("RelativeHumidity")),
                "windSpeed": _to_float(r.get("WindSpeed")),
                "precipitation": _to_float(r.get("Precipitation")),
                "pressure": _to_float(r.get("AirPressure")),
                "weather": r.get("Weather") if r.get("Weather") not in SENTINEL_VALUES else None,
            }
        )
    return stations


@app.get("/api/cwa-temperatures")
def get_temperatures(response: Response):
    try:
        stations = records_to_stations(fetch_weather.fetch_stations())
        return {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "stations": stations,
            "warning": None,
        }
    except Exception as exc:
        response.headers["X-Data-Warning"] = f"CWA fetch failed: {exc}"
        return {"last_updated": None, "stations": [], "warning": str(exc)}


@app.get("/api/cwa-forecast")
def get_forecast(response: Response):
    try:
        raw = cwa_forecast.fetch_raw_forecast()
        counties = cwa_forecast.parse_daily_forecast(raw)
        return {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "counties": counties,
            "warning": None,
        }
    except Exception as exc:
        response.headers["X-Data-Warning"] = f"CWA forecast fetch failed: {exc}"
        return {"last_updated": None, "counties": {}, "warning": str(exc)}


@app.get("/api/config")
def get_config():
    # Windy's Map Forecast API key is a client-side embed key by design
    # (unlike the CWA token, which is a private secret kept server-side
    # and never sent to the browser). Left blank until WINDY_API_KEY is
    # set, and the frontend falls back to a plain Leaflet/OSM map.
    return {"windyApiKey": WINDY_API_KEY}


# Mounted last so it only catches paths not matched by the /api/* routes above.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
