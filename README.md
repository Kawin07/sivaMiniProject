# Air Quality Prediction Dashboard

Professional web dashboard for MQ135-style indoor air quality forecasting with realistic synthetic telemetry, 10-minute predictions, and external trigger support.

## Highlights

- 2,000 realistic historical indoor records generated as MQ135-style sensor output (estimated PPM, Rs/Ro ratio, analog voltage, ADC, digital alert).
- 10-minute prediction table for the next 24 hours (144 forecast points).
- Side-by-side view:
  - Current indoor quality snapshot.
  - Real-time meter gated by external trigger.
- `ESP_TRIGGER` environment variable used as the external trigger credential.
- Live source after trigger: Open-Meteo Air Quality API (free, public), converted to MQ135-style readings.
- Temperature source: Open-Meteo Forecast API for Poonamallee.

## Sensor Data Basis

`MT135` is interpreted as `MQ135`.

Data basis was aligned with commonly documented MQ135 behavior:

- Detects broad gases (NH3, NOx, alcohol, benzene, smoke, CO2, etc.)
- Provides analog output (0-5V)
- Provides optional digital threshold output (HIGH/LOW)

Source used: Components101 MQ-135 summary page.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000

## Environment

Configured in `.env`:

- `ESP_TRIGGER` : shared secret required by external trigger website
- `TRIGGER_ACTIVE_MINUTES` : how long live meter remains active after trigger
- `OPEN_METEO_LAT` and `OPEN_METEO_LON` : location for Poonamallee weather and AQ feed
- `MQ135_DIGITAL_THRESHOLD_PPM` : threshold used for MQ135 digital HIGH/LOW state
- `TRIGGER_ALLOWED_ORIGIN` : optional CORS lock for your trigger website

## Trigger From External Website

Your external website button should call the dashboard backend:

```js
await fetch("https://your-dashboard-domain.com/api/esp-trigger", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-esp-trigger": "YOUR_ESP_TRIGGER_VALUE"
  },
  body: JSON.stringify({
    action: "start",
    source: "remote-button-site"
  })
});
```

Stop stream:

```js
await fetch("https://your-dashboard-domain.com/api/esp-trigger", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-esp-trigger": "YOUR_ESP_TRIGGER_VALUE"
  },
  body: JSON.stringify({ action: "stop", source: "remote-button-site" })
});
```

## API Summary

- `GET /api/dashboard` : boot payload (current + prediction table + trigger state)
- `GET /api/indoor-summary` : current modeled MQ135-style indoor snapshot
- `GET /api/predictions` : 10-minute forecast table
- `GET /api/esp-state` : trigger state
- `POST /api/esp-trigger` : start/stop live mode with `x-esp-trigger`
- `GET /api/live-air` : live external feed converted to MQ135-style meter values when trigger is active
