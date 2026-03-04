// ── SPEARTIPS — ENTRY POINT ─────────────────────────────────────────────────
// .NET MVC + JS marine conditions app for NSW spearfishing planning.
// All external API calls use free, no-key-required sources where possible;
// CORS-restricted APIs (BOM, NSW DPI, ALA) are proxied via /api/marine/*.

import { initMap }               from './map.js';
import { initHabitatLayer }      from './habitat.js';
import { initSpeciesLayer }      from './species.js';
import { initWeatherLayer }      from './weather.js';
import { initWaterQualityLayer } from './waterQuality.js';
import { initFavourites }        from './favourites.js';
import { initDrawer, openAt }    from './drawer.js';
import { initUI, buildCards }    from './ui.js';
import { initClosuresLayer }     from './closures.js';
import { CONFIG }                from './config.js';

// ── BOOT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialise map (Leaflet + tile layer)
  const map = initMap();

  // 2. Habitat layer: kelp/coral/seagrass (ALA proxy, shows at zoom >= 11)
  initHabitatLayer(map);

  // 3. Species distribution heatmaps (ALA biocache + GBIF, with likelihood scoring)
  initSpeciesLayer(map);

  // 4. Weather + SST data at pre-prepared locations (Open-Meteo, no key)
  //    No map markers — data feeds location cards and the click drawer.
  initWeatherLayer();

  // 5. Water quality indicators (NSW Beachwatch proxy + rainfall fallback)
  //    No map markers — data feeds the click drawer.
  initWaterQualityLayer();

  // 6. Favourite locations (localStorage persistence, opens drawer on click)
  initFavourites(map, openAt);

  // 7. Click drawer (detailed conditions for any clicked point)
  initDrawer(map);

  // 8. Panel, cards, and search UI
  initUI(map);

  // 9. NSW spearfishing closure zones (ArcGIS NSW Aquatic Reserves)
  initClosuresLayer(map);

  // Rebuild cards once weather data has loaded
  setTimeout(() => buildCards(), 3000);

  // 11. Fly to first pre-prepared location on load
  const first = CONFIG.locations[0];
  map.setView([first.lat, first.lng], 11);

  console.info(
    '%cSpearTips%c loaded. Click the ocean for live marine conditions.',
    'color:#00e5ff;font-weight:bold;font-family:monospace',
    'color:#3a5a78'
  );
});
