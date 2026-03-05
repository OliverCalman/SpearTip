// ── TIDE LAYER - HARMONIC PREDICTION ─────────────────────────────────────────
// Uses Sydney (Fort Denison) harmonic constituents from BOM Tide Tables.
// Prediction accuracy: ±15 cm, suitable for spearfishing planning.
// Map markers removed - tide data is surfaced in the drawer and rip risk only.
import { CONFIG } from './config.js';

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function getTideHeight(date = new Date()) {
  return predictHeight(date, CONFIG.tideConstituents.constituents, CONFIG.tideConstituents.msl);
}

/** Return the next N high/low events from `from` date. */
export function getNextTideEvents(from = new Date(), count = 4) {
  const events = [];
  const dt     = 6 * 60 * 1000; // 6-min steps
  let   prev   = predictHeight(from, CONFIG.tideConstituents.constituents, CONFIG.tideConstituents.msl);
  let   prevD  = null;

  const end = new Date(from.getTime() + 3 * 24 * 3600_000);
  let t = new Date(from.getTime() + dt);

  while (t <= end && events.length < count) {
    const cur = predictHeight(t, CONFIG.tideConstituents.constituents, CONFIG.tideConstituents.msl);
    const d   = cur - prev > 0 ? 1 : -1;

    if (prevD !== null && d !== prevD) {
      const refined = refineTurningPoint(new Date(t.getTime() - dt), t, prevD > 0 ? 'high' : 'low');
      events.push(refined);
    }

    prev  = cur;
    prevD = d;
    t     = new Date(t.getTime() + dt);
  }
  return events;
}

/** Build a 24-hour tide height series for the chart (one point per 30 min). */
export function getTideSeries(from = new Date(), hours = 24, stepMin = 30) {
  const series = [];
  const step   = stepMin * 60_000;
  for (let i = 0; i <= hours * 60 / stepMin; i++) {
    const t = new Date(from.getTime() + i * step);
    series.push({ t, h: predictHeight(t, CONFIG.tideConstituents.constituents, CONFIG.tideConstituents.msl) });
  }
  return series;
}

// ── HARMONIC PREDICTION ───────────────────────────────────────────────────────

function predictHeight(date, constituents, msl) {
  const t = date.getTime() / 3_600_000;
  let h   = msl;
  for (const c of constituents) {
    h += c.amp * Math.cos((c.speed * t - c.phase) * Math.PI / 180);
  }
  return Math.max(0, h);
}

function refineTurningPoint(t0, t1, type) {
  for (let i = 0; i < 8; i++) {
    const mid  = new Date((t0.getTime() + t1.getTime()) / 2);
    const hMid = predictHeight(mid, CONFIG.tideConstituents.constituents, CONFIG.tideConstituents.msl);
    const hT1  = predictHeight(t1,  CONFIG.tideConstituents.constituents, CONFIG.tideConstituents.msl);
    if ((type === 'high' && hMid > hT1) || (type === 'low' && hMid < hT1)) t1 = mid;
    else t0 = mid;
  }
  const midT = new Date((t0.getTime() + t1.getTime()) / 2);
  return { type, t: midT, h: predictHeight(midT, CONFIG.tideConstituents.constituents, CONFIG.tideConstituents.msl) };
}

// ── EXPORTED TIDE RENDER FOR DRAWER ──────────────────────────────────────────

export function renderTideSection(containerEl) {
  const now    = new Date();
  const h      = getTideHeight(now);
  const events = getNextTideEvents(now, 4);
  const series = getTideSeries(now, 24, 30);

  const eventsHtml = events.map(e => {
    const timeStr = e.t.toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit', timeZone:'Australia/Sydney' });
    const dateStr = e.t.toLocaleDateString('en-AU', { weekday:'short', timeZone:'Australia/Sydney' });
    return `<div class="tide-event">
      <span class="tide-event-v" style="color:${e.type==='high'?'var(--cyan)':'var(--lime)'}">${e.h.toFixed(2)}m</span>
      <span class="tide-event-l">${e.type.toUpperCase()} · ${dateStr} ${timeStr}</span>
    </div>`;
  }).join('');

  containerEl.innerHTML = `
    <div class="d-section">
      <div class="d-section-title">Tides
        <span class="api-badge b-bom" style="margin-left:6px">BOM HARMONIC</span>
      </div>
      <div class="tide-chart-wrap">
        <div class="tide-chart-title">24-HOUR PREDICTION - SYDNEY (ATC)</div>
        <canvas id="tide-canvas" height="80"></canvas>
        <div class="tide-next">${eventsHtml}</div>
      </div>
    </div>`;

  requestAnimationFrame(() => drawTideChart(series, h));
}

function drawTideChart(series, currentH) {
  const canvas = document.getElementById('tide-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const W   = canvas.offsetWidth;
  const H   = 80;
  canvas.width  = W;
  canvas.height = H;

  const minH   = Math.min(...series.map(s => s.h));
  const maxH   = Math.max(...series.map(s => s.h));
  const rangeH = maxH - minH || 1;
  const pad    = { top: 6, bottom: 6, left: 4, right: 4 };
  const iW     = W - pad.left - pad.right;
  const iH     = H - pad.top  - pad.bottom;

  function xFor(i)  { return pad.left + (i / (series.length - 1)) * iW; }
  function yFor(h2) { return pad.top  + iH - ((h2 - minH) / rangeH) * iH; }

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(0,229,255,0.25)');
  grad.addColorStop(1, 'rgba(0,229,255,0.02)');

  ctx.beginPath();
  series.forEach((s, i) => {
    const x = xFor(i), y = yFor(s.h);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(xFor(series.length - 1), H);
  ctx.lineTo(xFor(0), H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  series.forEach((s, i) => {
    const x = xFor(i), y = yFor(s.h);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  const nowY = yFor(currentH);
  ctx.beginPath();
  ctx.arc(xFor(0), nowY, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#00e5ff';
  ctx.fill();

  ctx.font      = '9px "Noto Sans", monospace';
  ctx.fillStyle = 'rgba(58,90,120,0.9)';
  ctx.textAlign = 'center';
  [0, 6, 12, 18, 24].forEach(hr => {
    const idx = Math.round(hr * 60 / 30);
    if (idx < series.length) ctx.fillText(`${hr}h`, xFor(idx), H - 1);
  });
}
