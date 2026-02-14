(function() {
  'use strict';

  // Global state
  let map;
  let markers = new Map();
  let currentPantry = null;
  let allPantries = [];
  let wishlistState = {
    items: [],
    pantryId: null,
    root: null
  };
  let messageState = {
    items: [],
    expanded: false,
    pantryId: null,
    root: null
  };
  let donorNotesState = {
    items: [],
    expanded: false,
    pantryId: null,
    root: null
  };
  /** In-memory cache: blobUrl -> readUrl for donation images (avoids repeated read-sas calls) */
  const donationReadUrlCache = {};
  let wishlistModal = null;
  const listControlsState = {
    type: 'all', // all | fridge | shelf
    stock: 'any', // any | high-low | low-high
    restock: 'newest', // newest | oldest
  };
  /** Default map view (Seattle area, ~5km) when returning from pantry detail */
  const DEFAULT_MAP_CENTER = [47.6062, -122.3321];
  const DEFAULT_MAP_ZOOM = 11;

  // Inline SVG placeholders (data URIs) for missing images
  const PLACEHOLDERS = {
    pantry: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="%23f0fdf4"/><stop offset="100%" stop-color="%23dcfce7"/></linearGradient></defs><rect width="1200" height="800" fill="url(%23g)"/><g fill="%2392ceac" opacity="0.45"><circle cx="180" cy="160" r="8"/><circle cx="300" cy="120" r="4"/><circle cx="1080" cy="180" r="6"/><circle cx="980" cy="620" r="8"/></g><g transform="translate(0,10)" fill="none" stroke="%2352b788" stroke-width="22"><circle cx="600" cy="420" r="120"/><circle cx="600" cy="420" r="38" fill="%2352b788"/></g><text x="600" y="720" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial" font-size="36" fill="%232c3e50" opacity="0.7">Pantry photo</text></svg>',
    avatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="16" fill="%23eaf7f0"/><circle cx="40" cy="32" r="16" fill="%2352b788"/><path d="M12 70c6-12 20-18 28-18s22 6 28 18" fill="none" stroke="%2352b788" stroke-width="6" stroke-linecap="round"/></svg>',
    photo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" rx="10" fill="%23f1f5f9"/><path d="M20 92l28-32 18 20 22-26 32 38H20z" fill="%2394a3b8"/><circle cx="52" cy="40" r="10" fill="%2394a3b8"/></svg>'
  };

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pantryPhotoTag(url, alt, extraAttrs = '') {
    const src = url && typeof url === 'string' ? url : PLACEHOLDERS.pantry;
    const safeAlt = escapeAttr(alt || 'Pantry photo');
    const rawAttr = url && typeof url === 'string' ? `data-raw-src='${escapeAttr(url)}'` : '';
    return `<img data-role='pantry-photo' ${rawAttr} src='${escapeAttr(src)}' alt='${safeAlt}' ${extraAttrs}>`;
  }

  function avatarTag(url, size = 40, alt = 'User avatar') {
    const src = url && typeof url === 'string' ? url : PLACEHOLDERS.avatar;
    const style = `width: ${size}px; height: ${size}px; border-radius: 50%; object-fit: cover;`;
    const safeAlt = escapeAttr(alt);
    return `<img data-role='avatar' src='${escapeAttr(src)}' alt='${safeAlt}' style='${escapeAttr(style)}'>`;
  }

  function contentPhotoTag(url, size = 60, alt = '') {
    const src = url && typeof url === 'string' ? url : PLACEHOLDERS.photo;
    const style = `width: ${size}px; height: ${size}px; border-radius: 8px; object-fit: cover;`;
    const safeAlt = escapeAttr(alt || 'Photo');
    const rawAttr = url && typeof url === 'string' ? `data-raw-src='${escapeAttr(url)}'` : '';
    return `<img data-role='content-photo' ${rawAttr} src='${escapeAttr(src)}' alt='${safeAlt}' style='${escapeAttr(style)}'>`;
  }

  function renderStockGauge(currentItems = 0, capacity = 40, forceLevel = null) {
    const safeCurrent = Number.isFinite(currentItems) ? currentItems : 0;
    let ratio = Math.max(0, Math.min(safeCurrent / capacity, 1));
    
    // Determine status level - can be forced by donation data
    let statusLevel = 'low';
    let statusLabel = 'Low';
    
    if (forceLevel) {
      // Use forced level from donation data
      statusLevel = forceLevel;
      if (forceLevel === 'high') {
        statusLabel = 'Full';
        ratio = 1.0; // 100% filled for high
      } else if (forceLevel === 'medium') {
        statusLabel = 'Medium';
        ratio = 0.66; // 66% filled for medium
      } else if (forceLevel === 'inactive') {
        statusLabel = 'Unknown';
        ratio = 0.0; // No fill for inactive
      } else {
        statusLabel = 'Low';
        ratio = 0.33; // 33% filled for low
      }
    } else {
      // Calculate from ratio
      if (ratio >= 0.75) {
        statusLevel = 'high';
        statusLabel = 'Full';
      } else if (ratio >= 0.4) {
        statusLevel = 'medium';
        statusLabel = 'Medium';
      } else {
        statusLevel = 'low';
        statusLabel = 'Low';
      }
    }
    
    const radius = 80;
    const circumference = Math.PI * radius;
    const dashOffset = circumference * (1 - ratio);
    
    // Map level to color
    const colorMap = {
      'low': '#ef4444',      // Red
      'medium': '#f59e0b',   // Yellow/Orange
      'high': '#52b788',     // Green
      'inactive': '#94a3b8' // Gray for lack of data
    };
    const strokeColor = colorMap[statusLevel] || '#52b788';
    const textColor = strokeColor;
    
    return `
      <div class="detail-gauge" data-level="${statusLevel}">
        <svg viewBox="0 0 200 120" class="detail-gauge-svg" role="img" aria-label="Stock level">
          <path class="detail-gauge-track" d="M20 100 A80 80 0 0 1 180 100" style="fill: none; stroke: #e5e7eb; stroke-width: 20; stroke-linecap: round;" />
          <path class="detail-gauge-fill" d="M20 100 A80 80 0 0 1 180 100"
            style="fill: none; stroke: ${strokeColor}; stroke-width: 20; stroke-linecap: round; stroke-dasharray: ${circumference}; stroke-dashoffset: ${dashOffset};" />
        </svg>
        <div class="detail-gauge-center">
          <div class="detail-gauge-status" style="color: ${textColor}">${statusLabel}</div>
        </div>
      </div>
    `;
  }

  function formatDateTimeMinutes(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return 'Unknown';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  function formatWeightDisplay(weight) {
    if (weight === null || weight === undefined || Number.isNaN(Number(weight))) return '--';
    const num = Number(weight);
    return `${num.toFixed(1)} kg`;
  }

  function formatDoorEvent(value) {
    if (!value) return '--';
    const lower = String(value).toLowerCase();
    if (lower === 'open' || lower === 'opened') return 'Opened';
    if (lower === 'closed' || lower === 'close') return 'Closed';
    return value;
  }

  function formatCondition(value) {
    if (!value) return '--';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function formatRelativeTimestamp(isoString) {
    if (!isoString) return 'No recent uploads';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return formatDateTimeMinutes(isoString);
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / (1000 * 60));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return formatDateTimeMinutes(isoString);
  }

  function attachImageFallbacks(container) {
    const nodes = container.querySelectorAll('img[data-role]');
    nodes.forEach(img => {
      const role = img.getAttribute('data-role');
      const fallback = role === 'avatar' ? PLACEHOLDERS.avatar : (role === 'pantry-photo' ? PLACEHOLDERS.pantry : PLACEHOLDERS.photo);
      const ensure = () => { if (!img.getAttribute('src')) img.setAttribute('src', fallback); };
      ensure();
      img.addEventListener('error', async () => {
        const attempted = img.getAttribute('data-sas-attempted') === '1';
        const rawSrc = (img.getAttribute('data-raw-src') || '').trim();
        // If backend stores private Azure Blob URLs (no SAS), resolve a temporary read URL on-demand.
        if (!attempted && rawSrc && rawSrc.includes('.blob.core.windows.net') && !rawSrc.includes('?')) {
          img.setAttribute('data-sas-attempted', '1');
          const readUrl = await resolveDonationImageReadUrl(rawSrc);
          if (readUrl) {
            img.setAttribute('src', readUrl);
            return;
          }
        }
        img.setAttribute('src', fallback);
      });
    });
  }

  // Initialize the application
  // Get pantry id from URL: ?pantryId=254 or #pantry/254
  function getPantryIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('pantryId') || params.get('pantry_id') || params.get('id');
    if (q) return String(q).trim();
    const hash = (window.location.hash || '').replace(/^#/, '');
    const m = hash.match(/^pantry\/(.+)$/i);
    if (m) return String(m[1]).trim();
    return null;
  }

  async function init() {
    console.log('Initializing Pantry Map Dashboard...');
    
    // Initialize the map
    initMap();
    
    // Load pantry data and create markers
    await loadPantries();
    
    // Open pantry detail from URL (e.g. ?pantryId=254 or #pantry/254) so pantry 254 detail page is reachable directly
    const urlPantryId = getPantryIdFromUrl();
    if (urlPantryId && allPantries.length > 0) {
      const normalized = String(urlPantryId).replace(/^p-?/i, '') || urlPantryId;
      const pantry = allPantries.find(p => {
        const id = String(p.id || '');
        return id === urlPantryId || id === 'p-' + normalized || id === normalized;
      });
      if (pantry) {
        showPantryDetails(pantry);
      }
    }
    
    // Render list for current view when no selection
    if (!currentPantry) showListForCurrentView();
    
    // Set up event listeners
    setupEventListeners();
    
    console.log('Dashboard initialized successfully');
  }

  // Initialize Leaflet map
  function initMap() {
    // Create map centered on Seattle area (where most pantries are), ~5km view
    map = L.map('map').setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    
    // Add Google-like basemap tiles (CARTO Voyager)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);
    
    // Position zoom control similar to Google Maps (top right)
    map.zoomControl.setPosition('topright');
    
    // Optional scale control
    L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);
    
    // Map legend: pin colors = pantry type
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      const div = document.createElement('div');
      div.className = 'map-legend';
      div.innerHTML = `
        <div class="map-legend-title">Legend</div>
        <div class="map-legend-item"><span class="map-legend-pin" style="background:#3b82f6"></span> Fridge</div>
        <div class="map-legend-item"><span class="map-legend-pin" style="background:#f59e0b"></span> Shelf</div>
        <div class="map-legend-item"><span class="map-legend-pin" style="background:#52b788"></span> Uncategorized</div>
      `;
      return div;
    };
    legend.addTo(map);
    
    console.log('Map initialized');
    // Update list as user moves/zooms the map, only if no pantry selected
    map.on('moveend', () => {
      if (!currentPantry) showListForCurrentView();
    });
  }

  /** Reset map to default 5km view (e.g. when returning from pantry detail). */
  function resetMapToDefaultView() {
    if (!map) return;
    if (map.flyTo) {
      map.flyTo(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, { animate: true, duration: 0.5 });
    } else {
      map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    }
  }

  // Load pantries from API and create markers
  async function loadPantries() {
    try {
      console.log('Loading pantries...');
      const pantries = await window.PantryAPI.getPantries();
      allPantries = pantries;
      console.log(`Loaded ${pantries.length} pantries`);
      
      // Create markers for each pantry
      pantries.forEach(pantry => {
        createPantryMarker(pantry);
      });
      
    } catch (error) {
      console.error('Error loading pantries:', error);
    }
  }

  function showListForCurrentView() {
    if (!map) return;
    const bounds = map.getBounds();
    let inView = allPantries.filter(p => {
      const { lat, lng } = p.location || {};
      return typeof lat === 'number' && typeof lng === 'number' && bounds.contains([lat, lng]);
    }).slice(0, 50);
    // Apply type filter
    if (listControlsState.type !== 'all') {
      inView = inView.filter(p => {
        const pantryType = (p.pantryType || '').toLowerCase();
        // Include uncategorized pantries (green) in all filters
        const isUncategorized = !pantryType || (pantryType !== 'shelf' && pantryType !== 'fridge');
        return isUncategorized || pantryType === listControlsState.type;
      });
    }
    // Compute stock level for sorting
    const withStock = inView.map(p => ({
      p,
      stock: (p.inventory && Array.isArray(p.inventory.categories)) ? p.inventory.categories.reduce((s, c) => s + (c.quantity || 0), 0) : 0,
      updated: p.sensors && p.sensors.updatedAt ? new Date(p.sensors.updatedAt).getTime() : 0,
    }));
    // Stock sorting
    if (listControlsState.stock === 'high-low') withStock.sort((a,b)=>b.stock - a.stock);
    if (listControlsState.stock === 'low-high') withStock.sort((a,b)=>a.stock - b.stock);
    // Restock sorting
    if (listControlsState.restock === 'newest') withStock.sort((a,b)=>b.updated - a.updated);
    if (listControlsState.restock === 'oldest') withStock.sort((a,b)=>a.updated - b.updated);
    inView = withStock.map(x=>x.p);

    const detailsPanel = document.getElementById('details');
    const detailsContent = document.getElementById('detailsContent');
    detailsPanel.classList.remove('hidden');
    detailsContent.innerHTML = renderPantryList(inView);
    attachImageFallbacks(detailsContent);
    updateCollapseButton(false);
    
    // Update map markers based on type filter
    updateMapMarkerVisibility();
  }

  function renderPantryList(items) {
    if (!items || items.length === 0) {
      return `
        <h2>Pantries in view</h2>
        <div class="empty">No pantries in the current view.</div>
      `;
    }
    return `
      <h2>Pantries in view (${items.length})</h2>
      <div class="list-controls">
        <label>
          <span>Type</span>
          <select id="listType">
            <option value="all" ${listControlsState.type==='all'?'selected':''}>All</option>
            <option value="fridge" ${listControlsState.type==='fridge'?'selected':''}>Fridge</option>
            <option value="shelf" ${listControlsState.type==='shelf'?'selected':''}>Shelf</option>
          </select>
        </label>
        <label>
          <span>Stock Level</span>
          <select id="listStock">
            <option value="any" ${listControlsState.stock==='any'?'selected':''}>Any</option>
            <option value="high-low" ${listControlsState.stock==='high-low'?'selected':''}>High → Low</option>
            <option value="low-high" ${listControlsState.stock==='low-high'?'selected':''}>Low → High</option>
          </select>
        </label>
        <label>
          <span>Last Restock</span>
          <select id="listRestock">
            <option value="newest" ${listControlsState.restock==='newest'?'selected':''}>Newest</option>
            <option value="oldest" ${listControlsState.restock==='oldest'?'selected':''}>Oldest</option>
          </select>
        </label>
      </div>
      <div class="list">
        ${items.map(p => renderListItem(p)).join('')}
      </div>
    `;
  }

  function getTotalStock(pantry) {
    return (pantry.inventory && Array.isArray(pantry.inventory.categories))
      ? pantry.inventory.categories.reduce((s, c) => s + (c.quantity || 0), 0)
      : 0;
  }

  function getStockBadge(total) {
    if (total <= 10) return { label: 'Low Stock', cls: 'low' };
    if (total <= 30) return { label: 'Medium Stock', cls: 'medium' };
    return { label: 'In Stock', cls: 'high' };
  }

  function formatRelativeDays(iso) {
    if (!iso) return 'Unknown';
    const t = new Date(iso).getTime();
    if (!t) return 'Unknown';
    const diff = Math.max(0, Date.now() - t);
    const days = Math.floor(diff / (24*60*60*1000));
    if (days === 0) return 'Restocked within 1 day';
    if (days === 1) return 'Restocked 1 day ago';
    return `Restocked ${days} days ago`;
  }

  function renderListItem(p) {
    const title = p.name || 'Untitled Pantry';
    const addrLine = (p.address || '').trim();
    const photo = (p.photos && p.photos[0]) || null;
    const total = getTotalStock(p);
    const stock = getStockBadge(total);
    const restock = formatRelativeDays(p.sensors && p.sensors.updatedAt);
    return `
      <button class="list-card list-item" data-id="${p.id}">
        <div class="thumb">${contentPhotoTag(photo, 72, title)}</div>
        <div class="list-main">
          <div class="list-row">
            <div class="list-title">${title}</div>
          </div>
          <div class="list-address">${addrLine}</div>
          <div class="list-meta">
            <span class="stock ${stock.cls}">${stock.label}</span>
            <span class="dot">•</span>
            <span class="restock">${restock}</span>
          </div>
        </div>
        <div class="chevron">›</div>
      </button>
    `;
  }

  // Create a marker for a pantry
  function createPantryMarker(pantry) {
    if (!pantry.location || !pantry.location.lat || !pantry.location.lng) {
      console.warn('Pantry missing location data:', pantry.id);
      return;
    }
    
    console.log(`Creating marker for ${pantry.name} at [${pantry.location.lat}, ${pantry.location.lng}]`);

    // Determine marker color based on pantryType (shelf vs fridge)
    const pantryType = (pantry.pantryType || '').toLowerCase();
    const typeColors = {
      'shelf': '#f59e0b',   // Orange for shelf
      'fridge': '#3b82f6'   // Blue for fridge
    };
    
    const color = typeColors[pantryType] || '#52b788'; // Default green if type unknown
    
    // Create custom icon with color based on pantry type
    const icon = L.divIcon({
      className: 'pantry-marker',
      html: `<div style="
        width: 32px;
        height: 32px;
        background: ${color};
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 3px 8px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.2s;
      " onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
        <div style="
          width: 12px;
          height: 12px;
          background: white;
          border-radius: 50%;
        "></div>
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    // Create marker
    const marker = L.marker([pantry.location.lat, pantry.location.lng], { icon })
      .addTo(map);
    
    // Add click handler
    marker.on('click', () => {
      showPantryDetails(pantry);
    });
    
    // Store marker reference
    markers.set(pantry.id, marker);
  }

  /** Refresh stock section from telemetry (sensor or donations). Call after posting a donation so the badge updates. */
  function refreshStockSectionForPantry(pantry) {
    if (!pantry || !pantry.id || !window.PantryAPI) return;
    const stockSection = document.querySelector('.stock-section .stock-card');
    if (!stockSection) return;
    function showUnavailable() {
      stockSection.innerHTML = `
        <div class="stock-card-head">
          <h2>Stock level</h2>
          <span class="stock-source-badge stock-source-badge-inactive">Sensor data unavailable. No reported stock in the last 24h.</span>
        </div>
        ${renderStockGauge(0, 40, 'inactive')}
      `;
    }
    function applyStock(weightKg, source) {
      if (weightKg == null || !window.PantryAPI.isWeightInReasonableRange(weightKg)) return false;
      const badge = window.PantryAPI.computeStockLevelFromWeight(weightKg);
      if (!badge) return false;
      const sourceLabel = source === 'donations' ? 'Estimated from donations' : 'From sensor';
      stockSection.innerHTML = `
        <div class="stock-card-head">
          <h2>Stock level</h2>
          <span class="stock-source-badge">${sourceLabel} · ${Number(weightKg).toFixed(1)} kg</span>
        </div>
        ${renderStockGauge(0, 40, badge.level)}
      `;
      return true;
    }
    function tryTelemetryThenDonations() {
      if (typeof window.PantryAPI.getTelemetryLatest !== 'function') {
        tryDonationStock();
        return;
      }
      window.PantryAPI.getTelemetryLatest(pantry.id).then(function (telemetry) {
        if (telemetry) {
          const weightKg = telemetry.weight != null ? Number(telemetry.weight) : (telemetry.weightKg != null ? Number(telemetry.weightKg) : null);
          const source = telemetry.source || 'sensor';
          if (applyStock(weightKg, source)) return;
        }
        tryDonationStock();
      }).catch(function () {
        tryDonationStock();
      });
    }
    function tryDonationStock() {
      if (typeof window.PantryAPI.getDonationBasedStock !== 'function') {
        showUnavailable();
        return;
      }
      window.PantryAPI.getDonationBasedStock(pantry.id).then(function (donationStock) {
        if (donationStock && donationStock.weightKg != null && applyStock(donationStock.weightKg, donationStock.source || 'donations')) return;
        showUnavailable();
      }).catch(showUnavailable);
    }
    tryTelemetryThenDonations();
  }

  // Show pantry details in side panel
  function showPantryDetails(pantry) {
    currentPantry = pantry;
    
    // Update details content
    const detailsContent = document.getElementById('detailsContent');
    detailsContent.innerHTML = renderPantryDetails(pantry);
    // Ensure images gracefully fallback
    attachImageFallbacks(detailsContent);
    // Initialize carousel if present
    setupCarousel(detailsContent);
    bindDonorNotesModule(detailsContent, pantry);
    bindWishlistModule(detailsContent, pantry);
    bindMessageModule(detailsContent, pantry);
    
    // Fetch latest telemetry (API → pantry_data → donations); update stock with weight and source badge
    function applyStockFromWeight(weightKg, source) {
      if (weightKg == null || !window.PantryAPI || !window.PantryAPI.isWeightInReasonableRange(weightKg)) return false;
      const badge = window.PantryAPI.computeStockLevelFromWeight(weightKg);
      if (!badge) return false;
      const stockSection = document.querySelector('.stock-section .stock-card');
      if (!stockSection) return false;
      const sourceLabel = source === 'donations' ? 'Estimated from donations' : 'From sensor';
      stockSection.innerHTML = `
        <div class="stock-card-head">
          <h2>Stock level</h2>
          <span class="stock-source-badge">${sourceLabel} · ${Number(weightKg).toFixed(1)} kg</span>
        </div>
        ${renderStockGauge(0, 40, badge.level)}
      `;
      return true;
    }
    if (window.PantryAPI && pantry && pantry.id) {
      const pid = pantry.id;
      var stockSection = document.querySelector('.stock-section .stock-card');
      function showStockUnavailable() {
        if (!stockSection) return;
        stockSection.innerHTML = `
          <div class="stock-card-head">
            <h2>Stock level</h2>
            <span class="stock-source-badge stock-source-badge-inactive">Sensor data unavailable. No reported stock in the last 24h.</span>
          </div>
          ${renderStockGauge(0, 40, 'inactive')}
        `;
      }
      if (typeof window.PantryAPI.getTelemetryLatest === 'function') {
        window.PantryAPI.getTelemetryLatest(pid).then(function (telemetry) {
          if (telemetry) {
            const weightKg = telemetry.weight != null ? Number(telemetry.weight) : (telemetry.weightKg != null ? Number(telemetry.weightKg) : null);
            const source = telemetry.source || 'sensor';
            if (applyStockFromWeight(weightKg, source)) return;
          }
          // Explicit fallback: try donation-based stock (in case telemetry fallback order skipped it)
          if (typeof window.PantryAPI.getDonationBasedStock === 'function') {
            return window.PantryAPI.getDonationBasedStock(pid).then(function (donationStock) {
              if (donationStock && donationStock.weightKg != null && applyStockFromWeight(donationStock.weightKg, donationStock.source || 'donations')) return;
              return loadStockFromPantryDataJson(pid).then(function (w) {
                if (!applyStockFromWeight(w, 'fallback_local')) showStockUnavailable();
              });
            });
          }
          return loadStockFromPantryDataJson(pid).then(function (w) {
            if (!applyStockFromWeight(w, 'fallback_local')) showStockUnavailable();
          });
        }).catch(function () {
          if (typeof window.PantryAPI.getDonationBasedStock === 'function') {
            return window.PantryAPI.getDonationBasedStock(pid).then(function (donationStock) {
              if (donationStock && donationStock.weightKg != null && applyStockFromWeight(donationStock.weightKg, donationStock.source || 'donations')) return;
              return loadStockFromPantryDataJson(pid).then(function (w) {
                if (!applyStockFromWeight(w, 'fallback_local')) showStockUnavailable();
              });
            });
          }
          return loadStockFromPantryDataJson(pid).then(function (w) {
            if (!applyStockFromWeight(w, 'fallback_local')) showStockUnavailable();
          });
        });
      } else {
        loadStockFromPantryDataJson(pid).then(function (w) {
          if (!applyStockFromWeight(w, 'fallback_local')) showStockUnavailable();
        });
      }
    }
    
    // Show details panel
    const detailsPanel = document.getElementById('details');
    detailsPanel.classList.remove('hidden');
    detailsPanel.classList.remove('collapsed');
    updateCollapseButton(false);
    
    // Pan/zoom map to marker
    const marker = markers.get(pantry.id);
    if (marker) {
      const target = marker.getLatLng();
      const targetZoom = Math.max(map.getZoom(), 16);
      if (map.flyTo) {
        map.flyTo(target, targetZoom, { animate: true, duration: 0.5 });
      } else {
        map.setView(target, targetZoom);
      }
    } else if (pantry.location && typeof pantry.location.lat === 'number' && typeof pantry.location.lng === 'number') {
      const target = [pantry.location.lat, pantry.location.lng];
      const targetZoom = Math.max(map.getZoom(), 16);
      map.setView(target, targetZoom);
    }
  }

  // Render pantry details HTML
  function renderPantryDetails(pantry) {
    const photosArr = Array.isArray(pantry.photos) ? pantry.photos : [];
    const photoUrl = photosArr.length > 0 ? photosArr[0] : '';
    const secondPhotoUrl = photosArr[1] || photosArr[0] || '';
    const totalItems = pantry.inventory?.categories?.reduce((sum, cat) => sum + (cat.quantity || 0), 0) || 0;
    const addressText = pantry.address || 'detail address unknown';
    const pantryTypeLabel = pantry.pantryType
      ? pantry.pantryType.charAt(0).toUpperCase() + pantry.pantryType.slice(1)
      : 'Pantry';
    
    // 逻辑：先看 hardware（传感器/重量），没有再用 donation
    const weightKg = pantry.stockLevelWeightKg != null ? Number(pantry.stockLevelWeightKg) : null;
    const hasHardware = weightKg != null && window.PantryAPI && typeof window.PantryAPI.isWeightInReasonableRange === 'function' && window.PantryAPI.isWeightInReasonableRange(weightKg);
    const sensorBadge = hasHardware && typeof window.PantryAPI.computeStockLevelFromWeight === 'function' ? window.PantryAPI.computeStockLevelFromWeight(weightKg) : null;

    let stockHtml;
    let stockSourceBadge = '';
    if (sensorBadge) {
      stockSourceBadge = '<span class="stock-source-badge">From sensor · ' + Number(weightKg).toFixed(1) + ' kg</span>';
      stockHtml = renderStockGauge(0, 40, sensorBadge.level);
    } else {
      stockSourceBadge = '<span class="stock-source-badge stock-source-badge-inactive">Loading...</span>';
      stockHtml = renderStockGauge(0, 40, 'inactive');
    }

    return `
      <div class="detail-hero">
        <div class="detail-hero-cover">
          ${pantryPhotoTag(photoUrl, pantry.name || 'Pantry photo', 'class="detail-hero-img"')}
          <span class="detail-hero-badge">${pantryTypeLabel}</span>
        </div>
        <div class="detail-hero-body">
          <h1 class="detail-title">${pantry.name || 'Untitled Pantry'}</h1>
          <div class="detail-subline">${addressText}</div>
        </div>
      </div>

      <section class="detail-section stock-section">
        <div class="stock-card">
          <div class="stock-card-head">
            <h2>Stock level</h2>
            ${stockSourceBadge}
          </div>
          ${stockHtml}
        </div>
      </section>

      <section class="detail-section donor-notes-section">
        <h2>Post a Donation</h2>
        <button class="donor-notes-cta" type="button" data-donor-note-add>report your new donation</button>
        <div class="donor-notes-latest" data-donor-notes-latest>
          <div class="donor-note-empty">Loading…</div>
        </div>
        <button class="donor-notes-toggle section-link" type="button" data-donor-notes-toggle hidden>View more</button>
      </section>

      <section class="detail-section detail-card-section wishlist-section" data-wishlist>
        <div class="detail-card-head section-heading-row">
          <h2>Pantry Wishlist</h2>
          <button class="wishlist-add" type="button" aria-label="Add wishlist item" data-wishlist-add>+</button>
        </div>
        <div class="wishlist-grid" data-wishlist-grid>
          <div class="wishlist-empty">Loading wishlist…</div>
        </div>
      </section>

      <section class="detail-section message-section">
        <h2>Leave a message</h2>
        <button class="message-cta" type="button" data-message-add>Leave a message to the host and the community</button>
        <div class="message-list" data-message-list>
          <div class="message-empty">Loading messages…</div>
        </div>
        <button class="message-toggle section-link" type="button" data-message-toggle hidden>View more</button>
      </section>
    `;
  }

  // Set up event listeners
  function setupEventListeners() {
    // Close details panel
    const closeBtn = document.getElementById('closeDetails');
    closeBtn.addEventListener('click', () => {
      const detailsPanel = document.getElementById('details');
      // If a pantry is selected, always go back to the list view (P2) and reset map to default 5km view
      if (currentPantry) {
        currentPantry = null;
        resetMapToDefaultView();
        detailsPanel.classList.remove('collapsed');
        showListForCurrentView();
        updateCollapseButton(false);
        return;
      }

      // Otherwise (already in list view), toggle collapsed state
      const willCollapse = !detailsPanel.classList.contains('collapsed');
      detailsPanel.classList.toggle('collapsed', willCollapse);
      if (!willCollapse) {
        showListForCurrentView();
      }
      updateCollapseButton(detailsPanel.classList.contains('collapsed'));
    });
    
    // Status filter
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        filterPantriesByStatus(e.target.value);
      });
    }

    // Delegate clicks on list items to open details
    const detailsContent = document.getElementById('detailsContent');
    if (detailsContent) {
      detailsContent.addEventListener('click', (e) => {
        const target = e.target.closest('.list-item');
        if (target) {
          e.preventDefault();
          const id = target.getAttribute('data-id');
          const p = allPantries.find(x => String(x.id) === String(id));
          if (p) showPantryDetails(p);
        }
      });
      // keyboard support
      detailsContent.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('list-item')) {
          e.preventDefault();
          const id = e.target.getAttribute('data-id');
          const p = allPantries.find(x => String(x.id) === String(id));
          if (p) showPantryDetails(p);
        }
      });
    }

    // Controls change events
    detailsContent.addEventListener('change', (e) => {
      const t = e.target;
      if (t && t.id === 'listType') { listControlsState.type = t.value; showListForCurrentView(); }
      if (t && t.id === 'listStock') { listControlsState.stock = t.value; showListForCurrentView(); }
      if (t && t.id === 'listRestock') { listControlsState.restock = t.value; showListForCurrentView(); }
    });

    // Fallback global delegation (in case list re-renders before handlers attach)
    document.addEventListener('click', (e) => {
      const target = e.target && e.target.closest && e.target.closest('.list-item');
      if (target) {
        e.preventDefault();
        const id = target.getAttribute('data-id');
        const p = allPantries.find(x => String(x.id) === String(id));
        if (p) showPantryDetails(p);
      }
    });
  }

  function updateCollapseButton(isCollapsed) {
    const btn = document.getElementById('closeDetails');
    if (!btn) return;
    btn.textContent = isCollapsed ? '›' : '←';
    btn.setAttribute('aria-label', isCollapsed ? 'Expand details' : 'Back to list');
  }

  async function resolveDonationImageReadUrl(blobUrl) {
    if (!blobUrl) return null;
    if (donationReadUrlCache[blobUrl]) return donationReadUrlCache[blobUrl];
    try {
      const data = await window.PantryAPI.getDonationReadSas(blobUrl);
      const readUrl = data?.readUrl || null;
      if (readUrl) donationReadUrlCache[blobUrl] = readUrl;
      return readUrl;
    } catch (e) {
      console.warn('Failed to get read URL for donation image', blobUrl, e);
      return null;
    }
  }

  // Load latest weight from pantry_data.json (device_to_pantry + scale1..4) for hardware pantry e.g. 254
  async function loadStockFromPantryDataJson(pantryId) {
    try {
      const pid = String(pantryId || '');
      // Try multiple base paths so fetch works whether page is at / or /index.html or /frontend/
      var dtpResp = await fetch('./data/device_to_pantry.json?' + Date.now());
      if (!dtpResp || !dtpResp.ok) dtpResp = await fetch('data/device_to_pantry.json?' + Date.now());
      if (!dtpResp || !dtpResp.ok) return null;
      const deviceToPantry = await dtpResp.json();
      const deviceId = Object.keys(deviceToPantry).find(function (k) { return String(deviceToPantry[k]) === pid || String(deviceToPantry[k]) === 'p-' + pid.replace(/^p-?/i, ''); });
      if (!deviceId) return null;
      var dataResp = await fetch('./pantry_data.json?' + Date.now());
      if (!dataResp || !dataResp.ok) dataResp = await fetch('pantry_data.json?' + Date.now());
      if (!dataResp || !dataResp.ok) return null;
      const list = await dataResp.json();
      const rows = Array.isArray(list) ? list.filter(function (r) { return (r.device_id || r.deviceId || '') === deviceId; }) : [];
      if (rows.length === 0) return null;
      const latest = rows.reduce(function (best, row) {
        const ts = new Date(row.timestamp || row.ts || row.time || 0).getTime();
        if (!best) return { row: row, ts: ts };
        return ts > best.ts ? { row: row, ts: ts } : best;
      }, null);
      if (!latest || !latest.row) return null;
      const r = latest.row;
      const s1 = Number(r.scale1 ?? 0);
      const s2 = Number(r.scale2 ?? 0);
      const s3 = Number(r.scale3 ?? 0);
      const s4 = Number(r.scale4 ?? 0);
      if (![s1, s2, s3, s4].some(function (v) { return Number.isFinite(v) && v !== 0; })) return null;
      var weightKg = s1 + s2 + s3 + s4;
      // Scales can be negative (unloaded); clamp to 0 so we show "Low" instead of rejecting
      if (Number.isFinite(weightKg) && weightKg < 0) weightKg = 0;
      return Number.isFinite(weightKg) ? weightKg : null;
    } catch (e) {
      console.warn('loadStockFromPantryDataJson failed', e);
      return null;
    }
  }

  function updateStockLevelFromDonations(pantry, donations) {
    // 有 hardware（传感器/重量）时不覆盖，只用 donation 补没有 hardware 的情况
    const weightKg = pantry.stockLevelWeightKg != null ? Number(pantry.stockLevelWeightKg) : null;
    if (weightKg != null && window.PantryAPI && typeof window.PantryAPI.isWeightInReasonableRange === 'function' && window.PantryAPI.isWeightInReasonableRange(weightKg)) {
      return;
    }
    // Pantry 254 (Beacon Hill) uses hardware telemetry; don't overwrite with "Lack of donation information"
    const pantryIdStr = String(pantry.id || '');
    if (pantryIdStr === '254' || pantryIdStr === 'p-254') {
      return;
    }
    
    // Find the stock gauge element
    const stockSection = document.querySelector('.stock-section .stock-card');
    if (!stockSection) return;
    
    // Recent donations within 24 hours (already filtered by caller)
    const recentDonations = donations && donations.length > 0 ? donations : [];
    
    // Count by donationSize: 5+ low_donation (ONE OR FEW ITEMS) → medium; 2+ medium_donation (ABOUT 1 GROCERY BAG) → high
    const countLow = recentDonations.filter(d => (d.donationSize || '') === 'low_donation').length;
    const countMedium = recentDonations.filter(d => (d.donationSize || '') === 'medium_donation').length;
    const countHigh = recentDonations.filter(d => (d.donationSize || '') === 'high_donation').length;
    
    let level = null;
    let badgeLabel = 'Based on recent donation';
    
    if (countMedium >= 2) {
      // 2+ "ABOUT ONE GROCERY BAG" → high_donation
      level = 'high';
      badgeLabel = 'Based on recent donations (2+ grocery bags)';
    } else if (countLow >= 5) {
      // 5+ "ONE OR FEW ITEMS" → medium_donation
      level = 'medium';
      badgeLabel = 'Based on recent donations (5+ small donations)';
    }
    
    // Fallback: use most recent donation's size
    if (level == null) {
      const mostRecentDonation = recentDonations.length > 0 ? recentDonations[0] : null;
      if (!mostRecentDonation || !mostRecentDonation.donationSize) {
        stockSection.innerHTML = `
          <div class="stock-card-head">
            <h2>Stock level</h2>
            <span class="stock-source-badge stock-source-badge-inactive">Lack of donation information</span>
          </div>
          ${renderStockGauge(0, 40, 'inactive')}
        `;
        return;
      }
      const donationSize = mostRecentDonation.donationSize;
      if (donationSize === 'low_donation') level = 'low';
      else if (donationSize === 'medium_donation') level = 'medium';
      else if (donationSize === 'high_donation') level = 'high';
    }
    
    if (level == null) {
      stockSection.innerHTML = `
        <div class="stock-card-head">
          <h2>Stock level</h2>
          <span class="stock-source-badge stock-source-badge-inactive">Lack of donation information</span>
        </div>
        ${renderStockGauge(0, 40, 'inactive')}
      `;
      return;
    }
    
    stockSection.innerHTML = `
      <div class="stock-card-head">
        <h2>Stock level</h2>
        <span class="stock-source-badge">${badgeLabel}</span>
      </div>
      ${renderStockGauge(0, 40, level)}
    `;
  }

  async function loadDonorNotes(pantry) {
    if (!pantry || !pantry.id || !donorNotesState.root) return;
    const container = donorNotesState.root;
    container.innerHTML = '<div class="donor-note-empty">Loading…</div>';
    try {
      // Fetch all donations (we'll filter by 24h on backend)
      const data = await window.PantryAPI.getDonations(pantry.id, 1, 100);
      const allItems = data?.items || [];
      
      // Backend already returns only donations within 24h; use all items (robust timestamp: createdAt/created_at/timestamp)
      const now = Date.now();
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
      const getDonationTimeMs = (item) => {
        const raw = item.createdAt ?? item.created_at ?? item.timestamp;
        if (raw == null || raw === '') return now;
        const t = new Date(raw).getTime();
        return Number.isFinite(t) ? t : now;
      };
      const recentItems = allItems.filter(item => getDonationTimeMs(item) >= twentyFourHoursAgo);
      
      donorNotesState.items = recentItems;
      donorNotesState.pantryId = String(pantry.id);
      donorNotesState.expanded = false;
      
      renderDonorNotes();
      
      // Update Stock Level based on donations if no hardware sensor data
      updateStockLevelFromDonations(pantry, recentItems);
    } catch (error) {
      console.error('Error loading donor notes:', error);
      container.innerHTML = '<div class="donor-note-empty">Unable to load.</div>';
    }
  }

  async function renderDonorNotes() {
    const container = donorNotesState.root;
    if (!container) return;
    
    // Find toggle button in the parent section
    const section = container.closest('.donor-notes-section');
    const toggleBtn = section ? section.querySelector('[data-donor-notes-toggle]') : null;
    
    const items = donorNotesState.items || [];
    container.innerHTML = '';
    
    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = '<div class="donor-note-empty">No donor reports yet.</div>';
      if (toggleBtn) toggleBtn.hidden = true;
      return;
    }

    const expanded = donorNotesState.expanded === true;
    const flatCount = 3;
    const toShow = expanded ? items : items.slice(0, flatCount);
    const hasMore = items.length > flatCount;

    // Resolve all photo URLs for items to show
    for (const note of toShow) {
      const photoUrls = Array.isArray(note.photoUrls) ? note.photoUrls : [];
      const resolvedUrls = await Promise.all(photoUrls.map((url) => resolveDonationImageReadUrl(url)));
      
      const card = document.createElement('article');
      card.className = 'donor-note-card';
      
      let inner = '';
      if (resolvedUrls.length) {
        inner += '<div class="donor-note-media">';
        resolvedUrls.forEach((readUrl) => {
          if (readUrl) inner += contentPhotoTag(readUrl, 160, 'Donor report photo');
        });
        inner += '</div>';
      }
      
      // Display donation size with human-readable labels
      const donationSize = note.donationSize || '';
      if (donationSize) {
        const sizeLabels = {
          'low_donation': 'ONE OR FEW ITEMS',
          'medium_donation': 'ABOUT 1 GROCERY BAG',
          'high_donation': 'MORE THAN 1 GROCERY BAG'
        };
        const sizeLabel = sizeLabels[donationSize] || donationSize;
        inner += `<p class="donor-note-text"><strong>Amount:</strong> ${sizeLabel.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
      }
      
      // Display donation items
      const donationItems = Array.isArray(note.donationItems) ? note.donationItems : [];
      if (donationItems.length > 0) {
        const itemsText = donationItems.join(', ');
        inner += `<p class="donor-note-text"><strong>Items:</strong> ${itemsText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
      }
      
      // Display message if present
      const noteText = note.note || '';
      if (noteText) {
        inner += `<p class="donor-note-text">${noteText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
      }
      
      const createdAt = note.createdAt || note.updatedAt || note.time || note.timestamp || '';
      if (createdAt) {
        inner += `<time class="donor-note-time" datetime="${createdAt}">${formatRelativeTimestamp(createdAt)}</time>`;
      }
      
      card.innerHTML = inner;
      container.appendChild(card);
    }

    attachImageFallbacks(container);

    if (toggleBtn) {
      if (hasMore) {
        toggleBtn.hidden = false;
        toggleBtn.textContent = expanded ? 'Collapse' : `View more (${items.length - flatCount} more)`;
      } else {
        toggleBtn.hidden = true;
      }
    }
  }

  function openDonorNoteModal(pantry, onSuccess) {
    const overlay = document.createElement('div');
    overlay.className = 'donor-note-modal-overlay';
    overlay.innerHTML = `
      <div class="donor-note-modal" role="dialog" aria-modal="true" aria-labelledby="donor-note-modal-title">
        <button type="button" class="donor-note-modal-close" aria-label="Close">×</button>
        <h3 id="donor-note-modal-title">Report your donation</h3>
        <p class="donor-note-modal-hint">Please select how much you are donating. All other fields are optional.</p>
        <form class="donor-note-form">
          <label>
            <span>How much are you donating?</span>
            <select name="donationSize" required>
              <option value="">Select size...</option>
              <option value="low_donation">ONE OR FEW ITEMS</option>
              <option value="medium_donation">ABOUT 1 GROCERY BAG</option>
              <option value="high_donation">MORE THAN 1 GROCERY BAG</option>
            </select>
          </label>
          <label>
            <span>What are you donating?</span>
            <select name="itemType">
              <option value="">Select type (optional)...</option>
              <option value="fresh produce">Fresh produce</option>
              <option value="cans">Cans</option>
              <option value="beans">Beans</option>
              <option value="liquids">Liquids</option>
              <option value="other">Other</option>
            </select>
            <input type="text" name="itemKeywords" class="donor-note-keywords-input" placeholder="Or add keywords (e.g., rice, pasta, vegetables)" />
          </label>
          <label class="donor-note-photo-label">
            <span>Post a photo!</span>
            <input type="file" name="photo" accept="image/*" />
          </label>
          <label>
            <span>Leave a message (optional)</span>
            <textarea name="message" rows="3" placeholder="Add any additional details about your donation..."></textarea>
          </label>
          <div class="donor-note-modal-error" aria-live="polite"></div>
          <div class="donor-note-modal-actions">
            <button type="button" class="donor-note-modal-cancel">Cancel</button>
            <button type="submit" class="donor-note-modal-submit">Submit report</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    const close = () => {
      document.body.classList.remove('modal-open');
      overlay.remove();
    };

    overlay.querySelector('.donor-note-modal-close').onclick = close;
    overlay.querySelector('.donor-note-modal-cancel').onclick = close;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    const form = overlay.querySelector('.donor-note-form');
    const submitBtn = overlay.querySelector('.donor-note-modal-submit');
    const errorEl = overlay.querySelector('.donor-note-modal-error');
    const photoInput = form.querySelector('input[name="photo"]');
    const donationSizeInput = form.querySelector('select[name="donationSize"]');
    const itemTypeInput = form.querySelector('select[name="itemType"]');
    const itemKeywordsInput = form.querySelector('input[name="itemKeywords"]');
    const messageInput = form.querySelector('textarea[name="message"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const donationSize = (donationSizeInput && donationSizeInput.value) ? String(donationSizeInput.value).trim() : '';
      const itemType = (itemTypeInput && itemTypeInput.value) ? String(itemTypeInput.value).trim() : '';
      const itemKeywords = (itemKeywordsInput && itemKeywordsInput.value) ? String(itemKeywordsInput.value).trim() : '';
      const message = (messageInput && messageInput.value) ? String(messageInput.value).trim() : '';
      const file = photoInput && photoInput.files && photoInput.files[0];
      
      if (!donationSize) {
        errorEl.textContent = 'Please select how much you are donating.';
        return;
      }

      // Combine item type and keywords
      const donationItems = [];
      if (itemType) donationItems.push(itemType);
      if (itemKeywords) {
        // Split keywords by comma or space and add them
        const keywords = itemKeywords.split(/[,\s]+/).filter(k => k.trim().length > 0);
        donationItems.push(...keywords);
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      try {
        let photoUrls = [];
        if (file) {
          const sas = await window.PantryAPI.createDonationUploadSas(pantry.id, file);
          const uploadUrl = sas?.uploadUrl;
          const blobUrl = sas?.blobUrl;
          if (!uploadUrl || !blobUrl) {
            throw new Error('Could not get upload link.');
          }
          const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'x-ms-blob-type': 'BlockBlob',
              'Content-Type': file.type
            },
            body: file
          });
          if (!putRes.ok) {
            throw new Error('Upload failed. Please try again.');
          }
          photoUrls = [blobUrl];
        }
        const payload = { 
          donationSize, 
          donationItems: donationItems.length > 0 ? donationItems : undefined,
          note: message || undefined,
          photoUrls 
        };
        console.log('Submitting donation report:', payload);
        await window.PantryAPI.postDonation(pantry.id, payload);
        if (donationSizeInput) donationSizeInput.value = '';
        if (itemTypeInput) itemTypeInput.value = '';
        if (itemKeywordsInput) itemKeywordsInput.value = '';
        if (messageInput) messageInput.value = '';
        if (photoInput) photoInput.value = '';
        if (typeof onSuccess === 'function') await onSuccess();
        close();
      } catch (error) {
        console.error('Error submitting donation report:', error);
        let errorMessage = 'Failed to submit. Please try again.';
        if (error && error.body) {
          if (typeof error.body === 'string') {
            try {
              const parsed = JSON.parse(error.body);
              errorMessage = parsed.error || parsed.message || errorMessage;
            } catch (_) {
              errorMessage = error.body;
            }
          } else if (error.body.error) {
            errorMessage = error.body.error;
          } else if (error.body.message) {
            errorMessage = error.body.message;
          }
        } else if (error && error.message) {
          errorMessage = error.message;
        }
        errorEl.textContent = errorMessage;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit report';
      }
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  function bindDonorNotesModule(root, pantry) {
    if (!root || !pantry || !pantry.id) return;
    const latestEl = root.querySelector('[data-donor-notes-latest]');
    const addBtn = root.querySelector('[data-donor-note-add]');
    const toggleBtn = root.querySelector('[data-donor-notes-toggle]');
    if (!latestEl || !addBtn) return;

    donorNotesState.root = latestEl;
    donorNotesState.pantryId = String(pantry.id);

    addBtn.onclick = () => openDonorNoteModal(pantry, async () => {
      await loadDonorNotes(pantry);
      refreshStockSectionForPantry(pantry);
    });
    
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        donorNotesState.expanded = !donorNotesState.expanded;
        renderDonorNotes();
      };
    }
    
    loadDonorNotes(pantry);
  }

  function bindWishlistModule(root, pantry) {
    if (!root || !pantry || !pantry.id) return;
    const grid = root.querySelector('[data-wishlist-grid]');
    const addBtn = root.querySelector('[data-wishlist-add]');
    if (!grid || !addBtn) return;

    const refresh = () => loadWishlist(pantry, grid);
    addBtn.onclick = () => openWishlistModal(pantry, refresh);
    refresh();
  }

  function normalizeWishlistItems(rawItems = []) {
    if (!Array.isArray(rawItems)) return [];
    return rawItems
      .map((entry, index) => {
        if (!entry) return null;
        const itemDisplay = String(entry.itemDisplay ?? entry.id ?? '').trim();
        if (!itemDisplay) return null;
        const parsedCount = Number(entry.count);
        const count = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1;
        return {
          id: entry.id ?? `wishlist-${index}`,
          itemDisplay,
          count,
          updatedAt: entry.updatedAt ?? entry.createdAt ?? null,
        };
      })
      .filter(Boolean);
  }

  async function loadWishlist(pantry, grid) {
    grid.innerHTML = `<div class="wishlist-empty">Loading wishlist…</div>`;
    try {
      const data = await window.PantryAPI.getWishlist(pantry.id);
      let items = Array.isArray(data)
        ? data
        : (Array.isArray(data?.items) ? data.items : []);
      if ((!items || items.length === 0) && Array.isArray(pantry.wishlist) && pantry.wishlist.length) {
        items = pantry.wishlist.map((name, idx) => ({
          id: `legacy-${idx}`,
          itemDisplay: name,
          count: 1,
          updatedAt: null
        }));
      }
      const normalized = normalizeWishlistItems(items);
      wishlistState.items = normalized;
      wishlistState.pantryId = pantry.id;
      wishlistState.root = grid;
      grid.__items = normalized;
      renderWishlistItems(grid, normalized);
    } catch (error) {
      console.error('Error loading wishlist:', error);
      grid.innerHTML = `<div class="wishlist-empty">Unable to load wishlist right now.</div>`;
    }
  }

  function renderWishlistItems(grid, items) {
    grid.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) {
      grid.innerHTML = `<div class="wishlist-empty">No wishlist items in the last 7 days.</div>`;
      return;
    }
    items.forEach(item => {
      const qty = Number.isFinite(item.count) && item.count > 0 ? item.count : 1; // Backend aggregates count
      const timestamp = item.updatedAt || item.createdAt || null; // Prefer freshest timestamp regardless of field name
      const itemDisplay = String(item.itemDisplay ?? item.id ?? 'Item'); // Use backend agg label
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'wishlist-chip';
      pill.title = timestamp ? `Updated ${formatRelativeTimestamp(timestamp)}` : '';
      pill.textContent = qty > 1 ? `${itemDisplay} × ${qty}` : itemDisplay; // Surface quantity inline when greater than one
      pill.addEventListener('click', async () => {
        if (!wishlistState.pantryId) return;
        const pantryId = String(wishlistState.pantryId);
        try {
          await window.PantryAPI.addWishlist(pantryId, itemDisplay, 1);
          // Refresh from backend to get latest state
          const data = await window.PantryAPI.getWishlist(pantryId);
          const refreshed = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
          const normalized = normalizeWishlistItems(refreshed);
          wishlistState.items = normalized;
          renderWishlistItems(grid, normalized);
        } catch (err) {
          console.error('Error re-adding wishlist item:', err);
        }
      });
      grid.appendChild(pill);
    });
  }

  async function loadMessages(pantry) {
    if (!pantry || !pantry.id || !messageState.root) return;
    const container = messageState.root;
    container.innerHTML = `<div class="message-empty">Loading messages…</div>`;
    try {
      const pantryId = String(pantry.id);
      const data = await window.PantryAPI.getMessages(pantryId);
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      messageState.items = items;
      messageState.expanded = false;
      messageState.pantryId = pantryId;
      renderMessages();
    } catch (error) {
      console.error('Error loading messages:', error);
      container.innerHTML = `<div class="message-empty">Unable to load messages right now.</div>`;
    }
  }

  function renderMessages() {
    const container = messageState.root;
    const toggleBtn = document.querySelector('[data-message-toggle]');
    if (!container) return;
    const items = messageState.items || [];
    container.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<div class="message-empty">No messages yet.</div>`;
      if (toggleBtn) toggleBtn.hidden = true;
      return;
    }

    const expanded = messageState.expanded === true;
    const latestCount = 3;
    const toShow = expanded ? items : items.slice(0, latestCount);
    const hasMore = items.length > latestCount;

    toShow.forEach((msg) => {
      const userName = (msg && (msg.userName || msg.name)) || 'Community member';
      const avatarUrl = msg?.userAvatar || msg?.avatarUrl || null;
      const content = msg?.content || msg?.message || '';
      const createdAt = msg?.createdAt || msg?.timestamp || msg?.time || '';
      const photos = Array.isArray(msg?.photos)
        ? msg.photos
        : (Array.isArray(msg?.images) ? msg.images : []);

      const card = document.createElement('article');
      card.className = 'message-card';

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.innerHTML = avatarTag(avatarUrl, 40, userName);
      card.appendChild(avatar);

      const body = document.createElement('div');
      body.className = 'message-body';

      const heading = document.createElement('h3');
      heading.textContent = userName;
      body.appendChild(heading);

      if (content) {
        const paragraph = document.createElement('p');
        paragraph.textContent = content;
        body.appendChild(paragraph);
      }

      if (photos && photos.length) {
        const media = document.createElement('div');
        media.className = 'message-media';
        media.innerHTML = photos.slice(0, 3)
          .map((url) => contentPhotoTag(url, 60, `${userName} upload`))
          .join('');
        body.appendChild(media);
      }

      const timeEl = document.createElement('time');
      if (createdAt) {
        timeEl.setAttribute('datetime', createdAt);
        timeEl.textContent = formatRelativeTimestamp(createdAt);
      } else {
        timeEl.textContent = '';
      }
      body.appendChild(timeEl);

      card.appendChild(body);
      container.appendChild(card);
    });

    attachImageFallbacks(container);

    if (toggleBtn) {
      if (hasMore) {
        toggleBtn.hidden = false;
        toggleBtn.textContent = expanded ? 'Collapse' : `View more (${items.length - latestCount} more)`;
      } else {
        toggleBtn.hidden = true;
      }
    }
  }

  function bindMessageModule(root, pantry) {
    if (!root || !pantry || !pantry.id) return;
    const list = root.querySelector('[data-message-list]');
    const addBtn = root.querySelector('[data-message-add]');
    const toggleBtn = root.querySelector('[data-message-toggle]');
    if (!list || !addBtn) return;

    messageState.root = list;
    messageState.pantryId = String(pantry.id);

    addBtn.onclick = async () => {
      const userNameInput = window.prompt('Your name (optional):') || 'Community member';
      const contentInput = window.prompt('Leave your message:');
      if (!contentInput || !contentInput.trim()) return;
      try {
        await window.PantryAPI.postMessage(
          String(pantry.id),
          contentInput.trim(),
          userNameInput.trim(),
          null,
          []
        );
        await loadMessages(pantry);
      } catch (error) {
        console.error('Error posting message:', error);
        window.alert('Failed to post message. Please try again.');
      }
    };

    if (toggleBtn) {
      toggleBtn.onclick = () => {
        messageState.expanded = !messageState.expanded;
        renderMessages();
      };
    }

    loadMessages(pantry);
  }

  function openWishlistModal(pantry, onSuccess) {
    const overlay = document.createElement('div');
    overlay.className = 'wishlist-modal-overlay';
    overlay.innerHTML = `
      <div class="wishlist-modal" role="dialog" aria-modal="true">
        <button type="button" class="wishlist-modal-close" aria-label="Close">×</button>
        <h3>Add wishlist item</h3>
        <form class="wishlist-form">
          <label>
            <span>Item name</span>
            <input type="text" name="item" maxlength="80" required placeholder="e.g. Rice" />
          </label>
          <label>
            <span>Quantity</span>
            <input type="number" name="quantity" min="1" max="99" value="1" />
          </label>
          <p class="wishlist-modal-hint">Items stay visible for 7 days.</p>
          <div class="wishlist-modal-error" aria-live="polite"></div>
          <div class="wishlist-modal-actions">
            <button type="button" class="wishlist-modal-cancel">Cancel</button>
            <button type="submit" class="wishlist-modal-submit">Add item</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    const close = () => {
      document.body.classList.remove('modal-open');
      overlay.remove();
    };

    overlay.querySelector('.wishlist-modal-close').onclick = close;
    overlay.querySelector('.wishlist-modal-cancel').onclick = close;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    const form = overlay.querySelector('.wishlist-form');
    const submitBtn = overlay.querySelector('.wishlist-modal-submit');
    const errorEl = overlay.querySelector('.wishlist-modal-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const formData = new FormData(form);
      const item = String(formData.get('item') || '').trim();
      let quantity = parseInt(formData.get('quantity'), 10);
      if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
      if (!item) {
        errorEl.textContent = 'Please enter an item name.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding…';

      try {
        await window.PantryAPI.addWishlist(pantry.id, item, quantity);
        if (typeof onSuccess === 'function') await onSuccess(); // Re-fetch wishlist immediately after add
        close();
      } catch (error) {
        console.error('Error creating wishlist item:', error);
        errorEl.textContent = 'Failed to add item. Please try again.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add item';
      }
    });
  }

  // Filter pantries by status
  function filterPantriesByStatus(status) {
    markers.forEach((marker, pantryId) => {
      // This would need to be implemented with actual pantry data
      // For now, just show all markers
      marker.setOpacity(1);
    });
  }

  // Update map marker visibility based on filter
  function updateMapMarkerVisibility() {
    const selectedType = listControlsState.type;
    
    allPantries.forEach(pantry => {
      const marker = markers.get(pantry.id);
      if (!marker) return;
      
      const pantryType = (pantry.pantryType || '').toLowerCase();
      
      // Green markers (uncategorized) should always be visible
      const isUncategorized = !pantryType || (pantryType !== 'shelf' && pantryType !== 'fridge');
      
      // Show/hide marker based on type filter
      if (selectedType === 'all' || isUncategorized) {
        // Show all markers when "all" selected, or always show uncategorized (green)
        marker.setOpacity(1);
      } else {
        // Show only markers that match the selected type
        if (pantryType === selectedType) {
          marker.setOpacity(1);
        } else {
          marker.setOpacity(0);
        }
      }
    });
  }

  // Update pantry marker (for real-time updates)
  function updatePantryMarker(pantry) {
    const marker = markers.get(pantry.id);
    if (marker) {
      // Update marker appearance if needed
      // This would be called when sensor data updates
    }
  }

  function setupCarousel(root) {
    const carousel = root.querySelector('[data-role="pantry-carousel"]');
    if (!carousel) return;
    const slides = Array.from(carousel.querySelectorAll('.slide'));
    const dots = Array.from(carousel.querySelectorAll('.dot'));
    if (slides.length <= 1) return;
    let index = 0;
    const update = () => {
      slides.forEach((s, i) => s.classList.toggle('active', i === index));
      dots.forEach((d, i) => d.classList.toggle('active', i === index));
    };
    const prev = carousel.querySelector('.prev');
    const next = carousel.querySelector('.next');
    prev && prev.addEventListener('click', () => { index = (index - 1 + slides.length) % slides.length; update(); });
    next && next.addEventListener('click', () => { index = (index + 1) % slides.length; update(); });
    dots.forEach((d, i) => d.addEventListener('click', () => { index = i; update(); }));
    update();
  }

  // Expose functions globally for external updates
  window.PantryMap = {
    updatePantryMarker,
    showPantryDetails
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

