import { inBounds } from "../../shared/regions.js";

export const STALE_SECONDS = 90;
export const LOST_SECONDS = 300;
export const RETAIN_SECONDS = 900;
export const HISTORY_SECONDS = 1800;
export const numberOrNull = (x) =>
  typeof x === "number" && Number.isFinite(x) ? x : null;

export function normalizeState(row) {
  if (
    !Array.isArray(row) ||
    typeof row[0] !== "string" ||
    !/^[a-f0-9]{6}$/i.test(row[0])
  )
    return null;
  const latitude = numberOrNull(row[6]),
    longitude = numberOrNull(row[5]);
  const validPosition =
    latitude !== null &&
    longitude !== null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
  return {
    id: row[0].toLowerCase(),
    callsign: typeof row[1] === "string" ? row[1].trim() : "",
    country: typeof row[2] === "string" ? row[2] : "Unknown country",
    positionTime: validPosition ? numberOrNull(row[3]) : null,
    lastContact: numberOrNull(row[4]),
    longitude: validPosition ? longitude : null,
    latitude: validPosition ? latitude : null,
    altitude: numberOrNull(row[7]),
    onGround: typeof row[8] === "boolean" ? row[8] : null,
    velocity: numberOrNull(row[9]),
    heading: numberOrNull(row[10]),
    verticalRate: numberOrNull(row[11]),
    geoAltitude: numberOrNull(row[13]),
    squawk: typeof row[14] === "string" ? row[14] : null,
    positionSource: numberOrNull(row[16]),
    category: numberOrNull(row[17]),
  };
}

export function mergeAircraft(
  previous,
  rows,
  bounds,
  snapshotTime,
  receivedAt = Date.now(),
) {
  const next = { ...previous };
  const nowSeconds = receivedAt / 1000;
  for (const row of rows) {
    const incoming = normalizeState(row);
    if (
      !incoming ||
      (incoming.lastContact !== null && incoming.lastContact > nowSeconds + 120)
    )
      continue;
    const old = next[incoming.id];
    const hasPosition =
      incoming.positionTime !== null &&
      incoming.positionTime <= nowSeconds + 120;
    if (!old && !hasPosition) continue;
    const newerContact =
      !old || (incoming.lastContact ?? 0) >= (old.lastContact ?? 0);
    const newerPosition =
      hasPosition && (!old || incoming.positionTime > (old.positionTime ?? 0));
    const aircraft = newerContact ? { ...old, ...incoming } : { ...old };
    // A fresh transponder contact may have no position; never replace a known fix with null.
    if (!newerPosition && old) {
      for (const key of ["latitude", "longitude", "positionTime"])
        aircraft[key] = old[key];
    }
    if (newerPosition) {
      aircraft.latitude = incoming.latitude;
      aircraft.longitude = incoming.longitude;
      aircraft.positionTime = incoming.positionTime;
    }
    const history = (old?.history || []).filter(
      (p) => p.time >= nowSeconds - HISTORY_SECONDS,
    );
    if (newerPosition)
      history.push({
        time: incoming.positionTime,
        lat: incoming.latitude,
        lon: incoming.longitude,
        altitude: incoming.altitude,
        velocity: incoming.velocity,
        heading: incoming.heading,
      });
    aircraft.history = history.slice(-90);
    aircraft.firstSeen = old?.firstSeen ?? receivedAt;
    aircraft.lastSeenSnapshot = Math.max(
      old?.lastSeenSnapshot ?? 0,
      snapshotTime,
    );
    aircraft.inRegion = inBounds(aircraft.latitude, aircraft.longitude, bounds);
    next[incoming.id] = aircraft;
  }
  for (const [id, aircraft] of Object.entries(next)) {
    if (
      nowSeconds - (aircraft.lastContact ?? aircraft.positionTime ?? 0) >
      RETAIN_SECONDS
    )
      delete next[id];
  }
  return next;
}

export function freshness(aircraft, now = Date.now()) {
  if (!Number.isFinite(aircraft.positionTime)) return "lost";
  const age = Math.max(0, now / 1000 - aircraft.positionTime);
  return age > LOST_SECONDS ? "lost" : age > STALE_SECONDS ? "stale" : "fresh";
}
export function categoryName(category) {
  return (
    {
      2: "Light aircraft",
      3: "Small aircraft",
      4: "Large aircraft",
      5: "High-vortex large",
      6: "Heavy aircraft",
      7: "High performance",
      8: "Rotorcraft",
      9: "Glider",
      10: "Lighter than air",
      12: "Ultralight",
      14: "Unmanned aircraft",
      16: "Emergency vehicle",
      17: "Service vehicle",
    }[category] || "Unspecified aircraft"
  );
}
export function altitudeFt(aircraft) {
  const m = aircraft.altitude ?? aircraft.geoAltitude;
  return m === null || m === undefined ? null : m * 3.28084;
}
export const speedKts = (aircraft) =>
  aircraft.velocity === null ? null : aircraft.velocity * 1.943844;
export function distanceKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      r = Math.PI / 180;
    const d =
      Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
      Math.cos(a.lat * r) *
        Math.cos(b.lat * r) *
        Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
    total += 12742 * Math.atan2(Math.sqrt(d), Math.sqrt(Math.max(0, 1 - d)));
  }
  return total;
}
export function filterAircraft(
  aircraft,
  {
    query = "",
    altitude = "all",
    status = "all",
    country = "all",
    category = "all",
    bounds,
    now = Date.now(),
  },
) {
  const q = query.toLowerCase().trim();
  return Object.values(aircraft)
    .filter((a) => {
      if (
        !inBounds(a.latitude, a.longitude, bounds) ||
        freshness(a, now) === "lost"
      )
        return false;
      if (q && !`${a.callsign} ${a.id} ${a.country}`.toLowerCase().includes(q))
        return false;
      const feet = altitudeFt(a);
      if (altitude === "high" && (feet === null || feet < 30000)) return false;
      if (
        altitude === "mid" &&
        (feet === null || feet < 10000 || feet >= 30000)
      )
        return false;
      if (altitude === "low" && (feet === null || feet >= 10000)) return false;
      if (status === "airborne" && a.onGround !== false) return false;
      if (status === "ground" && a.onGround !== true) return false;
      if (status === "stale" && freshness(a, now) !== "stale") return false;
      if (country !== "all" && a.country !== country) return false;
      if (category !== "all" && String(a.category ?? 0) !== category)
        return false;
      return true;
    })
    .sort((a, b) => (a.callsign || a.id).localeCompare(b.callsign || b.id));
}
