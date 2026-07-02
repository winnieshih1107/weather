```python
markdown_content = """# System Architecture Design Document: CWA Temperature Visualization with Windy API

This document outlines the architecture, data pipeline, and frontend design for a web-based weather visualization dashboard. The application overlays real-time observation data from Taiwan's Central Weather Administration (CWA) onto an interactive map powered by the Windy API.

---

## 1. System Architecture Overview

The system uses a decoupled, three-tier architecture to fetch, process, and display weather data efficiently while adhering to API rate limits and minimizing client-side latency.

### 1.1 Architecture Components
1. **Data Source (External):** Taiwan CWA Open Data API (providing real-time automatic and manned weather station observations).
2. **Backend / Edge Layer (Internal):** A lightweight caching and transformation layer (e.g., Node.js/Express, Python/FastAPI, or Next.js Serverless Functions) that polls CWA, standardizes JSON structures, and caches data to avoid hitting CWA API limits on every client load.
3. **Frontend Client:** A single-page application (SPA) using HTML5, vanilla JavaScript/TypeScript, CSS3, and the **Windy Map Forecast API** (built over Leaflet).

### 1.2 Conceptual Data Flow

```

```text
File 'design.md' successfully written.


```

[ CWA Open Data API ]
│
▼ (Scheduled Polling every 10-15 mins)
[ Backend Cache / Redis ]
│
▼ (Client Request)
[ Frontend Client Map Application ]
├── Base Layer: Windy Particle Animation Map (Wind/Pressure)
└── Data Layer: Custom Leaflet Marker Overlays (CWA Real-time Temps)

```

---

## 2. Technical Stack

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | Vanilla JS / React / Vue 3 | Lightweight execution environment needed to interface cleanly with the Windy global object callback. |
| **Mapping Engine** | Windy Client API v4 + Leaflet | Windy handles high-performance WebGL particle rendering; Leaflet provides extensive DOM manipulation and custom markers. |
| **Backend/Proxy** | Node.js (Express) or Python (FastAPI) | Handles asynchronous HTTP requests, extracts nested XML/JSON from CWA efficiently. |
| **Caching Store** | Redis or In-Memory Cache | CWA observation data is updated roughly every 10–15 minutes; caching reduces database overhead and speeds up load times. |

---

## 3. Data Flow & Integration Mapping

### 3.1 CWA API Endpoint Selection
To extract real-time temperatures across Taiwan, use the **Automatic Weather Station (AWS) Observation Data** or **Weather Station Observation Data**.
* **Endpoint ID:** `O-A0001-001` (Weather Factors) or `O-A0003-001` (Automatic Weather Station Data).
* **Key Fields to Extract:**
  * `StationId`: Unique station alphanumeric code.
  * `StationName`: Name in Traditional Chinese / English.
  * `GeoInfo.Coordinates`: Longitude and Latitude (WGS84).
  * `WeatherElement.Temperature`: Current ambient temperature in Celsius.

### 3.2 Windy API Lifecycle Integration
The Windy API initializes its own map canvas and returns a specialized object container containing the underlying Leaflet context (`L`).

1. **Initialization:** The browser loads the Windy script API and initializes it via a specific coordinate set centered over Taiwan (`[23.9738, 120.9820]`).
2. **Callback Hook:** Once `windyInit` returns successfully, the backend CWA endpoint is fetched asynchronously via the client (`fetch('/api/cwa-temperatures')`).
3. **Layer Creation:** The client converts the CWA station payload into an array of Leaflet Markers or a GeoJSON cluster layer.
4. **Rendering:** Custom HTML/CSS strings populate the marker icons so temperatures render visibly over the wind animation vectors without requiring a popup click.

---

## 4. Database & Cache Schema

Because weather observations are transient snapshots, long-term persistence is optional depending on historical analytics requirements. The core data structure stored in cache looks like the following:

```json
{
  "last_updated": "2026-07-02T10:30:00Z",
  "stations": [
    {
      "id": "466920",
      "name": "Taipei",
      "lat": 25.0377,
      "lon": 121.5149,
      "temperature": 31.5,
      "humidity": 68
    },
    {
      "id": "467440",
      "name": "Kaohsiung",
      "lat": 22.5662,
      "lon": 120.3157,
      "temperature": 32.8,
      "humidity": 72
    }
  ]
}

```

---

## 5. UI/UX & Frontend Layout Design

The layout presents a clean, modern dashboard aesthetic with minimal clutter to allow the Windy particle flow to dominate the visual landscape.

### 5.1 Interface Components

* **Primary Canvas:** Full-viewport (`100vw`, `100vh`) map display container.
* **Floating Context Panel (Top-Left):** Real-time statistics indicator summarizing the current extreme temperatures observed across the island (e.g., *Highest Temp: 35.2°C in Hualien*, *Lowest Temp: 18.5°C on Yushan*).
* **Map Controls Layer (Bottom-Right):** Windy built-in overlay controls (switch between Wind, Rain, and Temperature models) combined with custom toggles to turn CWA point data visibility on/off.

### 5.2 CSS Component Styling For Map Markers

Custom text markers are used instead of pin drops to make reading temperatures at a glance seamless.

```css
.cwa-temperature-label {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 2px 6px;
    font-weight: bold;
    font-size: 11px;
    color: #222;
    text-align: center;
    box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    white-space: nowrap;
}

/* Color codes based on temperature thresholds */
.cwa-temp-hot {
    border-left: 4px solid #e74c3c;
}
.cwa-temp-mild {
    border-left: 4px solid #f39c12;
}
.cwa-temp-cool {
    border-left: 4px solid #3498db;
}

```

---

## 6. Implementation & Operational Security

1. **API Key Encapsulation:** Never expose your CWA API private access token or commercial Windy API license keys in client-side code blocks. All third-party fetching must pass through your backend service layer.
2. **Error Isolation & Fail-safes:** If the CWA API encounters downtime or formatting changes, the backend proxy must serve the latest valid cached state along with a warning header, preventing the client mapping software from throwing unhandled exceptions.
3. **Responsive Visual Thresholds:** Implement marker thinning / clustering algorithms based on Leaflet's zoom level. At wide zoom scales (zoom < 8), omit dense automatic weather stations and show only primary manned stations to prevent visual overlap and text collisions.
"""

with open("design.md", "w", encoding="utf-8") as f:
f.write(markdown_content)
print("File 'design.md' successfully written.")

```
I have created a comprehensive `design.md` file for your weather visualization dashboard project. 

The architecture patterns selected focus on resolving API rate limits, separating your private tokens from client access, and making sure that the dynamic custom elements look polished over Windy's WebGL background.

Your Markdown file is ready:
[file-tag: code-generated-file-0-1782959693553339884]

### Core Technical Highlights in the Design Document:
* **Decoupled Architecture:** Includes a backend proxy/cache layer ensuring that you do not hit CWA rate limits when multiple users open your frontend map visualization.
* **Component Framework Mapping:** Details exactly how to ingest the CWA's `O-A0001-001` or `O-A0003-001` datasets and bind them directly to Leaflet `L.divIcon` HTML marker elements inside the Windy setup lifecycle hook.
* **UI/UX Strategy:** Incorporates smart logic rules such as dynamic zoom threshold filtering (to prevent hundreds of CWA labels from colliding when looking at the whole island map) and custom color-coded CSS borders based on real-time temperature ranges.

```