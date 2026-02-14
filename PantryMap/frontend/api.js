(function () {
  'use strict';

  /**
   * PantryAPI
   * - Normalizes backend (Cosmos/Azure Functions) pantry payloads into stable UI-ready models.
   * - Falls back to ./pantries.json only when the backend is unreachable (network/CORS).
   */

  const API = {};
  // Use window.PantryAPI_CONFIG?.apiBaseUrl for production (e.g. Azure) so Beacon Hill (254) gets sensor data from GetLatestPantry
  const API_BASE_URL = (typeof window !== 'undefined' && window.PantryAPI_CONFIG && window.PantryAPI_CONFIG.apiBaseUrl) || 'http://localhost:7071/api';
  const FALLBACK_PANTRIES_URL = './pantries.json';

  // ---------------------------
  // Small utils
  // ---------------------------

  const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
  const trimString = (v) => (typeof v === 'string' ? v.trim() : '');
  const toStringSafe = (v) => (v == null ? '' : String(v).trim());

  function coerceNumber(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function firstNumber(candidates) {
    for (const value of candidates) {
      const num = coerceNumber(value);
      if (num !== null) return num;
    }
    return null;
  }

  function normalizePantryId(id) {
    if (id == null) return '';
    if (typeof id === 'number') return Number.isFinite(id) ? String(id) : '';
    const trimmed = String(id).trim();
    if (!trimmed) return '';
    if (/^\d+$/.test(trimmed)) return String(Number.parseInt(trimmed, 10));
    const prefixed = trimmed.match(/^(?:pantry|p)[-_]?(\d+)$/i);
    if (prefixed) return String(Number.parseInt(prefixed[1], 10));
    return trimmed;
  }

  function resolvePantryId(id) {
    const raw = id == null ? '' : String(id).trim();
    const normalized = normalizePantryId(raw);
    // backend: prefer raw if present (some backends store alphanumeric ids), else normalized
    const backend = raw || normalized;
    const fallback = normalized || raw;
    return { raw, normalized, backend, fallback };
  }

  function buildQuery(paramsObj = {}) {
    const params = new URLSearchParams();
    Object.entries(paramsObj).forEach(([k, v]) => {
      if (v == null || v === '') return;
      params.append(k, String(v));
    });
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, { cache: 'no-store', ...options });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      try {
        const text = await res.text();
        try {
          const errorBody = JSON.parse(text);
          err.body = errorBody;
          err.message = errorBody?.error || errorBody?.message || `HTTP ${res.status} for ${url}`;
        } catch (_) {
          err.body = text;
          err.message = text || `HTTP ${res.status} for ${url}`;
        }
      } catch (_) {
        err.message = `HTTP ${res.status} for ${url}`;
      }
      throw err;
    }
    return res.json();
  }

  function isNetworkError(error) {
    return error instanceof TypeError || error?.name === 'TypeError';
  }

  // ---------------------------
  // Donation-based stock (Mode 2 / Self-reported): weight mapping and 24h window
  // ONE OR FEW ITEMS → 2 kg; ABOUT 1 GROCERY BAG → 10 kg; MORE THAN 1 GROCERY BAG → 25 kg
  // Special: 5× "One or few" = Medium (10 kg); 2× "More than 1 grocery bag" = High (25 kg)
  const DONATION_WEIGHT_KG = {
    low_donation: 2,
    medium_donation: 10,
    high_donation: 25,
  };
  const DONATION_24H_MS = 24 * 60 * 60 * 1000;

  // Stock level (sens_weight / tot_reported_weight vs low_weight / high_weight)
  // Reasonable range: > -2 kg & < 150 kg so sensor readings like Beacon Hill (~78 kg) are accepted.
  // ---------------------------
  const STOCK_PARAMS = {
    reasonableMin: -2,
    reasonableMax: 150,
    low_weight: 5,   // kg: <= low_weight -> LOW; low_weight < w <= high_weight -> MEDIUM; > high_weight -> HIGH
    high_weight: 25,
  };

  function isWeightInReasonableRange(weightKg) {
    const n = coerceNumber(weightKg);
    if (n === null) return false;
    return n > STOCK_PARAMS.reasonableMin && n < STOCK_PARAMS.reasonableMax;
  }

  /**
   * Compute stock level from weight (sens_weight or tot_reported_weight).
   * Returns { level: 'low'|'medium'|'high', label, cls } or null if weight invalid/out of range.
   */
  function computeStockLevelFromWeight(weightKg) {
    const n = coerceNumber(weightKg);
    if (n === null || !isWeightInReasonableRange(n)) return null;
    if (n <= STOCK_PARAMS.low_weight) return { level: 'low', label: 'Low Stock', cls: 'low' };
    if (n <= STOCK_PARAMS.high_weight) return { level: 'medium', label: 'Medium Stock', cls: 'medium' };
    return { level: 'high', label: 'In Stock', cls: 'high' };
  }

  /**
   * Resolve stock level and update_datetime:
   * - Sensor mode: sens_weight + most recent sensor reading datetime.
   * - Self-reported mode: tot_reported_weight + donation_datetime.
   * - No-update: neither available.
   */
  function resolveStockLevel(p = {}) {
    const sensWeight = coerceNumber(
      p.sensors?.weightKg ?? p.weightKg ?? p.weight ?? p.current_weight ?? p.loadcell_kg
    );
    const sensUpdatedAt = p.sensors?.updatedAt ?? p.updatedAt ?? p.timestamp ?? p.lastUpdated ?? null;
    const totReportedWeight = coerceNumber(p.tot_reported_weight ?? p.totReportedWeight ?? p.reportedWeightKg);
    const donationDatetime = p.donation_datetime ?? p.donationDatetime ?? p.lastDonationAt ?? null;

    // Prefer sensor if weight is valid
    if (sensWeight !== null && isWeightInReasonableRange(sensWeight)) {
      const badge = computeStockLevelFromWeight(sensWeight);
      if (badge) return { ...badge, weightKg: sensWeight, updatedAt: sensUpdatedAt, source: 'sensor' };
    }
    // Else self-reported donation
    if (totReportedWeight !== null && isWeightInReasonableRange(totReportedWeight)) {
      const badge = computeStockLevelFromWeight(totReportedWeight);
      if (badge) return { ...badge, weightKg: totReportedWeight, updatedAt: donationDatetime, source: 'self-reported' };
    }
    return null;
  }

  // ---------------------------
  // Extractors (normalize fields)
  // ---------------------------

  function extractLocation(p = {}) {
    const coords = Array.isArray(p.location?.coordinates) ? p.location.coordinates : null;
    const lat = firstNumber([
      p.location?.lat,
      p.location?.latitude,
      p.lat,
      p.latitude,
      p.lat_or,
      p.latOr,
      coords ? coords[1] : null,
    ]);
    const lng = firstNumber([
      p.location?.lng,
      p.location?.lon,
      p.location?.longitude,
      p.lon,
      p.lng,
      p.longitude,
      p.lon_or,
      p.lonOr,
      coords ? coords[0] : null,
    ]);
    return { lat: lat ?? null, lng: lng ?? null };
  }

  /**
   * ✅ Your requirement:
   * pantry.address = address/adress + city/town + state + zip
   */
  function extractAddress(p = {}) {
    const street =
      (isNonEmptyString(p.address) && p.address.trim()) ||
      (isNonEmptyString(p.adress) && p.adress.trim()) ||
      '';

    const city =
      (isNonEmptyString(p.city) && p.city.trim()) ||
      (isNonEmptyString(p.town) && p.town.trim()) ||
      '';

    const state =
      (isNonEmptyString(p.state) && p.state.trim()) ||
      (isNonEmptyString(p.region) && p.region.trim()) ||
      '';

    const zip =
      // zip can be number (98110) in your example
      toStringSafe(p.zip || p.zipcode || p.postalCode);

    return [street, city, state, zip].filter(Boolean).join(', ');
  }

  function extractPhotos(p = {}) {
    function normalizeUrlCandidates(raw) {
      // Return 0..N normalized, browser-loadable URLs for a single raw value.
      // This lets us "attempt" http→https upgrades without breaking compatibility.
      if (!isNonEmptyString(raw)) return [];

      let s = raw.trim();
      if (!s) return [];

      // Remove surrounding quotes defensively (often appears in CSV/JSON exports).
      if (
        (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
        (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
      ) {
        s = s.slice(1, -1).trim();
      }
      if (!s) return [];

      if (/^data:image\//i.test(s)) return [s];

      // Protocol-relative URL (//example.com/img.jpg) → prefer https
      if (s.startsWith('//')) return [`https:${s}`];

      // Sometimes values are URL-encoded. Decode and re-normalize.
      if (/%2F/i.test(s) || /%3A/i.test(s)) {
        try {
          const decoded = decodeURIComponent(s);
          if (decoded && decoded !== s) {
            const normalized = normalizeUrlCandidates(decoded);
            if (normalized.length) return normalized;
          }
        } catch (_) {}
      }

      if (/^https?:\/\//i.test(s)) {
        // Frontend is often served over HTTPS; http images can be blocked as mixed content.
        // We "attempt" an https upgrade but also keep the original http URL to avoid breaking
        // environments where the host does not support HTTPS (or when the app is served over HTTP).
        if (/^http:\/\//i.test(s)) {
          const httpsVersion = `https://${s.slice('http://'.length)}`;
          return [httpsVersion, s];
        }
        return [s];
      }

      // Common shorthand: "www.example.com/..." → assume https
      if (/^www\./i.test(s)) return [`https://${s}`];

      return [];
    }

    const urls = [];

    // Most common: array of strings (or array of objects containing url/src/href).
    if (Array.isArray(p.photos)) {
      p.photos.forEach((entry) => {
        const candidate =
          typeof entry === 'string'
            ? entry
            : (entry && (entry.url || entry.src || entry.href)) || '';
        urls.push(candidate);
      });
    }

    // Alternate arrays.
    if (Array.isArray(p.photoUrls)) urls.push(...p.photoUrls);
    if (Array.isArray(p.imageUrls)) urls.push(...p.imageUrls);
    if (Array.isArray(p.urls)) urls.push(...p.urls);

    // Singular fields.
    urls.push(p.url, p.photoUrl, p.imageUrl, p.image, p.imgUrl, p.imgURL);

    // Backend examples: img_link with multiple URLs separated by spaces (or commas/semicolons).
    if (isNonEmptyString(p.img_link)) {
      urls.push(...p.img_link.split(/[\s,;]+/));
    }

    // Also accept "img_link" variants.
    if (isNonEmptyString(p.imgLink)) {
      urls.push(...p.imgLink.split(/[\s,;]+/));
    }

    // Normalize + de-dupe.
    const normalized = urls
      .flatMap((u) => normalizeUrlCandidates(trimString(u)))
      .filter(Boolean);

    // De-dupe while preserving order (prefer https-upgraded variants first).
    const seen = new Set();
    const out = [];
    normalized.forEach((u) => {
      if (!seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    });
    return out;
  }

  function derivePantryType(p = {}) {
    const raw = p.refrigerated ?? p.pantryType ?? p.type ?? '';
    const normalizeString = (value) => String(value).trim().toLowerCase();

    if (Array.isArray(raw)) {
      const lowered = raw.map(normalizeString).filter(Boolean);
      const hasFridge = lowered.some((v) => v.includes('fridge') || v.includes('refrigerat'));
      const hasShelf = lowered.some((v) => v.includes('shelf') || v.includes('pantry'));
      if (hasFridge && hasShelf) return 'shelf+fridge';
      if (hasFridge) return 'fridge';
      if (hasShelf) return 'shelf';
    } else if (typeof raw === 'string') {
      const lowered = normalizeString(raw);
      if (!lowered) return 'shelf';
      if (/(both|and|\+|all)/.test(lowered) && lowered.includes('fridge')) return 'shelf+fridge';
      if (lowered.includes('fridge') || lowered.includes('refrigerat') || lowered.includes('cooler')) return 'fridge';
      if (lowered.includes('shelf') || lowered.includes('pantry')) return 'shelf';
    } else if (typeof raw === 'boolean') {
      return raw ? 'fridge' : 'shelf';
    }

    return 'shelf';
  }

  /**
   * ✅ Your requirement:
   * - pantry.contact.owner / pantry.contact.email / pantry.contact.emailAddress → UI does NOT show avatar or name
   * - show as: "Pantry manage contact information: Contact"
   *
   * So we normalize to a UI-friendly structure:
   * pantry.contact = null | { label: "Contact", raw: "<whatever backend gave>", kind: "contact" }
   *
   * UI can render:
   * Title: Pantry manage contact information
   * Button text: pantry.contact.label ("Contact")
   */
  function extractContact(p = {}) {
    // Support common shapes (string or nested objects), but we DO NOT expose name/avatar fields.
    const raw =
      trimString(p.contact) ||
      trimString(p.contactInfo) ||
      trimString(p.email) ||
      trimString(p.emailAddress) ||
      trimString(p.contact?.email) ||
      trimString(p.contact?.emailAddress) ||
      trimString(p.contact?.contact) ||
      '';

    if (!raw) return null;

    return {
      label: 'Contact',
      kind: 'contact',
      raw, // keep raw for possible click behavior (mailto, link, etc.), but UI can ignore it if desired
    };
  }

  // ---------------------------
  // Normalizer (single source of truth)
  // ---------------------------

  function normalizePantry(p = {}) {
    // 🔹 ID: be lenient, but always coerce to string
    const rawId =
      p.id ??
      p.pantryId ??
      p.PantryId ??
      p.device_id ??
      p.deviceId ??
      p.device ??
      p.slug ??
      p.key ??
      Math.random().toString(36).slice(2);

    const id = toStringSafe(rawId) || Math.random().toString(36).slice(2);

    // 🔹 Display name: prefer explicit name, fall back to any device/slug fallback
    const name =
      p.name ||
      p.title ||
      p.displayName ||
      p.device_name ||
      p.deviceName ||
      p.device ||
      p.slug ||
      `Pantry ${id}`;

    const statusRaw = (p.status || p.state || '').toString().toLowerCase().trim();
    let status = 'open';
    if (['closed', 'inactive', 'offline'].includes(statusRaw)) status = 'closed';
    if (['low', 'low-inventory', 'running-low'].includes(statusRaw)) status = 'low-inventory';

    const location = extractLocation(p);
    const address = extractAddress(p);
    const pantryType = derivePantryType(p);
    const photos = extractPhotos(p);
    const contact = extractContact(p);

    const inventory =
      p.inventory && typeof p.inventory === 'object'
        ? p.inventory
        : { categories: Array.isArray(p.categories) ? p.categories : [] };

    // Sensors: try to standardize the fields for UI
    const sensors = {
      // IMPORTANT: do NOT default to 0 here, otherwise every pantry looks like it has a valid
      // sensor reading of 0 kg and will block self‑reported donations from taking effect.
      weightKg:
        coerceNumber(p.weightKg) ??
        coerceNumber(p.weight) ??
        coerceNumber(p.current_weight) ??
        coerceNumber(p.loadcell_kg) ??
        null,
      temperature:
        coerceNumber(p.temperature) ??
        coerceNumber(p.temp) ??
        coerceNumber(p.temp_c) ??
        coerceNumber(p.air_temp) ??
        null,
      humidity:
        coerceNumber(p.humidity) ??
        coerceNumber(p.humid) ??
        coerceNumber(p.air_humid) ??
        null,
      doorState: p.doorState || p.door || p.door_event || null,
      updatedAt:
        p.updatedAt ||
        p.lastUpdated ||
        p.timestamp ||
        p.time ||
        p._ts ||
        (p._metadata && p._metadata.updatedAt) ||
        null,
    };

    const latestActivity =
      p.latestActivity ||
      p.lastActivity ||
      p.lastDonation ||
      p.timestamp ||
      sensors.updatedAt ||
      null;

    const wishlist = Array.isArray(p.wishlist) ? p.wishlist : [];

    const stats = {
      visitsPerDay: coerceNumber(p.visitsPerDay) ?? coerceNumber(p.stats?.visitsPerDay) ?? 0,
      ...((p.stats && typeof p.stats === 'object') ? p.stats : {}),
    };

    // Stock level: sensor mode (sens_weight) or self-reported (tot_reported_weight); no-update if neither
    const stockResolution = resolveStockLevel({ ...p, sensors });
    const stockLevel = stockResolution ? stockResolution.label : null;
    const stockLevelCls = stockResolution ? stockResolution.cls : null;
    const stockLevelUpdatedAt = stockResolution ? stockResolution.updatedAt : null;
    const stockLevelWeightKg = stockResolution && stockResolution.weightKg != null ? stockResolution.weightKg : null;
    const stockLevelSource = stockResolution ? stockResolution.source : null;

    return {
      id,
      name,
      status,
      address,
      pantryType,
      description: p.description || p.about || p.detail || '',
      acceptedFoodTypes: Array.isArray(p.acceptedFoodTypes) ? p.acceptedFoodTypes : [],
      hours: p.hours && typeof p.hours === 'object' ? p.hours : {},
      photos,
      location,
      inventory,
      sensors,
      contact,
      latestActivity,
      stats,
      wishlist,
      updatedAt: sensors.updatedAt || latestActivity || null,
      stockLevel,
      stockLevelCls,
      stockLevelUpdatedAt,
      stockLevelWeightKg,
      stockLevelSource,
      _raw: p, // keep original shape for debugging & advanced UI
    };
  }

  // ---------------------------
  // Fallback Loaders
  // ---------------------------

  async function loadFallbackPantries() {
    const list = await fetchJson(FALLBACK_PANTRIES_URL);
    return Array.isArray(list) ? list.map(normalizePantry) : [];
  }

  async function loadFallbackPantryById(id) {
    const { backend: backendId, normalized: normalizedId } = resolvePantryId(id);
    const list = await fetchJson(FALLBACK_PANTRIES_URL);

    if (!Array.isArray(list)) return null;

    const targetIds = new Set([backendId, normalizedId].filter(Boolean));

    const match = list.find((p) => {
      const candidate = resolvePantryId(p.id ?? p.pantryId);
      return [candidate.backend, candidate.normalized].some((value) => value && targetIds.has(value));
    });

    return match ? normalizePantry(match) : null;
  }

  // ---------------------------
  // API methods
  // ---------------------------

  API.getPantries = async function getPantries(filters = {}) {
    const query = buildQuery({
      status: filters.status,
      type: filters.type,
      bounds: filters.bounds,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 500,
    });

    const url = `${API_BASE_URL}/pantries${query}`;

    try {
      console.log('Fetching pantries from backend API...', url);
      const list = await fetchJson(url);
      const normalized = Array.isArray(list) ? list.map(normalizePantry) : [];
      console.info('[PantryAPI] Using backend pantries payload', normalized.length);
      return normalized;
    } catch (error) {
      console.warn('[PantryAPI] Backend error, falling back to static pantries.json', error);
      const normalized = await loadFallbackPantries();
      console.info('[PantryAPI] Using fallback pantries payload', normalized.length);
      return normalized;
    }
  };

  API.getPantry = async function getPantry(id) {
    const { backend: backendId } = resolvePantryId(id);
    if (!backendId) throw new Error('Pantry id is required');

    const url = `${API_BASE_URL}/pantries/${encodeURIComponent(backendId)}`;

    try {
      const pantry = await fetchJson(url);
      console.info('[PantryAPI] Using backend pantry detail', backendId);
      return normalizePantry(pantry);
    } catch (error) {
      console.warn('[PantryAPI] Backend error when fetching pantry, using static fallback.', error);
      const fallback = await loadFallbackPantryById(backendId);
      if (!fallback) throw error;
      return fallback;
    }
  };

  API.getMessages = async function getMessages(pantryId) {
    const { backend: backendId } = resolvePantryId(pantryId);
    if (!backendId) return [];
    const url = `${API_BASE_URL}/messages${buildQuery({ pantryId: backendId })}`;

    try {
      const data = await fetchJson(url);
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    } catch (error) {
      console.error('Error fetching messages:', error);
      return [];
    }
  };

  API.postMessage = async function postMessage(pantryId, content, userName, userAvatar, photos = []) {
    const { backend: backendId } = resolvePantryId(pantryId);
    if (!backendId) throw new Error('Pantry id is required');

    const payload = {
      pantryId: backendId,
      content,
      userName,
      userAvatar,
      photos,
    };

    try {
      const data = await fetchJson(`${API_BASE_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return data;
    } catch (error) {
      console.error('Error posting message:', error);
      throw error;
    }
  };

  // Donations — use normalized id so GET/POST always hit the same backend key (e.g. "1" for both "p-1" and "1")
  API.getDonations = async function getDonations(pantryId, page = 1, pageSize = 1) {
    const { normalized: normalizedId, backend: backendId } = resolvePantryId(pantryId);
    const donationPantryId = normalizedId || backendId;
    if (!donationPantryId) return { items: [], page: 1, pageSize: 1, total: 0 };

    const url = `${API_BASE_URL}/donations${buildQuery({ pantryId: donationPantryId, page, pageSize })}`;

    try {
      const data = await fetchJson(url);
      return {
        items: Array.isArray(data?.items) ? data.items : [],
        page: data?.page ?? page,
        pageSize: data?.pageSize ?? pageSize,
        total: coerceNumber(data?.total) ?? 0,
      };
    } catch (e) {
      if (isNetworkError(e)) {
        console.warn('[PantryAPI] /donations unavailable (network/CORS).', e);
      } else {
        console.error('[PantryAPI] getDonations failed', e);
      }
      return { items: [], page, pageSize, total: 0 };
    }
  };

  /** Get numeric timestamp (ms) from a donation; accepts ISO string from createdAt/created_at/timestamp. */
  function getDonationTimeMs(d) {
    const raw = d.createdAt ?? d.created_at ?? d.timestamp ?? d.updatedAt;
    if (raw == null || raw === '') return Date.now();
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : Date.now();
  }

  /**
   * Self-reported mode: estimate tot_reported_weight from donations in the last 24 hours.
   * Backend already returns only donations within 24h; we do not re-filter by client time to avoid clock skew.
   * Mapping: low_donation → 2 kg, medium_donation → 10 kg, high_donation → 25 kg.
   * Returns { weightKg, updatedAt, source: 'donations' } or null if no donations in 24h.
   */
  API.getDonationBasedStock = async function getDonationBasedStock(pantryId) {
    const { normalized: normalizedId } = resolvePantryId(pantryId);
    if (!normalizedId) return null;
    try {
      const data = await API.getDonations(pantryId, 1, 100);
      const items = Array.isArray(data?.items) ? data.items : [];
      // Backend already filters to 24h; use all returned items and sort by time descending (no client re-filter to avoid clock skew)
      const recent = items.slice().sort((a, b) => getDonationTimeMs(b) - getDonationTimeMs(a));
      if (recent.length === 0) return null;

      const countLow = recent.filter((d) => (d.donationSize || '') === 'low_donation').length;
      const countMedium = recent.filter((d) => (d.donationSize || '') === 'medium_donation').length;
      const countHigh = recent.filter((d) => (d.donationSize || '') === 'high_donation').length;

      let weightKg = null;
      const firstTs = recent[0].createdAt ?? recent[0].created_at ?? recent[0].updatedAt ?? recent[0].timestamp;
      const updatedAt = firstTs != null && firstTs !== '' ? (typeof firstTs === 'string' ? firstTs : new Date(firstTs).toISOString()) : new Date().toISOString();

      if (countHigh >= 2) {
        weightKg = DONATION_WEIGHT_KG.high_donation;
      } else if (countLow >= 5) {
        weightKg = DONATION_WEIGHT_KG.medium_donation;
      } else {
        const size = (recent[0].donationSize || '').trim();
        weightKg = DONATION_WEIGHT_KG[size] != null ? DONATION_WEIGHT_KG[size] : null;
      }

      if (weightKg == null || !Number.isFinite(weightKg)) return null;
      const tsStr = typeof updatedAt === 'string' ? updatedAt : (updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt));
      return {
        weight: weightKg,
        weightKg: weightKg,
        updatedAt: tsStr,
        timestamp: tsStr,
        source: 'donations',
      };
    } catch (e) {
      console.warn('getDonationBasedStock failed', e);
      return null;
    }
  };

  API.createDonationUploadSas = async function createDonationUploadSas(pantryId, file) {
    const { backend: backendId } = resolvePantryId(pantryId);
    if (!backendId) throw new Error('Pantry id is required');
    if (!file || typeof file.name !== 'string' || typeof file.type !== 'string') {
      throw new Error('A file with name and type is required');
    }

    const payload = {
      pantryId: backendId,
      filename: file.name,
      contentType: file.type,
    };

    const data = await fetchJson(`${API_BASE_URL}/uploads/donations/sas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return {
      uploadUrl: data?.uploadUrl,
      blobUrl: data?.blobUrl,
      expiresOn: data?.expiresOn,
    };
  };

  API.getDonationReadSas = async function getDonationReadSas(blobUrl) {
    if (!blobUrl || typeof blobUrl !== 'string') throw new Error('blobUrl is required');
    const url = `${API_BASE_URL}/uploads/donations/read-sas${buildQuery({ blobUrl })}`;
    const data = await fetchJson(url);
    return {
      readUrl: data?.readUrl,
      expiresOn: data?.expiresOn,
    };
  };

  API.postDonation = async function postDonation(pantryId, payload = {}) {
    const { normalized: normalizedId, backend: backendId } = resolvePantryId(pantryId);
    const donationPantryId = normalizedId || backendId;
    if (!donationPantryId) throw new Error('Pantry id is required');

    const note = trimString(payload.note);
    const donationSize = trimString(payload.donationSize);
    const donationItems = Array.isArray(payload.donationItems) ? payload.donationItems : [];
    const photoUrls = Array.isArray(payload.photoUrls) ? payload.photoUrls : [];
    
    // Only donationSize is required, all other fields are optional
    if (!donationSize) {
      throw new Error('donationSize is required');
    }

    const body = {
      pantryId: donationPantryId,
      donationSize: donationSize,
      ...(note ? { note } : {}),
      ...(donationItems.length > 0 ? { donationItems } : {}),
      ...(photoUrls.length > 0 ? { photoUrls } : {}),
    };

    try {
      console.log('[PantryAPI] Posting donation:', body);
      const data = await fetchJson(`${API_BASE_URL}/donations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      console.log('[PantryAPI] Donation posted successfully:', data);
      return data;
    } catch (e) {
      console.error('Error posting donation report:', e);
      throw e;
    }
  };

  // Wishlist
  API.getWishlist = async function getWishlist(pantryId) {
    const { backend: backendId } = resolvePantryId(pantryId);
    if (!backendId) return [];

    const url = `${API_BASE_URL}/wishlist${buildQuery({ pantryId: backendId })}`;
    try {
      const data = await fetchJson(url);
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    } catch (e) {
      console.error('Error fetching wishlist:', e);
      return [];
    }
  };

  API.addWishlistItem = async function addWishlistItem(pantryId, item, quantity = 1) {
    const { backend: backendId } = resolvePantryId(pantryId);
    const trimmedItem = isNonEmptyString(item) ? item.trim() : String(item || '').trim();
    const parsedQuantity = Number.parseInt(quantity, 10);
    const safeQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;

    if (!backendId || !trimmedItem) throw new Error('Missing pantryId or item');

    const payload = { pantryId: backendId, item: trimmedItem, quantity: safeQuantity };

    try {
      const data = await fetchJson(`${API_BASE_URL}/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return data?.agg ?? data;
    } catch (e) {
      console.error('Error adding wishlist item:', e);
      throw e;
    }
  };

  API.addWishlist = async function addWishlist(pantryId, item, quantity = 1) {
    await API.addWishlistItem(pantryId, item, quantity);
    return API.getWishlist(pantryId);
  };

  // Stock / Telemetry priority: 1) Sensor (API telemetry/latest e.g. Beacon Hill 254 → Azure SQL);
  // 2) Local device_to_pantry + pantry_data.json (within 24h); 3) Donations (last 24h). Sensor is always tried first.
  API.getTelemetryLatest = async function getTelemetryLatest(pantryId) {
    const { normalized: normalizedId } = resolvePantryId(pantryId);
    if (!normalizedId) return null;

    const url = `${API_BASE_URL}/telemetry/latest${buildQuery({ pantryId: normalizedId })}`;
    try {
      const data = await fetchJson(url);
      // Backend may return flat object { weight, doorStatus, timestamp } or wrapped { latest: {...} }
      const raw = data != null && data.weight !== undefined ? data : (data?.latest ?? null);
      if (raw == null) return null;
      const weight = coerceNumber(raw.weight ?? raw.weightKg);
      const timestamp = raw.timestamp ?? raw.updatedAt ?? raw.ts;
      const tsStr = timestamp != null ? (typeof timestamp === 'string' ? timestamp : (timestamp instanceof Date ? timestamp.toISOString() : String(timestamp))) : undefined;
      if (weight !== null && tsStr != null) {
        return {
          weight,
          weightKg: weight,
          doorStatus: raw.doorStatus,
          timestamp: tsStr,
          updatedAt: tsStr,
          source: 'sensor',
        };
      }
      return null;
    } catch (e) {
      const status = e && e.status;
      if (status === 404 || status === 500) {
        console.warn('Telemetry API failed (', status, '), using local fallback:', e.message || e);
      } else if (status != null) {
        console.warn('Telemetry API failed, using local fallback:', e.message || e);
      }
    }

    // Fallback: match pantryId → deviceId via device_to_pantry.json; latest record from pantry_data.json (within 24h)
    try {
      const dtpRes = await fetch('./data/device_to_pantry.json', { cache: 'no-store' });
      if (dtpRes?.ok) {
        const deviceToPantry = await dtpRes.json();
        const deviceId = Object.keys(deviceToPantry || {}).find(
          (k) => String(deviceToPantry[k]) === String(normalizedId) || String(deviceToPantry[k]) === 'p-' + normalizedId
        );
        if (deviceId) {
          const dataRes = await fetch('./pantry_data.json', { cache: 'no-store' });
          if (dataRes?.ok) {
            const list = await dataRes.json();
            const rows = Array.isArray(list) ? list.filter((r) => (r.device_id || r.deviceId || '') === deviceId) : [];
            if (rows.length > 0) {
              const latestRow = rows.reduce((best, row) => {
                const ts = new Date(row.timestamp || row.ts || row.time || 0).getTime();
                return !best || ts > best.ts ? { row, ts } : best;
              }, null);
              if (latestRow?.row) {
                const r = latestRow.row;
                const directWeight = coerceNumber(r.weight ?? r.weightKg);
                const s1 = Number(r.scale1 ?? 0);
                const s2 = Number(r.scale2 ?? 0);
                const s3 = Number(r.scale3 ?? 0);
                const s4 = Number(r.scale4 ?? 0);
                const sumWeight = [s1, s2, s3, s4].every((n) => Number.isFinite(n)) ? s1 + s2 + s3 + s4 : null;
                const weightKg = directWeight !== null ? directWeight : sumWeight;
                const timestamp = r.timestamp ?? r.ts ?? r.time;
                const tsStr = timestamp != null ? (typeof timestamp === 'string' ? timestamp : (timestamp instanceof Date ? timestamp.toISOString() : String(timestamp))) : undefined;
                if (weightKg != null && tsStr != null) {
                  const rowTime = new Date(timestamp).getTime();
                  const now = Date.now();
                  if (rowTime >= now - DONATION_24H_MS) {
                    return { weight: weightKg, weightKg, timestamp: tsStr, updatedAt: tsStr, source: 'fallback_local' };
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Local telemetry fallback failed:', e);
    }

    // Priority 3: Self-reported (donations in last 24h). Only show "unavailable" if no sensor AND no donations.
    if (typeof API.getDonationBasedStock === 'function') {
      const donationStock = await API.getDonationBasedStock(pantryId);
      if (donationStock != null) return donationStock;
    }
    return null;
  };

  API.getTelemetryHistory = async function getTelemetryHistory(pantryId, from, to) {
    const { normalized: normalizedId } = resolvePantryId(pantryId);
    if (!normalizedId) return [];

    const url = `${API_BASE_URL}/telemetry${buildQuery({ pantryId: normalizedId, from, to })}`;
    try {
      const data = await fetchJson(url);
      return data?.items || [];
    } catch (e) {
      if (e && e.status === 404) return [];
      console.error('Error fetching telemetry history:', e);
      return [];
    }
  };

  // Expose globally
  API.STOCK_PARAMS = STOCK_PARAMS;
  API.computeStockLevelFromWeight = computeStockLevelFromWeight;
  API.isWeightInReasonableRange = isWeightInReasonableRange;

  window.PantryAPI = API;
})();