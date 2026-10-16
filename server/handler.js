import { gzipSync } from "node:zlib";
import { validBounds } from "../shared/regions.js";

// This handler works with both local Express and Vercel's Node request/response.
// Every browser uses the same worldwide request/cache key.
export function createAircraftHandler(opensky, { edgeCache = false } = {}) {
  return async function aircraftHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) {
      res.setHeader("Allow", "GET, HEAD");
      res.statusCode = 405;
      return res.end();
    }
    const url = new URL(req.url, "http://planet.local");
    const raw = url.searchParams.get("bounds");
    const bounds =
      raw === null
        ? null
        : raw.split(",").map((x) => (x.trim() === "" ? NaN : Number(x)));
    if (bounds !== null && !validBounds(bounds)) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Invalid geographical bounds." }));
    }
    try {
      const payload = await opensky.getStates(bounds);
      res.statusCode = payload.fetchedAt ? 200 : 503;
      if (edgeCache && payload.fetchedAt && !payload.retryAt) {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        res.setHeader(
          "Vercel-CDN-Cache-Control",
          "public, s-maxage=50, stale-while-revalidate=10",
        );
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Vary", "Accept-Encoding");
      let body = Buffer.from(JSON.stringify(payload));
      if (/\bgzip\b/.test(req.headers?.["accept-encoding"] || "")) {
        body = gzipSync(body);
        res.setHeader("Content-Encoding", "gzip");
      }
      res.setHeader("Content-Length", body.length);
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          states: [],
          issue: "OpenSky is temporarily unavailable. Retrying automatically.",
          nextPollMs: 60000,
        }),
      );
    }
  };
}
