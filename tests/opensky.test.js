import test from "node:test";
import assert from "node:assert/strict";
import { createOpenSky, retryDelay } from "../server/opensky.js";

const start = 1_800_000_000_000,
  bounds = [5, 64, 38, 99];
const credentials = { clientId: "test-client", clientSecret: "test-secret" };
const state = (t) => [
  "abcdef",
  "IGO123",
  "India",
  t,
  t,
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
];
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const snapshot = (t) => ({ time: t / 1000, states: [state(t / 1000)] });

test("authenticates server-side, coalesces requests, and serves cached data without spending more credits", async () => {
  let calls = 0,
    time = start;
  const api = createOpenSky({
    credentials,
    now: () => time,
    fetcher: async (url, options) => {
      calls++;
      if (String(url).includes("/token")) {
        assert.equal(options.body.get("client_secret"), "test-secret");
        return json({ access_token: "private-token", expires_in: 1800 });
      }
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.equal(new URL(url).searchParams.get("extended"), "1");
      return json(snapshot(time), 200, { "x-rate-limit-remaining": "3996" });
    },
  });
  const [a, b] = await Promise.all([
    api.getStates(bounds),
    api.getStates(bounds),
  ]);
  assert.equal(calls, 2);
  assert.equal(a.states.length, 1);
  assert.deepEqual(a, b);
  await api.getStates(bounds);
  assert.equal(calls, 2);
  time += 61000;
  await api.getStates(bounds);
  assert.equal(calls, 3);
});
test("rate limiting honors the upstream retry header across different regions and preserves cache", async () => {
  let time = start,
    calls = 0,
    fail = false;
  const api = createOpenSky({
    now: () => time,
    fetcher: async () => {
      calls++;
      return fail
        ? json({}, 429, { "x-rate-limit-retry-after-seconds": "600" })
        : json(snapshot(time));
    },
  });
  await api.getStates(bounds);
  time += 301000;
  fail = true;
  const r = await api.getStates(bounds);
  assert.equal(r.states.length, 1);
  assert.equal(r.retryAt, time + 600000);
  assert.match(r.issue, /request limit/);
  await api.getStates([35, -12, 62, 35]);
  assert.equal(calls, 2);
});
test("timeouts back off and keep a valid previous snapshot", async () => {
  let time = start,
    fail = false;
  const api = createOpenSky({
    now: () => time,
    fetcher: async () => {
      if (fail) throw new Error("timeout");
      return json(snapshot(time));
    },
  });
  await api.getStates(bounds);
  time += 301000;
  fail = true;
  const r = await api.getStates(bounds);
  assert.equal(r.states.length, 1);
  assert.ok(r.stale);
  assert.equal(r.retryAt, time + 30000);
});
test("malformed and older upstream responses cannot replace the last valid snapshot", async () => {
  let time = start,
    mode = 0;
  const api = createOpenSky({
    credentials,
    now: () => time,
    fetcher: async (url) =>
      String(url).includes("/token")
        ? json({ access_token: "token" })
        : json(
            mode === 0
              ? snapshot(time)
              : mode === 1
                ? { time: time / 1000, states: [[]] }
                : snapshot(start - 10000),
          ),
  });
  await api.getStates(bounds);
  time += 61000;
  mode = 1;
  let r = await api.getStates(bounds);
  assert.equal(r.time, start / 1000);
  assert.match(r.issue, /incomplete/);
  time += 61000;
  mode = 2;
  r = await api.getStates(bounds);
  assert.equal(r.time, start / 1000);
  assert.match(r.issue, /older snapshot/);
});
test("a delayed successful response is labeled as outdated rather than live", async () => {
  const api = createOpenSky({
    now: () => start,
    fetcher: async () => json(snapshot(start - 2700000)),
  });
  const r = await api.getStates(bounds);
  assert.ok(r.stale);
  assert.equal(r.snapshotAgeSeconds, 2700);
  assert.match(r.issue, /45 minutes old/);
});
test("a valid empty snapshot is accepted", async () => {
  const api = createOpenSky({
    now: () => start,
    fetcher: async () => json({ time: start / 1000, states: null }),
  });
  const r = await api.getStates(bounds);
  assert.deepEqual(r.states, []);
  assert.equal(r.issue, null);
});
test("401 expires the token and retries only once", async () => {
  let tokens = 0,
    requests = 0;
  const api = createOpenSky({
    credentials,
    now: () => start,
    fetcher: async (url) => {
      if (String(url).includes("/token"))
        return json({ access_token: `token-${++tokens}` });
      return ++requests === 1 ? json({}, 401) : json(snapshot(start));
    },
  });
  const r = await api.getStates(bounds);
  assert.equal(tokens, 2);
  assert.equal(requests, 2);
  assert.equal(r.issue, null);
});
test("low remaining credits slow the refresh interval", async () => {
  const api = createOpenSky({
    credentials,
    now: () => start,
    fetcher: async (url) =>
      String(url).includes("/token")
        ? json({ access_token: "token" })
        : json(snapshot(start), 200, { "x-rate-limit-remaining": "400" }),
  });
  assert.equal((await api.getStates(bounds)).nextPollMs, 120000);
});
test("retry headers support seconds and HTTP dates", () => {
  assert.equal(retryDelay(new Headers({ "retry-after": "42" }), start), 42000);
  assert.equal(
    retryDelay(
      new Headers({ "retry-after": new Date(start + 60000).toUTCString() }),
      start,
    ),
    60000,
  );
});
test("persisted snapshots are usable through an outage and secrets never reach the result", async () => {
  const entry = { ...snapshot(start), fetchedAt: start - 300000 };
  const api = createOpenSky({
    credentials,
    now: () => start,
    initialCache: [["5.000,64.000,38.000,99.000", entry]],
    fetcher: async () => {
      throw new Error("private-token");
    },
  });
  const r = await api.getStates(bounds);
  assert.equal(r.states.length, 1);
  assert.ok(!JSON.stringify(r).includes("test-secret"));
  assert.ok(!JSON.stringify(r).includes("private-token"));
});
test("malformed persisted caches do not prevent the service starting", async () => {
  for (const initialCache of [
    { unexpected: true },
    [null, ["broken"], ["key", {}]],
  ]) {
    const api = createOpenSky({
      initialCache,
      now: () => start,
      fetcher: async () => json(snapshot(start)),
    });
    assert.equal((await api.getStates(bounds)).states.length, 1);
  }
});

