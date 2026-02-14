// my-pantry.js - Enhanced with List View and Detail View
// ========================================================

// Global state for view management
let currentView = 'list'; // 'list' or 'detail'
let selectedPantry = null;
let allPantries = [];
let filteredPantries = [];

// Placeholder image for pantries without photos
const PANTRY_PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="%23f0fdf4"/><stop offset="100%" stop-color="%23dcfce7"/></linearGradient></defs><rect width="400" height="200" fill="url(%23g)"/><text x="200" y="110" text-anchor="middle" font-family="system-ui" font-size="18" fill="%2352b788" opacity="0.7">Pantry</text></svg>';

// 1. 直接把 dashboard_data.json 的内容粘贴在这里 (绕过所有文件读取问题)
const fallbackData = {
  "modules": {
    "performance": {
      "stockLevel": 25.8,
      "temperature": 10.7,
      "doorVisits": 326,
      "batteryStatus": "84%"
    },
    "persona": {
      "name": "Beacon Hill Pantry",
      "status": "Open",
      "goal": { "current": 326, "target": 500 },
      "preferences": ["Canned Veg", "Pasta", "Baby Formula"]
    },
    "highlights": {
      "hasAlert": true,
      "alertMessage": "High Temperature Detected",
      "recentActivity": [
        { "action": "Pantry Accessed", "time": "2026-01-29 21:33:13", "details": "Temp: 10.66°C" },
        { "action": "Pantry Accessed", "time": "2026-01-29 21:19:05", "details": "Temp: 10.61°C" },
        { "action": "Pantry Accessed", "time": "2026-01-29 19:10:36", "details": "Temp: 9.81°C" }
      ]
    }
  }
};

// ========================================================
// PANTRY LIST VIEW FUNCTIONS
// ========================================================

// Load all pantries from API or JSON file
async function loadAllPantries() {
  try {
    // Try API first
    if (window.PantryAPI && window.PantryAPI.getPantries) {
      const pantries = await window.PantryAPI.getPantries();
      if (Array.isArray(pantries) && pantries.length > 0) {
        return pantries;
      }
    }
    // Fallback to local JSON
    const resp = await fetch('./pantries.json');
    const pantries = await resp.json();
    return Array.isArray(pantries) ? pantries : [];
  } catch (e) {
    console.warn('Failed to load pantries:', e);
    return [];
  }
}

// Stock level: prefer weight-based (sens_weight / tot_reported_weight) from API; fallback to item count
function calculateStockLevel(pantry) {
  const weightKg = pantry.stockLevelWeightKg != null ? pantry.stockLevelWeightKg : null;
  if (weightKg != null && window.PantryAPI && window.PantryAPI.computeStockLevelFromWeight && window.PantryAPI.isWeightInReasonableRange(weightKg)) {
    const badge = window.PantryAPI.computeStockLevelFromWeight(weightKg);
    if (badge) {
      const params = window.PantryAPI.STOCK_PARAMS || { low_weight: 5, high_weight: 25 };
      let ratio = 0;
      if (weightKg <= params.low_weight) ratio = weightKg / params.low_weight;
      else if (weightKg <= params.high_weight) ratio = 0.33 + 0.34 * (weightKg - params.low_weight) / (params.high_weight - params.low_weight);
      else ratio = Math.min(1, 0.67 + (weightKg - params.high_weight) / (params.high_weight * 2));
      return { level: badge.level, label: badge.label, total: weightKg, ratio: Math.min(ratio, 1), weightKg };
    }
  }
  const categories = pantry.inventory?.categories || [];
  const total = categories.reduce((sum, cat) => sum + (cat.quantity || 0), 0);
  const capacity = 40;
  const ratio = Math.min(total / capacity, 1);
  if (ratio >= 0.6) return { level: 'high', label: 'High', total, ratio };
  if (ratio >= 0.3) return { level: 'medium', label: 'Medium', total, ratio };
  return { level: 'low', label: 'Low', total, ratio };
}

// Render a single pantry card
function renderPantryCard(pantry) {
  const stock = calculateStockLevel(pantry);
  const photoUrl = (pantry.photos && pantry.photos[0]) || PANTRY_PLACEHOLDER;
  const status = pantry.status || 'open';
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  const address = pantry.address || 'Address not available';
  const lastUpdated = (pantry.stockLevelUpdatedAt || pantry.sensors?.updatedAt)
    ? new Date(pantry.stockLevelUpdatedAt || pantry.sensors.updatedAt).toLocaleDateString()
    : 'N/A';

  // Check if the photo URL is valid (not placeholder or empty)
  const hasValidPhoto = photoUrl && photoUrl !== PANTRY_PLACEHOLDER && !photoUrl.startsWith('data:');

  return `
    <div class="mp-pantry-card" data-pantry-id="${pantry.id}">
      ${hasValidPhoto
        ? `<img class="mp-pantry-card-image" src="${escapeHtmlGlobal(photoUrl)}" alt="${escapeHtmlGlobal(pantry.name || 'Pantry')}" onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';" /><div class="mp-pantry-card-image-placeholder" style="display:none;">No Image</div>`
        : `<div class="mp-pantry-card-image-placeholder">No Image</div>`
      }
      <div class="mp-pantry-card-body">
        <div class="mp-pantry-card-header">
          <h3 class="mp-pantry-card-title">${escapeHtmlGlobal(pantry.name || 'Untitled Pantry')}</h3>
          <span class="mp-pantry-card-status ${status}">${statusLabel}</span>
        </div>
        <div class="mp-pantry-card-address">
          <i class="fa-solid fa-location-dot"></i>
          <span>${escapeHtmlGlobal(address)}</span>
        </div>
        <div class="mp-pantry-card-stats">
          <div class="mp-stat">
            <span class="mp-stat-label">Stock Level</span>
            <div class="mp-stock-gauge-mini">
              <div class="mp-stock-bar">
                <div class="mp-stock-bar-fill ${stock.level}" style="width: ${stock.ratio * 100}%"></div>
              </div>
              <span class="mp-stat-value ${stock.level}">${stock.label}</span>
            </div>
          </div>
          <div class="mp-stat">
            <span class="mp-stat-label">${stock.weightKg != null ? 'Weight' : 'Items'}</span>
            <span class="mp-stat-value">${stock.weightKg != null ? `${Number(stock.total).toFixed(1)} kg` : stock.total}</span>
          </div>
          <div class="mp-stat">
            <span class="mp-stat-label">Updated</span>
            <span class="mp-stat-value">${lastUpdated}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Render the pantry list
