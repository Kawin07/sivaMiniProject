require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const ESP_TRIGGER = process.env.ESP_TRIGGER || "dev-esp-trigger";
const TRIGGER_ACTIVE_MINUTES = Number(process.env.TRIGGER_ACTIVE_MINUTES || 60);
const OPEN_METEO_LAT = Number(process.env.OPEN_METEO_LAT || 13.0472);
const OPEN_METEO_LON = Number(process.env.OPEN_METEO_LON || 80.0945);
const TRIGGER_ALLOWED_ORIGIN = process.env.TRIGGER_ALLOWED_ORIGIN || "*";
const MQ135_DIGITAL_THRESHOLD_PPM = Number(process.env.MQ135_DIGITAL_THRESHOLD_PPM || 420);

const TEN_MINUTES_MS = 10 * 60 * 1000;
const HISTORY_POINTS = 2000;
const PREDICTION_POINTS = 144;

app.use(
  cors({
    origin: TRIGGER_ALLOWED_ORIGIN === "*" ? true : TRIGGER_ALLOWED_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-esp-trigger"],
  })
);
app.use(express.json());
app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "public")));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianLike(random) {
  return (random() + random() + random() + random() - 2) / 2;
}

function occupancyByHour(hour) {
  if (hour >= 0 && hour < 5) return 0.08;
  if (hour >= 5 && hour < 7) return 0.24;
  if (hour >= 7 && hour < 9) return 0.56;
  if (hour >= 9 && hour < 12) return 0.76;
  if (hour >= 12 && hour < 14) return 0.64;
  if (hour >= 14 && hour < 18) return 0.8;
  if (hour >= 18 && hour < 22) return 0.48;
  return 0.3;
}

function inferLevel(iaqScore) {
  if (iaqScore <= 60) return "Excellent";
  if (iaqScore <= 120) return "Good";
  if (iaqScore <= 200) return "Moderate";
  if (iaqScore <= 300) return "Poor";
  return "Severe";
}

function computeIaqScore(estimatedPpm) {
  const scaled = ((estimatedPpm - 80) / 1400) * 500;
  return round(clamp(scaled, 0, 500), 0);
}

function ppmToRsRo(estimatedPpm) {
  const ppm = Math.max(estimatedPpm, 1);
  const ratio = Math.pow(ppm / 116.6020682, -1 / 2.769034857);
  return round(clamp(ratio, 0.25, 8), 3);
}

function rsRoToVoltage(rsRoRatio) {
  const vc = 5;
  const rLoad = 10;
  const r0 = 10;
  const rs = rsRoRatio * r0;
  const vout = vc * (rLoad / (rLoad + rs));
  return round(clamp(vout, 0, 5), 3);
}

function voltageToAdc(mq135Voltage) {
  return round(clamp((mq135Voltage / 5) * 1023, 0, 1023), 0);
}

function slope(series, key) {
  const n = series.length;
  if (n < 2) return 0;

  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;

  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = series[i][key];
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
  }

  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

function buildMq135Reading(timestamp, estimatedPpm) {
  const rsRoRatio = ppmToRsRo(estimatedPpm);
  const mq135Voltage = rsRoToVoltage(rsRoRatio);
  const mq135Adc = voltageToAdc(mq135Voltage);
  const iaqScore = computeIaqScore(estimatedPpm);

  return {
    timestamp,
    estimatedPpm: round(estimatedPpm, 1),
    rsRoRatio,
    mq135Voltage,
    mq135Adc,
    digitalAlert: estimatedPpm >= MQ135_DIGITAL_THRESHOLD_PPM,
    iaqScore,
    level: inferLevel(iaqScore),
  };
}

function averageSlotProfile(records) {
  const slots = Array.from({ length: 144 }, () => ({
    ppm: 0,
    count: 0,
  }));

  for (const row of records) {
    const date = new Date(row.timestamp);
    const slot = date.getHours() * 6 + Math.floor(date.getMinutes() / 10);
    const bucket = slots[slot];

    bucket.ppm += row.estimatedPpm;
    bucket.count += 1;
  }

  return slots.map((bucket) => {
    if (bucket.count === 0) {
      return { ppm: 180 };
    }

    return {
      ppm: bucket.ppm / bucket.count,
    };
  });
}

