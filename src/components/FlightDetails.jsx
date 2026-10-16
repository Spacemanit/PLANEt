import {
  ArrowLeft,
  ArrowUpRight,
  Clock3,
  Compass,
  Download,
  Navigation,
  Plane,
  Radio,
  Route,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  altitudeFt,
  categoryName,
  distanceKm,
  freshness,
  speedKts,
} from "../lib/aircraft.js";
import { useStore } from "../store.js";

const number = (n, suffix = "") =>
  n === null || n === undefined
    ? "—"
    : `${Math.round(n).toLocaleString()}${suffix}`;
export const timeLabel = (t) =>
  t
    ? new Date(t * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "Not reported";
export const ageLabel = (timestamp, now) =>
  !timestamp
    ? "Unknown"
    : now / 1000 - timestamp < 60
      ? `${Math.max(0, Math.floor(now / 1000 - timestamp))}s ago`
      : `${Math.floor((now / 1000 - timestamp) / 60)}m ago`;

function AltitudeChart({ history }) {
  const points = history.filter((p) => p.altitude !== null);
  if (points.length < 2)
    return (
      <div className="chart-empty">
        <Route size={23} />
        <span>
          A trail starts with two observations.
          <br />
          Keep watching this flight.
        </span>
      </div>
    );
  const min = Math.min(...points.map((p) => p.altitude)),
    max = Math.max(...points.map((p) => p.altitude)),
    range = Math.max(300, max - min);
  const begin = points[0].time,
    duration = Math.max(1, points.at(-1).time - begin);
  const path = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${12 + ((p.time - begin) / duration) * 270},${67 - ((p.altitude - min) / range) * 45}`,
    )
    .join(" ");
  return (
    <div className="altitude-chart">
      <svg
        viewBox="0 0 294 92"
        role="img"
        aria-label={`Observed altitude from ${number(min * 3.28084)} to ${number(max * 3.28084)} feet`}
      >
        <defs>
          <linearGradient id="altFill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#e37b5e" stopOpacity=".24" />
            <stop offset="1" stopColor="#e37b5e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M12 25H282M12 47H282M12 69H282"
          stroke="#e9e8df"
          strokeDasharray="3 4"
        />
        <path d={`${path} L282 80 L12 80Z`} fill="url(#altFill)" />
        <path
          d={path}
          fill="none"
          stroke="#de795d"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <div>
        <span>{timeLabel(begin).slice(0, 5)}</span>
        <span>Altitude · ft</span>
        <span>{timeLabel(points.at(-1).time).slice(0, 5)}</span>
      </div>
    </div>
  );
}

export default function FlightDetails({ aircraft: a, now }) {
  const [tab, setTab] = useState("overview");
  const demo = useStore((s) => s.demo);
  const state = freshness(a, now),
    history = a.history || [];
  function download() {
    const rows = [
      "timestamp_utc,latitude,longitude,barometric_altitude_m,velocity_m_s,true_track_deg",
      ...history.map((p) =>
        [
          new Date(p.time * 1000).toISOString(),
          p.lat,
          p.lon,
          p.altitude ?? "",
          p.velocity ?? "",
          p.heading ?? "",
        ].join(","),
      ),
    ];
    const url = URL.createObjectURL(
        new Blob([rows.join("\n")], { type: "text/csv" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `${demo ? "sample-" : ""}${a.id}-observations.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="flight-details">
      <div className="details-top">
        <button
          className="text-button"
          onClick={() => useStore.getState().selectAircraft(null)}
        >
          <ArrowLeft size={15} /> All aircraft
        </button>
        <span className={`signal-label ${state}`}>
          <i />
          {state === "fresh"
            ? "Fresh position"
            : state === "stale"
              ? "Stale position"
              : "Signal lost"}
        </span>
      </div>
      <div className="flight-identity">
        <span className="flight-icon large">
          <Plane size={25} />
        </span>
        <div>
          <h2>{a.callsign || a.id.toUpperCase()}</h2>
          <p>{a.country}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close flight details"
          onClick={() => useStore.getState().selectAircraft(null)}
        >
          <X size={17} />
        </button>
      </div>
      <p className="aircraft-category">{categoryName(a.category)}</p>
      <div className="detail-tabs">
        <button
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          Flight details
        </button>
        <button
          className={tab === "movement" ? "active" : ""}
          onClick={() => setTab("movement")}
        >
          Movement <span>{history.length}</span>
        </button>
      </div>
      {tab === "overview" ? (
        <>
          <div className="flight-metrics">
            <div>
              <span>
                <ArrowUpRight size={13} /> Altitude
              </span>
              <strong>
                {number(altitudeFt(a))}
                <small> ft</small>
              </strong>
            </div>
            <div>
              <span>
                <Navigation size={13} /> Ground speed
              </span>
              <strong>
                {number(speedKts(a))}
                <small> kts</small>
              </strong>
            </div>
            <div>
              <span>
                <Compass size={13} /> True track
              </span>
              <strong>
                {number(a.heading)}
                <small>°</small>
              </strong>
            </div>
            <div>
              <span>
                <Plane size={13} /> Vertical rate
              </span>
              <strong>
                {number(
                  a.verticalRate === null ? null : a.verticalRate * 196.8504,
                )}
                <small> ft/min</small>
              </strong>
            </div>
          </div>
          <div className="position-info">
            <div className="section-title">
              <Radio size={14} />
              <h3>Last reported position</h3>
              <span>{ageLabel(a.positionTime, now)}</span>
            </div>
            <strong>
              {Math.abs(a.latitude).toFixed(4)}°{a.latitude >= 0 ? " N" : " S"}{" "}
              <span>/</span> {Math.abs(a.longitude).toFixed(4)}°
              {a.longitude >= 0 ? " E" : " W"}
            </strong>
            <p>{timeLabel(a.positionTime)} local time</p>
            {state !== "fresh" && (
              <p className="position-warning">
                {state === "lost"
                  ? "This aircraft is no longer shown on the globe."
                  : "This fix is over 90 seconds old."}{" "}
                Its position is not being predicted.
              </p>
            )}
          </div>
          <dl className="aircraft-facts">
            <div>
              <dt>ICAO24 address</dt>
              <dd>{a.id.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Flight state</dt>
              <dd>
                {a.onGround === null
                  ? "Not reported"
                  : a.onGround
                    ? "On the ground"
                    : "Airborne"}
              </dd>
            </div>
            <div>
              <dt>Position source</dt>
              <dd>
                {["ADS-B", "ASTERIX", "MLAT", "FLARM"][a.positionSource] ||
                  "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Last contact</dt>
              <dd>{ageLabel(a.lastContact, now)}</dd>
            </div>
          </dl>
          <p className="data-note">
            Aircraft category is reported by OpenSky. Exact model, route, and
            destination are not provided by this feed.
          </p>
        </>
      ) : (
        <>
          <div className="movement-heading">
            <div>
              <h3>A little flight journal</h3>
              <p>
                {demo
                  ? "Synthetic sample observations"
                  : "Collected by this app"}{" "}
                · last 30 minutes
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Download observed movement as CSV"
              onClick={download}
              disabled={!history.length}
            >
              <Download size={17} />
            </button>
          </div>
          <div className="movement-summary">
            <span>
              <strong>{history.length}</strong> observations
            </span>
            <span>
              <strong>{distanceKm(history).toFixed(1)}</strong> km observed
            </span>
          </div>
          <AltitudeChart history={history} />
          <div className="observation-list">
            {history
              .slice()
              .reverse()
              .slice(0, 15)
              .map((p, i) => (
                <div className="observation" key={`${p.time}-${i}`}>
                  <i />
                  <div>
                    <strong>{timeLabel(p.time)}</strong>
                    <span>
                      {p.lat.toFixed(3)}°, {p.lon.toFixed(3)}°
                    </span>
                  </div>
                  <span>
                    {number(p.altitude === null ? null : p.altitude * 3.28084)}{" "}
                    ft
                  </span>
                </div>
              ))}
          </div>
          <p className="data-note">
            Trails connect collected positions only. Gaps longer than 3 minutes
            break the trail. No extra history requests are made.
          </p>
        </>
      )}
    </div>
  );
}
