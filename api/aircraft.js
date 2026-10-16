import { createOpenSky } from "../server/opensky.js";
import { createAircraftHandler } from "../server/handler.js";

// Warm instances reuse the OAuth token and snapshot. The Vercel CDN shares
// successful responses between visitors. No filesystem writes or private files.
const opensky = createOpenSky({
  credentials: {
    clientId: process.env.OPENSKY_CLIENT_ID,
    clientSecret: process.env.OPENSKY_CLIENT_SECRET,
  },
});

export default createAircraftHandler(opensky, { edgeCache: true });
