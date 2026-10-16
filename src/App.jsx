import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Earth,
  Globe2,
  Layers2,
  LoaderCircle,
  Pause,
  Plane,
  Play,
  Radio,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  WifiOff,
  X,
} from "lucide-react";
import { useStore } from "./store.js";
import {
  filterAircraft,
  altitudeFt,
  speedKts,
  freshness,
  categoryName,
} from "./lib/aircraft.js";
import { useAirTraffic } from "./hooks/useAirTraffic.js";
import Globe from "./components/Globe.jsx";
import FlightDetails, { ageLabel } from "./components/FlightDetails.jsx";

function Brand() {
  return (
    <a className="brand" href="/" aria-label="PLANEt home">
      <span className="brand-mark">
        <Earth size={27} />
        <i />
      </span>
      <span>
        PLANEt<span className="brand-dot">.</span>
      </span>
    </a>
  );
}
function Dialog({ title, onClose, children, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function About({ onClose }) {
  return (
    <Dialog title="Hello, little planet!" onClose={onClose}>
      <div className="about-planet">
        <Earth size={52} />
        <span>Everyone's going somewhere.</span>
      </div>
      <p className="dialog-description">
        A whole world of aircraft, in one explorable sky. Spin the globe, pick a
        dot, and get up close with a little 3D plane.
      </p>
      <div className="about-sections">
        <div>
          <Radio size={20} />
          <p>
            <strong>One worldwide feed</strong>All aircraft with usable
            positions from OpenSky are included. Observations refresh about once
            a minute; searching and filtering happen locally.
          </p>
        </div>
        <div>
          <Route size={20} />
          <p>
            <strong>A trail of actual observations</strong>Trails connect
            positions collected by this app. Missing positions stay missing. The
            3D plane is an illustration, rather than the aircraft's verified
            model.
          </p>
        </div>
        <div>
          <Clock3 size={20} />
          <p>
            <strong>Quiet signals stay honest</strong>Positions turn stale after
            90 seconds and leave the globe after 5 minutes. Inspect the feed
            status to see timestamps and connection details.
          </p>
        </div>
      </div>
      <p className="model-attribution">
        Plane models:{" "}
        <a
          href="https://sketchfab.com/3d-models/cartoon-plane-edbb12ffdd3c408d8908e02cbc1ba137"
          target="_blank"
          rel="noreferrer"
        >
          Jorge Mayoral Asensio
        </a>{" "}
        and{" "}
        <a
          href="https://sketchfab.com/3d-models/ss500-cartoon-plane-61c0015202b347a99076174068e9d4a0"
          target="_blank"
          rel="noreferrer"
        >
          ZEBandit3D
        </a>
        , CC BY 4.0. Materials adapted for the cartoon view.
      </p>
      <a
        className="external-link"
        href="https://openskynetwork.github.io/opensky-api/rest.html"
        target="_blank"
        rel="noreferrer"
      >
        OpenSky API documentation <ArrowUpRight size={14} />
      </a>
    </Dialog>
  );
}
function FeedStatus({ now, onClose }) {
  const s = useStore();
  const age = s.snapshotTime
    ? Math.max(0, Math.floor(now / 1000 - s.snapshotTime))
    : null;
  const label = s.diagnostic?.code === "MISSING_CREDENTIALS"
    ? "Live tracking needs setup"
    : s.issue
      ? "The feed needs a moment"
      : age === null
        ? "Waiting for a snapshot"
        : age < 90
          ? "The feed is current"
          : "The feed is delayed";
  return (
    <Dialog
      title={s.demo ? "You’re in sample mode" : label}
      onClose={onClose}
      className="feed-dialog"
    >
      <p className="dialog-description">
        {s.demo
          ? "Sample flights are simulated. Return to live to see the worldwide OpenSky feed."
          : s.issue ||
            (s.fetchedAt
              ? "OpenSky is responding. The globe shows every matching aircraft with a usable position from the last 5 minutes."
              : "Waiting for the first OpenSky response. Connection details will appear here.")}
      </p>
      <dl className="feed-facts">
        <div>
          <dt>Access</dt>
          <dd>
            {s.demo
              ? "Sample data · no API calls"
              : s.authMode === "authenticated"
                ? s.upstreamStatus === 200
                  ? "OAuth credentials accepted"
                  : "OAuth credentials configured"
                : s.authMode === "anonymous"
                  ? "Anonymous access"
                  : s.authMode === "unconfigured"
                    ? "Deployment credentials missing"
                    : "Not connected yet"}
          </dd>
        </div>
        <div>
          <dt>Last upstream response</dt>
          <dd>
            {s.demo
              ? "Not requested in sample mode"
              : s.upstreamStatus
                ? `HTTP ${s.upstreamStatus}`
                : s.diagnostic?.stage === "configuration"
                  ? "Not requested · settings missing"
                  : s.diagnostic
                    ? "No HTTP response received"
                    : "Not available yet"}
          </dd>
        </div>
        <div>
          <dt>Snapshot time (UTC)</dt>
          <dd>
            {s.snapshotTime
              ? new Date(s.snapshotTime * 1000)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19)
              : "Not received yet"}
          </dd>
        </div>
        <div>
          <dt>Snapshot age</dt>
          <dd>
            {age === null ? "Unknown" : `${age.toLocaleString()} seconds`}
          </dd>
        </div>
        <div>
          <dt>Aircraft in response</dt>
          <dd>{s.receivedCount?.toLocaleString() ?? "—"}</dd>
        </div>
        <div>
          <dt>Request credits</dt>
          <dd>
            {s.demo
              ? "Not used"
              : (s.remaining?.toLocaleString() ?? "Not reported")}
          </dd>
        </div>
        {!s.demo && s.diagnostic && (
          <div>
            <dt>Connection check</dt>
            <dd>
              {({ configuration: "Deployment settings", authentication: "OpenSky sign-in", aircraft: "OpenSky aircraft feed", dashboard: "Dashboard connection" })[s.diagnostic.stage] || "OpenSky feed"}
              {s.diagnostic.networkCode && <small> · {s.diagnostic.networkCode}</small>}
            </dd>
          </div>
        )}
      </dl>
      {!s.demo && ["CONNECTION_TIMEOUT", "CONNECTION_FAILED"].includes(s.diagnostic?.code) && (
        <div className="feed-explanation">
          <strong>About hosted connections</strong>
          <p>
            The server could not reach OpenSky. This can happen during an outage
            or when OpenSky restricts a hosting provider’s network. A timeout
            alone does not confirm a block. <a href="https://github.com/openskynetwork/opensky-api/blob/master/docs/free/index.rst" target="_blank" rel="noreferrer">OpenSky’s hosting notice ↗</a>
          </p>
        </div>
      )}
      <div className="feed-explanation">
        <strong>Why can a map look empty?</strong>
        <p>
          A successful response can still contain old positions. Fixes over 5
          minutes old are hidden so they don’t look live. A 429 response means
          the credit limit was reached; a 401/403 indicates an access problem.
          The app waits and retries automatically.
        </p>
      </div>
      {s.demo && (
        <button
          className="button coral"
          onClick={() => {
            s.setDemo(false);
            onClose();
          }}
        >
          Return to live
        </button>
      )}
    </Dialog>
  );
}
function FilterControls({ aircraft }) {
  const s = useStore();
  const countries = [
    ...new Set(Object.values(aircraft).map((a) => a.country)),
  ].sort();
  const categories = [
    ...new Set(Object.values(aircraft).map((a) => a.category ?? 0)),
  ].sort((a, b) => a - b);
  return (
    <div className="filters-panel">
      <div className="filter-grid">
        <label>
          Altitude
          <select
            aria-label="Altitude"
            value={s.altitude}
            onChange={(e) => s.setFilter("altitude", e.target.value)}
          >
            <option value="all">All altitudes</option>
            <option value="high">30,000+ ft</option>
            <option value="mid">10,000–30,000 ft</option>
            <option value="low">Below 10,000 ft</option>
          </select>
        </label>
        <label>
          Flight state
          <select
            aria-label="Flight state"
            value={s.status}
            onChange={(e) => s.setFilter("status", e.target.value)}
          >
            <option value="all">All aircraft</option>
            <option value="airborne">Airborne</option>
            <option value="ground">On the ground</option>
            <option value="stale">Stale positions</option>
          </select>
        </label>
        <label>
          Country of registration
          <select
            aria-label="Country of registration"
            value={s.country}
            onChange={(e) => s.setFilter("country", e.target.value)}
          >
            <option value="all">All countries</option>
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Reported category
          <select
            aria-label="Reported category"
            value={s.category}
            onChange={(e) => s.setFilter("category", e.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryName(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="text-button" onClick={s.clearFilters}>
        Reset filters
      </button>
    </div>
  );
}
function AircraftPanel({ visible, selected, now }) {
  const s = useStore(),
    [limit, setLimit] = useState(100);
  const hasFilters =
    s.query ||
    [s.altitude, s.status, s.country, s.category].some((v) => v !== "all");
  useEffect(
    () => setLimit(100),
    [s.query, s.altitude, s.status, s.country, s.category],
  );
  return (
    <aside
      className={`aircraft-panel ${selected ? "has-details" : ""}`}
      aria-label="Aircraft explorer"
    >
      {selected ? (
        <FlightDetails key={selected.id} aircraft={selected} now={now} />
      ) : (
        <>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">The worldwide roll call</span>
              <h2>
                Planes everywhere <span>{visible.length.toLocaleString()}</span>
              </h2>
            </div>
            <span className="panel-plane">
              <Plane size={24} />
            </span>
          </div>
          <div className="aircraft-search">
            <Search size={17} />
            <input
              aria-label="Search aircraft by callsign, country or ICAO24"
              placeholder="Find a flight, callsign, country…"
              value={s.query}
              onChange={(e) => s.setFilter("query", e.target.value)}
            />
            {s.query && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => s.setFilter("query", "")}
              >
                <X size={14} />
              </button>
            )}
            <button
              className={`filter-button ${s.filtersOpen || hasFilters ? "active" : ""}`}
              aria-label="Filter aircraft"
              aria-expanded={s.filtersOpen}
              onClick={() => s.setFilter("filtersOpen", !s.filtersOpen)}
            >
              <SlidersHorizontal size={18} />
              {hasFilters && <i />}
            </button>
          </div>
          {s.filtersOpen && <FilterControls aircraft={s.aircraft} />}
          <div className="list-labels">
            <span>Aircraft / registration country</span>
            <span>Altitude</span>
          </div>
          <div className="aircraft-list">
            {visible.slice(0, limit).map((a) => (
              <button
                className={`aircraft-row ${freshness(a, now) === "stale" ? "is-stale" : ""}`}
                key={a.id}
                onClick={() => s.selectAircraft(a.id)}
              >
                <span className="flight-icon">
                  <Plane
                    size={20}
                    style={{
                      transform: `rotate(${(a.heading ?? 45) - 45}deg)`,
                    }}
                  />
                </span>
                <span className="aircraft-name">
                  <strong>
                    {a.callsign || a.id.toUpperCase()}
                    <i className={freshness(a, now)} />
                  </strong>
                  <small>{a.country}</small>
                </span>
                <span className="aircraft-altitude">
                  <strong>
                    {altitudeFt(a) === null
                      ? "—"
                      : Math.round(altitudeFt(a)).toLocaleString()}
                    <small> ft</small>
                  </strong>
                  <small>
                    {a.onGround
                      ? "On ground"
                      : speedKts(a) === null
                        ? "Speed unknown"
                        : `${Math.round(speedKts(a))} kts`}
                  </small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
            {visible.length > limit && (
              <button
                className="load-more"
                onClick={() => setLimit((n) => n + 100)}
              >
                Show more aircraft ({(visible.length - limit).toLocaleString()})
              </button>
            )}
            {!visible.length && (
              <div className="empty-aircraft">
                <span>
                  <Plane size={31} />
                </span>
                <h3>
                  {hasFilters
                    ? "A quieter corner of the sky."
                    : s.fetching
                      ? "Checking the skies…"
                      : "Waiting for a little lift-off."}
                </h3>
                <p>
                  {hasFilters
                    ? "Try a different search or clear your filters."
                    : s.issue
                      ? "No current positions are available. Check the feed status or explore a sample sky."
                      : "Aircraft appear as OpenSky reports usable positions worldwide."}
                </p>
                {hasFilters ? (
                  <button className="button small" onClick={s.clearFilters}>
                    Clear filters
                  </button>
                ) : (
                  !s.demo && (
                    <button
                      className="button small"
                      onClick={() => s.setDemo(true)}
                    >
                      <Sparkles size={15} /> Explore sample flights
                    </button>
                  )
                )}
              </div>
            )}
          </div>
          <div className="panel-footer">
            <i className="fresh" />
            <span>Pick a dot. Meet a little 3D plane.</span>
            <ArrowUpRight size={15} />
          </div>
        </>
      )}
    </aside>
  );
}

export default function App() {
  useAirTraffic();
  const s = useStore(),
    [now, setNow] = useState(Date.now()),
    [aboutOpen, setAboutOpen] = useState(false),
    [feedOpen, setFeedOpen] = useState(false),
    [layersOpen, setLayersOpen] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const visible = useMemo(
    () => filterAircraft(s.aircraft, { ...s, bounds: s.region.bounds, now }),
    [
      s.aircraft,
      s.query,
      s.altitude,
      s.status,
      s.country,
      s.category,
      Math.floor(now / 5000),
    ],
  );
  const all = useMemo(
    () => Object.values(s.aircraft).filter((a) => freshness(a, now) !== "lost"),
    [s.aircraft, Math.floor(now / 5000)],
  );
  const selected = s.selectedId ? s.aircraft[s.selectedId] : null;
  const airborne = all.filter((a) => a.onGround === false),
    stale = all.filter((a) => freshness(a, now) === "stale");
  const altitudes = airborne.map(altitudeFt).filter((v) => v !== null);
  const avg = altitudes.length
    ? Math.round(altitudes.reduce((a, b) => a + b, 0) / altitudes.length)
    : null;
  const seconds = Math.max(0, Math.ceil((s.nextAt - now) / 1000));
  const label = s.demo
    ? "Sample airspace"
    : s.authMode === "unconfigured"
      ? "Live feed needs setup"
      : s.paused
        ? "Updates paused"
        : s.fetching && !s.fetchedAt
          ? "Connecting to OpenSky"
          : s.connection === "live"
            ? "Connected to OpenSky"
            : s.connection === "offline"
              ? "You’re offline"
              : s.connection === "connecting"
                ? "Connecting to OpenSky"
                : "Waiting for OpenSky";
  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main navigation">
            <button className="nav-active" onClick={s.recenter}>
              <Globe2 size={17} /> Live airspace
              <span />
            </button>
            <button onClick={() => setAboutOpen(true)}>
              The flight manual <ArrowUpRight size={14} />
            </button>
          </nav>
          <div className="header-right">
            <span className="header-caption">
              Small planet. Big adventures.
            </span>
            <button
              className="icon-button help-button"
              aria-label="About PLANEt and data freshness"
              onClick={() => setAboutOpen(true)}
            >
              <CircleHelp size={20} />
            </button>
          </div>
        </div>
      </header>
      <main className="app-main">
        <section className="intro">
          <div>
            <div className="intro-kicker">
              <span /> One little planet. A whole lot of planes.
            </div>
            <h1>
              Big world. Busy skies<span>!</span>
            </h1>
            <p>Grab a window seat. The whole world is going somewhere.</p>
          </div>
          <div className="connection-block">
            <button
              className={`connection-pill ${s.demo ? "demo" : s.paused ? "paused" : s.connection === "live" ? "live" : "waiting"}`}
              aria-label="Open feed status"
              onClick={() => setFeedOpen(true)}
            >
              <i />
              {label}
              <ChevronDown size={12} />
            </button>
            <span className="update-caption">
              {s.fetchedAt
                ? `Last sync ${ageLabel(s.fetchedAt / 1000, now)}`
                : "Waiting for the first observations"}
              {s.demo ? " · synthetic data" : ""}
            </span>
          </div>
        </section>
        {s.demo && (
          <div className="notice sample-notice">
            <Sparkles size={18} />
            <span>
              <strong>You’re exploring sample airspace.</strong> These flights
              are simulated for your demo.
            </span>
            <button onClick={() => s.setDemo(false)}>
              Return to live <ArrowUpRight size={15} />
            </button>
          </div>
        )}
        {!s.demo && s.issue && (
          <div className="notice connection-notice" role="status">
            <WifiOff size={17} />
            <span>
              {s.issue}
              {s.retryAt && s.retryAt > now
                ? ` Next attempt in ${Math.ceil((s.retryAt - now) / 1000)}s.`
                : ""}
            </span>
            <button onClick={() => setFeedOpen(true)}>Feed details</button>
            <button onClick={() => s.setDemo(true)}>Try sample mode</button>
          </div>
        )}
        <section
          className="airspace-workspace"
          aria-label="Air traffic dashboard"
        >
          <div className="map-panel">
            <div className="map-toolbar">
              <div className="world-badge">
                <span className="region-pin">
                  <Globe2 size={23} />
                </span>
                <span>
                  <small>Now boarding</small>
                  <strong>The whole planet!</strong>
                </span>
                <span className="world-badge-star">✦</span>
              </div>
              <div className="map-toolbar-right">
                <span className="map-live-label">
                  <Radio size={14} />
                  {s.demo ? "Sample feed" : "Worldwide feed"}
                </span>
                <div className="layers-container">
                  <button
                    className={`icon-button layers-button ${layersOpen ? "active" : ""}`}
                    aria-label="Map layers"
                    aria-expanded={layersOpen}
                    onClick={() => setLayersOpen(!layersOpen)}
                  >
                    <Layers2 size={20} />
                  </button>
                  {layersOpen && (
                    <div className="layers-popover">
                      <strong>Make it your view</strong>
                      <label>
                        <Route size={16} /> Observed trails
                        <input
                          type="checkbox"
                          checked={s.showTrails}
                          onChange={(e) =>
                            s.setFilter("showTrails", e.target.checked)
                          }
                        />
                      </label>
                      <label>
                        <Cloud size={16} /> Little clouds
                        <input
                          type="checkbox"
                          checked={s.showClouds}
                          onChange={(e) =>
                            s.setFilter("showClouds", e.target.checked)
                          }
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <Globe aircraft={visible} selected={selected} now={now} />
            <div className="map-decoration decoration-one" aria-hidden="true">
              ✦
            </div>
            <div className="map-decoration decoration-two" aria-hidden="true">
              +
            </div>
            <div className="map-bottom">
              <div className="map-legend">
                <span>
                  <i className="legend-dot" />
                  Fresh position
                </span>
                <span>
                  <i className="legend-dot stale" />
                  Stale position
                </span>
                <span>
                  <i className="legend-line" />
                  Observed trail
                </span>
              </div>
              <span className="map-scale">
                <Globe2 size={13} /> Every longitude
              </span>
            </div>
          </div>
          <AircraftPanel visible={visible} selected={selected} now={now} />
        </section>
        <section className="airspace-summary" aria-label="Airspace summary">
          <div className="summary-region">
            <span className="summary-icon">
              <Globe2 size={27} />
            </span>
            <div>
              <strong>Worldwide</strong>
              <span>No borders. Just busy skies.</span>
            </div>
          </div>
          <div className="summary-stat">
            <span>
              <Plane size={15} /> In the air
            </span>
            <strong>
              {airborne.length.toLocaleString()}
              <small>aircraft</small>
            </strong>
          </div>
          <div className="summary-stat">
            <span>
              <ArrowUpRight size={15} /> Average altitude
            </span>
            <strong>
              {avg === null ? "—" : avg.toLocaleString()}
              <small>ft</small>
            </strong>
          </div>
          <div className="summary-stat">
            <span>
              <Clock3 size={15} /> Stale positions
            </span>
            <strong>
              {stale.length.toLocaleString()}
              <small>over 90s old</small>
            </strong>
          </div>
          <div className="summary-doodle" aria-hidden="true">
            <span className="paper-plane">✈</span>
            <span>Oh, the places we go.</span>
          </div>
        </section>
        <section className="feed-bar" aria-label="Feed controls">
          <div className="feed-source">
            <Activity size={17} />
            <span>
              Powered by{" "}
              <a
                href="https://opensky-network.org"
                target="_blank"
                rel="noreferrer"
              >
                OpenSky Network <ArrowUpRight size={12} />
              </a>
            </span>
            <span className="feed-divider" />
            <span className="credits">
              {s.demo
                ? "No API credits used"
                : s.remaining !== null
                  ? `${s.remaining.toLocaleString()} credits remaining`
                  : "Worldwide requests, thoughtfully paced"}
            </span>
            <button
              className="feed-details-link"
              onClick={() => setFeedOpen(true)}
            >
              Feed status
            </button>
          </div>
          <div className="feed-controls">
            <span className="refresh-countdown">
              {s.paused ? (
                "Taking a breather"
              ) : s.diagnostic?.code === "MISSING_CREDENTIALS" && !s.demo ? (
                "Deployment setup needed"
              ) : s.fetching ? (
                <>
                  <LoaderCircle size={13} className="spin" /> Updating…
                </>
              ) : s.demo ? (
                `Sample update in ${seconds}s`
              ) : seconds > 0 ? (
                `Next sync in ${seconds}s`
              ) : (
                "Ready to sync"
              )}
            </span>
            <button
              className="pause-button"
              onClick={() => s.setPaused(!s.paused)}
              aria-label={
                s.paused ? "Resume live updates" : "Pause live updates"
              }
            >
              {s.paused ? <Play size={13} /> : <Pause size={13} />}{" "}
              {s.paused ? "Resume" : "Pause"}
            </button>
            <button
              className={`sample-button ${s.demo ? "active" : ""}`}
              aria-pressed={s.demo}
              onClick={() => s.setDemo(!s.demo)}
            >
              <Sparkles size={14} />
              {s.demo ? "Sample mode on" : "Sample mode"}
            </button>
          </div>
        </section>
        <footer className="page-footer">
          <span>
            Made for the curious. Built for a world that never stands still.
          </span>
          <span>
            PLANEt <i>✦</i> Keep looking up.
          </span>
        </footer>
      </main>
      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}{" "}
      {feedOpen && <FeedStatus now={now} onClose={() => setFeedOpen(false)} />}
    </>
  );
}
