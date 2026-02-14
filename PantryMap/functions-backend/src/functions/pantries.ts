import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";
import { corsHeaders, handleOptions } from "../lib/cors";

function getClient() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;

  if (!endpoint || !key) {
    throw new Error("Missing COSMOS_ENDPOINT or COSMOS_KEY. Check local.settings.json.");
  }

  return new CosmosClient({ endpoint, key });
}

export async function getPantries(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    if (req.method === "OPTIONS") return handleOptions(req);
    const origin = req.headers.get("origin");
    const dbName = process.env.COSMOS_DATABASE ?? "microPantry";
    const containerName = process.env.COSMOS_CONTAINER_PANTRIES ?? "pantries";

    const client = getClient();
    const container = client.database(dbName).container(containerName);

    // Select common UI fields while avoiding Cosmos system metadata.
    // NOTE: include optional photo/address fields because frontend expects them when present.
    const query = `
      SELECT
        c.id, c.name, c.location, c.description, c.detail, c.status, c.updatedAt,
        c.photos, c.img_link, c.imgLink,
        c.url, c.urls, c.photoUrl, c.photoUrls, c.imageUrl, c.imageUrls, c.image, c.imgUrl, c.imgURL,
        c.address, c.adress, c.city, c.town, c.state, c.region, c.zip, c.zipcode, c.postalCode,
        c.refrigerated, c.pantryType, c.type
      FROM c
    `;

    const { resources } = await container.items.query(query).fetchAll();

    return {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      body: JSON.stringify(resources ?? []),
    };
  } catch (err: any) {
    const origin = req.headers.get("origin");
    context.log("getPantries error:", err?.message || err);
    return {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      body: JSON.stringify({
        error: "Failed to fetch pantries.",
        detail: err?.message || String(err),
      }),
    };
  }
}

app.http("pantries", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: getPantries,
});