function generateHistoricalData(points = HISTORY_POINTS) {
  const now = Date.now();
  const start = now - (points - 1) * TEN_MINUTES_MS;

  const random = mulberry32(20260416);
  const rows = [];

  let pollutionEvent = 0;

  for (let i = 0; i < points; i += 1) {
    const timestamp = start + i * TEN_MINUTES_MS;
    const date = new Date(timestamp);
    const hour = date.getHours() + date.getMinutes() / 60;
    const dailyWave = Math.sin((2 * Math.PI * (hour - 7.5)) / 24);
    const dayIndex = Math.floor(i / 144);
    const weekWave = Math.sin((2 * Math.PI * dayIndex) / 7);
    const occupancy = occupancyByHour(hour);

    pollutionEvent *= 0.84;
    if (random() < 0.014) {
      pollutionEvent += 140 + random() * 380;
    }

    const noise = gaussianLike(random);

    const estimatedPpm = clamp(
      96 +
        315 * occupancy +
        38 * (dailyWave + 1) +
        26 * weekWave +
        pollutionEvent +
        24 * noise,
      70,
      1800
    );

    rows.push(buildMq135Reading(timestamp, estimatedPpm));
  }

  return rows;
}

let historicalData = generateHistoricalData(HISTORY_POINTS);
let slotProfile = averageSlotProfile(historicalData);

function getCurrentIndoorSnapshot() {
  const now = Date.now();
  const date = new Date(now);
  const slot = date.getHours() * 6 + Math.floor(date.getMinutes() / 10);
  const profile = slotProfile[slot];
  const recent = historicalData.slice(-24);

  const ppmTrend = slope(recent, "estimatedPpm");
  const pulse = Math.sin(now / 220000);

  const estimatedPpm = clamp(
    0.7 * recent[recent.length - 1].estimatedPpm +
      0.3 * profile.ppm +
      ppmTrend * 1.35 +
      pulse * 5.5,
    70,
    1900
  );

  return buildMq135Reading(now, estimatedPpm);
}

