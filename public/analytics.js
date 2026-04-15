const avgPpmElement = document.getElementById("avgPpm");
const peakIaqElement = document.getElementById("peakIaq");
const alertRatioElement = document.getElementById("alertRatio");
const exportPngBtn = document.getElementById("exportPngBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportStatus = document.getElementById("exportStatus");

let ppmTrendChart;
let ppmBarChart;
let levelPieChart;
let latestRows = [];
let latestGeneratedAt = null;

function round(value, digits = 1) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function formatTimeLabel(row) {
  const date = new Date(row.timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function renderSummary(rows) {
  const ppmValues = rows.map((row) => row.estimatedPpm);
  const iaqValues = rows.map((row) => row.iaqScore);
  const digitalAlerts = rows.filter((row) => row.digitalAlert).length;

  avgPpmElement.textContent = `${round(average(ppmValues), 1)} ppm`;
  peakIaqElement.textContent = `${Math.max(...iaqValues, 0)}`;
  alertRatioElement.textContent = `${rows.length ? round((digitalAlerts / rows.length) * 100, 1) : 0}%`;
}

function buildBlockAverages(rows) {
  const blocks = [
    { label: "00:00-05:59", values: [] },
    { label: "06:00-11:59", values: [] },
    { label: "12:00-17:59", values: [] },
    { label: "18:00-23:59", values: [] },
  ];

  rows.forEach((row) => {
    const hour = new Date(row.timestamp).getHours();
    if (hour < 6) blocks[0].values.push(row.estimatedPpm);
    else if (hour < 12) blocks[1].values.push(row.estimatedPpm);
    else if (hour < 18) blocks[2].values.push(row.estimatedPpm);
    else blocks[3].values.push(row.estimatedPpm);
  });

  return {
    labels: blocks.map((block) => block.label),
    values: blocks.map((block) => round(average(block.values), 1)),
  };
}

function buildLevelDistribution(rows) {
  const levels = ["Excellent", "Good", "Moderate", "Poor", "Severe"];
  const counts = levels.map((level) => rows.filter((row) => row.level === level).length);
  return { levels, counts };
}

function destroyExistingCharts() {
  if (ppmTrendChart) ppmTrendChart.destroy();
  if (ppmBarChart) ppmBarChart.destroy();
  if (levelPieChart) levelPieChart.destroy();
}

function setExportState(enabled, message) {
  exportPngBtn.disabled = !enabled;
  exportPdfBtn.disabled = !enabled;
  exportStatus.textContent = message;
}

function formatDateTime(dateInput) {
  const date = new Date(dateInput || Date.now());
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileStamp(dateInput) {
  const date = new Date(dateInput || Date.now());
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${min}`;
}

function createReportCanvas() {
  if (!latestRows.length) {
    return null;
  }

  const lineCanvas = document.getElementById("ppmTrendChart");
  const barCanvas = document.getElementById("ppmBarChart");
  const pieCanvas = document.getElementById("levelPieChart");

  if (!lineCanvas || !barCanvas || !pieCanvas) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 2080;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0f2f57";
  ctx.fillRect(0, 0, canvas.width, 132);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 40px Space Grotesk, sans-serif";
  ctx.fillText("Air Intelligence Analytics Report", 48, 68);
  ctx.font = "500 22px IBM Plex Sans, sans-serif";
  ctx.fillText(`Generated: ${formatDateTime(latestGeneratedAt)}`, 48, 104);

  const avgPpm = avgPpmElement.textContent;
  const peakIaq = peakIaqElement.textContent;
  const alertRatio = alertRatioElement.textContent;

  const summaryCards = [
    { label: "Average MQ135 PPM", value: avgPpm },
    { label: "Peak IAQ Score", value: peakIaq },
    { label: "Digital Alert Ratio", value: alertRatio },
  ];

  let x = 48;
  const cardY = 170;
  const cardW = 488;
  const cardGap = 20;

  summaryCards.forEach((card) => {
    ctx.strokeStyle = "#c9d8ea";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, cardY, cardW, 104);

    ctx.fillStyle = "#4c5f78";
    ctx.font = "500 18px IBM Plex Sans, sans-serif";
    ctx.fillText(card.label, x + 18, cardY + 36);

    ctx.fillStyle = "#0f2f57";
    ctx.font = "700 32px Space Grotesk, sans-serif";
    ctx.fillText(card.value, x + 18, cardY + 80);

    x += cardW + cardGap;
  });

  function drawChartBlock(title, sourceCanvas, yPos) {
    ctx.fillStyle = "#0f2f57";
    ctx.font = "700 28px Space Grotesk, sans-serif";
    ctx.fillText(title, 48, yPos - 14);

    ctx.strokeStyle = "#c9d8ea";
    ctx.lineWidth = 2;
    ctx.strokeRect(48, yPos, 1504, 500);
    ctx.drawImage(sourceCanvas, 66, yPos + 18, 1468, 464);
  }

  drawChartBlock("MQ135 PPM Trend (24h)", lineCanvas, 320);
  drawChartBlock("Average PPM By Time Block", barCanvas, 860);
  drawChartBlock("Air Quality Level Distribution", pieCanvas, 1400);

  return canvas;
}

function triggerDownload(dataUrl, fileName) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function exportPngReport() {
  const reportCanvas = createReportCanvas();
  if (!reportCanvas) {
    setExportState(false, "No data available for export.");
    return;
  }

  const stamp = fileStamp(latestGeneratedAt);
  const dataUrl = reportCanvas.toDataURL("image/png", 1.0);
  triggerDownload(dataUrl, `air_analytics_report_${stamp}.png`);
  setExportState(true, "PNG report exported successfully.");
}

function exportPdfReport() {
  const reportCanvas = createReportCanvas();
  if (!reportCanvas) {
    setExportState(false, "No data available for export.");
    return;
  }

  const jsPdfNamespace = window.jspdf;
  if (!jsPdfNamespace || !jsPdfNamespace.jsPDF) {
    setExportState(true, "PDF library unavailable. Please refresh and try again.");
    return;
  }

  const { jsPDF } = jsPdfNamespace;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 10;
  const imageWidth = pageWidth - margin * 2;
  const imageHeight = (reportCanvas.height / reportCanvas.width) * imageWidth;

  pdf.addImage(reportCanvas.toDataURL("image/png", 1.0), "PNG", margin, margin, imageWidth, imageHeight);

  const stamp = fileStamp(latestGeneratedAt);
  pdf.save(`air_analytics_report_${stamp}.pdf`);
  setExportState(true, "PDF report exported successfully.");
}

function renderCharts(rows) {
  destroyExistingCharts();

  const lineLabels = rows.map((row) => formatTimeLabel(row));
  const ppmValues = rows.map((row) => row.estimatedPpm);

  const barData = buildBlockAverages(rows);
  const pieData = buildLevelDistribution(rows);

  const bluePalette = ["#0f2f57", "#2d5f97", "#4f7db1", "#8fb0d6", "#c9d8ea"];

  ppmTrendChart = new Chart(document.getElementById("ppmTrendChart"), {
    type: "line",
    data: {
      labels: lineLabels,
      datasets: [
        {
          label: "MQ135 PPM",
          data: ppmValues,
          borderColor: "#0f2f57",
          backgroundColor: "#0f2f57",
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 12,
          },
          grid: {
            color: "#e7eef8",
          },
        },
        y: {
          beginAtZero: false,
          grid: {
            color: "#e7eef8",
          },
        },
      },
    },
  });

  ppmBarChart = new Chart(document.getElementById("ppmBarChart"), {
    type: "bar",
    data: {
      labels: barData.labels,
      datasets: [
        {
          label: "Average PPM",
          data: barData.values,
          backgroundColor: ["#0f2f57", "#2d5f97", "#4f7db1", "#8fb0d6"],
          borderColor: "#0f2f57",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
      },
      scales: {
        x: {
          grid: {
            color: "#e7eef8",
          },
        },
        y: {
          beginAtZero: false,
          grid: {
            color: "#e7eef8",
          },
        },
      },
    },
  });

  levelPieChart = new Chart(document.getElementById("levelPieChart"), {
    type: "pie",
    data: {
      labels: pieData.levels,
      datasets: [
        {
          data: pieData.counts,
          backgroundColor: bluePalette,
          borderColor: "#ffffff",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
        },
      },
    },
  });
}

async function bootAnalytics() {
  try {
    setExportState(false, "Loading analytics data...");

    const response = await fetch("/api/dashboard");
    const payload = await response.json();
    const rows = payload.predictions || [];
    latestRows = rows;
    latestGeneratedAt = payload.generatedAt || Date.now();

    if (!rows.length) {
      avgPpmElement.textContent = "No data";
      peakIaqElement.textContent = "No data";
      alertRatioElement.textContent = "No data";
      setExportState(false, "No chart data available to export.");
      return;
    }

    renderSummary(rows);
    renderCharts(rows);
    setExportState(true, "Ready to export report as PNG or PDF.");
  } catch (_error) {
    avgPpmElement.textContent = "Unavailable";
    peakIaqElement.textContent = "Unavailable";
    alertRatioElement.textContent = "Unavailable";
    setExportState(false, "Unable to load analytics data.");
  }
}

exportPngBtn.addEventListener("click", exportPngReport);
exportPdfBtn.addEventListener("click", exportPdfReport);

bootAnalytics();
