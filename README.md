# PLANEt

A playful worldwide air traffic dashboard: a Three.js Earth, live OpenSky aircraft, and a cartoon 3D plane when you select a flight.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. The local server reads the existing `credentials.json` (`clientId` / `clientSecret`, or `client_id` / `client_secret`). Environment variables or a local `.env` file can also supply credentials.

For a production preview, run `npm run build`, then `npm start`.

## Deploy the entire app on Vercel

The project uses **Vite static output + Node Vercel Functions**. No separate backend host, database, or persistent disk is required.

1. Push this project to your own Git repository. Keep all three source models in the root: `realistic_earth_8k.glb`, `cartoon_plane.glb`, and `ss500_cartoon_plane.glb`.
2. Import the repository into Vercel. Use the **Vite** framework preset and Node.js 22 or newer. `vercel.json` supplies build command `npm run build`, output directory `dist`, and Function settings.
3. Add **server environment variables** `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` for the deployment environments you use.
4. Deploy. The webpage is at `/`, the worldwide feed at `/api/aircraft`, and the health check at `/api/health`.

No deployment has been published to a Vercel account yet. Future Git pushes can use Vercel's normal deployment workflow after import.

Never prefix the credentials with `VITE_` or put them in `public/`. Git ignores `credentials.json`, and `.vercelignore` excludes it and local environment files from CLI uploads. The deployed function reads environment variables only and never opens the local credential file.

### Models are static assets

The build creates `public/assets/` and Vite copies it into `dist/assets/`:

| Asset             | Purpose                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `earth.glb`       | The supplied Earth reduced from 45.3 MB to 6.7 MB by removing unused layers    |
| `plane-ss500.glb` | The supplied SS500 with its older material extension converted to standard PBR |
| `plane-prop.glb`  | The supplied cartoon prop plane                                                |

Vercel serves these files as static assets, bypassing Function response limits. All originals are preserved. Generated GLBs are ignored by Git and rebuilt from the committed source models.

The API uses gzip when supported. A live check with approximately 12,400 aircraft produced a roughly 485 KB compressed response, below Vercel's Function payload limit.

## Use the dashboard

- **Worldwide:** the client requests the global OpenSky feed without a bounding box. Every valid matching position has a marker. Rotate the globe to see the other hemisphere. The list adds rows on demand to keep thousands of buttons out of the DOM.
- **Cartoon view:** sunny paper colors, rounded lettering, stronger outlines, sticker controls, soft globe shading, and clouds.
- **Select a flight:** click a dot or use the aircraft list. Selection uses half the previous camera distance. The zoom-in button also takes a larger step. The old flat airplane illustration is removed.
- **3D models:** larger/unspecified emitter categories default to the SS500, smaller categories to the prop plane. The on-globe selector can choose either model. They are illustrative, rather than verified airframes; the UI labels this. The selected model follows reported coordinates and true track.
- **Details and movement:** altitude, speed, true track, vertical rate, freshness, and transponder information; observed positions, an altitude chart, distance, and CSV export. Unknown values display a dash. Trails break across gaps longer than 3 minutes.
- **Feed status:** click the connection badge or Feed status link to inspect upstream HTTP status, access mode, snapshot time/age, aircraft count, and remaining credits.
- **Sample mode:** 192 clearly labeled synthetic aircraft spread worldwide. Sample data stays separate from live observations and is never automatically substituted for live data or persisted into its cache.

## Why the earlier OpenSky map looked empty

The earlier regional request succeeded but returned a snapshot much older than the local clock. The application hid positions older than 5 minutes, leaving no current aircraft on the map. Successful authentication did not imply recent position data.

A new direct worldwide check returned **HTTP 200**, accepted OAuth credentials, and over **12,000 aircraft** in a snapshot about **6 seconds old**. The credentials were working and the global endpoint was current during verification. The response alone did not establish the exact upstream cause of the earlier stale regional snapshot. The new status panel makes the timestamps and connection state inspectable.

A **429** means the credit limit was reached; a **401/403** indicates an access problem; a timeout or 5xx indicates a connection/upstream failure. Retained observations remain available while the app backs off and retries.

## Reliability

