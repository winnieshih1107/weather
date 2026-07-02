"""
Fetch CWA's county-level 1-week forecast (F-D0047-091) and reshape it into
a simple per-county list of daily {date, maxTemp, minTemp, weather, pop}.
"""

import json
import os
import ssl
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
CWA_TOKEN = os.environ["CWA_TOKEN"]

FORECAST_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091"


def fetch_raw_forecast() -> dict:
    # opendata.cwa.gov.tw's TLS chain is missing a Subject Key Identifier
    # extension (see fetch_weather.py's _resolve_redirect for the fuller
    # explanation). Unlike the fileapi flow, this REST endpoint returns data
    # directly from that same broken host rather than redirecting to S3, so
    # verification has to be skipped for the whole request, not just a hop.
    ctx = ssl._create_unverified_context()
    req = urllib.request.Request(
        FORECAST_URL,
        headers={"User-Agent": "Mozilla/5.0", "Authorization": CWA_TOKEN},
    )
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        return json.loads(resp.read())


def parse_daily_forecast(raw: dict) -> dict:
    locations = raw["records"]["Locations"][0]["Location"]
    result = {}

    for loc in locations:
        county = loc["LocationName"]
        elements = {el["ElementName"]: el["Time"] for el in loc["WeatherElement"]}
        days = {}

        for period in elements.get("最高溫度", []):
            date = period["StartTime"][:10]
            temp = period["ElementValue"][0].get("MaxTemperature")
            if temp is None:
                continue
            day = days.setdefault(date, {})
            val = float(temp)
            day["maxTemp"] = val if day.get("maxTemp") is None else max(day["maxTemp"], val)

        for period in elements.get("最低溫度", []):
            date = period["StartTime"][:10]
            temp = period["ElementValue"][0].get("MinTemperature")
            if temp is None:
                continue
            day = days.setdefault(date, {})
            val = float(temp)
            day["minTemp"] = val if day.get("minTemp") is None else min(day["minTemp"], val)

        for period in elements.get("12小時降雨機率", []):
            date = period["StartTime"][:10]
            pop = period["ElementValue"][0].get("ProbabilityOfPrecipitation")
            if pop in (None, "", "-"):
                continue
            day = days.setdefault(date, {})
            val = int(pop)
            day["pop"] = val if day.get("pop") is None else max(day["pop"], val)

        for period in elements.get("天氣現象", []):
            date = period["StartTime"][:10]
            day = days.setdefault(date, {})
            if "weather" not in day:
                day["weather"] = period["ElementValue"][0].get("Weather")

        result[county] = [{"date": d, **v} for d, v in sorted(days.items())][:7]

    return result