function renderPantryList(pantries) {
  const listContainer = document.getElementById('mp-pantry-list');
  if (!listContainer) return;

  if (!pantries || pantries.length === 0) {
    listContainer.innerHTML = `
      <div class="mp-empty-state">
        <div class="mp-empty-state-icon">📦</div>
        <div class="mp-empty-state-text">No pantries found</div>
        <div class="mp-empty-state-hint">Try adjusting your filters or check back later</div>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = pantries.map(p => renderPantryCard(p)).join('');

  // Add click handlers to cards
  listContainer.querySelectorAll('.mp-pantry-card').forEach(card => {
    card.addEventListener('click', () => {
      const pantryId = card.getAttribute('data-pantry-id');
      const pantry = allPantries.find(p => String(p.id) === String(pantryId));
      if (pantry) {
        showPantryDetail(pantry);
      }
    });
  });
}

// Filter pantries based on search and filters
function filterPantries() {
  const searchInput = document.getElementById('mp-search');
  const statusFilter = document.getElementById('mp-filter-status');
  const stockFilter = document.getElementById('mp-filter-stock');

  const searchTerm = (searchInput?.value || '').toLowerCase().trim();
  const statusValue = statusFilter?.value || 'all';
  const stockValue = stockFilter?.value || 'all';

  filteredPantries = allPantries.filter(pantry => {
    // Search filter
    if (searchTerm) {
      const name = (pantry.name || '').toLowerCase();
      const address = (pantry.address || '').toLowerCase();
      if (!name.includes(searchTerm) && !address.includes(searchTerm)) {
        return false;
      }
    }

    // Status filter
    if (statusValue !== 'all') {
      const status = (pantry.status || 'open').toLowerCase();
      if (status !== statusValue) return false;
    }

    // Stock filter
    if (stockValue !== 'all') {
      const stock = calculateStockLevel(pantry);
      if (stock.level !== stockValue) return false;
    }

    return true;
  });

  renderPantryList(filteredPantries);
}

// Show list view
function showListView() {
  currentView = 'list';
  selectedPantry = null;

  // 停止 pantry_data.json 的定时刷新
  if (window._pantryDataRefreshInterval) {
    clearInterval(window._pantryDataRefreshInterval);
    window._pantryDataRefreshInterval = null;
  }

  const listView = document.getElementById('pantry-list-view');
  const detailView = document.getElementById('pantry-detail-view');

  if (listView) listView.style.display = 'block';
  if (detailView) detailView.style.display = 'none';

  // Update URL without pantryId
  const url = new URL(window.location.href);
  url.searchParams.delete('pantryId');
  window.history.pushState({}, '', url);
}

// Show pantry detail view
function showPantryDetail(pantry) {
  currentView = 'detail';
  selectedPantry = pantry;

  const listView = document.getElementById('pantry-list-view');
  const detailView = document.getElementById('pantry-detail-view');

  if (listView) listView.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  // Update URL with pantryId
  const url = new URL(window.location.href);
  url.searchParams.set('pantryId', pantry.id);
  window.history.pushState({}, '', url);

  // Initialize detail view with selected pantry
  initDetailView(pantry);
}

// Initialize the list view
async function initListView() {
  const listContainer = document.getElementById('mp-pantry-list');
  if (listContainer) {
    listContainer.innerHTML = '<div class="mp-loading">Loading your pantries...</div>';
  }

  // Load pantries
  allPantries = await loadAllPantries();
  filteredPantries = allPantries;
  renderPantryList(filteredPantries);

  // Setup filter event listeners
  const searchInput = document.getElementById('mp-search');
  const statusFilter = document.getElementById('mp-filter-status');
  const stockFilter = document.getElementById('mp-filter-stock');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(filterPantries, 300));
  }
  if (statusFilter) {
    statusFilter.addEventListener('change', filterPantries);
  }
  if (stockFilter) {
    stockFilter.addEventListener('change', filterPantries);
  }

  // Setup back button
  const backBtn = document.getElementById('mp-back-to-list');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showListView();
    });
  }
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Global escapeHtml function
function escapeHtmlGlobal(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// Initialize detail view with a specific pantry
async function initDetailView(pantry) {
  if (!pantry) return;

  // Apply any saved local settings
  applySavedSettingsToPantryGlobal(pantry);

  // Update title and subtitle
  const titleEl = document.getElementById('pantryTitle');
  const subtitleEl = document.getElementById('pantrySubtitle');
  if (titleEl) titleEl.textContent = pantry.name || 'My Pantry';
  if (subtitleEl) subtitleEl.textContent = pantry.address || '';

  // Render detail sections (these will be called from within the IIFE)
  if (typeof window._renderBasicInfo === 'function') window._renderBasicInfo(pantry);
  if (typeof window._renderStatusCards === 'function') window._renderStatusCards(pantry);
  if (typeof window._renderInventoryCategories === 'function') window._renderInventoryCategories(pantry);
  if (typeof window._renderWishlist === 'function') await window._renderWishlist(pantry.id);
  if (typeof window._setupMiniMap === 'function') window._setupMiniMap(pantry);
  if (typeof window._renderActivities === 'function') {
    const activities = window._getActivitiesByPantryId ? window._getActivitiesByPantryId(pantry.id) : [];
    window._renderActivities(activities);
  }
  if (typeof window._initSettingsSection === 'function') window._initSettingsSection(pantry);

  // Load sensor data: prefer real-time API (getTelemetryLatest e.g. 254), then pantry_data.json, then CSV fallback
  if (window._pantryDataRefreshInterval) {
    clearInterval(window._pantryDataRefreshInterval);
    window._pantryDataRefreshInterval = null;
  }
  // 1) 优先用实时 telemetry API（Beacon Hill 254 等）更新传感器重量
  if (typeof window._applyTelemetryLatestToPantry === 'function') {
    try {
      await window._applyTelemetryLatestToPantry(pantry.id);
    } catch (e) { console.warn('getTelemetryLatest failed', e); }
  }
  if (typeof window._loadPantryDataJsonAndRender === 'function') {
    try {
      const result = await window._loadPantryDataJsonAndRender(pantry.id);
      if (result) {
        // 每 30 分钟重新请求实时 telemetry + pantry_data 并刷新 Sensors
        const THIRTY_MIN_MS = 30 * 60 * 1000;
        window._pantryDataRefreshInterval = setInterval(async () => {
          if (currentView !== 'detail' || !selectedPantry || selectedPantry.id !== pantry.id) return;
          try {
            if (typeof window._applyTelemetryLatestToPantry === 'function') {
              await window._applyTelemetryLatestToPantry(pantry.id);
            }
            await window._loadPantryDataJsonAndRender(pantry.id);
          } catch (e) {}
        }, THIRTY_MIN_MS);
      } else {
        if (selectedPantry && String(selectedPantry.id) === String(pantry.id) && selectedPantry.sensorsUnavailable && typeof applyPantryDataToUI === 'function') {
          applyPantryDataToUI({
            modules: {
              performance: { sensorsUnavailable: true },
              persona: { name: selectedPantry.name || 'My Pantry', status: selectedPantry.status || 'Open' },
              highlights: { recentActivity: [] },
            },
          });
        }
        if (typeof window._loadBeaconCSVAndRender === 'function') {
          await window._loadBeaconCSVAndRender('BeaconHill_2026-01-22_to_2026-01-29.csv');
        }
      }
    } catch(e) {}
  } else if (typeof window._loadBeaconCSVAndRender === 'function') {
    try { await window._loadBeaconCSVAndRender('BeaconHill_2026-01-22_to_2026-01-29.csv'); } catch(e) {}
  }

  // Reset tabs to overview
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const overviewTab = document.querySelector('.tab[data-tab="overview"]');
  const overviewPanel = document.getElementById('tab-overview');
  if (overviewTab) overviewTab.classList.add('active');
  if (overviewPanel) overviewPanel.classList.add('active');
}

// Helper to apply saved settings (called from outside IIFE)
function applySavedSettingsToPantryGlobal(pantry) {
  if (!pantry || !pantry.id) return;
  try {
    const key = `pantry_settings_${pantry.id}`;
    const s = localStorage.getItem(key);
    if (!s) return;
    const settings = JSON.parse(s);
    if (settings.name) pantry.name = settings.name;
    if (settings.address) pantry.address = settings.address;
    if (settings.description) pantry.description = settings.description;
    if (settings.contact) pantry.contact = Object.assign({}, pantry.contact || {}, settings.contact);
    if (settings.notifications) pantry.notifications = settings.notifications;
    if (settings.deactivated) pantry.deactivated = settings.deactivated;
  } catch(e) {}
}

// ========================================================
// END PANTRY LIST VIEW FUNCTIONS
// ========================================================

// 2. Render function — maps dashboard_data.json (modules structure) to UI
function applyPantryDataToUI(data) {
    if (!data || !data.modules) return;

    // --- A. Title --- Only update if in detail view (check if detail view is visible)
    // Don't overwrite the list view title
    const detailView = document.getElementById('pantry-detail-view');
    const isDetailViewVisible = detailView && detailView.style.display !== 'none';
    if (isDetailViewVisible) {
        const titleEl = document.getElementById('pantryTitle');
        if (titleEl && data.modules.persona && data.modules.persona.name) {
            titleEl.innerText = data.modules.persona.name;
        }
    }

    // --- B. Status Cards (Weight / Temperature / Battery) ---
    const perf = data.modules.performance;
    const statusRoot = document.getElementById('statusCards');
    if (perf && statusRoot) {
      const weight = perf.sensorsUnavailable && perf.stockLevel === undefined ? 'Sensor data unavailable. No reported stock in the last 24h.' : (perf.stockLevel !== undefined ? perf.stockLevel + ' kg' : '\u2014');
      const temp = perf.temperature !== undefined ? perf.temperature + ' \u00B0C' : '\u2014';
      const battery = perf.batteryStatus !== undefined ? perf.batteryStatus : '\u2014';
      const visits = perf.doorVisits !== undefined ? perf.doorVisits : '\u2014';
      statusRoot.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
          <div class="status-small" style="min-width:120px;padding:12px;border-radius:8px;background:#fff;border:1px solid #eee;">
            <div class="label">Current Weight</div><div class="value">${escapeHtml(String(weight))}</div>
          </div>
          <div class="status-small" style="min-width:120px;padding:12px;border-radius:8px;background:#fff;border:1px solid #eee;">
            <div class="label">Temperature</div><div class="value">${escapeHtml(String(temp))}</div>
          </div>
          <div class="status-small" style="min-width:120px;padding:12px;border-radius:8px;background:#fff;border:1px solid #eee;">
            <div class="label">Battery</div><div class="value">${escapeHtml(String(battery))}</div>
          </div>
          <div class="status-small" style="min-width:120px;padding:12px;border-radius:8px;background:#fff;border:1px solid #eee;">
            <div class="label">Door Visits</div><div class="value">${escapeHtml(String(visits))}</div>
          </div>
        </div>`;
    }

    // --- C. Recent Activity from highlights.recentActivity -> Activity tab (#activityLog) ---
    // NOTE: #activitySummaryList (Sensors tab) is reserved for CSV door cycles.
    const activityLog = document.getElementById('activityLog');
    if (!activityLog) return;

    const activities = (data.modules.highlights && Array.isArray(data.modules.highlights.recentActivity))
      ? data.modules.highlights.recentActivity
      : [];

    if (activities.length === 0) {
      activityLog.innerHTML = '<div class="empty-state">No recent activities</div>';
      return;
    }

    activityLog.innerHTML = '';
    activities.forEach(item => {
      const action = item.action || '';
      const time = item.time || '';
      const details = item.details || '';

      // Format time string
      let timeStr = time;
      try {
        const cand = time.replace(' ', 'T');
        const d = new Date(cand);
        if (!Number.isNaN(d.getTime())) timeStr = d.toLocaleString();
      } catch(e) { /* keep raw */ }

      // Pick icon based on action text
      let icon = '\uD83D\uDCDD'; // default
      const aLow = action.toLowerCase();
      if (aLow.includes('access')) icon = '\uD83D\uDEAA';
      else if (aLow.includes('restock') || aLow.includes('donation')) icon = '\uD83D\uDED2';
      else if (aLow.includes('alert') || aLow.includes('temp')) icon = '\u26A0\uFE0F';

      const card = document.createElement('div');
      card.className = 'activity-card';
      card.innerHTML = `
        <div class="weight-change-box"><div class="change-icon">${icon}</div></div>
        <div class="event-info">
          <div class="event-date">${escapeHtml(timeStr)}</div>
          <div class="event-times"><div class="event-duration">${escapeHtml(details)}</div></div>
        </div>
        <div class="event-action"><div class="action-label">${escapeHtml(action)}</div></div>`;
      activityLog.appendChild(card);
    });
}

// helper escapeHtml (lightweight)
function escapeHtml(text){ const d=document.createElement('div'); d.textContent = text; return d.innerHTML; }

// 3. 页面加载完成后立即运行
document.addEventListener('DOMContentLoaded', () => {
    try{ applyPantryDataToUI(fallbackData); }catch(e){ console.error('apply fallback failed', e); }
});

// Immediate data loader (runs at top)
function loadAndApplyDashboard(){
  const path = './data/dashboard_data.json';
  fetch(path + '?nocache=' + new Date().getTime())
    .then(res => { if(!res.ok) throw new Error('File not found at ' + res.url); return res.json(); })
    .then(data => {
      try{ applyPantryDataToUI(data); }catch(err){ /* render error */ }
    })
    .catch(err => { try{ showFetchAlert('Failed to load dashboard_data.json — check path and server.'); }catch(e){} });
}
loadAndApplyDashboard();

// 强制启用滚动（紧急修复）
document.addEventListener('DOMContentLoaded', function() {
  try{
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.height = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    document.body.style.minHeight = '100vh';
    // 移除明显阻止滚动的内联样式
    document.body.classList.remove('modal-open');
    // 检查并 relax overflow hidden where reasonable
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      try{
        const computed = window.getComputedStyle(el);
        if (computed && computed.overflow === 'hidden' && computed.height && computed.height !== 'auto') {
          el.style.overflow = 'visible';
        }
      }catch(e){}
    });
  }catch(e){ console.warn('scroll-fix error', e); }
});

