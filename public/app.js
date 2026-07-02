const STATS_TITLE = document.getElementById("stats-title");
const STATS_EL = document.getElementById("stats-content");
const LEGEND_TITLE = document.getElementById("legend-title");
const LEGEND_ROWS = document.getElementById("legend-rows");
const METRIC_BUTTONS = document.querySelectorAll(".metric-btn");
const TOGGLE_STATIONS_EL = document.getElementById("toggle-stations");
const TOGGLE_WIND_EL = document.getElementById("toggle-wind");
const TOGGLE_RAIN_EL = document.getElementById("toggle-rain");
const MODE_STATIONS_BTN = document.getElementById("mode-stations");
const MODE_CHOROPLETH_BTN = document.getElementById("mode-choropleth");
const LEGEND_PANEL = document.getElementById("legend-panel");
const TIPS_PANEL = document.getElementById("tips-panel");
const FORECAST_PANEL = document.getElementById("forecast-panel");
const FORECAST_TITLE = document.getElementById("forecast-title");
const FORECAST_CONTENT = document.getElementById("forecast-content");
const FORECAST_CLOSE_BTN = document.getElementById("forecast-close");

const TAIWAN_CENTER = [23.9738, 120.982];
const DEFAULT_ZOOM = 7;
const COUNTY_TOPOJSON_URL = "tw_counties.topo.json";
const FORECAST_POLL_MS = 10 * 60 * 1000;

// Station tiering (design.md 優化方案 策略二). CWA's O-A0001-001 feed only
// distinguishes "manned" (numeric StationId, e.g. "466920" Taipei) from
// "automatic" (alphanumeric, e.g. "C0A9C0") stations -- there is no separate
// campus/micro-station (Level 3) feed available here, so only two tiers are
// populated. LEVEL2_MIN_ZOOM is where the doc's "中倍率" cutoff would sit;
// wire a Level 3 in below it if a micro-station data source is added later.
const MANNED_STATION_ID = /^\d+$/;
const LEVEL2_MIN_ZOOM = 9;

// Selectable info categories ("分業" in the user's ask): each maps a station
// field to a display icon, unit, decimal precision, and colour/label bands
// used consistently by station labels, cluster bubbles, the choropleth, the
// legend, and the stats panel.
const METRICS = {
  temperature: {
    label: "氣溫",
    icon: "🌡️",
    unit: "°C",
    decimals: 1,
    bands: [
      { max: 25, color: "#4a90d9", text: "舒適" },
      { max: 30, color: "#8bc34a", text: "溫暖" },
      { max: 35, color: "#f4a300", text: "悶熱" },
      { max: 40, color: "#e63946", text: "炎熱" },
      { max: Infinity, color: "#8e24aa", text: "危險" },
    ],
  },
  humidity: {
    label: "濕度",
    icon: "💧",
    unit: "%",
    decimals: 0,
    bands: [
      { max: 40, color: "#e63946", text: "乾燥" },
      { max: 60, color: "#f4a300", text: "適中" },
      { max: 80, color: "#8bc34a", text: "潮濕" },
      { max: Infinity, color: "#4a90d9", text: "悶濕" },
    ],
  },
  windSpeed: {
    label: "風速",
    icon: "💨",
    unit: "m/s",
    decimals: 1,
    bands: [
      { max: 3, color: "#4a90d9", text: "微風" },
      { max: 8, color: "#8bc34a", text: "和風" },
      { max: 14, color: "#f4a300", text: "強風" },
      { max: Infinity, color: "#e63946", text: "強烈" },
    ],
  },
  precipitation: {
    label: "降雨量",
    icon: "🌧️",
    unit: "mm",
    decimals: 1,
    bands: [
      { max: 0, color: "#cccccc", text: "無雨" },
      { max: 5, color: "#4a90d9", text: "小雨" },
      { max: 20, color: "#2b6cb0", text: "中雨" },
      { max: Infinity, color: "#1a365d", text: "大雨" },
    ],
  },
  pressure: {
    label: "氣壓",
    icon: "📊",
    unit: "hPa",
    decimals: 1,
    bands: [
      { max: 1005, color: "#e63946", text: "低壓" },
      { max: 1013, color: "#f4a300", text: "稍低" },
      { max: 1020, color: "#8bc34a", text: "正常" },
      { max: Infinity, color: "#4a90d9", text: "偏高" },
    ],
  },
};

