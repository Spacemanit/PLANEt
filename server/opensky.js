import { validBounds, boundsKey } from "../shared/regions.js";

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";
export const BASE_INTERVAL = 60_000;

class UpstreamError extends Error {
  constructor(message, status, retryMs, details = {}) {
    super(message);
    this.status = status;
    this.retryMs = retryMs;
    this.details = details;
  }
}

export function retryDelay(headers, now = Date.now()) {
  const seconds = headers.get("x-rate-limit-retry-after-seconds");
  if (seconds !== null && Number.isFinite(Number(seconds)))
    return Math.max(1000, Number(seconds) * 1000);
  const retry = headers.get("retry-after");
  if (retry !== null && Number.isFinite(Number(retry)))
    return Math.max(1000, Number(retry) * 1000);
  const date = Date.parse(retry);
  return Number.isFinite(date) ? Math.max(1000, date - now) : 300_000;
}

export function createOpenSky({
  credentials = {},
  fetcher = fetch,
  now = Date.now,
  initialCache = [],
  onCache = () => {},
  requireCredentials = false,
} = {}) {
  const clientId = credentials.clientId || credentials.client_id;
  const clientSecret = credentials.clientSecret || credentials.client_secret;
  const authenticated = Boolean(clientId && clientSecret);
  const cache = new Map(
    (Array.isArray(initialCache) ? initialCache : [])
      .filter((entry) => {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string"
        )
          return false;
        const v = entry[1];
        return (
          v &&
          Number.isFinite(v.fetchedAt) &&
          Number.isFinite(v.time) &&
          Array.isArray(v.states) &&
          now() - v.fetchedAt < 86_400_000 &&
          v.fetchedAt <= now() + 120_000
        );
      })
      .slice(-12),
  );
  const pending = new Map();
  let token = null,
    tokenExpires = 0,
    tokenPromise = null;
  let blockedUntil = 0,
    lastRequest = 0,
    failures = 0,
    remaining = null,
    issue = null,
    upstreamStatus = null,
    diagnostic = null;

  async function connect(url, options, stage) {
    try {
      return await fetcher(url, options);
    } catch (error) {
      // Report only a fixed set of safe codes, never URLs, tokens or raw errors.
      const codes = [
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "UND_ERR_BODY_TIMEOUT",
        "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH",
        "ETIMEDOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      ];
      const candidate = error.cause?.code || error.code;
      const networkCode = codes.includes(candidate) ? candidate : null;
      const timedOut =
        error.name === "TimeoutError" ||
        ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"].includes(networkCode);
      const target =
        stage === "authentication"
          ? "OpenSky’s sign-in service"
          : "OpenSky’s aircraft service";
      throw new UpstreamError(
        timedOut
          ? `The server connection to ${target} timed out before an HTTP response. Retrying automatically.`
          : `The server could not connect to ${target}. Retrying automatically.`,
        null,
        undefined,
        {
          stage,
          code: timedOut ? "CONNECTION_TIMEOUT" : "CONNECTION_FAILED",
          networkCode,
          retryable: true,
        },
      );
    }
  }

  async function readJson(res, stage) {
    try {
      return await res.json();
    } catch {
      throw new UpstreamError(
        `OpenSky returned an unreadable ${stage === "authentication" ? "authentication" : "aircraft"} response. Retrying automatically.`,
        res.status,
        undefined,
        { stage, code: "INVALID_RESPONSE", retryable: true },
      );
    }
  }

  async function getToken() {
    if (token && tokenExpires > now() + 30_000) return token;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      const res = await connect(
        TOKEN_URL,
        {
          method: "POST",
          signal: AbortSignal.timeout(12_000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
          }),
        },
        "authentication",
      );
      if (!res.ok)
        throw new UpstreamError(
          res.status === 400 || res.status === 401
            ? "OpenSky rejected the client credentials. Check the Production environment variables and redeploy."
            : "OpenSky’s sign-in service is unavailable. Retrying automatically.",
          res.status,
          res.status === 429 ? retryDelay(res.headers, now()) : 300_000,
          {
            stage: "authentication",
            code: [400, 401].includes(res.status)
              ? "CREDENTIALS_REJECTED"
              : "AUTH_SERVICE_ERROR",
            retryable: ![400, 401].includes(res.status),
          },
        );
      const data = await readJson(res, "authentication");
      if (typeof data?.access_token !== "string" || !data.access_token)
        throw new UpstreamError(
          "OpenSky returned an invalid authentication response.",
          res.status,
          undefined,
          { stage: "authentication", code: "INVALID_RESPONSE", retryable: true },
        );
      token = data.access_token;
      tokenExpires = now() + (Number(data.expires_in) || 1800) * 1000;
      return token;
    })().finally(() => {
      tokenPromise = null;
    });
    return tokenPromise;
  }

  const interval = () =>
    !authenticated
      ? 300_000
      : remaining !== null && remaining < 500
        ? 120_000
        : BASE_INTERVAL;
  function result(entry, source = "cache") {
    const age = entry
      ? Math.max(0, Math.floor(now() / 1000 - entry.time))
      : null;
    const currentIssue =
      issue ||
      (age > 90
        ? `OpenSky’s latest snapshot is ${Math.floor(age / 60)} minutes old. Waiting for current observations; positions over 5 minutes old stay off the map.`
        : null);
    return {
      serverTime: now(),
      upstreamStatus,
      time: entry?.time ?? null,
      states: entry?.states ?? [],
      fetchedAt: entry?.fetchedAt ?? null,
      source,
      issue: currentIssue,
      diagnostic,
      snapshotAgeSeconds: age,
      remaining,
      authMode: authenticated
        ? "authenticated"
        : requireCredentials ? "unconfigured" : "anonymous",
      nextPollMs: Math.max(interval(), blockedUntil - now()),
      retryAt: blockedUntil > now() ? blockedUntil : null,
      stale:
        !entry ||
        now() - entry.fetchedAt > interval() + 15_000 ||
        Boolean(currentIssue),
    };
  }

  async function refresh(bounds, key) {
    // A shared upstream gate prevents multiple regions/tabs spending credits at once.
    lastRequest = now();
    upstreamStatus = null;
    try {
      const url = new URL(STATES_URL);
      if (bounds)
        for (const [i, name] of ["lamin", "lomin", "lamax", "lomax"].entries())
          url.searchParams.set(name, bounds[i]);
      url.searchParams.set("extended", "1");
      const request = async () =>
        connect(
          url,
          {
            headers: authenticated
              ? { Authorization: `Bearer ${await getToken()}` }
              : {},
            signal: AbortSignal.timeout(12_000),
          },
          "aircraft",
        );
      let res = await request();
      if (res.status === 401 && authenticated) {
        token = null;
        tokenExpires = 0;
        res = await request();
      }
      const balance = res.headers.get("x-rate-limit-remaining");
      upstreamStatus = res.status;
      if (balance !== null && Number.isFinite(Number(balance)))
        remaining = Number(balance);
      if (!res.ok)
        throw new UpstreamError(
          res.status === 429
            ? "OpenSky’s request limit was reached. Updates will resume automatically."
            : res.status === 401 || res.status === 403
              ? "OpenSky declined access. Check the server API credentials."
              : "OpenSky is temporarily unavailable. Keeping the last observations.",
          res.status,
          res.status === 429 ? retryDelay(res.headers, now()) : undefined,
          {
            stage: "aircraft",
            code: res.status === 429
              ? "RATE_LIMITED"
              : [401, 403].includes(res.status)
                ? "ACCESS_DENIED" : "UPSTREAM_UNAVAILABLE",
            retryable: true,
          },
        );
      const data = await readJson(res, "aircraft");
      if (
        !data ||
        !Number.isFinite(data.time) ||
        data.time > now() / 1000 + 120 ||
        !(data.states === null || Array.isArray(data.states)) ||
        (Array.isArray(data.states) &&
          data.states.some((row) => !Array.isArray(row) || row.length < 17))
      ) {
        throw new UpstreamError(
          "OpenSky returned incomplete data. Keeping the last observations.",
          res.status,
          undefined,
          { stage: "aircraft", code: "INCOMPLETE_RESPONSE", retryable: true },
        );
      }
      const old = cache.get(key);
      if (old && data.time < old.time)
        throw new UpstreamError(
          "OpenSky returned an older snapshot. Keeping the newer observations.",
          res.status,
          undefined,
          { stage: "aircraft", code: "OLDER_SNAPSHOT", retryable: true },
        );
      const entry = {
        time: data.time,
        states: data.states || [],
        fetchedAt: now(),
      };
      cache.delete(key);
      cache.set(key, entry);
      while (cache.size > 12) cache.delete(cache.keys().next().value);
      failures = 0;
      blockedUntil = 0;
      issue = null;
      diagnostic = null;
      Promise.resolve(onCache([...cache])).catch(() => {});
      return result(entry, "live");
    } catch (error) {
      failures++;
      upstreamStatus = error instanceof UpstreamError ? error.status ?? null : null;
      diagnostic =
        error instanceof UpstreamError
          ? error.details
          : { stage: "aircraft", code: "UNEXPECTED_FAILURE", retryable: true };
      issue =
        error instanceof UpstreamError
          ? error.message
          : "The connection to OpenSky timed out or failed. Retrying automatically.";
      blockedUntil =
        now() +
        (error.retryMs ||
          Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4)));
      return result(cache.get(key), "cache");
    } finally {
      pending.delete(key);
    }
  }

  return {
    async getStates(bounds = null) {
      if (bounds !== null && !validBounds(bounds))
        throw new Error("Invalid geographical bounds");
      const key = bounds ? boundsKey(bounds) : "worldwide",
        entry = cache.get(key);
      if (requireCredentials && !authenticated) {
        const missing = [
          !clientId && "OPENSKY_CLIENT_ID",
          !clientSecret && "OPENSKY_CLIENT_SECRET",
        ].filter(Boolean);
        issue = `Live tracking needs deployment settings. Add ${missing.join(" and ")} in Vercel’s Production environment variables, then redeploy.`;
        diagnostic = {
          stage: "configuration",
          code: "MISSING_CREDENTIALS",
          retryable: false,
        };
        return result(entry);
      }
      if (pending.has(key)) return pending.get(key);
      if (
        blockedUntil > now() ||
        (entry && now() - entry.fetchedAt < interval())
      )
        return result(entry);
      if (lastRequest && now() - lastRequest < 8000)
        return { ...result(entry), nextPollMs: Math.max(8000, interval()) };
      const promise = refresh(bounds, key);
      pending.set(key, promise);
      return promise;
    },
  };
}
