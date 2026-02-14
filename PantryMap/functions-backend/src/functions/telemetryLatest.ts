import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { corsHeaders, handleOptions } from "../lib/cors";

// Optional: load mssql only when needed so routes still register if mssql is not installed
function getMssql(): unknown {
  try {
    return require("mssql");
  } catch {
    return null;
  }
}

/** pantryId -> device_id in Azure SQL (same as device_to_pantry reverse) */
const PANTRY_ID_TO_DEVICE: Record<string, string> = {
  "254": "BeaconHill",
  "p-254": "BeaconHill",
  "1": "PantryLogger",
  "p-1": "PantryLogger",
};

/**
 * Supports:
 *   GET /api/telemetry?pantryId=254&latest=true
 *   GET /api/telemetry/latest?pantryId=254
 *   GET /api/GetLatestPantry?pantryId=254  (Azure deployment alias)
 * Returns latest telemetry for a pantry from Azure SQL when configured;
 * otherwise returns { latest: null } so the frontend can fall back to pantry_data.json.
 */
export async function getTelemetry(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    if (req.method === "OPTIONS") return handleOptions(req);
    const origin = req.headers.get("origin");
    const pantryId = req.query.get("pantryId")?.trim() ?? "";
    const url = req.url ?? "";
    const isLatestRoute =
      url.includes("/telemetry/latest") || url.includes("/GetLatestPantry");
    const latest = req.query.get("latest") === "true" || isLatestRoute;

    if (!pantryId) {
      return {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        body: JSON.stringify({ error: "Missing pantryId." }),
      };
    }

    const deviceId = PANTRY_ID_TO_DEVICE[pantryId] ?? pantryId;

    // When latest route or latest=true: try Azure SQL for latest row; fallback to null
    if (latest) {
      const server = process.env.AZURE_SQL_SERVER;
      const database = process.env.AZURE_SQL_DATABASE;
      const user = process.env.AZURE_SQL_USER;
      const password = process.env.AZURE_SQL_PASSWORD;
      const tableName = process.env.AZURE_SQL_TELEMETRY_TABLE?.trim() || null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sql = getMssql() as any;

      if (sql && server && database && user && password) {
        try {
          const pool = await sql.connect({
            server,
            database,
            user,
            password,
            options: {
              encrypt: true,
              trustServerCertificate: true,
            },
          });

          let table = tableName;
          if (!table) {
            const tablesResult = await pool.request().query(
              "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
            );
            const tables = tablesResult.recordset as { TABLE_NAME: string }[];
            if (tables.length > 0) table = tables[0].TABLE_NAME;
          }

          if (table) {
            // device column: try device_id first (from pantry_data.json schema)
            const deviceCol = "device_id";
            const tsCol = "timestamp";
            const request = pool.request();
            request.input("deviceId", sql.NVarChar, deviceId);
            const result = await request.query(
              `SELECT TOP 1 * FROM [${table}] WHERE [${deviceCol}] = @deviceId ORDER BY [${tsCol}] DESC`
            );
            const row = result.recordset?.[0] as Record<string, unknown> | undefined;
            await pool.close();

            if (row) {
              const s1 = Number(row.scale1 ?? 0);
              const s2 = Number(row.scale2 ?? 0);
              const s3 = Number(row.scale3 ?? 0);
              const s4 = Number(row.scale4 ?? 0);
              const weightKg =
                [s1, s2, s3, s4].every((n) => Number.isFinite(n)) ? s1 + s2 + s3 + s4 : undefined;
              const timestamp = row[tsCol] ?? row.ts ?? row.time;
              const tsStr =
                typeof timestamp === "string"
                  ? timestamp
                  : timestamp instanceof Date
                    ? timestamp.toISOString()
                    : timestamp != null
                      ? String(timestamp)
                      : undefined;

              return {
                status: 200,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                body: JSON.stringify({
                  latest: {
                    weightKg: weightKg != null ? Math.round(weightKg * 100) / 100 : undefined,
                    weight: weightKg,
                    timestamp: tsStr,
                    updatedAt: tsStr,
                  },
                }),
              };
            }
          }
        } catch (sqlErr: unknown) {
          context.log(
            "telemetryLatest SQL error:",
            sqlErr instanceof Error ? sqlErr.message : String(sqlErr)
          );
          // fall through to try ECE_TELEMETRY_BASE_URL
        }
      }

      // Fallback: when Azure SQL not configured or no row, proxy to ECE_TELEMETRY_BASE_URL (e.g. Azure deployed API)
      const telemetryBaseUrl = process.env.ECE_TELEMETRY_BASE_URL?.trim();
      if (telemetryBaseUrl) {
        try {
          const base = telemetryBaseUrl.replace(/\/$/, "");
          const proxyUrl = `${base}/GetLatestPantry?pantryId=${encodeURIComponent(pantryId)}`;
          const res = await fetch(proxyUrl);
          if (res.ok) {
            const data = (await res.json()) as Record<string, unknown>;
            const rawWeight = data.weight ?? data.weightKg;
            const weightKg =
              typeof rawWeight === "number" && Number.isFinite(rawWeight)
                ? rawWeight
                : typeof rawWeight === "string"
                  ? Number.parseFloat(rawWeight)
                  : undefined;
            const numWeight = weightKg != null && Number.isFinite(weightKg) ? weightKg : undefined;
            const timestamp =
              typeof data.timestamp === "string"
                ? data.timestamp
                : data.timestamp instanceof Date
                  ? data.timestamp.toISOString()
                  : data.timestamp != null
                    ? String(data.timestamp)
                    : undefined;
            if (numWeight != null && timestamp != null) {
              return {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders(origin),
                },
                body: JSON.stringify({
                  latest: {
                    weightKg: Math.round(numWeight * 100) / 100,
                    weight: numWeight,
                    timestamp,
                    updatedAt: timestamp,
                  },
                }),
              };
            }
          }
        } catch (fetchErr: unknown) {
          context.log(
            "ECE_TELEMETRY_BASE_URL fetch error:",
            fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          );
        }
      }

      return {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        body: JSON.stringify({
          latest: null as { weightKg?: number; weight?: number; timestamp?: string } | null,
        }),
      };
    }

    // latest !== true: history not implemented here, return empty
    return {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      body: JSON.stringify({ items: [] as unknown[] }),
    };
  } catch (err: unknown) {
    const origin = req.headers.get("origin");
    context.log("getTelemetry error:", err instanceof Error ? err.message : String(err));
    return {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      body: JSON.stringify({
        error: "Failed to fetch telemetry.",
        detail: err instanceof Error ? err.message : String(err),
      }),
    };
  }
}

// /api/telemetry/latest?pantryId=254 (and /api/telemetry?pantryId=254&latest=true)
app.http("telemetryLatest", {
  route: "telemetry/latest",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: getTelemetry,
});

// /api/telemetry?pantryId=254&latest=true (same handler, different route for backward compat)
app.http("telemetry", {
  route: "telemetry",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: getTelemetry,
});

// /api/GetLatestPantry?pantryId=254 (Azure deployment alias)
app.http("getLatestPantry", {
  route: "GetLatestPantry",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: getTelemetry,
});