let map = null;
let windyAPI = null;
let clusterGroup = null;
let choroplethLayer = null;
let countyGeoData = null;
let countyStats = new Map();
let countyForecasts = {};
let allStations = [];
let lastUpdated = null;
let viewMode = "choropleth";
let currentMetric = "temperature";

function stationLevel(id) {
  return MANNED_STATION_ID.test(id || "") ? 1 : 2;
}

function colorForMetric(value, metricKey) {
  if (value == null) return "#999999";
  const bands = METRICS[metricKey].bands;
  return (bands.find((b) => value <= b.max) || bands[bands.length - 1]).color;
}

function formatMetricValue(value, metricKey) {
  return value != null ? value.toFixed(METRICS[metricKey].decimals) : "--";
}

function formatTemp(t) {
  return t != null ? t.toFixed(1) : "--";
}

function weatherEmoji(text) {
  if (!text) return "🌡️";
  if (text.includes("雷")) return "⛈️";
  if (text.includes("雨")) return "🌧️";
  if (text.includes("陰")) return "☁️";
  if (text.includes("多雲") && text.includes("晴")) return "⛅";
  if (text.includes("多雲")) return "🌥️";
  if (text.includes("晴")) return "☀️";
  return "🌡️";
}

function formatForecastDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${dateStr.slice(5)} (${weekday})`;
}

function formatUpdatedTime(iso) {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString("zh-TW", { hour12: false });
  } catch (err) {
    return iso;
  }
}

// The county boundary dataset uses "台" (e.g. "台中市") and the pre-2014
// "桃園縣"; CWA's station feed uses "臺" and "桃園市". Normalize to CWA's
// form so aggregation keys match.
function normalizeCountyName(name) {
  if (!name) return name;
  let n = name.replace(/台/g, "臺");
  if (n === "桃園縣") n = "桃園市";
  return n;
}

function stationsForZoom(zoom) {
  const minLevel = zoom >= LEVEL2_MIN_ZOOM ? 2 : 1;
  return allStations.filter((s) => stationLevel(s.id) <= minLevel && s.lat != null && s.lon != null);
}

function makeStationMarker(s) {
  const value = s[currentMetric];
  const marker = L.marker([s.lat, s.lon], {
    icon: L.divIcon({
      className: "",
      html: `<div class="cwa-temp-flat" style="color:${colorForMetric(value, currentMetric)}">${formatMetricValue(value, currentMetric)}</div>`,
      iconSize: null,
    }),
    stationValue: value,
  });

  marker.bindTooltip(
    `<div class="cwa-tooltip-title">${s.name}</div>
     <div>測站代碼：${s.id}</div>
     <div>氣溫：${formatMetricValue(s.temperature, "temperature")}°C</div>
     <div>相對濕度：${formatMetricValue(s.humidity, "humidity")}%</div>
     <div>風速：${formatMetricValue(s.windSpeed, "windSpeed")} m/s</div>
     <div>降雨量：${formatMetricValue(s.precipitation, "precipitation")} mm</div>
     <div>氣壓：${formatMetricValue(s.pressure, "pressure")} hPa</div>
     <div>天氣：${s.weather || "--"}</div>
     <div>更新時間：${formatUpdatedTime(lastUpdated)}</div>`,
    { direction: "top", offset: [0, -8], opacity: 1, className: "cwa-tooltip-wrapper" }
  );

  return marker;
}

function clusterIconCreate(cluster) {
  const markers = cluster.getAllChildMarkers();
  const values = markers.map((m) => m.options.stationValue).filter((v) => v != null);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const size = markers.length < 10 ? 40 : markers.length < 50 ? 48 : 56;
  return L.divIcon({
    className: "",
    html: `<div class="cwa-cluster" style="color:${colorForMetric(avg, currentMetric)}">
             <span class="cwa-cluster-temp">${formatMetricValue(avg, currentMetric)}</span>
             <span class="cwa-cluster-count">${markers.length} 站</span>
           </div>`,
    iconSize: L.point(size, size),
  });
}

function renderMarkers() {
  if (!map || !clusterGroup) return;
  clusterGroup.clearLayers();
  if (!TOGGLE_STATIONS_EL.checked) return;

  const stations = stationsForZoom(map.getZoom());
  const markers = stations.map(makeStationMarker);
  clusterGroup.addLayers(markers);
}

function aggregateByCounty(metricKey) {
  const result = new Map();
  for (const s of allStations) {
    if (!s.county) continue;
    let entry = result.get(s.county);
    if (!entry) {
      entry = { maxValue: null, stationName: null, count: 0 };
      result.set(s.county, entry);
    }
    entry.count += 1;
    const value = s[metricKey];
    if (value != null && (entry.maxValue == null || value > entry.maxValue)) {
      entry.maxValue = value;
      entry.stationName = s.name;
    }
  }
  return result;
}

async function loadCountyGeoData() {
  if (countyGeoData) return countyGeoData;
  const res = await fetch(COUNTY_TOPOJSON_URL);
  const topology = await res.json();
  const objectKey = Object.keys(topology.objects)[0];
  countyGeoData = topojson.feature(topology, topology.objects[objectKey]);
  return countyGeoData;
}

function countyNameOf(feature) {
  return normalizeCountyName(feature.properties.COUNTYNAME || feature.properties.name);
}

async function renderChoropleth() {
  if (!map) return;
  const data = await loadCountyGeoData();
  countyStats = aggregateByCounty(currentMetric);
  const metric = METRICS[currentMetric];

  if (choroplethLayer) {
    map.removeLayer(choroplethLayer);
  }

  // onEachFeature runs synchronously inside the L.geoJSON constructor below,
  // i.e. before it returns -- the outer `choroplethLayer` isn't assigned yet
  // at that point, so label markers are collected here and attached after.
  const labelMarkers = [];

  const newLayer = L.geoJSON(data, {
    style: (feature) => {
      const stats = countyStats.get(countyNameOf(feature));
      return {
        fillColor: colorForMetric(stats ? stats.maxValue : null, currentMetric),
        fillOpacity: 0.75,
        color: "#fff",
        weight: 1,
      };
    },
    onEachFeature: (feature, layer) => {
      const name = countyNameOf(feature);
      const stats = countyStats.get(name);
      const v = stats ? stats.maxValue : null;

      layer.bindTooltip(
        `<div class="cwa-tooltip-title">${name}</div>
         <div>最高${metric.label}：${formatMetricValue(v, currentMetric)} ${metric.unit}（${stats && stats.stationName ? stats.stationName : "--"}）</div>
         <div>測站數：${stats ? stats.count : 0}</div>
         <div>更新時間：${formatUpdatedTime(lastUpdated)}</div>`,
        { sticky: true, className: "cwa-tooltip-wrapper" }
      );
      layer.on("click", () => showForecastForCounty(name));

      const center = layer.getBounds().getCenter();
      labelMarkers.push(
        L.marker(center, {
          icon: L.divIcon({
            className: "",
            html: `<div class="cwa-choropleth-label">${name}<br/>${formatMetricValue(v, currentMetric)} ${metric.unit} ${metric.icon}</div>`,
            iconSize: null,
          }),
          interactive: false,
        })
      );
    },
  });

  labelMarkers.forEach((m) => m.addTo(newLayer));
  choroplethLayer = newLayer;

  if (viewMode === "choropleth") {
    choroplethLayer.addTo(map);
  }
}

function updateStats() {
  const metric = METRICS[currentMetric];
  STATS_TITLE.textContent = `即時極端${metric.label}`;

  const valid = allStations.filter((s) => s[currentMetric] != null);
  if (valid.length === 0) {
    STATS_EL.textContent = "無有效資料";
    return;
  }
  const highest = valid.reduce((a, b) => (b[currentMetric] > a[currentMetric] ? b : a));
  const lowest = valid.reduce((a, b) => (b[currentMetric] < a[currentMetric] ? b : a));
  STATS_EL.innerHTML =
    `最高${metric.label}: ${formatMetricValue(highest[currentMetric], currentMetric)} ${metric.unit}（${highest.name}）<br/>` +
    `最低${metric.label}: ${formatMetricValue(lowest[currentMetric], currentMetric)} ${metric.unit}（${lowest.name}）`;
}

function renderLegend() {
  const metric = METRICS[currentMetric];
  LEGEND_TITLE.textContent = `${metric.label}圖例（縣市內最高${metric.label}）`;
  LEGEND_ROWS.innerHTML = metric.bands
    .map((b, i) => {
      const prevMax = i === 0 ? null : metric.bands[i - 1].max;
      const rangeText =
        prevMax == null
          ? `&lt; ${b.max}${metric.unit}`
          : b.max === Infinity
          ? `&ge; ${prevMax}${metric.unit}`
          : `${prevMax}–${b.max}${metric.unit}`;
      return `<div class="legend-row"><span class="legend-swatch" style="background:${b.color}"></span>${rangeText} ${b.text}</div>`;
    })
    .join("");
}

function setMetric(metricKey) {
  if (!METRICS[metricKey]) return;
  currentMetric = metricKey;
  METRIC_BUTTONS.forEach((btn) => btn.classList.toggle("active", btn.dataset.metric === metricKey));
  renderLegend();
  renderMarkers();
  updateStats();
  renderChoropleth();
}

function showForecastForCounty(name) {
  const days = countyForecasts[name] || [];
  FORECAST_TITLE.textContent = `${name}未來一週預報`;

  if (days.length === 0) {
    FORECAST_CONTENT.innerHTML = "<div>尚無預報資料</div>";
  } else {
    FORECAST_CONTENT.innerHTML = `<div class="forecast-days">${days
      .map(
        (d) => `
        <div class="forecast-day-card">
          <div class="forecast-day-date">${formatForecastDate(d.date)}</div>
          <div class="forecast-day-emoji">${weatherEmoji(d.weather)}</div>
          <div class="forecast-day-temp"><span class="hi">${formatTemp(d.maxTemp)}°</span> / <span class="lo">${formatTemp(d.minTemp)}°</span></div>
          <div class="forecast-day-pop">${d.pop != null ? "降雨 " + d.pop + "%" : ""}</div>
        </div>`
      )
      .join("")}</div>`;
  }

  FORECAST_PANEL.hidden = false;
}

async function loadForecast() {
  try {
    const res = await fetch("/api/cwa-forecast");
    const data = await res.json();
    countyForecasts = data.counties || {};
    const warning = res.headers.get("X-Data-Warning");
    if (warning) console.warn("CWA forecast warning:", warning);
  } catch (err) {
    console.error("Failed to load forecast data", err);
  }
}

function startForecastPolling() {
  loadForecast();
  setInterval(loadForecast, FORECAST_POLL_MS);
}

async function loadStations() {
  try {
    const res = await fetch("/api/cwa-temperatures");
    const data = await res.json();
    allStations = data.stations || [];
    lastUpdated = data.last_updated || null;
    renderMarkers();
    updateStats();
    await renderChoropleth();
    const warning = res.headers.get("X-Data-Warning");
    if (warning) console.warn("CWA data warning:", warning);
  } catch (err) {
    console.error("Failed to load station data", err);
  }
}

function startPolling() {
  loadStations();
  setInterval(loadStations, 5 * 60 * 1000);
}

function setViewMode(mode) {
  if (!map) return;
  viewMode = mode;
  MODE_STATIONS_BTN.classList.toggle("active", mode === "stations");
  MODE_CHOROPLETH_BTN.classList.toggle("active", mode === "choropleth");
  LEGEND_PANEL.hidden = mode !== "choropleth";
  TIPS_PANEL.hidden = mode !== "choropleth";
  if (mode !== "choropleth") FORECAST_PANEL.hidden = true;

  if (mode === "stations") {
    if (choroplethLayer && map.hasLayer(choroplethLayer)) map.removeLayer(choroplethLayer);
    if (clusterGroup && !map.hasLayer(clusterGroup)) map.addLayer(clusterGroup);
  } else {
    if (clusterGroup && map.hasLayer(clusterGroup)) map.removeLayer(clusterGroup);
    if (choroplethLayer) choroplethLayer.addTo(map);
  }
}

function createClusterGroup() {
  clusterGroup = L.markerClusterGroup({
    iconCreateFunction: clusterIconCreate,
    maxClusterRadius: 60,
    disableClusteringAtZoom: 12,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
  });
  if (viewMode === "stations") map.addLayer(clusterGroup);
  map.on("zoomend", renderMarkers);
  loadCountyGeoData().catch((err) => console.warn("Failed to prefetch county boundaries", err));
}

function showWindyDisabledBanner(reason) {
  if (document.querySelector(".windy-disabled-banner")) return;
  const banner = document.createElement("div");
  banner.className = "floating-panel windy-disabled-banner";
  banner.textContent = reason;
  document.body.appendChild(banner);
}

function initPlainLeaflet(reason) {
  if (map) return; // already initialized (e.g. Windy succeeded after we'd already fallen back)
  map = L.map("windy").setView(TAIWAN_CENTER, DEFAULT_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  createClusterGroup();
  showWindyDisabledBanner(reason);
  startPolling();
  startForecastPolling();
}

// Windy's map only ever shows one weather overlay at a time (its own
// picker model), so these two checkboxes just switch windyAPI's active
// overlay rather than being independently stackable layers. store.set can
// throw/reject (e.g. this API key's plan not including a given overlay,
// such as radar/rain) -- never let that surface as an unhandled rejection.
function setWindyOverlay(name) {
  try {
    const result = windyAPI.store.set("overlay", name);
    if (result && typeof result.catch === "function") {
      result.catch((err) => console.warn(`Windy overlay "${name}" unavailable:`, err));
    }
  } catch (err) {
    console.warn(`Windy overlay "${name}" unavailable:`, err);
  }
}

function setupWindyLayerToggles() {
  TOGGLE_WIND_EL.disabled = false;
  TOGGLE_RAIN_EL.disabled = false;

  TOGGLE_WIND_EL.addEventListener("change", () => {
    if (!windyAPI) return;
    if (TOGGLE_WIND_EL.checked) {
      TOGGLE_RAIN_EL.checked = false;
      setWindyOverlay("wind");
    } else {
      setWindyOverlay("temp");
    }
  });

  TOGGLE_RAIN_EL.addEventListener("change", () => {
    if (!windyAPI) return;
    if (TOGGLE_RAIN_EL.checked) {
      TOGGLE_WIND_EL.checked = false;
      setWindyOverlay("rain");
    } else {
      setWindyOverlay("temp");
    }
  });
}

function initWindyMap(apiKey) {
  // windyInit's callback never fires if Windy's own server rejects the key
  // (e.g. domain not whitelisted for this key) -- don't hang on "載入中...".
  const fallbackTimer = setTimeout(() => {
    console.warn("Windy did not initialize in time, falling back to plain map");
    initPlainLeaflet("Windy 圖層初始化逾時（可能是金鑰未授權此網域），目前顯示一般底圖。");
  }, 8000);

  windyInit({ key: apiKey, lat: TAIWAN_CENTER[0], lon: TAIWAN_CENTER[1], zoom: DEFAULT_ZOOM }, (api) => {
    clearTimeout(fallbackTimer);
    if (map) return; // fallback already kicked in before this fired
    windyAPI = api;
    map = api.map;
    createClusterGroup();
    setupWindyLayerToggles();
    startPolling();
    startForecastPolling();
  });
}

async function boot() {
  let windyApiKey = "";
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    windyApiKey = cfg.windyApiKey || "";
  } catch (err) {
    console.warn("Failed to load config, falling back to plain map", err);
  }

  if (windyApiKey && typeof windyInit === "function") {
    initWindyMap(windyApiKey);
  } else {
    initPlainLeaflet("Windy 圖層未啟用（尚未設定 WINDY_API_KEY），目前顯示一般底圖。");
  }
}

TOGGLE_STATIONS_EL.addEventListener("change", renderMarkers);
MODE_STATIONS_BTN.addEventListener("click", () => setViewMode("stations"));
MODE_CHOROPLETH_BTN.addEventListener("click", () => setViewMode("choropleth"));
METRIC_BUTTONS.forEach((btn) => btn.addEventListener("click", () => setMetric(btn.dataset.metric)));
FORECAST_CLOSE_BTN.addEventListener("click", () => {
  FORECAST_PANEL.hidden = true;
});
renderLegend();
boot();