test("required deployment credentials fail immediately without an anonymous request", async () => {
  let requests = 0;
  const api = createOpenSky({
    credentials: { clientId: "configured-id" },
    requireCredentials: true,
    now: () => start,
    fetcher: async () => { requests++; throw new Error("Must not connect"); },
  });
  const result = await api.getStates();
  assert.equal(requests, 0);
  assert.equal(result.authMode, "unconfigured");
  assert.equal(result.upstreamStatus, null);
  assert.equal(result.retryAt, null);
  assert.equal(result.diagnostic.code, "MISSING_CREDENTIALS");
  assert.equal(result.diagnostic.retryable, false);
  assert.match(result.issue, /OPENSKY_CLIENT_SECRET/);
  assert.doesNotMatch(result.issue, /OPENSKY_CLIENT_ID/);
  assert.ok(!JSON.stringify(result).includes("configured-id"));
});

test("connection errors distinguish OAuth from aircraft timeouts and sanitize error details", async () => {
  for (const stage of ["authentication", "aircraft"]) {
    const api = createOpenSky({
      credentials,
      now: () => start,
      fetcher: async (url) => {
        if (stage === "aircraft" && String(url).includes("/token"))
          return json({ access_token: "secret-token" });
        throw new TypeError("sensitive raw failure", { cause: { code: "UND_ERR_CONNECT_TIMEOUT", request: "secret-token" } });
      },
    });
    const result = await api.getStates();
    assert.equal(result.upstreamStatus, null);
    assert.equal(result.diagnostic.stage, stage);
    assert.equal(result.diagnostic.code, "CONNECTION_TIMEOUT");
    assert.equal(result.diagnostic.networkCode, "UND_ERR_CONNECT_TIMEOUT");
    assert.equal(result.retryAt, start + 30000);
    assert.ok(!JSON.stringify(result).includes("sensitive raw failure"));
    assert.ok(!JSON.stringify(result).includes("secret-token"));
  }
});

test("a failed connection clears the previous HTTP status and recovery clears diagnostics", async () => {
  let time = start, fail = false;
  const api = createOpenSky({
    credentials,
    now: () => time,
    fetcher: async (url) => {
      if (String(url).includes("/token")) return json({ access_token: "token" });
      if (fail) throw new Error("secret-error", { cause: { code: "secret-code" } });
      return json(snapshot(time));
    },
  });
  assert.equal((await api.getStates()).upstreamStatus, 200);
  time += 61000;
  fail = true;
  const failed = await api.getStates();
  assert.equal(failed.upstreamStatus, null);
  assert.equal(failed.states.length, 1);
  assert.equal(failed.diagnostic.networkCode, null);
  assert.ok(!JSON.stringify(failed).includes("secret-code"));
  time += 61000;
  fail = false;
  const recovered = await api.getStates();
  assert.equal(recovered.upstreamStatus, 200);
  assert.equal(recovered.diagnostic, null);
  assert.equal(recovered.issue, null);
});

test("rejected OAuth credentials are distinct from connection failures", async () => {
  const api = createOpenSky({
    credentials,
    now: () => start,
    fetcher: async () => json({ error_description: "do not reveal this" }, 401),
  });
  const result = await api.getStates();
  assert.equal(result.upstreamStatus, 401);
  assert.equal(result.diagnostic.stage, "authentication");
  assert.equal(result.diagnostic.code, "CREDENTIALS_REJECTED");
  assert.ok(!JSON.stringify(result).includes("do not reveal this"));
});

test("unreadable and null upstream bodies preserve a usable cache", async () => {
  let time = start, body = "valid";
  const api = createOpenSky({
    credentials,
    now: () => time,
    fetcher: async (url) => {
      if (String(url).includes("/token")) return json({ access_token: "token" });
      return body === "valid" ? json(snapshot(time)) : body === "null" ? json(null) : new Response("private raw body");
    },
  });
  await api.getStates();
  for (const mode of ["unreadable", "null"]) {
    time += 61000;
    body = mode;
    const result = await api.getStates();
    assert.equal(result.states.length, 1);
    assert.equal(result.upstreamStatus, 200);
    assert.equal(result.diagnostic.stage, "aircraft");
    assert.ok(!JSON.stringify(result).includes("private raw body"));
  }
});