(function(){
  'use strict';

  // Utility functions
  function getQueryParam(name) { try { return new URLSearchParams(window.location.search).get(name); } catch(e){return null;} }
  function formatDateTimeMinutes(isoString) { const d=new Date(isoString); if (Number.isNaN(d.getTime())) return 'Unknown'; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function formatWeightDisplay(w){ if (w===null||w===undefined||Number.isNaN(Number(w))) return '--'; return `${Number(w).toFixed(2)} kg`; }
  function formatKgDelta(delta){ if (delta===null||delta===undefined||Number.isNaN(Number(delta))) return '—'; const sign = delta>0?'+':''; return `${sign}${delta.toFixed(2)} kg`; }

  // Data parsers and processors (same logic as app)
  function parseTelemetryHistory(items){ if (!Array.isArray(items)) return {weight:[],doors:[]}; const weight=[]; const doors=[]; items.forEach(item=>{ const ts=item.ts; let weightKg=NaN; if (item.mass!==undefined&&item.mass!==null){ const n=Number(item.mass); if(!Number.isNaN(n)) weightKg=n*0.453592; } const metricsWeight=Number(item.metrics?.weightKg ?? item.metrics?.weightkg ?? NaN); if (Number.isNaN(weightKg) && !Number.isNaN(metricsWeight)) weightKg=metricsWeight; if (!Number.isNaN(weightKg)) weight.push({ts,weightKg}); const doorRaw = (item.door!==undefined&&item.door!==null)?item.door:item.flags?.door; let doorState=null; if (doorRaw===1||doorRaw==='1'||doorRaw==='open'||doorRaw==='opened') doorState='open'; if (doorRaw===0||doorRaw==='0'||doorRaw==='closed'||doorRaw==='close') doorState='closed'; if (doorState) doors.push({ts,status:doorState}); }); weight.sort((a,b)=>new Date(a.ts)-new Date(b.ts)); doors.sort((a,b)=>new Date(a.ts)-new Date(b.ts)); return {weight,doors}; }

  function processDoorEvents(items){ if(!Array.isArray(items)||items.length===0) return []; const timeline = items.map(item=>{ const ts=item.ts; let massKg=NaN; if (item.mass!==undefined&&item.mass!==null){ const n=Number(item.mass); if(!Number.isNaN(n)) massKg=n*0.453592; } const metricsWeight=Number(item.metrics?.weightKg ?? item.metrics?.weightkg ?? NaN); if (Number.isNaN(massKg) && !Number.isNaN(metricsWeight)) massKg=metricsWeight; const doorRaw=(item.door!==undefined&&item.door!==null)?item.door:item.flags?.door; let doorState=null; if (doorRaw===1||doorRaw==='1'||doorRaw==='open'||doorRaw==='opened') doorState='open'; if (doorRaw===0||doorRaw==='0'||doorRaw==='closed'||doorRaw==='close') doorState='closed'; return {ts,massKg:Number.isFinite(massKg)?massKg:null,doorState}; }).sort((a,b)=>new Date(a.ts)-new Date(b.ts)); const cycles=[]; let waitingOpen=null; for(let i=0;i<timeline.length;i++){ const ev=timeline[i]; if(!ev.doorState) continue; if(ev.doorState==='open'){ if(!waitingOpen) waitingOpen={openTs:ev.ts,openMass:ev.massKg}; else if(ev.massKg!==null) waitingOpen.openMass=ev.massKg; } if(ev.doorState==='closed'){ if(waitingOpen){ const cycle={openTs:waitingOpen.openTs,openMass:waitingOpen.openMass,closeTs:ev.ts,closeMass:ev.massKg}; if(cycle.openMass===null){ for(let j=Math.max(0,i-1);j>=0;j--){ if(timeline[j].massKg!==null){ cycle.openMass=timeline[j].massKg; break; } } } if(cycle.closeMass===null){ for(let j=i+1;j<timeline.length;j++){ if(timeline[j].massKg!==null){ cycle.closeMass=timeline[j].massKg; break; } } } if(Number.isFinite(cycle.openMass) && Number.isFinite(cycle.closeMass)) cycle.delta=Number((cycle.closeMass-cycle.openMass).toFixed(3)); else cycle.delta=null; const openTsNum=Date.parse(cycle.openTs); const closeTsNum=Date.parse(cycle.closeTs); cycle.durationMin = Number.isFinite(openTsNum) && Number.isFinite(closeTsNum) ? Math.round((closeTsNum-openTsNum)/60000) : null; cycles.push(cycle); waitingOpen=null; } } } return cycles; }

  // Rendering helpers for Overview
  function renderBasicInfo(pantry){ const root=document.getElementById('basicInfo'); if(!root) return; root.innerHTML = `
    <div><strong>Name:</strong> ${escapeHtml(pantry.name||'Untitled')}</div>
    <div><strong>Address:</strong> <a class="address-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pantry.address||'')}" target="_blank" rel="noopener noreferrer">${escapeHtml(pantry.address||'—')}</a></div>
    <div><strong>GPS:</strong> ${pantry.location?`${pantry.location.lat}, ${pantry.location.lng}`:'—'}</div>
    <div><strong>Contact:</strong> ${escapeHtml(pantry.contact?.owner||'—')} ${pantry.contact?.phone?` · ${escapeHtml(pantry.contact.phone)}`:''} ${pantry.contact?.email?` · <a href="mailto:${escapeHtml(pantry.contact.email)}">${escapeHtml(pantry.contact.email)}</a>`:''}</div>
  `; }

  // Initialize mini map preview inside Overview
  function setupMiniMap(pantry){ try{
    if (!pantry || !pantry.location || typeof pantry.location.lat !== 'number' || typeof pantry.location.lng !== 'number') return;
    const id = 'pantry-mini-map';
    const el = document.getElementById(id);
    if (!el) return;
    // ensure container has proper positioning and overflow
    el.style.position = el.style.position || 'relative';
    el.style.overflow = 'hidden';
    // Avoid reinitializing
    if (el._leaflet_map) { try{ el._leaflet_map.setView([pantry.location.lat, pantry.location.lng], 14); el._leaflet_map.invalidateSize(); }catch(e){} return; }
    const lat = pantry.location.lat; const lng = pantry.location.lng;
    // initialize Leaflet map with interaction limits
    const miniMap = L.map(id, {
      attributionControl: false,
      zoomControl: true,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      dragging: true
    }).setView([lat, lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap);
    const marker = L.marker([lat, lng]).addTo(miniMap);
    marker.bindPopup(`<strong>${escapeHtml(pantry.name||'Pantry')}</strong><br>${escapeHtml(pantry.address||'')}`);
    el._leaflet_map = miniMap;
    // ensure responsive resize and proper sizing after render
    setTimeout(()=> { try{ miniMap.invalidateSize(); }catch(e){} }, 120);
    // also invalidate on window resize
    const resizeHandler = () => { try{ miniMap.invalidateSize(); }catch(e){} };
    window.addEventListener('resize', resizeHandler);
    // store handler so it can be removed if needed later
    el._leaflet_resizeHandler = resizeHandler;
  }catch(e){ console.warn('mini-map init error', e); } }

  // Activity records (mocked for now)
  function getActivitiesByPantryId(pantryId){
    // Try to fetch from mockData.json if present
    try{
      // synchronous fallback will be used in init via await pattern; here return sample
    }catch(e){}
    // sample data
    const sample = [
      { id: 'activity-3', pantryId: pantryId, type: 'cleaning', timestamp: '2025-01-20T10:30:00', manager: 'Alice Chen', description: 'Deep cleaned shelves and removed expired items', duration: '35 minutes' },
      { id: 'activity-2', pantryId: pantryId, type: 'restock', timestamp: '2025-01-18T09:15:00', manager: 'John Smith', description: 'Received weekly donation boxes and restocked essentials', duration: '45 minutes' },
      { id: 'activity-1', pantryId: pantryId, type: 'maintenance', timestamp: '2025-01-12T14:00:00', manager: 'Miguel Lopez', description: 'Repaired door hinge and inspected seal', duration: '20 minutes' }
    ];
    return sample.sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
  }

  function renderActivities(activities){ const root=document.getElementById('activityLog'); if(!root) return; if(!Array.isArray(activities)||activities.length===0){ root.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No maintenance records yet</p></div>`; return; } root.innerHTML = `<div class="activity-list">${activities.map(a=>`<article class="activity-item">
      <div class="activity-icon">${a.type==='cleaning'?'🧹': a.type==='restock'?'📦': a.type==='maintenance'?'🔧': a.type==='alert'?'⚠️':'📝'}</div>
      <div class="activity-details">
        <div class="activity-header"><span class="activity-type">${a.type==='cleaning'?'Pantry Cleaning': a.type==='restock'?'Restocked': a.type==='maintenance'?'Maintenance': a.type==='alert'?'Alert':'Note'}</span><time class="activity-time">${formatDateTimeMinutes(a.timestamp)}</time></div>
        <p class="activity-description">${escapeHtml(a.description||'')}</p>
        <div class="activity-meta"><span class="activity-manager">👤 Manager: ${escapeHtml(a.manager||'—')}</span>${a.duration?` · <span class="activity-duration">${escapeHtml(a.duration)}</span>`:''}</div>
      </div>
    </article>`).join('')}</div>`; }

  /* Settings persistence helpers */
  function getSettingsKey(pantryId){ return `pantry_settings_${pantryId}`; }
  function loadSavedSettings(pantryId){ try{ const s = localStorage.getItem(getSettingsKey(pantryId)); return s? JSON.parse(s): {}; }catch(e){ return {}; } }
  function saveSettings(pantryId, settings){ try{ localStorage.setItem(getSettingsKey(pantryId), JSON.stringify(settings||{})); }catch(e){} }
  function applySavedSettingsToPantry(pantry){ if(!pantry || !pantry.id) return; const s = loadSavedSettings(pantry.id); if(!s) return; if(s.name) pantry.name = s.name; if(s.address) pantry.address = s.address; if(s.description) pantry.description = s.description; if(s.contact) pantry.contact = Object.assign({}, pantry.contact||{}, s.contact); if(s.notifications) pantry.notifications = s.notifications; if(s.deactivated) pantry.deactivated = s.deactivated; }
  
  /* Ensure delete modal exists in document.body to avoid fixed positioning issues when nested inside containers */
  function ensureDeleteModalInBody(){
    if(document.getElementById('delete-modal')) return;
    const modalHTML = `
      <div id="delete-modal" class="modal-overlay" aria-hidden="true">
        <div class="modal-backdrop"></div>
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div class="modal-header"><h3 id="delete-modal-title" class="modal-title" style="color:var(--danger);">Delete Pantry?</h3><button class="modal-close" data-delete-close>&times;</button></div>
          <div class="module-content">
            <p><strong style="color:var(--danger);">This action cannot be undone.</strong> Deleting this pantry will permanently remove its local settings and wishlist. To confirm, type <strong>DELETE</strong> (uppercase) below.</p>
            <input id="delete-modal-input" placeholder="Type DELETE to confirm" class="form-input" style="margin-top:8px;" />
          </div>
          <div class="modal-actions">
            <button id="delete-modal-cancel" class="modal-btn" data-delete-close>Cancel</button>
            <button id="modal-delete-confirm-btn" class="btn btn-danger" disabled>Delete Permanently</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }
  

  /* Toast helper */
  function showToast(msg, ms=3500){ try{ const container = document.getElementById('mp-toast'); if(!container) return; const el = document.createElement('div'); el.className='mp-toast-item'; el.textContent = msg; container.appendChild(el); setTimeout(()=>{ el.style.opacity=1; },50); setTimeout(()=>{ el.style.transition='opacity 260ms'; el.style.opacity=0; setTimeout(()=>{ try{ container.removeChild(el); }catch(e){} },260); }, ms); }catch(e){ console.warn('toast',e); } }

  /* Settings UI initialisation and handlers */
  function initSettingsSection(pantry){ if(!pantry || !pantry.id) return; const saved = loadSavedSettings(pantry.id) || {};
    // populate fields (new input-based name)
    const nameEl = document.getElementById('settings-name-input'); if(nameEl) nameEl.value = saved.name || pantry.name || '';
    const nameSub = document.getElementById('settings-name-sub'); if(nameSub) nameSub.textContent = pantry.address || '';
    const addrEl = document.getElementById('settings-address'); if(addrEl) addrEl.value = saved.address || pantry.address || '';
    const descEl = document.getElementById('settings-description'); if(descEl) descEl.value = saved.description || pantry.description || '';
    const contactName = document.getElementById('settings-contact-name'); if(contactName) contactName.value = (saved.contact?.owner) || pantry.contact?.owner || '';
    const contactPhone = document.getElementById('settings-contact-phone'); if(contactPhone) contactPhone.value = (saved.contact?.phone) || pantry.contact?.phone || '';
    const contactEmail = document.getElementById('settings-contact-email'); if(contactEmail) contactEmail.value = (saved.contact?.email) || pantry.contact?.email || '';
    const toggleLow = document.getElementById('toggle-low-inv'); if(toggleLow) toggleLow.checked = !!(saved.notifications?.lowInventory);
    const toggleMaint = document.getElementById('toggle-maint-rem'); if(toggleMaint) toggleMaint.checked = !!(saved.notifications?.maintenance);

    // Single Update button (saves name, description, contact)
    const saveAllBtn = document.getElementById('btn-update-settings');
    if(saveAllBtn){ saveAllBtn.addEventListener('click', ()=>{
      const name = (document.getElementById('settings-name-input')?.value || '').trim(); if(!name) return alert('Name cannot be empty');
      const address = (document.getElementById('settings-address')?.value || '').trim();
      const description = (document.getElementById('settings-description')?.value || '').trim();
      const owner = (document.getElementById('settings-contact-name')?.value || '').trim();
      const phone = (document.getElementById('settings-contact-phone')?.value || '').trim();
      const email = (document.getElementById('settings-contact-email')?.value || '').trim();
      const s = loadSavedSettings(pantry.id) || {};
      s.name = name; s.address = address; s.description = description; s.contact = { owner, phone, email };
      saveSettings(pantry.id, s);
      pantry.name = name; pantry.address = address; pantry.description = description; pantry.contact = Object.assign({}, pantry.contact||{}, s.contact);
      // update UI title
      const title = document.getElementById('pantryTitle'); if(title) title.textContent = `My Pantry - ${name}`;
      const nameSub2 = document.getElementById('settings-name-sub'); if(nameSub2) nameSub2.textContent = address || '';
      showToast('Settings updated');
    }); }

    // keep existing separate save handlers for backward compatibility if present
    const saveDescBtn = document.getElementById('btn-save-desc'); if(saveDescBtn){ saveDescBtn.addEventListener('click', ()=>{ const v = document.getElementById('settings-description').value.trim(); const s = loadSavedSettings(pantry.id)||{}; s.description = v; saveSettings(pantry.id,s); pantry.description = v; showToast('Description saved'); }); }

    const saveContactBtn = document.getElementById('btn-save-contact'); if(saveContactBtn){ saveContactBtn.addEventListener('click', ()=>{ const owner = document.getElementById('settings-contact-name').value.trim(); const phone = document.getElementById('settings-contact-phone').value.trim(); const email = document.getElementById('settings-contact-email').value.trim(); const s = loadSavedSettings(pantry.id)||{}; s.contact = { owner, phone, email }; saveSettings(pantry.id,s); pantry.contact = Object.assign({}, pantry.contact||{}, s.contact); renderBasicInfo(pantry); showToast('Contact updated'); }); }

    // toggles
    if(toggleLow) toggleLow.addEventListener('change', (e)=>{ const s = loadSavedSettings(pantry.id)||{}; s.notifications = s.notifications||{}; s.notifications.lowInventory = !!e.target.checked; saveSettings(pantry.id,s); showToast('Low inventory alerts ' + (e.target.checked? 'enabled':'disabled')); });
    if(toggleMaint) toggleMaint.addEventListener('change', (e)=>{ const s = loadSavedSettings(pantry.id)||{}; s.notifications = s.notifications||{}; s.notifications.maintenance = !!e.target.checked; saveSettings(pantry.id,s); showToast('Maintenance reminders ' + (e.target.checked? 'enabled':'disabled')); });

    // save notifications button (if present)
    const saveNotif = document.getElementById('btn-save-notifications'); if(saveNotif){ saveNotif.addEventListener('click', ()=>{ const s = loadSavedSettings(pantry.id)||{}; s.notifications = s.notifications||{}; s.notifications.lowInventory = !!(document.getElementById('toggle-low-inv')?.checked); s.notifications.maintenance = !!(document.getElementById('toggle-maint-rem')?.checked); saveSettings(pantry.id,s); showToast('Notification settings saved'); }); }

    // activate / deactivate toggle
    const deactivateBtn = document.getElementById('btn-deactivate');
    const dangerTitle = document.getElementById('danger-action-title');
    const dangerDesc = document.getElementById('danger-action-desc');
    // derive current active state (true = visible/active)
    let isActive = true;
    try{ isActive = !((saved && saved.deactivated) || (!!pantry.deactivated)); }catch(e){ isActive = true; }
    const updateDeactivateUI = ()=>{
      if(!deactivateBtn) return;
      // normalize classes: remove any legacy or state classes, then add explicit new state class
      deactivateBtn.classList.remove('btn-outline-danger','btn-success','btn-danger-outline','btn-success-solid');
      if(isActive){
        deactivateBtn.textContent = 'Deactivate Pantry';
        deactivateBtn.classList.add('btn-danger-outline');
        if(dangerTitle) dangerTitle.textContent = 'Deactivate Pantry';
        if(dangerDesc) dangerDesc.textContent = 'Temporarily hide this pantry from public listings';
      } else {
        deactivateBtn.textContent = 'Activate Pantry';
        deactivateBtn.classList.add('btn-success-solid');
        if(dangerTitle) dangerTitle.textContent = 'Activate Pantry';
        if(dangerDesc) dangerDesc.textContent = 'This pantry is currently hidden. Click to make it public again.';
      }
    };
    updateDeactivateUI();
    if(deactivateBtn){ deactivateBtn.addEventListener('click', ()=>{
      const s = loadSavedSettings(pantry.id)||{};
      // Toggle deactivated state: newDeactivated = !isActive
      const newDeactivated = !isActive;
      s.deactivated = newDeactivated;
      saveSettings(pantry.id,s);
      pantry.deactivated = s.deactivated;
      isActive = !s.deactivated; // update runtime state
      updateDeactivateUI();
      showToast(isActive? 'Pantry activated (local)':'Pantry deactivated (local)');
    }); }

    // ensure modal appended to body so fixed positioning works correctly
    ensureDeleteModalInBody();
    // delete flow (new top-level modal)
    const delModal = document.getElementById('delete-modal');
    const delInput = document.getElementById('delete-modal-input');
    const delBtn = document.getElementById('modal-delete-confirm-btn');
    const delTrigger = document.getElementById('btn-delete');
    if(delTrigger){ delTrigger.addEventListener('click', ()=>{ if(delInput){ delInput.value=''; delBtn.disabled = true; } if(delModal){ delModal.classList.add('show'); delModal.setAttribute('aria-hidden','false'); if(delInput) delInput.focus(); } }); }
    if(delModal){
      const closeDelModal = ()=>{ delModal.classList.remove('show'); delModal.setAttribute('aria-hidden','true'); if(delInput){ delInput.value=''; } if(delBtn) delBtn.disabled = true; };
      // close handlers for modal close buttons (data-delete-close)
      delModal.querySelectorAll('[data-delete-close]').forEach(b=> b.addEventListener('click', closeDelModal));
      // close when clicking on backdrop (outside dialog)
      delModal.addEventListener('click', (e)=>{ if(e.target === delModal || e.target.classList.contains('delete-modal-backdrop')){ closeDelModal(); } });
    }
    if(delInput) delInput.addEventListener('input', ()=>{ if(delBtn) delBtn.disabled = (delInput.value.trim() !== 'DELETE'); });
    if(delBtn) delBtn.addEventListener('click', ()=>{ if(!delInput || delInput.value.trim() !== 'DELETE') return; try{ localStorage.removeItem(getSettingsKey(pantry.id)); localStorage.removeItem(`wishlist_${pantry.id}`); localStorage.setItem(`pantry_deleted_${pantry.id}`, '1'); showToast('Pantry deleted (local). Redirecting...'); setTimeout(()=>{ window.location.href = './index.html'; },900); }catch(e){ console.warn('delete',e); showToast('Delete failed'); } });
  }

  function renderStatusCards(pantry){ const root=document.getElementById('statusCards'); if(!root) return;
    const status = pantry.status||'open';
    const stockLabel = pantry.stockLevel != null ? pantry.stockLevel : null;
    const stockWeightKg = pantry.stockLevelWeightKg != null ? pantry.stockLevelWeightKg : null;
    const totalItems = (pantry.inventory?.categories||[]).reduce((s,c)=>s+(c.quantity||0),0);
    const stockLevel = stockLabel != null ? stockLabel : (totalItems<=10? 'Low': (totalItems<=30? 'Medium':'High'));
    const sensorsUnavailable = pantry.sensorsUnavailable && (stockWeightKg == null || !Number.isFinite(stockWeightKg));
    const fromDonations = pantry.stockSource === 'donations';
    let stockDetail = sensorsUnavailable ? 'Sensor data unavailable. No reported stock in the last 24h.' : (stockWeightKg != null && Number.isFinite(stockWeightKg) ? `${stockLevel} (${Number(stockWeightKg).toFixed(1)} kg)` : `${stockLevel} (${totalItems} items)`);
    if (!sensorsUnavailable && fromDonations && stockWeightKg != null) stockDetail += ' · Estimated from donations';
    const lastUpdated = pantry.stockLevelUpdatedAt || pantry.sensors?.updatedAt;
    const lastUpdatedText = lastUpdated ? formatDateTimeMinutes(lastUpdated) : (sensorsUnavailable ? 'Sensor data unavailable. No reported stock in the last 24h.' : '—');
    root.innerHTML=`
    <div><strong>Status:</strong> <span class="badge ${status}">${status.charAt(0).toUpperCase()+status.slice(1)}</span></div>
    <div><strong>Stock Level:</strong> ${stockDetail}</div>
    <div><strong>Last updated:</strong> ${lastUpdatedText}</div>
    <div><strong>Condition:</strong> ${pantry.sensors?.foodCondition?escapeHtml(pantry.sensors.foodCondition):'—'}</div>
  `; }

  function renderInventoryCategories(pantry){ const root=document.getElementById('inventoryCategories'); if(!root) return; const cats = pantry.inventory?.categories||[]; if(cats.length===0){ root.innerHTML='<div class="empty">No inventory categories.</div>'; return; } root.innerHTML = `<ul>${cats.map(c=>`<li>${escapeHtml(c.name||'Unknown')}: ${Number(c.quantity||0)}</li>`).join('')}</ul>`; }

  // Wish list - now uses backend API (PantryAPI) for integration with main page
  // Cache for wishlist items to avoid repeated API calls
  let wishlistCache = { pantryId: null, items: [] };

  // Normalize backend wishlist items to UI-friendly format
  function normalizeWishlistItem(entry, index) {
    if (!entry) return null;
    // Backend returns: { id, itemDisplay, count, updatedAt, createdAt }
    // We map to: { id, item, quantity, requester, status, createdAt }
    const itemDisplay = String(entry.itemDisplay ?? entry.item ?? entry.id ?? '').trim();
    if (!itemDisplay) return null;
    const parsedCount = Number(entry.count ?? entry.quantity);
    const count = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1;
    return {
      id: entry.id ?? `wishlist-${index}`,
      item: itemDisplay,
      quantity: count,
      requester: entry.requester || 'Community',
      status: entry.status || 'pending',
      createdAt: entry.createdAt ?? entry.updatedAt ?? null,
      updatedAt: entry.updatedAt ?? entry.createdAt ?? null,
    };
  }

  // Load wishlist from backend API
  async function loadWishlistFromAPI(pantryId) {
    if (!pantryId) return [];
    try {
      const data = await window.PantryAPI.getWishlist(pantryId);
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      const normalized = items.map((item, idx) => normalizeWishlistItem(item, idx)).filter(Boolean);
      wishlistCache = { pantryId: String(pantryId), items: normalized };
      return normalized;
    } catch (e) {
      console.error('Error loading wishlist from API:', e);
      return wishlistCache.pantryId === String(pantryId) ? wishlistCache.items : [];
    }
  }

  // Add item to wishlist via backend API
  async function addWishlistItemToAPI(pantryId, item, quantity) {
    if (!pantryId || !item) return;
    try {
      await window.PantryAPI.addWishlistItem(pantryId, item, quantity);
    } catch (e) {
      console.error('Error adding wishlist item:', e);
      throw e;
    }
  }

  // Render wishlist - now async since it loads from API
  async function renderWishlist(pantryId) {
    const root = document.getElementById('mp-wishlist');
    if (!root) return;

    // Show loading state
    root.innerHTML = '<div class="wishlist-empty">Loading wishlist...</div>';

    // Load from backend API
    const items = await loadWishlistFromAPI(pantryId);

    // Update counter badge
    const pendingCount = items.filter(x => x.status === 'pending').length;
    const totalCount = items.length;
    const counterEl = document.getElementById('wishlist-counter');
    if (counterEl) {
      counterEl.innerHTML = `<span class="wl-count pending">${totalCount} items</span><span class="wl-count donated">${pendingCount} requested</span>`;
    }

    if (items.length === 0) {
      root.innerHTML = '<div class="wishlist-empty">No wishlist items yet. Items added on the main map page will appear here.</div>';
      return;
    }

    // Sort by most recent first
    const sorted = items.slice().sort((a, b) => {
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    });

    root.innerHTML = `<div class="wishlist-grid">${sorted.map(it => {
      const qtyDisplay = it.quantity > 1 ? ` × ${it.quantity}` : '';
      return `<div class="wishlist-item-card pending">
        <div class="wishlist-item-info">
          <div class="wishlist-item-name">${escapeHtml(it.item)}${qtyDisplay}</div>
          <div class="wishlist-item-meta">Requested by: ${escapeHtml(it.requester || 'Community')} · ${it.updatedAt ? formatDateTimeMinutes(it.updatedAt) : ''}</div>
        </div>
        <div class="wishlist-actions">
          <button class="wl-mark-btn wl-add-more" data-item="${escapeHtml(it.item)}" title="Add one more request">+1</button>
        </div>
      </div>`;
    }).join('')}</div>`;

    // "+1" button — add one more of the same item
    root.querySelectorAll('.wl-add-more').forEach(btn => btn.addEventListener('click', async () => {
      const itemName = btn.getAttribute('data-item');
      if (!itemName) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await addWishlistItemToAPI(pantryId, itemName, 1);
        await renderWishlist(pantryId);
      } catch (e) {
        btn.textContent = '!';
        setTimeout(() => { btn.textContent = '+1'; btn.disabled = false; }, 1500);
      }
    }));
  }

  // Chart renderers (reuse simplified logic)
  function renderWeightChartInto(container, data, cycles){ const svg = document.querySelector('[data-weight-chart]'); const legend = document.querySelector('[data-weight-legend]'); const rangeLabel = document.querySelector('[data-weight-range]'); if(!svg||!legend||!rangeLabel) return; if(!Array.isArray(data)||data.length===0){ svg.innerHTML=''; legend.textContent='No weight data available.'; rangeLabel.textContent=''; return; } const width=svg.viewBox.baseVal.width||720; const height=svg.viewBox.baseVal.height||320; const margin={top:20,right:32,bottom:36,left:56}; const plotWidth=width-margin.left-margin.right; const plotHeight=height-margin.top-margin.bottom; const minWeight=Math.min(...data.map(d=>d.weightKg)); const maxWeight=Math.max(...data.map(d=>d.weightKg)); const scaleY=(v)=> maxWeight===minWeight? margin.top+plotHeight/2 : margin.top + (maxWeight - v)*(plotHeight/(maxWeight-minWeight)); const scaleX=(i)=> data.length===1? margin.left + plotWidth/2 : margin.left + (i/(data.length-1))*plotWidth; const points = data.map((d,i)=>`${scaleX(i)},${scaleY(d.weightKg)}`).join(' '); svg.innerHTML = `<rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="var(--bg)" stroke="var(--border)" stroke-width="1" rx="8"></rect><polyline fill="none" stroke="var(--accent)" stroke-width="3" points="${points}"></polyline>${data.map((d,i)=>`<circle class="weight-point" data-ts="${d.ts}" cx="${scaleX(i)}" cy="${scaleY(d.weightKg)}" r="4" fill="var(--primary)"><title>${formatDateTimeMinutes(d.ts)} — ${d.weightKg.toFixed(2)} kg</title></circle>`).join('')}`; legend.textContent = `Min ${minWeight.toFixed(2)} kg · Max ${maxWeight.toFixed(2)} kg`; rangeLabel.textContent = `${formatDateTimeMinutes(data[0].ts)} → ${formatDateTimeMinutes(data[data.length-1].ts)}`; }

  function renderDoorTimelineInto(container, data, cycles){
    const timeline = document.querySelector('[data-door-timeline]');
    const summary = document.querySelector('[data-door-summary]');
    if(!timeline||!summary) return;
    if(!Array.isArray(data)||data.length===0){ timeline.innerHTML='<div class="history-placeholder">No door events recorded.</div>'; summary.textContent=''; return; }
    // show most recent 15 events, compact
    const recent = data.slice(-15).reverse();
    const ul = document.createElement('ul'); ul.className = 'door-events-compact';
    recent.forEach(ev=>{
      const li = document.createElement('li');
      const pill = document.createElement('span'); pill.className = `door-pill ${ev.status}`; pill.textContent = ev.status==='open' ? 'OPEN' : 'CLOSED';
      const ts = document.createElement('span'); ts.className = 'door-ts'; ts.textContent = formatDateTimeMinutes(ev.ts);
      li.appendChild(pill); li.appendChild(ts);
      ul.appendChild(li);
    });
    timeline.innerHTML = '';
    timeline.appendChild(ul);
    const totalOpen = data.filter(d=>d.status==='open').length;
    summary.textContent = `${data.length} events · ${totalOpen} openings`;
  }

  // Update on-page CSV debug panel (visible when present)
  function updateCSVDebugPanel(info){
    try{
      const el = document.getElementById('csvDebugPanel'); if(!el) return;
      el.style.display = 'block';
      const rows = info.parsedRows!==undefined? info.parsedRows : (info.weightTrendData? info.weightTrendData.length : '—');
      const cycles = info.cycles!==undefined? info.cycles : (info.activitySummary? info.activitySummary.length : '—');
      const opens = info.opens!==undefined? info.opens : (info.opensCount!==undefined? info.opensCount : '—');
      const closes = info.closes!==undefined? info.closes : (info.closesCount!==undefined? info.closesCount : '—');
      const doors = info.doorEvents!==undefined? info.doorEvents : (info.doorEventsList? info.doorEventsList.length : (info.doorPoints? info.doorPoints.length : '—'));
      const timeRange = info.timeRange || (info.weightTrendData && info.weightTrendData.length? `${info.weightTrendData[0].timestamp||info.weightTrendData[0].ts} → ${info.weightTrendData[info.weightTrendData.length-1].timestamp||info.weightTrendData[info.weightTrendData.length-1].ts}` : '-');
      el.innerHTML = `
        <div style="background:#f8f9fa;padding:12px;border-radius:8px;font-family:monospace;font-size:13px;color:#222;">
          <strong>CSV Debug Info:</strong><br>
          Total rows parsed: <span id="debug-rows">${rows}</span><br>
          Door open events: <span id="debug-opens">${opens}</span><br>
          Door close events: <span id="debug-closes">${closes}</span><br>
          Complete cycles: <span id="debug-cycles">${cycles}</span><br>
          Time range: <span id="debug-timerange">${timeRange}</span><br>
          <button id="debug-log-full" style="margin-top:8px;padding:6px 8px;border-radius:6px;">Log Full Data</button>
        </div>
      `;
      const btn = document.getElementById('debug-log-full'); if(btn) btn.addEventListener('click', ()=>{ });
    }catch(e){ console.warn('updateCSVDebugPanel', e); }
  }

  // small helper to format date (Jan 22, 2026)
  function formatDate(iso){ const d=new Date(iso); if (Number.isNaN(d.getTime())) return ''; const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }
  function formatTime(iso){ const d=new Date(iso); if (Number.isNaN(d.getTime())) return ''; return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

  // Render the activity summary module (per-cycle weight changes)
  function renderActivitySummary(cycles, weightPoints, opts){
    opts = opts || {}; const max = opts.max || 5; const list = document.getElementById('activitySummaryList'); if(!list) return;
    if(!Array.isArray(cycles) || cycles.length===0){ list.innerHTML = '<div class="history-placeholder">No recent cycles</div>'; return; }

    // normalize weight points
    const wp = Array.isArray(weightPoints)? weightPoints.slice().sort((a,b)=>new Date(a.ts)-new Date(b.ts)) : [];
    const recent = cycles.slice(-max).reverse(); list.innerHTML = '';

    recent.forEach(raw=>{
      const c = Object.assign({}, raw);
      const openTs = c.openTimestamp || c.openTs || c.open || c.open_time || c.openTime;
      const closeTs = c.closeTimestamp || c.closeTs || c.close || c.close_time || c.closeTime;
      const durationSec = (c.duration!==undefined && c.duration!==null) ? c.duration : (c.durationMin? c.durationMin*60 : null);
      // duration text
      let durationText = '—';
      if (Number.isFinite(durationSec)){
        const mins = Math.floor(durationSec/60); const secs = durationSec % 60;
        if (mins>0) durationText = `${mins} min ${secs} sec`; else if (secs>0) durationText = `${secs} seconds`; else durationText = 'less than 1 second';
      }

      // compute delta: prefer explicit weightChange, then existing delta, else derive from weightPoints
      let delta = (typeof c.weightChange === 'number') ? c.weightChange : (typeof c.delta === 'number' ? c.delta : null);
      if (delta===null && wp.length>0 && openTs && closeTs){
        try{
          const oNum = Date.parse(openTs); const cNum = Date.parse(closeTs);
          let base = null, res = null;
          for(let i=wp.length-1;i>=0;i--){ if(Date.parse(wp[i].ts) <= oNum){ base = wp[i].weightKg; break; } }
          for(let i=0;i<wp.length;i++){ if(Date.parse(wp[i].ts) >= cNum){ res = wp[i].weightKg; break; } }
          if (Number.isFinite(base) && Number.isFinite(res)) delta = Number((res - base).toFixed(3));
        }catch(e){}
      }

      // classification threshold 0.02 kg
      let status='neutral', icon='➖', label='No change', value='—', valueClass='';
      if (delta!==null && !Number.isNaN(Number(delta))){
        if (delta > 0.02){ status='increase'; icon='📦'; label='Items added'; value=`+${delta.toFixed(3)} kg`; valueClass='positive'; }
        else if (delta < -0.02){ status='decrease'; icon='📤'; label='Items taken'; value=`${delta.toFixed(3)} kg`; valueClass='negative'; }
        else { status='neutral'; icon='➖'; label='No change'; value=`${delta.toFixed(3)} kg`; }
      }

      const card = document.createElement('div'); card.className = `activity-card ${status}`;
      card.innerHTML = `
        <div class="weight-change-box">
          <div class="change-icon">${icon}</div>
          <div class="change-value ${valueClass}">${value}</div>
        </div>
        <div class="event-info">
          <div class="event-date">${formatDate(openTs)}</div>
          <div class="event-times"><span class="time-badge opened">Opened ${formatTime(openTs)}</span><span class="arrow">→</span><span class="time-badge closed">Closed ${formatTime(closeTs)}</span></div>
          <div class="event-duration">⏱️ Door open for ${durationText}</div>
        </div>
        <div class="event-action"><div class="action-label">${label}</div></div>
      `;
      card.addEventListener('click', ()=>{ // highlight nearest point at closeTs if available
        document.querySelectorAll('circle.weight-point').forEach(s=>{ s.classList.remove('highlight'); try{ s.setAttribute('r','4'); }catch(e){} });
        const ts = closeTs || openTs; const circ = document.querySelector(`circle.weight-point[data-ts="${ts}"]`);
        if(circ){ circ.classList.add('highlight'); try{ circ.setAttribute('r','6'); }catch(e){} circ.scrollIntoView({block:'center', behavior:'smooth'}); }
      });
      list.appendChild(card);
    });

    // Show more action: reveal modal-like alert with recent history
    const btn = document.getElementById('activityShowMore'); if(btn){ btn.onclick = ()=>{ const all = cycles.slice().reverse(); const moreList = all.map(c=>{
        const openTs = c.openTimestamp || c.openTs || c.open || c.open_time || c.openTime;
        const closeTs = c.closeTimestamp || c.closeTs || c.close || c.close_time || c.closeTime;
        const delta = (typeof c.weightChange === 'number')? c.weightChange : (typeof c.delta === 'number'? c.delta : null);
        return `${formatDate(openTs)} ${formatTime(openTs)} → ${formatTime(closeTs)} (${formatKgDelta(delta)})`;
      }).join('\n'); }; }
  }

    // old duplicate removed

  function escapeHtml(text){ const d=document.createElement('div'); d.textContent = text; return d.innerHTML; }

  // Load data sources and render
  async function loadPantry(pantryId){ try{ const resp = await fetch('./pantries.json'); const pantries = await resp.json(); const pantry = pantries.find(p=>String(p.id)===String(pantryId)) || pantries[0]; return pantry; }catch(e){ console.warn('Failed to load pantries.json',e); return null; } }

  async function loadTelemetry(pantryId){
    // 1) 优先使用 Azure SQL 导出的按 pantry 分组数据（fetch_data.py 生成的 telemetry_by_pantry.json）
    try{
      const r = await fetch('./data/telemetry_by_pantry.json?' + (Date.now()));
      if (r && r.ok){
        const byPantry = await r.json();
        const raw = byPantry[String(pantryId)] || byPantry[pantryId];
        if (Array.isArray(raw) && raw.length > 0){
          const items = raw.map(row=>{
            const mass = row.mass != null ? Number(row.mass) : NaN;
            const units = (row.units || '').toString().toLowerCase();
            const kg = !Number.isNaN(mass) ? (units === 'lb' ? mass * 0.453592 : mass) : undefined;
            return { ts: row.ts || row.timestamp || row.time, mass: row.mass, metrics: kg != null ? { weightKg: kg } : {}, door: row.door };
          });
          return items;
        }
      }
    }catch(e){ console.warn('telemetry_by_pantry.json load failed', e); }
    // 2) 后端 API
    if (window.PantryAPI && window.PantryAPI.getTelemetryHistory) { try{ const items = await window.PantryAPI.getTelemetryHistory(pantryId); return items || []; }catch(e){ console.warn('PantryAPI telemetry error', e); } }
    // 3) CSV 回退
    try{
      const csvResp = await fetch('./data/20251111.csv');
      if (csvResp && csvResp.ok){ const csvText = await csvResp.text(); const parsed = Papa.parse(csvText, { header: true, dynamicTyping: true, skipEmptyLines: true }); const rows = Array.isArray(parsed.data) ? parsed.data : [];
          const items = rows.map(r=>({ ts: r.ts || r.time || r.timestamp, mass: r.mass, metrics: { weightKg: (r.mass && !Number.isNaN(Number(r.mass))) ? Number(r.mass) * 0.453592 : undefined }, door: r.door }));
          return items;
      }
    }catch(e){ console.warn('CSV load failed', e); }
    try{ const r = await fetch('./mockData.json'); const j = await r.json(); return Array.isArray(j)? j : (j.items||[]); }catch(e){ console.warn('Failed to load mockData.json', e); return []; }
  }

  // Attempt to load a real CSV from several likely paths and return telemetry-like items
  async function loadRealSensorData(){
    const possiblePaths = [
      '/BeaconHill_2026-01-20_to_2026-01-27.csv',
      '/data/BeaconHill_2026-01-20_to_2026-01-27.csv',
      './BeaconHill_2026-01-20_to_2026-01-27.csv',
      './data/BeaconHill_2026-01-20_to_2026-01-27.csv',
      '/20251111.csv','/data/20251111.csv','./20251111.csv','./data/20251111.csv','20251111.csv'
    ];
    let csvText = null;
    for (const path of possiblePaths){
      try{
        const resp = await fetch(path);
        if (resp && resp.ok){ csvText = await resp.text(); break; }
      }catch(err){ /* skip path */ }
    }
    if(!csvText) return null;
    try{
      const processed = parseAndProcessCSV(csvText);
      if (processed) return processed;
      const parsed = Papa.parse(csvText, { header: true, dynamicTyping: true, skipEmptyLines: true });
      const rows = Array.isArray(parsed.data) ? parsed.data : [];
      const items = rows.map(r=>({ ts: r.ts || r.time || r.timestamp, mass: (r.mass!==undefined? r.mass : (r.mass_kg||r.weight)), metrics: { weightKg: (r.mass!==undefined && !Number.isNaN(Number(r.mass))) ? Number(r.mass)*0.453592 : (r.weightKg||r.weight) }, door: (r.door!==undefined? Number(r.door) : (r.flagDoor!==undefined? Number(r.flagDoor): undefined)) }));
      return items;
    }catch(e){ return null; }
  }

  // Parse CSV text and return processed events + trend + door list
  function parseAndProcessCSV(csvText){
    if(!csvText || typeof csvText !== 'string') return null;
    csvText = csvText.replace(/^\uFEFF/, '').trim();
    const lines = csvText.split('\n');
    if (lines.length < 2) return { activitySummary: [], weightTrendData: [], doorEventsList: [] };
    const headers = lines[0].split(',').map(h=>h.trim());
      // attempt to find common header variants
      const tsCandidates = ['ts','timestamp','time','datetime','date','time_local','datetime_local'];
      const massCandidates = ['mass','total','total_weight','weight','totalweight','scale_total'];
      const doorCandidates = ['door','is_event','isEvent','event','flag'];
      function findIndex(cands){ for(const c of cands){ const idx = headers.findIndex(h => h.toLowerCase()===c.toLowerCase()); if(idx!==-1) return idx; } return -1; }
      const tsIndex = findIndex(tsCandidates);
      let massIndex = findIndex(massCandidates);
      const doorIndex = findIndex(doorCandidates);
      // detect scale columns (scale1..scale4)
      const scaleCols = headers.map(h=>h.toLowerCase()).map((h,idx)=> ({h,idx})).filter(x=>/^scale\d+$/.test(x.h)).map(x=>x.idx);
      if (tsIndex === -1) return { activitySummary: [], weightTrendData: [], doorEventsList: [] };
      // if no mass column but scale columns present, we'll compute total from scales
      const useScales = (massIndex===-1 && scaleCols.length>0);
      const rawData = []; let parseErrors = 0;
      for (let i=1;i<lines.length;i++){
        const line = lines[i].trim(); if(!line) continue;
        const values = line.split(',');
        if (values.length < headers.length) { parseErrors++; continue; }
        try{
          const tsRaw = values[tsIndex].trim(); const timestamp = new Date(tsRaw);
          let mass = NaN;
          if (useScales){ let sum = 0; let got=false; for(const si of scaleCols){ const v = parseFloat(values[si]); if(!isNaN(v)){ sum += v; got=true; } } if (got) mass = sum; }
          else if (massIndex!==-1){ mass = parseFloat(values[massIndex]); }
          // if still NaN try to find any numeric column that looks like weight
          if (isNaN(mass)){
            for(let k=0;k<values.length;k++){ if (k===tsIndex) continue; const maybe = parseFloat(values[k]); if(!isNaN(maybe) && Math.abs(maybe) > 0){ mass = maybe; break; } }
          }
          // door/event flag
          let door = null;
          if (doorIndex!==-1){ const dv = values[doorIndex].trim(); if (/^\s*(1|true|yes)\s*$/i.test(dv)) door = 1; else if (/^\s*(0|false|no)\s*$/i.test(dv)) door = 0; else door = Number(dv); }
          if (!isNaN(timestamp.getTime()) && !isNaN(mass)){
            rawData.push({ timestamp, mass: mass, door });
          } else parseErrors++;
        }catch(e){ parseErrors++; }
      }
    if (rawData.length === 0) return { activitySummary: [], weightTrendData: [], doorEventsList: [] };
    return processEvents(rawData);
  }

  // Build entries from rows (CSV or JSON) with timestamp, scale1-4, is_event, door1_open, door2_open
  function buildEntriesFromRows(rows) {
    const entries = rows.map(r=>{
      const tsRaw = r.ts || r.timestamp || r.time || r.date || r.datetime;
      const ts = (tsRaw ? new Date(tsRaw) : null);
      const s1 = Number.isFinite(Number(r.scale1)) ? Number(r.scale1) : 0;
      const s2 = Number.isFinite(Number(r.scale2)) ? Number(r.scale2) : 0;
      const s3 = Number.isFinite(Number(r.scale3)) ? Number(r.scale3) : 0;
      const s4 = Number.isFinite(Number(r.scale4)) ? Number(r.scale4) : 0;
      const total = s1 + s2 + s3 + s4;
      return { raw: r, ts: ts, tsIso: ts?ts.toISOString():null, totalWeight: total, isEvent: (r.is_event===true || r.is_event===1 || String(r.is_event).toLowerCase()==='true' || String(r.is_event)==='1') };
    }).filter(e=>e.ts);
    entries.sort((a,b)=>a.ts - b.ts);
    return entries;
  }

  // Shared: from entries build cycles and render Sensors tab (cycle cards, weight chart, door timeline)
  function processEntriesAndRender(entries) {
    if (!entries || entries.length === 0) return null;
    const WINDOW = 5;
    const cycles = [];
    let i = 0;
    while (i < entries.length){
      if (!entries[i].isEvent){ i++; continue; }
      const startIdx = i;
      while (i < entries.length && entries[i].isEvent) i++;
      const endIdx = i - 1;
      const beforeStart = Math.max(0, startIdx - WINDOW);
      const beforeSlice = entries.slice(beforeStart, startIdx).map(e=>e.totalWeight).filter(v=>Number.isFinite(v));
      const afterEnd = Math.min(entries.length, endIdx + 1 + WINDOW);
      const afterSlice = entries.slice(endIdx+1, afterEnd).map(e=>e.totalWeight).filter(v=>Number.isFinite(v));
      const beforeAvg = beforeSlice.length? beforeSlice.reduce((a,b)=>a+b,0)/beforeSlice.length : (entries[startIdx-1]? entries[startIdx-1].totalWeight : null);
      const afterAvg = afterSlice.length? afterSlice.reduce((a,b)=>a+b,0)/afterSlice.length : (entries[endIdx+1]? entries[endIdx+1].totalWeight : null);
      const change = (Number.isFinite(afterAvg) && Number.isFinite(beforeAvg)) ? (afterAvg - beforeAvg) : null;
      const startTs = entries[startIdx].ts;
      const endTs = entries[endIdx].ts;
      const durationSec = (startTs && endTs) ? Math.round((endTs - startTs)/1000) : null;
      cycles.push({ startIdx, endIdx, startTs, endTs, durationSec, beforeAvg, afterAvg, change });
    }
    cycles.sort((a,b)=> (b.endTs?b.endTs.getTime():0) - (a.endTs?a.endTs.getTime():0));
    window._csvCycles = cycles;
    renderCycleCards(cycles);
    const weightTrendData = entries.filter(e => Number.isFinite(e.totalWeight)).map(e => ({ ts: e.tsIso, weightKg: e.totalWeight }));
    renderWeightChartInto(null, weightTrendData, cycles);
    const doorEvents = [];
    for (let di = 0; di < entries.length; di++) {
      const e = entries[di];
      const raw = e.raw;
      const d1 = (raw.door1_open === true || raw.door1_open === 1 || String(raw.door1_open).toLowerCase() === 'true');
      const d2 = (raw.door2_open === true || raw.door2_open === 1 || String(raw.door2_open).toLowerCase() === 'true');
      const isOpen = d1 || d2;
      if (di === 0) {
        doorEvents.push({ ts: e.tsIso, status: isOpen ? 'open' : 'closed' });
        continue;
      }
      const prevRaw = entries[di - 1].raw;
      const prevD1 = (prevRaw.door1_open === true || prevRaw.door1_open === 1 || String(prevRaw.door1_open).toLowerCase() === 'true');
      const prevD2 = (prevRaw.door2_open === true || prevRaw.door2_open === 1 || String(prevRaw.door2_open).toLowerCase() === 'true');
      const prevOpen = prevD1 || prevD2;
      if (isOpen !== prevOpen) doorEvents.push({ ts: e.tsIso, status: isOpen ? 'open' : 'closed' });
    }
    renderDoorTimelineInto(null, doorEvents, cycles);
    return { entries, cycles };
  }

  // Uses API.getTelemetryLatest(pantryId): real-time API → pantry_data.json → donations (last 24h).
  // Updates selectedPantry with weight and source; source 'donations' shows "Estimated from donations" in UI.
  async function applyTelemetryLatestToPantry(pantryId) {
    if (!pantryId || !window.PantryAPI || typeof window.PantryAPI.getTelemetryLatest !== 'function') return false;
    if (!selectedPantry || String(selectedPantry.id) !== String(pantryId)) return false;
    try {
      const telemetry = await window.PantryAPI.getTelemetryLatest(pantryId);
      if (!telemetry || (telemetry.weight == null && telemetry.weightKg == null)) {
        selectedPantry.sensorsUnavailable = true;
        selectedPantry.stockSource = null;
        return false;
      }
      const weightKg = Number(telemetry.weight ?? telemetry.weightKg);
      if (!Number.isFinite(weightKg)) {
        selectedPantry.sensorsUnavailable = true;
        selectedPantry.stockSource = null;
        return false;
      }
      const updatedAt = telemetry.timestamp ?? telemetry.updatedAt ?? telemetry.ts ?? new Date().toISOString();
      selectedPantry.sensorsUnavailable = false;
      selectedPantry.stockSource = telemetry.source || 'sensor';
      selectedPantry.sensors = Object.assign({}, selectedPantry.sensors, { weightKg, updatedAt });
      selectedPantry.stockLevelWeightKg = weightKg;
      selectedPantry.stockLevelUpdatedAt = updatedAt;
      return true;
    } catch (e) {
      console.warn('applyTelemetryLatestToPantry failed', e);
      if (selectedPantry && String(selectedPantry.id) === String(pantryId)) {
        selectedPantry.sensorsUnavailable = true;
        selectedPantry.stockSource = null;
      }
      return false;
    }
  }

  // Load pantry_data.json for a pantry: use device_to_pantry to get device_id (e.g. BeaconHill -> p-2), filter JSON by device_id, render Sensors
  async function loadPantryDataJsonAndRender(pantryId) {
    try {
      const dtpResp = await fetch('./data/device_to_pantry.json?' + Date.now());
      if (!dtpResp || !dtpResp.ok) return null;
      const deviceToPantry = await dtpResp.json();
      const deviceId = Object.keys(deviceToPantry).find(k => String(deviceToPantry[k]) === String(pantryId));
      if (!deviceId) return null;

      const dataResp = await fetch('./pantry_data.json?' + Date.now());
      if (!dataResp || !dataResp.ok) return null;
      const list = await dataResp.json();
      const rows = Array.isArray(list) ? list.filter(r => (r.device_id || r.deviceId || '') === deviceId) : [];
      if (rows.length === 0) return null;

      const entries = buildEntriesFromRows(rows);
      const processed = processEntriesAndRender(entries);

      // 同步 Overview 区域的 Current Weight / Temperature / Battery / Door Visits 到最新 SQL 记录
      try {
        if (typeof applyPantryDataToUI === 'function' && rows.length > 0 && selectedPantry && String(selectedPantry.id) === String(pantryId)) {
          // 找到时间最新的一条记录
          const latestWrapped = rows.reduce((best, row) => {
            const ts = new Date(row.timestamp || row.ts || row.time || 0).getTime();
            if (!best) return { row, ts };
            return ts > best.ts ? { row, ts } : best;
          }, null);

          if (latestWrapped && latestWrapped.row) {
            const r = latestWrapped.row;

            // 1) 当前总重量（kg）：优先用 scale1..4 之和，其次尝试 mass 字段
            let totalKg = NaN;
            const s1 = Number(r.scale1 ?? 0);
            const s2 = Number(r.scale2 ?? 0);
            const s3 = Number(r.scale3 ?? 0);
            const s4 = Number(r.scale4 ?? 0);
            if ([s1, s2, s3, s4].some(v => Number.isFinite(v) && v !== 0)) {
              totalKg = s1 + s2 + s3 + s4;
            } else if (r.mass != null) {
              const mass = Number(r.mass);
              if (Number.isFinite(mass)) {
                const units = (r.units || '').toString().toLowerCase();
                totalKg = units === 'lb' ? mass * 0.453592 : mass;
              }
            }

            // 2) 温度 / 电量 / 门访问次数
            const tempC = typeof r.air_temp === 'number' ? Number(r.air_temp.toFixed(1)) : undefined;
            const batteryPct = typeof r.batt_percent === 'number' ? Math.round(r.batt_percent) : undefined;
            const doorVisits = typeof processed?.opens === 'number' ? processed.opens : undefined;

            // Prefer real-time API weight; else use pantry_data totalKg (fallback). Clear sensorsUnavailable when we have fallback data.
            const weightForStock = selectedPantry?.sensors?.weightKg ?? selectedPantry?.stockLevelWeightKg ?? totalKg;
            if (Number.isFinite(totalKg) && (selectedPantry?.sensors?.weightKg == null) && (selectedPantry?.stockLevelWeightKg == null)) {
              selectedPantry.sensorsUnavailable = false;
              selectedPantry.stockSource = 'fallback_local';
              selectedPantry.stockLevelWeightKg = totalKg;
              selectedPantry.stockLevelUpdatedAt = r.timestamp ?? r.ts ?? r.time;
            }
            const inRange = window.PantryAPI && window.PantryAPI.isWeightInReasonableRange && window.PantryAPI.isWeightInReasonableRange(weightForStock);
            const perf = {
              stockLevel: (Number.isFinite(weightForStock) && inRange) ? Number(Number(weightForStock).toFixed(2)) : undefined,
              temperature: tempC,
              doorVisits,
              batteryStatus: typeof batteryPct === 'number' ? `${batteryPct}%` : undefined,
            };

            const persona = {
              name: selectedPantry.name || 'My Pantry',
              status: selectedPantry.status || 'Open',
            };

            applyPantryDataToUI({
              modules: {
                performance: perf,
                persona,
                highlights: { recentActivity: [] },
              },
            });
          }
        }
      } catch (e) {
        console.warn('Failed to update Overview status cards from pantry_data.json', e);
      }

      return processed;
    } catch (e) {
      console.warn('loadPantryDataJsonAndRender failed', e);
      return null;
    }
  }

  // Load BeaconHill CSV, compute total weight, update UI and render activity cards
  async function loadBeaconCSVAndRender(fileName){
    if (!fileName) return null;
    const possible = [ `./data/${fileName}`, `/data/${fileName}`, `./${fileName}`, `/${fileName}` ];
    let text = null;
    for (const p of possible){
      try{ const resp = await fetch(p); if (resp && resp.ok){ text = await resp.text(); break; } }catch(e){}
    }
    if (!text) return null;
    const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    if (rows.length===0) return null;
    const entries = buildEntriesFromRows(rows);
    return processEntriesAndRender(entries);
  }

  // Render filtered cycle cards into #activitySummaryList
  function renderCycleCards(allCycles) {
    const container = document.getElementById('activitySummaryList');
    if (!container) return;
    container.innerHTML = '';

    if (!allCycles || allCycles.length === 0) {
      container.innerHTML = '<div class="history-placeholder">No door cycles detected in CSV data.</div>';
      return;
    }

    // Apply time filter
    const filterEl = document.getElementById('mpTimeFilter');
    const filterVal = filterEl ? filterEl.value : 'all';
    let cutoff = null;
    const now = Date.now();
    if (filterVal === '12h') cutoff = now - 12 * 3600000;
    else if (filterVal === '24h') cutoff = now - 24 * 3600000;
    else if (filterVal === '48h') cutoff = now - 48 * 3600000;

    const filtered = cutoff
      ? allCycles.filter(c => c.endTs && c.endTs.getTime() >= cutoff)
      : allCycles;

    // Show count summary
    const countDiv = document.createElement('div');
    countDiv.style.cssText = 'font-size:13px;color:#7f8c8d;margin-bottom:6px;';
    countDiv.textContent = cutoff
      ? `Showing ${filtered.length} of ${allCycles.length} events`
      : `${allCycles.length} events total`;
    container.appendChild(countDiv);

    if (filtered.length === 0) {
      container.innerHTML += '<div class="history-placeholder">No door cycles found for this time range.</div>';
      return;
    }

    filtered.forEach(c => {
      const delta = c.change;
      const cls = (delta !== null && delta > 0.02) ? 'increase' : (delta !== null && delta < -0.02 ? 'decrease' : 'neutral');
      const label = (delta !== null && delta > 0.02) ? 'Restocked' : (delta !== null && delta < -0.02 ? 'Consumed' : 'No change');
      const dateText = c.startTs ? formatDate(c.startTs.toISOString()) : '';
      const startTime = c.startTs ? formatTime(c.startTs.toISOString()) : '';
      const endTime = c.endTs ? formatTime(c.endTs.toISOString()) : '';
      let durationText = '\u2014';
      if (Number.isFinite(c.durationSec)) {
        const mins = Math.floor(c.durationSec / 60);
        const secs = c.durationSec % 60;
        durationText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      }
      const valueText = (delta === null || Number.isNaN(Number(delta))) ? '\u2014' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)} kg`;
      const card = document.createElement('div');
      card.className = `activity-card ${cls}`;
      card.innerHTML = `
        <div class="weight-change-box">
          <div class="change-icon">${cls === 'increase' ? '\uD83D\uDCE6' : (cls === 'decrease' ? '\uD83D\uDCE4' : '\u2796')}</div>
          <div class="change-value">${valueText}</div>
        </div>
        <div class="event-info">
          <div class="event-date">${dateText}</div>
          <div class="event-times"><span class="time-badge opened">${startTime}</span><span class="arrow">\u2192</span><span class="time-badge closed">${endTime}</span></div>
          <div class="event-duration">\u23F1 ${durationText}</div>
        </div>
        <div class="event-action"><div class="action-label">${label}</div></div>`;
      container.appendChild(card);
    });
  }

  // Process raw data points (timestamp, mass kg, door) into cycles and door changes
  function processEvents(data){
    if (!Array.isArray(data) || data.length === 0) return { activitySummary: [], weightTrendData: data||[], doorEventsList: [] };
    const doorEvents = []; const doorChanges = []; let openEvent = null;
    const doorStates = data.map(d => d.door);
    const opens = doorStates.filter((d,i)=> i>0 && doorStates[i-1]===0 && d===1).length;
    const closes = doorStates.filter((d,i)=> i>0 && doorStates[i-1]===1 && d===0).length;

    // sampling window increased to 10
    const WINDOW = 10;
    // lowered threshold to 0.02 kg
    const THRESHOLD = 0.02;

    for (let i=1;i<data.length;i++){
      const prev = data[i-1]; const curr = data[i];
      if (prev.door !== curr.door) { doorChanges.push({ timestamp: curr.timestamp || curr.ts, state: curr.door===1? 'OPEN':'CLOSED' }); }
      // open 0->1
      if (prev.door === 0 && curr.door === 1){
        const startIdx = Math.max(0, i - WINDOW);
        const weights = data.slice(startIdx, i).map(d=>d.mass).filter(m=>m>0);
        const avgWeight = weights.length>0? weights.reduce((a,b)=>a+b)/weights.length : curr.mass;
        openEvent = { openTimestamp: curr.timestamp || curr.ts, weightBefore: avgWeight, index: i };
      }
      // close 1->0
      if (prev.door === 1 && curr.door === 0 && openEvent){
        const endIdx = Math.min(data.length, i + WINDOW);
        const weights = data.slice(i, endIdx).map(d=>d.mass).filter(m=>m>0);
        const avgAfter = weights.length>0? weights.reduce((a,b)=>a+b)/weights.length : curr.mass;
        const weightChange = avgAfter - openEvent.weightBefore;
        const duration = Math.round(((new Date(curr.timestamp || curr.ts)) - (new Date(openEvent.openTimestamp)))/1000);
        const type = weightChange > THRESHOLD? 'added' : (weightChange < -THRESHOLD? 'taken':'neutral');
        doorEvents.push({ openTimestamp: openEvent.openTimestamp, closeTimestamp: curr.timestamp || curr.ts, duration: duration, weightChange: weightChange, type: type });
        openEvent = null;
      }
    }

    const activitySummary = doorEvents.reverse().slice(0,50);
    const doorEventsList = doorChanges.reverse().slice(0,50);
    const timeRange = `${data[0]?.timestamp || data[0]?.ts} → ${data[data.length-1]?.timestamp || data[data.length-1]?.ts}`;
    return { activitySummary, weightTrendData: data, doorEventsList, opens: opens, closes: closes, timeRange: timeRange, parsedRows: data.length };
  }

  // Expose functions to window for external access (used by initDetailView)
  window._renderBasicInfo = renderBasicInfo;
  window._renderStatusCards = renderStatusCards;
  window._renderInventoryCategories = renderInventoryCategories;
  window._renderWishlist = renderWishlist;
  window._setupMiniMap = setupMiniMap;
  window._renderActivities = renderActivities;
  window._getActivitiesByPantryId = getActivitiesByPantryId;
  window._initSettingsSection = initSettingsSection;
  window._loadBeaconCSVAndRender = loadBeaconCSVAndRender;
  window._loadPantryDataJsonAndRender = loadPantryDataJsonAndRender;
  window._applyTelemetryLatestToPantry = applyTelemetryLatestToPantry;
  window._addWishlistItemToAPI = addWishlistItemToAPI;
  window._showToast = showToast;
  window._loadPantry = loadPantry;

  async function init(){
    // Check if pantryId is in URL - if so, show detail view directly
    const pantryId = getQueryParam('pantryId') || '';

    // Initialize list view first (always needed for navigation)
    await initListView();

    // Setup tab switching
    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const name = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('tab-' + name)?.classList.add('active');
    }));

    // Setup wishlist add button handler
    document.getElementById('mp-wishlist-add')?.addEventListener('click', async () => {
      if (!selectedPantry) return;
      const name = prompt('Item name requested:');
      if (!name || !name.trim()) return;
      const qty = parseInt(prompt('Quantity needed:', '1'), 10) || 1;
      const btn = document.getElementById('mp-wishlist-add');
      if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
      try {
        await addWishlistItemToAPI(selectedPantry.id, name.trim(), qty);
        await renderWishlist(selectedPantry.id);
        showToast('Item added to wishlist');
      } catch (e) {
        console.error('Failed to add wishlist item:', e);
        showToast('Failed to add item');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '+ Add Request'; }
      }
    });

    // Wire up time filter for Sensors tab
    const timeFilter = document.getElementById('mpTimeFilter');
    if (timeFilter) {
      timeFilter.addEventListener('change', function() {
        renderCycleCards(window._csvCycles || []);
      });
    }

    // If pantryId is provided in URL, show detail view for that pantry
    if (pantryId) {
      const pantry = await loadPantry(pantryId);
      if (pantry) {
        showPantryDetail(pantry);
      }
    }

    // Handle browser back/forward buttons
    window.addEventListener('popstate', async () => {
      const newPantryId = getQueryParam('pantryId');
      if (newPantryId) {
        const pantry = allPantries.find(p => String(p.id) === String(newPantryId));
        if (pantry) {
          showPantryDetail(pantry);
        }
      } else {
        showListView();
      }
    });
  }

  function generateSampleTelemetry(){ const now = Date.now(); const weight=[]; let base = 50 + Math.floor(Math.random()*40); for(let i=24;i>=0;i--){ const ts=new Date(now - i*60*60*1000).toISOString(); if(Math.random()<0.08) base+=5+Math.random()*8; else base += (Math.random() * -1.2); weight.push({ts, weightKg: Number(Math.max(3, base).toFixed(2))}); } const doors=[]; for(let hoursAgo=48; hoursAgo>=0; hoursAgo -= (3 + Math.floor(Math.random()*4))){ const openTs = new Date(now - hoursAgo*60*60*1000).toISOString(); doors.push({ts: openTs, status: 'open'}); const closeOffsetMin = 2 + Math.floor(Math.random()*30); const closeTs = new Date(Date.parse(openTs) + closeOffsetMin*60*1000).toISOString(); doors.push({ts: closeTs, status: 'closed'}); } weight.sort((a,b)=>new Date(a.ts)-new Date(b.ts)); doors.sort((a,b)=>new Date(a.ts)-new Date(b.ts)); return {weight,doors}; }

  document.addEventListener('DOMContentLoaded', init);

})();

// --------------------------
// Pantry JSON auto-refresh
// --------------------------
// removed previous fetch helper; using top-level loader `loadAndApplyDashboard`

// Display a small on-screen alert for fetch failures
function showFetchAlert(msg){
  try{
    const id = 'mp-fetch-alert';
    let el = document.getElementById(id);
    if (!msg){ if (el && el.parentNode) el.parentNode.removeChild(el); return; }
    if (!el){ el = document.createElement('div'); el.id = id; document.body.insertBefore(el, document.body.firstChild); }
    el.style.position = 'fixed'; el.style.top = '12px'; el.style.right = '12px'; el.style.zIndex = 99999; el.style.background = '#fff3cd'; el.style.color = '#856404'; el.style.border = '1px solid #ffeeba'; el.style.padding = '10px 14px'; el.style.borderRadius = '8px'; el.style.boxShadow = '0 8px 20px rgba(0,0,0,0.06)'; el.style.fontWeight = '700'; el.textContent = msg;
  }catch(e){ console.warn('showFetchAlert error', e); }
}

// initial fetch + setInterval
try{ loadAndApplyDashboard(); setInterval(loadAndApplyDashboard, 30000); }catch(e){}
