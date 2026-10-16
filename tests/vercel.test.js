import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createAircraftHandler } from "../server/handler.js";
import { createOpenSky } from "../server/opensky.js";
import { planeModelFor, FLIGHT_VIEW_DISTANCE } from "../src/lib/models.js";
import { demoRows } from "../src/lib/demo.js";
import { WORLD } from "../shared/regions.js";

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(body) {
      this.body = body;
    },
  };
}
const now = 1_800_000_000_000;
const rows = [
  [
    "abcdef",
    "TEST001",
    "India",
    now / 1000,
    now / 1000,
    79,
    23,
    10000,
    false,
    230,
    90,
    0,
    null,
    null,
    null,
    false,
    0,
    4,
  ],
];

test("worldwide requests send no bounding box and share one upstream cache", async () => {
  let calls = 0;
  const service = createOpenSky({
    now: () => now,
    fetcher: async (url) => {
      calls++;
      const parsed = new URL(url);
      for (const key of ["lamin", "lomin", "lamax", "lomax"])
        assert.equal(parsed.searchParams.has(key), false);
      return Response.json({ time: now / 1000, states: rows });
    },
  });
  const a = await service.getStates();
  const b = await service.getStates();
  assert.equal(a.states.length, 1);
  assert.equal(b.states.length, 1);
  assert.equal(calls, 1);
});

test("Vercel-compatible handler returns gzip worldwide data and safe CDN headers", async () => {
  let requested;
  const handler = createAircraftHandler(
    {
      getStates: async (bounds) => {
        requested = bounds;
        return {
          states: rows,
          time: now / 1000,
          fetchedAt: now,
          retryAt: null,
        };
      },
    },
    { edgeCache: true },
  );
  const res = response();
  await handler(
    {
      method: "GET",
      url: "/api/aircraft",
      headers: { "accept-encoding": "gzip, br" },
    },
    res,
  );
  assert.equal(requested, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-encoding"], "gzip");
  assert.match(res.headers["vercel-cdn-cache-control"], /s-maxage=50/);
  assert.equal(JSON.parse(gunzipSync(res.body)).states.length, 1);
});

test("Vercel handler does not cache failures and preserves retry information", async () => {
  const handler = createAircraftHandler(
    {
      getStates: async () => ({
        states: [],
        fetchedAt: null,
        retryAt: now + 10000,
        issue: "Rate limited",
        nextPollMs: 60000,
      }),
    },
    { edgeCache: true },
  );
  const res = response();
  await handler({ method: "GET", url: "/api/aircraft", headers: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["vercel-cdn-cache-control"], undefined);
  assert.equal(JSON.parse(res.body).issue, "Rate limited");
});

test("native Vercel entry point reads environment credentials and never sends them to the client", async () => {
  const oldFetch = globalThis.fetch,
    oldId = process.env.OPENSKY_CLIENT_ID,
    oldSecret = process.env.OPENSKY_CLIENT_SECRET;
  process.env.OPENSKY_CLIENT_ID = "fixture-client";
  process.env.OPENSKY_CLIENT_SECRET = "fixture-secret";
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/token")) {
      assert.equal(options.body.get("client_secret"), "fixture-secret");
      return Response.json({ access_token: "private-token", expires_in: 1800 });
    }
    assert.equal(options.headers.Authorization, "Bearer private-token");
    return Response.json({ time: Math.floor(Date.now() / 1000), states: rows });
  };
  try {
    const { default: handler } = await import("../api/aircraft.js");
    const res = response();
    await handler({ method: "GET", url: "/api/aircraft", headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).authMode, "authenticated");
    for (const secret of ["fixture-secret", "fixture-client", "private-token"])
      assert.ok(!res.body.toString().includes(secret));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldId === undefined) delete process.env.OPENSKY_CLIENT_ID;
    else process.env.OPENSKY_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.OPENSKY_CLIENT_SECRET;
    else process.env.OPENSKY_CLIENT_SECRET = oldSecret;
  }
});

test("API rejects invalid bounds and unsupported methods", async () => {
  const handler = createAircraftHandler({
    getStates: async () => {
      throw new Error("Must not call");
    },
  });
  let res = response();
  await handler({ method: "POST", url: "/api/aircraft", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  res = response();
  await handler(
    { method: "GET", url: "/api/aircraft?bounds=invalid", headers: {} },
    res,
  );
  assert.equal(res.statusCode, 400);
});

test("selection distance is halved and illustrative models can be selected explicitly", () => {
  assert.equal(FLIGHT_VIEW_DISTANCE, 1.325);
  assert.equal(planeModelFor({ category: 6 }).id, "ss500");
  assert.equal(planeModelFor({ category: 2 }).id, "prop");
  assert.equal(planeModelFor({ category: 6 }, "prop").id, "prop");
});

test("sample mode populates the whole planet with unique aircraft addresses", () => {
  const states = demoRows(WORLD.bounds);
  assert.equal(states.length, 192);
  assert.equal(new Set(states.map((row) => row[0])).size, 192);
  assert.ok(states.some((row) => row[5] < -60));
  assert.ok(states.some((row) => row[5] > 100));
  assert.ok(states.some((row) => row[6] < -10));
});
