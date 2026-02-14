# PantryMap Telemetry Setup (English)

This guide explains how to run the `telemetry-live-integration` branch locally and verify that Beacon Hill (`pantryId=254`) is connected to live hardware telemetry.

## Quick run (exact teammate flow)

### Terminal 1

```bash
cd "/Users/hugo/Desktop/guide-map-merge"
npm install
npm run dev -- -p 3001
```

### Terminal 2

```bash
cd "/Users/hugo/Desktop/guide-map-merge/PantryMap/functions-backend"
npm install
npm start -- --port 7071
```

### Terminal 3

```bash
cd "/Users/hugo/Desktop/guide-map-merge/PantryMap"
npx serve -l 3000 frontend
```

### Browser

- `http://localhost:3001/map`

To test whether API connection is successful, use this page for validation:

- `http://localhost:3000/index.html`

Console commands (run separately):

```js
typeof window.PantryAPI
```

```js
await window.PantryAPI.getTelemetryLatest("254")
```

Or verify backend directly without frontend object:

```js
await (await fetch("http://localhost:7071/api/telemetry/latest?pantryId=254")).json()
```

## 1) Get the code

```bash
git fetch origin
git checkout telemetry-live-integration
git pull
```

## 2) Install dependencies

From repository root:

```bash
npm install
```

From Functions backend folder:

```bash
cd PantryMap/functions-backend
npm install
```

## 3) Configure environment

Place this file on your machine:

- `PantryMap/functions-backend/local.settings.json`

Required values are already included if you share the same team config, especially:

- `ECE_TELEMETRY_BASE_URL`
- `COSMOS_*`
- `STORAGE_*`

## 4) Start backend API (port 7071)

```bash
cd PantryMap/functions-backend
npm start -- --port 7071
```

You should see telemetry routes such as:

- `/api/telemetry/latest`
- `/api/GetLatestPantry`

## 5) Start PantryMap frontend (port 3000)

```bash
cd PantryMap
npx serve -l 3000 frontend
```

Open:

- `http://localhost:3000/index.html`

## 6) Optional: start Next shell (port 3001)

From repository root:

```bash
npm run dev -- -p 3001
```

Open:

- `http://localhost:3001/map`

Note: `3001/map` is an iframe container. The actual PantryMap app runs at `3000`.

---

## Verification checklist

### API check (required)

```bash
curl "http://localhost:7071/api/telemetry/latest?pantryId=254"
```

Expected: JSON with non-null `latest.weight` and `latest.timestamp`.

### Frontend check

1. Open `http://localhost:3000/index.html`
2. Select Beacon Hill pantry (`pantryId=254`)
3. In Stock section, confirm the badge shows `From sensor`.

### Console check

In browser console on `3000` page:

```js
typeof window.PantryAPI
await window.PantryAPI.getTelemetryLatest("254")
```

Expected:

- first line returns `"object"`
- second line returns telemetry object with `weight` and `timestamp`

### Anti-regression check

Post a donation for `pantryId=254` and re-check telemetry.
Stock should still follow hardware telemetry (sensor source), not donation size.

---

## Common issues

- `window.PantryAPI is undefined`
  - You are not in the `3000` PantryMap page context.
  - Open `http://localhost:3000/index.html` directly.

- `Port 7071 is unavailable`
  - Another backend process is already running on 7071.
  - Stop the old process, then restart.

- Network panel shows only donations
  - Clear Network logs and click the pantry marker again to trigger telemetry request.

- Some image URLs return 404
  - External image failures do not block telemetry integration.
