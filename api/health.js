import { openSkyEnvironment } from "../server/config.js";

export default function health(_req, res) {
  const { configured, missingEnvironment } = openSkyEnvironment();
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  // This checks deployment settings only; it spends no OpenSky credits.
  res.end(
    JSON.stringify({ ok: true, openskyConfigured: configured, missingEnvironment }),
  );
}
