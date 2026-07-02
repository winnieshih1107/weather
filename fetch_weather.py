"""
Fetch CWA (Central Weather Administration, Taiwan) automatic weather station
observation data (O-A0001-001), save it to CSV, then load it into a SQLite
database (weather.db).
"""

import csv
import http.client
import os
import sqlite3
import ssl
import urllib.request
import urllib.error
import json
from pathlib import Path
from urllib.parse import urlparse

import certifi
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "weather.csv"
DB_PATH = BASE_DIR / "weather.db"

load_dotenv(BASE_DIR / ".env")
CWA_TOKEN = os.environ["CWA_TOKEN"]

API_URL = (
    "https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/O-A0001-001"
    "?downloadType=WEB&format=JSON"
)


def _resolve_redirect(url: str, headers: dict) -> str | None:
    """
    opendata.cwa.gov.tw's TLS certificate chain is missing a Subject Key
    Identifier extension, which modern OpenSSL rejects. No actual data is
    exchanged on this hop (it only ever returns a 302 redirect to a public
    S3 file), so we skip verification here and verify normally on the
    actual data fetch below.
    """
    parsed = urlparse(url)
    insecure_ctx = ssl._create_unverified_context()
    path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    conn = http.client.HTTPSConnection(parsed.hostname, context=insecure_ctx, timeout=30)
    try:
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
        if resp.status in (301, 302, 303, 307, 308):
            return resp.getheader("Location")
        return None
    finally:
        conn.close()


def fetch_data(url: str, token: str) -> dict:
    # The Authorization header is only meaningful to opendata.cwa.gov.tw for
    # resolving the redirect. It must NOT be forwarded to the redirect target
    # (a plain S3 URL) -- S3 treats an "Authorization" header as its own AWS
    # signature scheme and rejects anything that isn't in that format.
    auth_headers = {"User-Agent": "Mozilla/5.0", "Authorization": token}
    ctx = ssl.create_default_context(cafile=certifi.where())
    target = _resolve_redirect(url, auth_headers) or url
    req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        raw = resp.read()
    return json.loads(raw)


def extract_records(payload: dict) -> list[dict]:
    """Flatten the CWA JSON response into a list of per-station records."""
    stations = (
        payload.get("cwaopendata", {})
        .get("dataset", {})
        .get("Station", [])
    )

    records = []
    for st in stations:
        weather_element = st.get("WeatherElement", {})
        gust_info = weather_element.get("GustInfo", {}) or {}
        peak_gust = gust_info.get("PeakGustSpeed")
        gust_time = (gust_info.get("Occurred_at", {}) or {}).get("DateTime")

        daily = weather_element.get("DailyExtreme", {}) or {}
        daily_high = (
            daily.get("DailyHigh", {}).get("TemperatureInfo", {}).get("AirTemperature")
        )
        daily_low = (
            daily.get("DailyLow", {}).get("TemperatureInfo", {}).get("AirTemperature")
        )

        geo = st.get("GeoInfo", {}) or {}
        coords = geo.get("Coordinates", []) or []
        wgs84 = next((c for c in coords if c.get("CoordinateName") == "WGS84"), {})

        record = {
            "StationId": st.get("StationId"),
            "StationName": st.get("StationName"),
            "ObsTime": st.get("ObsTime", {}).get("DateTime"),
            "County": geo.get("CountyName"),
            "Town": geo.get("TownName"),
            "Lat": wgs84.get("StationLatitude"),
            "Lon": wgs84.get("StationLongitude"),
            "Elevation": geo.get("StationAltitude"),
            "Weather": weather_element.get("Weather"),
            "AirTemperature": weather_element.get("AirTemperature"),
            "RelativeHumidity": weather_element.get("RelativeHumidity"),
            "WindSpeed": weather_element.get("WindSpeed"),
            "WindDirection": weather_element.get("WindDirection"),
            "PeakGustSpeed": peak_gust,
            "GustOccurredAt": gust_time,
            "AirPressure": weather_element.get("AirPressure"),
            "Precipitation": weather_element.get("Now", {}).get("Precipitation"),
            "DailyHighTemp": daily_high,
            "DailyLowTemp": daily_low,
        }
        records.append(record)

    return records


def save_csv(records: list[dict], path: Path) -> None:
    if not records:
        raise ValueError("No records to write to CSV")
    fieldnames = list(records[0].keys())
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def csv_to_sqlite(csv_path: Path, db_path: Path, table: str = "weather") -> None:
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = reader.fieldnames

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute(f"DROP TABLE IF EXISTS {table}")
    columns_sql = ", ".join(f'"{col}" TEXT' for col in fieldnames)
    cur.execute(f"CREATE TABLE {table} ({columns_sql})")

    placeholders = ", ".join("?" for _ in fieldnames)
    insert_sql = f"INSERT INTO {table} VALUES ({placeholders})"
    cur.executemany(insert_sql, [tuple(row[col] for col in fieldnames) for row in rows])

    conn.commit()
    conn.close()


def fetch_stations() -> list[dict]:
    """Fetch from CWA and return the parsed records, without touching disk.

    Used by the web API (app.py), which runs on Vercel's read-only,
    ephemeral filesystem and needs fresh data on every request anyway.
    """
    payload = fetch_data(API_URL, CWA_TOKEN)
    return extract_records(payload)


def fetch_and_store() -> list[dict]:
    """Fetch from CWA, write weather.csv, load weather.db, and return the records."""
    records = fetch_stations()
    save_csv(records, CSV_PATH)
    csv_to_sqlite(CSV_PATH, DB_PATH)
    return records


def main():
    print("Fetching data from CWA opendata API...")
    records = fetch_and_store()
    print(f"Got {len(records)} station records.")
    print(f"Saved CSV to {CSV_PATH}")
    print(f"Loaded SQLite database: {DB_PATH}")
    print("Done.")


if __name__ == "__main__":
    main()
