import { createOpenSky } from "../server/opensky.js";
import { createAircraftHandler } from "../server/handler.js";
import { openSkyEnvironment } from "../server/config.js";

// Warm instances reuse the OAuth token and snapshot. The Vercel CDN shares
// successful responses between visitors. No filesystem writes or private files.
const opensky = createOpenSky({
  credentials: openSkyEnvironment().credentials,
  requireCredentials: true,
});

export default createAircraftHandler(opensky, { edgeCache: true });
