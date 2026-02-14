import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { corsHeaders, handleOptions } from "../lib/cors";

function json(status: number, body: unknown, origin?: string | null): HttpResponseInit {
  return {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    body: JSON.stringify(body),
  };
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

/** Normalize pantryId so "p-1", "1", "pantry-1" all map to the same key (avoids empty list after refresh when UI uses different id format). */
function normalizePantryId(pantryId: string): string {
  const t = (pantryId ?? "").trim();
  if (!t) return t;
  const numeric = t.replace(/^(?:pantry|p)[-_]?/i, "").trim();
  if (/^\d+$/.test(numeric)) return numeric;
  return t;
}

// 🔹 in-memory donor notes (per pantry)
type DonorNote = {
  id: string;
  pantryId: string;
  note?: string;
  donationSize?: string;
  donationItems?: string[];
  photoUrls?: string[];
  createdAt: string;
};

const donorNotesByPantry = new Map<string, DonorNote[]>();

async function getDonations(req: HttpRequest): Promise<HttpResponseInit> {
  const origin = req.headers.get("origin");
  const pantryId = req.query.get("pantryId")?.trim() ?? "";
  const page = parsePositiveInt(req.query.get("page"), 1);
  const pageSize = parsePositiveInt(req.query.get("pageSize"), 5);

  if (!pantryId) {
    return json(400, { error: "Missing pantryId." }, origin);
  }

  const key = normalizePantryId(pantryId);
  let list = donorNotesByPantry.get(key) ?? [];

  // Filter out posts older than 24 hours (ISO createdAt); invalid/missing dates treated as recent so we don't drop donations
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  list = list.filter((item) => {
    const raw = item.createdAt;
    if (!raw || typeof raw !== "string") return true;
    const createdAt = new Date(raw).getTime();
    if (!Number.isFinite(createdAt)) return true;
    return createdAt >= twentyFourHoursAgo;
  });

  // Update the stored list (remove old items)
  donorNotesByPantry.set(key, list);
  
  const total = list.length;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize);

  return json(200, { items, page, pageSize, total }, origin);
}

async function postDonation(req: HttpRequest): Promise<HttpResponseInit> {
  const origin = req.headers.get("origin");

  let body: { pantryId?: string; note?: string; donationSize?: string; donationItems?: string[]; photoUrls?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON body." }, origin);
  }

  const rawPantryId = (body?.pantryId ?? "").trim();
  if (!rawPantryId) {
    return json(400, { error: "Missing pantryId." }, origin);
  }
  const pantryId = normalizePantryId(rawPantryId);

  const note = typeof body.note === "string" ? body.note.trim() : undefined;
  const donationSize = typeof body.donationSize === "string" ? body.donationSize.trim() : undefined;
  const donationItems =
    Array.isArray(body.donationItems) && body.donationItems.length > 0
      ? body.donationItems.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;
  const photoUrls =
    Array.isArray(body.photoUrls) && body.photoUrls.length > 0
      ? body.photoUrls.filter((u): u is string => typeof u === "string")
      : undefined;

  // Only donationSize is required, all other fields are optional
  if (!donationSize) {
    return json(400, { error: "donationSize is required." }, origin);
  }

  const item: DonorNote = {
    id: `dn-${pantryId}-${Date.now()}`,
    pantryId,
    ...(note ? { note } : {}),
    ...(donationSize ? { donationSize } : {}),
    ...(donationItems ? { donationItems } : {}),
    ...(photoUrls ? { photoUrls } : {}),
    createdAt: new Date().toISOString(),
  };

  const list = donorNotesByPantry.get(pantryId) ?? [];
  list.unshift(item);
  donorNotesByPantry.set(pantryId, list);

  return json(201, item, origin);
}

async function handler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method === "POST") return postDonation(req);
  return getDonations(req);
}

app.http("donations", {
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler,
});
