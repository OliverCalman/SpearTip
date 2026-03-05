// ── WATER QUALITY (Rainfall-based turbidity assessment) ───────────────────────
// Uses Open-Meteo daily precipitation sum for the past 24 h - no proxy needed.
// Heavy rain flushes stormwater, bacteria and silt into coastal waters.
// This is the most reliable real-time proxy without a backend data source.
import { CONFIG } from './config.js';

const FETCH_MS = 3_600_000;  // 1 h refresh

let _cache = {};  // { locId: { status, label, color, note, rainfall24h, fetched } }

const THRESHOLDS = [
  { mm: 30, status: 'POOR',    label: 'Poor',
    note: 'Heavy rain - high stormwater runoff. Bacteria & turbidity risk elevated. Avoid entering water near drains.' },
  { mm: 8,  status: 'CAUTION', label: 'Caution',
    note: 'Moderate rainfall - elevated turbidity likely. Conditions typically improve 24–48 h after rain.' },
  { mm: 0,  status: 'GOOD',    label: 'Good',
    note: 'No significant recent rainfall. Water clarity likely good.' },
];

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initWaterQualityLayer() {
  fetchAll();
  setInterval(fetchAll, FETCH_MS);
}

export function getWaterQuality(locId) {
  return _cache[locId] ?? null;
}

/** Returns the cached 24 h rainfall total in mm (0 if not yet fetched). */
export function getRainfall24h(locId) {
  return _cache[locId]?.rainfall24h ?? 0;
}

// ── FETCH ─────────────────────────────────────────────────────────────────────

async function fetchAll() {
  await Promise.allSettled(CONFIG.locations.map(loc => fetchForLocation(loc)));
}

async function fetchForLocation(loc) {
  const cached = _cache[loc.id];
  if (cached && Date.now() - cached.fetched < FETCH_MS) return;

  try {
    // Open-Meteo: daily precipitation_sum for the past 1 day.
    // No API key, CORS-enabled - direct browser fetch, no backend proxy needed.
    const url = `${CONFIG.api.openMeteoWeather}` +
      `?latitude=${loc.lat.toFixed(4)}&longitude=${loc.lng.toFixed(4)}` +
      `&daily=precipitation_sum&past_days=1&forecast_days=0&timezone=Australia%2FSydney`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error();
    const d = await resp.json();

    const sums        = d.daily?.precipitation_sum ?? [];
    const rainfall24h = sums.reduce((s, v) => s + (v || 0), 0);

    _cache[loc.id] = { ...classify(rainfall24h), rainfall24h, fetched: Date.now() };
  } catch {
    _cache[loc.id] = {
      status: 'UNKNOWN', label: 'Unknown', color: '#3a5a78',
      note: 'Rainfall data unavailable.',
      rainfall24h: 0, fetched: Date.now(),
    };
  }
}

function classify(mm) {
  for (const t of THRESHOLDS) {
    if (mm >= t.mm) return { status: t.status, label: t.label, color: colorFor(t.status), note: t.note };
  }
  return { status: 'GOOD', label: 'Good', color: colorFor('GOOD'), note: THRESHOLDS[2].note };
}

function colorFor(status) {
  return { GOOD: '#aaff5e', CAUTION: '#ffb347', POOR: '#ff5f6d', UNKNOWN: '#3a5a78' }[status] ?? '#3a5a78';
}

// ── DRAWER SECTION ────────────────────────────────────────────────────────────

export function buildWaterQualitySection(locId) {
  const data = _cache[locId];
  if (!data) return '';

  const statusClass = data.status.toLowerCase();
  const rainLabel   = data.rainfall24h > 0
    ? `${data.rainfall24h.toFixed(1)} mm in last 24 h`
    : 'No significant rainfall recorded';

  return `
    <div class="d-section">
      <div class="d-section-title">Water Quality
        <span class="api-badge b-om" style="margin-left:4px">OPEN-METEO</span>
      </div>
      <div class="wq-row">
        <span class="wq-badge wq-${statusClass}">${data.label}</span>
        <div>
          <div class="wq-label">Stormwater runoff risk</div>
          <div class="wq-date">${rainLabel}</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;line-height:1.5">${data.note}</div>
    </div>`;
}
