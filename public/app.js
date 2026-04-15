const currentMetrics = document.getElementById("currentMetrics");
const currentLevel = document.getElementById("currentLevel");
const liveMetrics = document.getElementById("liveMetrics");
const predictionRows = document.getElementById("predictionRows");
const historicalCount = document.getElementById("historicalCount");
const triggerState = document.getElementById("triggerState");
const liveProvider = document.getElementById("liveProvider");

function fmt(value, unit = "") {
  if (value === null || value === undefined) return "----";
  return `${value}${unit}`;
}

function levelClass(level) {
  if (level === "Excellent") return "Excellent";
  if (level === "Good") return "Good";
  if (level === "Moderate") return "Moderate";
  if (level === "Poor") return "Poor";
  return "Severe";
}

function liveTone(level) {
  if (level === "Excellent" || level === "Good") return "good";
  if (level === "Moderate") return "moderate";
  return "bad";
}

function metricCard(label, value, extraClass = "") {
  return `
    <div class="metric ${extraClass}">
      <dt>${label}</dt>
      <dd>${value}</dd>
    </div>
  `;
}

function renderCurrentPlaceholder() {
  currentLevel.textContent = "----";
  currentMetrics.innerHTML = [
    metricCard("IAQ Score", "----"),
    metricCard("MQ135 PPM", "----"),
    metricCard("Rs/Ro", "----"),
    metricCard("Analog Voltage", "----"),
    metricCard("ADC", "----"),
    metricCard("Digital Alert", "----"),
    metricCard("Poonamallee Temp", "----"),
  ].join("");
}

function renderCurrent(data) {
  if (!data) return;

  currentLevel.textContent = `${data.level} · IAQ ${data.iaqScore}`;
  currentMetrics.innerHTML = [
    metricCard("IAQ Score", fmt(data.iaqScore)),
    metricCard("MQ135 PPM", fmt(data.estimatedPpm, " ppm")),
    metricCard("Rs/Ro", fmt(data.rsRoRatio)),
    metricCard("Analog Voltage", fmt(data.mq135Voltage, " V")),
    metricCard("ADC", fmt(data.mq135Adc)),
    metricCard("Digital Alert", data.digitalAlert ? "HIGH" : "LOW"),
    metricCard("Poonamallee Temp", fmt(data.temperature, " C")),
  ].join("");
}

function renderLive(payload) {
  if (!payload || !payload.active || !payload.live) {
    triggerState.textContent = "Waiting";
    triggerState.className = "pill muted";
    liveProvider.textContent = "No stream active. Waiting for external trigger...";

    liveMetrics.innerHTML = [
      metricCard("IAQ Score", "----"),
      metricCard("MQ135 PPM", "----"),
      metricCard("Rs/Ro", "----"),
      metricCard("Analog Voltage", "----"),
      metricCard("ADC", "----"),
      metricCard("Digital Alert", "----"),
      metricCard("Poonamallee Temp", "----"),
    ].join("");
    return;
  }

  const tone = liveTone(payload.live.level);

  triggerState.textContent = `Live · ${payload.live.level}`;
  triggerState.className = `pill live-${tone}`;
  liveProvider.textContent = `${payload.provider} · observed ${payload.observedAt}`;

  liveMetrics.innerHTML = [
    metricCard("IAQ Score", fmt(payload.live.iaqScore), `live-score ${tone}`),
    metricCard("MQ135 PPM", fmt(payload.live.estimatedPpm, " ppm")),
    metricCard("Rs/Ro", fmt(payload.live.rsRoRatio)),
    metricCard("Analog Voltage", fmt(payload.live.mq135Voltage, " V")),
    metricCard("ADC", fmt(payload.live.mq135Adc)),
    metricCard("Digital Alert", payload.live.digitalAlert ? "HIGH" : "LOW"),
    metricCard("Poonamallee Temp", fmt(payload.live.temperature, " C")),
  ].join("");
}

function renderPredictions(rows) {
  predictionRows.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.timeLabel}</td>
        <td>${r.iaqScore}</td>
        <td><span class="level-chip ${levelClass(r.level)}">${r.level}</span></td>
        <td>${r.estimatedPpm}</td>
        <td>${r.rsRoRatio}</td>
        <td>${r.mq135Voltage}</td>
        <td>${r.mq135Adc}</td>
        <td>${r.digitalAlert ? "HIGH" : "LOW"}</td>
        <td>${fmt(r.temperature)}</td>
      </tr>
    `
    )
    .join("");
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  const data = await response.json();

  historicalCount.textContent = `${data.historicalCount.toLocaleString()} records`;
  renderCurrent(data.current);
  renderPredictions(data.predictions);
}

async function refreshCurrent() {
  try {
    const res = await fetch("/api/indoor-summary");
    const payload = await res.json();
    renderCurrent(payload.current);
  } catch (_error) {
    // Keep previous values if current snapshot fetch temporarily fails.
  }
}

async function refreshLive() {
  try {
    const res = await fetch("/api/live-air");
    const payload = await res.json();

    if (payload && payload.active && payload.live) {
      renderCurrent(payload.live);
    }

    renderLive(payload);
  } catch (_error) {
    renderLive(null);
  }
}

async function boot() {
  await loadDashboard();
  await refreshCurrent();
  await refreshLive();

  setInterval(refreshCurrent, 12000);
  setInterval(refreshLive, 10000);
}

boot();
