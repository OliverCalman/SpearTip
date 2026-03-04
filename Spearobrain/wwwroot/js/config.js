// ── GLOBAL CONFIGURATION ──────────────────────────────────────────────────────

export const CONFIG = {
  defaultCenter: [-33.865, 151.255],
  defaultZoom:   11,

  // Pre-prepared locations
  locations: [
    {
      id:         'freshwater',
      name:       'Freshwater Beach',
      lat:        -33.7736,
      lng:        151.2854,
      waterLat:   -33.7736,
      waterLng:   151.2960,
      beachAngle: 90,
      tideRef:    'SYDNEY',
      note:       'Exposed ocean beach, good for pelagic species',
    },
    {
      id:         'manly',
      name:       'Manly Beach',
      lat:        -33.7972,
      lng:        151.2891,
      waterLat:   -33.7972,
      waterLng:   151.3000,
      beachAngle: 75,
      tideRef:    'SYDNEY',
      note:       'Rocky headlands, diverse reef habitat',
    },
    {
      id:         'malabar',
      name:       'Malabar Beach',
      lat:        -33.9671,
      lng:        151.2383,
      waterLat:   -33.9671,
      waterLng:   151.2530,
      beachAngle: 100,
      tideRef:    'SYDNEY',
      note:       'Sheltered bay, flathead and snapper country',
    },
  ],

  // NSW spearfishing target species — ALA biocache occurrence data.
  // Scientific names from FishBase / WoRMS taxonomy (current accepted names).
  species: [
    { id:'kingfish',       name:'Yellowtail Kingfish',  scientific:'Seriola lalandi',                    color:'#00e5ff', alaName:'Seriola lalandi' },
    { id:'mulloway',       name:'Mulloway',             scientific:'Argyrosomus japonicus',              color:'#a29bfe', alaName:'Argyrosomus japonicus' },
    { id:'snapper',        name:'Snapper',              scientific:'Chrysophrys auratus',                color:'#ff5f6d', alaName:'Chrysophrys auratus' },
    { id:'mackerel',       name:'Spanish Mackerel',     scientific:'Scomberomorus commerson',            color:'#fdcb6e', alaName:'Scomberomorus commerson' },
    { id:'spotted-mack',   name:'Spotted Mackerel',     scientific:'Scomberomorus munroi',               color:'#ffe800', alaName:'Scomberomorus munroi' },
    { id:'mahi',           name:'Mahi-Mahi',            scientific:'Coryphaena hippurus',                color:'#55efc4', alaName:'Coryphaena hippurus' },
    { id:'yfin-tuna',      name:'Yellowfin Tuna',       scientific:'Thunnus albacares',                  color:'#ff9f43', alaName:'Thunnus albacares' },
    { id:'lt-tuna',        name:'Longtail Tuna',        scientific:'Thunnus tonggol',                    color:'#ee5a24', alaName:'Thunnus tonggol' },
    { id:'bonito',         name:'Bonito',               scientific:'Sarda australis',                    color:'#fd79a8', alaName:'Sarda australis' },
    { id:'luderick',       name:'Luderick',             scientific:'Girella tricuspidata',               color:'#5f27cd', alaName:'Girella tricuspidata' },
    { id:'bream',          name:'Yellowfin Bream',      scientific:'Acanthopagrus australis',            color:'#d4e157', alaName:'Acanthopagrus australis' },
    { id:'rock-blackfish', name:'Rock Blackfish',       scientific:'Girella elevata',                    color:'#8395a7', alaName:'Girella elevata' },
    { id:'silver-drummer', name:'Silver Drummer',       scientific:'Kyphosus sydneyanus',                color:'#c8d6e5', alaName:'Kyphosus sydneyanus' },
    { id:'morwong',        name:'Red Morwong',          scientific:'Cheilodactylus fuscus',              color:'#e17055', alaName:'Cheilodactylus fuscus' },
    { id:'leatherjacket',  name:'Leatherjacket',        scientific:'Nelusetta ayraud',                   color:'#1abc9c', alaName:'Nelusetta ayraud' },
    { id:'salmon',         name:'Australian Salmon',    scientific:'Arripis trutta',                     color:'#c0392b', alaName:'Arripis trutta' },
    { id:'flathead',       name:'Dusky Flathead',       scientific:'Platycephalus fuscus',               color:'#ffb347', alaName:'Platycephalus fuscus' },
    { id:'blue-flathead',  name:'Bluespotted Flathead', scientific:'Platycephalus caeruleopunctatus',    color:'#3498db', alaName:'Platycephalus caeruleopunctatus' },
    { id:'trevally',       name:'Silver Trevally',      scientific:'Pseudocaranx georgianus',            color:'#74b9ff', alaName:'Pseudocaranx georgianus' },
    { id:'tarwhine',       name:'Tarwhine',             scientific:'Rhabdosargus sarba',                 color:'#d7b8f3', alaName:'Rhabdosargus sarba' },
    { id:'wahoo',          name:'Wahoo',                scientific:'Acanthocybium solandri',             color:'#e91e63', alaName:'Acanthocybium solandri' },
    { id:'cobia',          name:'Cobia',                scientific:'Rachycentron canadum',               color:'#2ecc71', alaName:'Rachycentron canadum' },
    { id:'tailor',         name:'Tailor',               scientific:'Pomatomus saltatrix',                color:'#aaff5e', alaName:'Pomatomus saltatrix' },
    { id:'urchin',         name:'Sea Urchin',           scientific:'Centrostephanus rodgersii',          color:'#9b59b6', alaName:'Centrostephanus rodgersii' },
  ],

  // Map tile providers
  tiles: [
    { label:'Simple',    url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr:'© OpenStreetMap contributors, © CARTO' },
    { label:'Satellite', url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr:'© Esri' },
  ],

  // API endpoints (backend proxied where CORS is required)
  api: {
    openMeteoMarine:  'https://marine-api.open-meteo.com/v1/marine',
    openMeteoWeather: 'https://api.open-meteo.com/v1/forecast',
    nominatim:        'https://nominatim.openstreetmap.org',
    ala:              'https://biocache.ala.org.au/ws/occurrences/search',
    gbif:             'https://api.gbif.org/v1/occurrence/search',
    // Backend proxy endpoints
    tides:            '/api/marine/tides',
    waterquality:     '/api/marine/waterquality',
    restrictions:     '/api/marine/restrictions',
    habitat:          '/api/marine/habitat',
    nearestWater:     '/api/marine/nearest-water',
  },

  // Harmonic tide constituents for Sydney (Fort Denison) — from BOM Tide Tables
  // Used client-side for fast continuous prediction
  tideConstituents: {
    msl: 0.925, // Mean sea level above LAT (m)
    constituents: [
      { name:'M2',  speed:28.984104, amp:0.527, phase:162.5 },
      { name:'S2',  speed:30.000000, amp:0.108, phase:196.5 },
      { name:'N2',  speed:28.439730, amp:0.112, phase:143.5 },
      { name:'K2',  speed:30.082138, amp:0.031, phase:198.0 },
      { name:'K1',  speed:15.041069, amp:0.089, phase:291.0 },
      { name:'O1',  speed:13.943036, amp:0.069, phase:275.0 },
      { name:'P1',  speed:14.958931, amp:0.027, phase:290.0 },
      { name:'M4',  speed:57.968208, amp:0.019, phase: 14.0 },
      { name:'MS4', speed:58.984104, amp:0.010, phase: 39.0 },
    ],
  },
};

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2
             + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function compassDir(deg) {
  if (deg == null) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export function fmt(v, dp = 1) {
  return v != null ? Number(v).toFixed(dp) : '—';
}

export function waveColor(h) {
  if (h < 0.5) return 'var(--lime)';
  if (h < 1.5) return 'var(--cyan)';
  if (h < 2.5) return 'var(--amber)';
  return 'var(--coral)';
}