- OAuth tokens are server-only, reused until near expiry, and refreshed/retried once after a 401.
- Global snapshots refresh at most once per minute per warm server instance. Below 500 credits, refresh slows to 120 seconds; anonymous access uses 300 seconds. Filters make no API requests.
- Matching in-flight requests are coalesced within each warm instance. Vercel's CDN shares successful responses for 50 seconds, with up to 10 seconds of stale-while-revalidate. Tokens and retry state are per instance, rather than distributed persistent state; cold instances can issue additional requests. No paid cache service is required for this interview project.
- Vercel Functions make no filesystem writes. The optional local server persists snapshots in ignored `.cache/opensky.json`. Browser observations survive a Function cold start.
- Retry headers are honored for 429s; other failures use exponential backoff from 30 seconds to 5 minutes. Upstream calls have 12-second timeouts; the Vercel Function has a 60-second duration setting.
- Malformed and older snapshots cannot replace newer valid observations. Delayed snapshot timestamps are reported explicitly.
- Older/duplicate fixes cannot move aircraft backwards or add duplicate history. Missing coordinates preserve a known fix. Positions are never predicted.
- A position becomes stale after 90 seconds and leaves the globe after 5 minutes. An aircraft expires from memory 15 minutes after last contact. Histories retain up to 90 fixes within 30 minutes.
- Browser persistence saves up to 1,500 recent aircraft and their last 10 fixes. A full or disabled storage area does not interrupt monitoring. The active session still includes all received aircraft.
- Every matching aircraft has a marker. Up to 250 observed trails are drawn for performance, always including the selected aircraft. Polling pauses while hidden, offline, or explicitly paused.

OpenSky coverage depends on receiver availability. State vectors do not reliably supply an exact model, airline, route, departure, or destination.

## Structure

```text
api/aircraft.js               Native Vercel entry point and environment credentials
api/health.js                 Vercel health endpoint
server/handler.js             Shared Node handler, gzip and CDN headers
server/opensky.js             OAuth, cache, validation, worldwide feed, retry logic
server/index.js               Local development/production server
scripts/prepare-assets.js     Static model preparation for local and Vercel
scripts/prepare-earth.js      Surface-only Earth GLB generation
src/store.js                  Zustand, observation cache, live/sample isolation
src/hooks/useAirTraffic.js    Visibility-aware polling
src/lib/aircraft.js           Normalization, lifecycle, filters, history
src/lib/models.js             Illustrative model selection and camera distance
src/components/Globe.jsx      Models, markers, trails, camera controls
src/components/FlightDetails.jsx  Aircraft details, movement chart, CSV export
src/cartoon.css               Cartoon visual treatment
vercel.json                   Build, static output, Function configuration
```

React + Vite, JavaScript, Three.js, Zustand, Tailwind CSS 4, and Express for local development. Fonts are bundled locally.

## Verification

```sh
npm test
npm run build
```

Tests cover aircraft lifecycle, history, cache/OAuth/backoff, worldwide requests, native Vercel handler behavior, gzip/CDN headers, credential isolation, model choice, and worldwide samples.

Optional browser check using installed Google Chrome and intercepted fixtures, without spending OpenSky credits:

```sh
python -m pip install playwright
python tests/browser_check.py
```

This checks worldwide markers, both GLBs, removal of the illustration, search, filters, details, movement/export, feed diagnostics, pause, sample isolation, layers, dialogs, and the 390 px mobile layout. Screenshots go to ignored `test-results/`.

## Credits

Aircraft observations: [OpenSky Network](https://opensky-network.org/), with its [REST API documentation](https://openskynetwork.github.io/opensky-api/rest.html).

- **Cartoon Plane**, [Jorge Mayoral Asensio](https://sketchfab.com/jorgemayoralasensio.jma), [source](https://sketchfab.com/3d-models/cartoon-plane-edbb12ffdd3c408d8908e02cbc1ba137), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **SS500 Cartoon Plane**, [ZEBandit3D](https://sketchfab.com/ZEBandit3D), [source](https://sketchfab.com/3d-models/ss500-cartoon-plane-61c0015202b347a99076174068e9d4a0), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Plane materials were adapted to toon shading, and the SS500 material extension was converted for current Three.js. Source metadata is retained in the generated files.

Earth: the supplied `realistic_earth_8k.glb`. Retain any original attribution associated with that asset when publishing. This is an exploration/interview project.