function generatePredictions(temperatureLookup) {
  const base = getCurrentIndoorSnapshot();
  const recent = historicalData.slice(-30);
  const ppmTrend = slope(recent, "estimatedPpm");

  const output = [];
  const now = Date.now();

  for (let step = 1; step <= PREDICTION_POINTS; step += 1) {
    const ts = now + step * TEN_MINUTES_MS;
    const d = new Date(ts);
    const slot = d.getHours() * 6 + Math.floor(d.getMinutes() / 10);
    const profile = slotProfile[slot];
    const stepDecay = Math.exp(-step / 85);

    const estimatedPpm = clamp(
      0.76 * profile.ppm +
        0.24 * (base.estimatedPpm + ppmTrend * step * 0.42 * stepDecay),
      70,
      1950
    );

    const reading = buildMq135Reading(ts, estimatedPpm);
    output.push({
      timestamp: ts,
      timeLabel: d.toLocaleString("en-GB", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      ...reading,
      temperature: temperatureLookup ? temperatureLookup(ts) : null,
    });
  }

  return output;
}

const weatherCache = {
  fetchedAt: 0,
  data: null,
};

async function fetchPoonamalleeWeather() {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.fetchedAt < 5 * 60 * 1000) {
    return weatherCache.data;
  }

  const query = new URLSearchParams({
    latitude: String(OPEN_METEO_LAT),
    longitude: String(OPEN_METEO_LON),
    current: "temperature_2m",
    hourly: "temperature_2m",
    forecast_days: "2",
    past_days: "1",
    timezone: "auto",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${query.toString()}`;
  const response = await fetch(url, { method: "GET" });

  if (!response.ok) {
    throw new Error(`Open-Meteo weather request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const hourly = payload && payload.hourly ? payload.hourly : {};

  const weather = {
    provider: "Open-Meteo Forecast API",
    place: "Poonamallee",
    currentTemp: payload.current ? round(Number(payload.current.temperature_2m), 1) : null,
    currentObservedAt: payload.current ? payload.current.time : new Date().toISOString(),
    hourlyTimes: Array.isArray(hourly.time) ? hourly.time.map((t) => new Date(t).getTime()) : [],
    hourlyTemps: Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m.map((v) => round(Number(v), 1)) : [],
  };

  weatherCache.fetchedAt = now;
  weatherCache.data = weather;
  return weather;
}

function createTemperatureLookup(weather) {
  if (!weather || weather.hourlyTimes.length === 0 || weather.hourlyTemps.length === 0) {
    return () => null;
  }

  return (timestamp) => {
    let closestIndex = 0;
    let closestDiff = Number.POSITIVE_INFINITY;

    for (let i = 0; i < weather.hourlyTimes.length; i += 1) {
      const diff = Math.abs(weather.hourlyTimes[i] - timestamp);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }

    return weather.hourlyTemps[closestIndex] ?? null;
  };
}

const airFeedCache = {
  fetchedAt: 0,
  data: null,
};

async function fetchLiveAirReference() {
  const now = Date.now();
  if (airFeedCache.data && now - airFeedCache.fetchedAt < 60 * 1000) {
    return airFeedCache.data;
  }

  const query = new URLSearchParams({
    latitude: String(OPEN_METEO_LAT),
    longitude: String(OPEN_METEO_LON),
    hourly: "us_aqi,european_aqi",
    timezone: "auto",
  });

  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?${query.toString()}`;
  const response = await fetch(url, { method: "GET" });

  if (!response.ok) {
    throw new Error(`Open-Meteo air request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const hourly = payload && payload.hourly ? payload.hourly : {};
  const time = hourly.time || [];
  const usAqiValues = hourly.us_aqi || [];
  const euAqiValues = hourly.european_aqi || [];

  let idx = usAqiValues.length - 1;
  while (idx > 0 && (usAqiValues[idx] == null || euAqiValues[idx] == null)) {
    idx -= 1;
  }

  const reference = {
    provider: "Open-Meteo Air Quality API",
    observedAt: time[idx] || new Date().toISOString(),
    usAqi: round(Number(usAqiValues[idx] || 0), 0),
    euAqi: round(Number(euAqiValues[idx] || 0), 0),
  };

  airFeedCache.fetchedAt = now;
  airFeedCache.data = reference;
  return reference;
}

function blendLiveMq135(reference, indoorBase) {
  const pulse = Math.sin(Date.now() / 170000);
  const estimatedPpm = clamp(
    indoorBase.estimatedPpm * 0.56 +
      reference.usAqi * 5.1 +
      reference.euAqi * 2.6 +
      12 * pulse,
    70,
    1900
  );

  return buildMq135Reading(Date.now(), estimatedPpm);
}

const espState = {
  active: false,
  activatedAt: null,
  expiresAt: null,
  source: "inactive",
};

function isTriggerActive() {
  if (!espState.active) return false;
  if (espState.expiresAt && Date.now() > espState.expiresAt) {
    espState.active = false;
    espState.source = "expired";
    return false;
  }
  return true;
}

app.get("/api/indoor-summary", async (_req, res) => {
  let weather = null;
  try {
    weather = await fetchPoonamalleeWeather();
  } catch (_error) {
    weather = null;
  }

  const current = {
    ...getCurrentIndoorSnapshot(),
    temperature: weather ? weather.currentTemp : null,
  };

  res.json({
    ok: true,
    mode: "simulated-mq135",
    sensor: "MQ135",
    historicalCount: historicalData.length,
    current,
    weather: weather
      ? {
          provider: weather.provider,
          place: weather.place,
          observedAt: weather.currentObservedAt,
        }
      : null,
  });
});

app.get("/api/predictions", async (_req, res) => {
  let weather = null;
  try {
    weather = await fetchPoonamalleeWeather();
  } catch (_error) {
    weather = null;
  }

  const temperatureLookup = createTemperatureLookup(weather);

  res.json({
    ok: true,
    sensor: "MQ135",
    historicalCount: historicalData.length,
    intervalMinutes: 10,
    predictions: generatePredictions(temperatureLookup),
  });
});

app.get("/api/dashboard", async (_req, res) => {
  let weather = null;
  try {
    weather = await fetchPoonamalleeWeather();
  } catch (_error) {
    weather = null;
  }

  const temperatureLookup = createTemperatureLookup(weather);

  res.json({
    ok: true,
    generatedAt: Date.now(),
    sensor: "MQ135",
    historicalCount: historicalData.length,
    current: {
      ...getCurrentIndoorSnapshot(),
      temperature: weather ? weather.currentTemp : null,
    },
    predictions: generatePredictions(temperatureLookup),
    weather: weather
      ? {
          provider: weather.provider,
          place: weather.place,
          observedAt: weather.currentObservedAt,
          currentTemp: weather.currentTemp,
        }
      : null,
    trigger: {
      name: "ESP_TRIGGER",
      active: isTriggerActive(),
      source: espState.source,
      activatedAt: espState.activatedAt,
      expiresAt: espState.expiresAt,
    },
  });
});

app.get("/api/esp-state", (_req, res) => {
  res.json({
    ok: true,
    triggerName: "ESP_TRIGGER",
    active: isTriggerActive(),
    source: espState.source,
    activatedAt: espState.activatedAt,
    expiresAt: espState.expiresAt,
  });
});

app.post("/api/esp-trigger", (req, res) => {
  const candidate = req.header("x-esp-trigger") || (req.body && req.body.espTrigger) || "";
  if (!candidate || candidate !== ESP_TRIGGER) {
    return res.status(403).json({
      ok: false,
      error: "Invalid trigger credential",
    });
  }

  const action = (req.body && req.body.action) || "start";
  if (action === "stop") {
    espState.active = false;
    espState.source = req.body.source || "external-stop";
    espState.activatedAt = null;
    espState.expiresAt = null;

    return res.json({
      ok: true,
      message: "Live stream stopped",
      state: espState,
    });
  }

  const now = Date.now();
  espState.active = true;
  espState.source = req.body.source || "external-trigger";
  espState.activatedAt = now;
  espState.expiresAt = now + TRIGGER_ACTIVE_MINUTES * 60 * 1000;

  return res.json({
    ok: true,
    message: "Live stream started",
    state: espState,
  });
});

app.get("/api/live-air", async (_req, res) => {
  if (!isTriggerActive()) {
    return res.json({
      ok: true,
      active: false,
      sensor: "MQ135",
      triggerName: "ESP_TRIGGER",
      live: null,
      airReference: null,
      placeholder: "----",
    });
  }

  try {
    const [airReference, weather] = await Promise.all([
      fetchLiveAirReference(),
      fetchPoonamalleeWeather().catch(() => null),
    ]);

    const indoorBase = getCurrentIndoorSnapshot();
    const live = {
      ...blendLiveMq135(airReference, indoorBase),
      temperature: weather ? weather.currentTemp : null,
    };

    return res.json({
      ok: true,
      active: true,
      sensor: "MQ135",
      triggerName: "ESP_TRIGGER",
      provider: airReference.provider,
      observedAt: airReference.observedAt,
      weatherProvider: weather ? weather.provider : null,
      weatherPlace: weather ? weather.place : null,
      airReference,
      live,
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      active: true,
      error: error.message,
    });
  }
});

setInterval(() => {
  historicalData = generateHistoricalData(HISTORY_POINTS);
  slotProfile = averageSlotProfile(historicalData);
}, 15 * 60 * 1000);

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Air dashboard running at http://localhost:${PORT}`);
  console.log("ESP trigger header key expected: x-esp-trigger");
  console.log("Active env variable name: ESP_TRIGGER");
});
