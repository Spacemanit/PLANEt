import test from "node:test";
import assert from "node:assert/strict";
import {
  filterAircraft,
  freshness,
  mergeAircraft,
  normalizeState,
  distanceKm,
} from "../src/lib/aircraft.js";
import { validBounds } from "../shared/regions.js";

const now = 1_800_000_000_000,
  seconds = now / 1000,
  bounds = [5, 64, 38, 99];
const row = (id = "abcdef", t = seconds, lat = 23, lon = 79) => [
  id,
  " IGO123 ",
  "India",
  t,
  t,
  lon,
  lat,
  10000,
  false,
  230,
  90,
  0,
  null,
  10050,
  "2000",
  false,
  0,
  4,
];

test("normalizes units without turning missing measurements into zero", () => {
  const r = row();
  r[7] = null;
  r[9] = null;
  r[10] = null;
  assert.deepEqual(
    [
      normalizeState(r).altitude,
      normalizeState(r).velocity,
      normalizeState(r).heading,
    ],
    [null, null, null],
  );
  assert.equal(normalizeState(r).callsign, "IGO123");
  assert.equal(normalizeState(["invalid"]), null);
});
test("collects only increasing position observations and ignores duplicate/cached responses", () => {
  const a = mergeAircraft({}, [row()], bounds, seconds, now);
  const b = mergeAircraft(a, [row()], bounds, seconds, now + 1000);
  const c = mergeAircraft(
    b,
    [row("abcdef", seconds + 30, 23.1)],
    bounds,
    seconds + 30,
    now + 30000,
  );
  assert.equal(c.abcdef.history.length, 2);
  assert.equal(c.abcdef.latitude, 23.1);
});
test("out-of-order fixes cannot move an aircraft backwards", () => {
  const a = mergeAircraft({}, [row()], bounds, seconds, now);
  const b = mergeAircraft(
    a,
    [row("abcdef", seconds - 40, 20)],
    bounds,
    seconds - 40,
    now,
  );
  assert.equal(b.abcdef.latitude, 23);
  assert.equal(b.abcdef.history.length, 1);
});
test("a newer fix is accepted independently of an out-of-order contact message", () => {
  const a = mergeAircraft({}, [row()], bounds, seconds, now);
  const r = row("abcdef", seconds + 10, 23.5);
  r[4] = seconds - 5;
  const b = mergeAircraft(a, [r], bounds, seconds + 10, now + 10000);
  assert.equal(b.abcdef.latitude, 23.5);
  assert.equal(b.abcdef.lastContact, seconds);
});
test("missing coordinates keep the previous fix but never invent a trail point", () => {
  const a = mergeAircraft({}, [row()], bounds, seconds, now);
  const r = row("abcdef", seconds + 30);
  r[3] = null;
  r[5] = null;
  r[6] = null;
  const b = mergeAircraft(a, [r], bounds, seconds + 30, now + 30000);
  assert.equal(b.abcdef.longitude, 79);
  assert.equal(b.abcdef.positionTime, seconds);
  assert.equal(b.abcdef.history.length, 1);
  assert.equal(
    Object.keys(mergeAircraft({}, [r], bounds, seconds + 30, now + 30000))
      .length,
    0,
  );
});
test("aircraft absent from a response are retained, grow stale, leave the map, and expire", () => {
  const a = mergeAircraft({}, [row()], bounds, seconds, now);
  const b = mergeAircraft(a, [], bounds, seconds + 120, now + 120000);
  assert.equal(freshness(b.abcdef, now + 120000), "stale");
  assert.equal(filterAircraft(b, { bounds, now: now + 120000 }).length, 1);
  assert.equal(filterAircraft(b, { bounds, now: now + 301000 }).length, 0);
  assert.equal(
    Object.keys(mergeAircraft(b, [], bounds, seconds + 901, now + 901000))
      .length,
    0,
  );
});
test("entering and leaving a region preserves independent history", () => {
  const a = mergeAircraft({}, [row()], bounds, seconds, now);
  const b = mergeAircraft(
    a,
    [row("abcdef", seconds + 30, 40)],
    bounds,
    seconds + 30,
    now + 30000,
  );
  assert.equal(b.abcdef.inRegion, false);
  assert.equal(b.abcdef.history.length, 2);
  assert.equal(filterAircraft(b, { bounds, now: now + 30000 }).length, 0);
});
test("filters use the reported country, altitude, category and flight state", () => {
  const a = mergeAircraft({}, [row()], bounds, seconds, now);
  assert.equal(filterAircraft(a, { bounds, now, query: "igo" }).length, 1);
  assert.equal(
    filterAircraft(a, {
      bounds,
      now,
      altitude: "high",
      country: "India",
      category: "4",
      status: "airborne",
    }).length,
    1,
  );
  assert.equal(filterAircraft(a, { bounds, now, altitude: "low" }).length, 0);
});
test("future fixes and impossible coordinates are not plotted", () => {
  assert.equal(
    Object.keys(
      mergeAircraft({}, [row("abcdef", seconds + 300)], bounds, seconds, now),
    ).length,
    0,
  );
  assert.equal(
    Object.keys(
      mergeAircraft({}, [row("abcdef", seconds, 190)], bounds, seconds, now),
    ).length,
    0,
  );
});
test("history stays bounded and distances cross the date line correctly", () => {
  let state = {};
  for (let i = 0; i < 120; i++)
    state = mergeAircraft(
      state,
      [row("abcdef", seconds + i, 23 + i * 0.001)],
      bounds,
      seconds + i,
      now + i * 1000,
    );
  assert.equal(state.abcdef.history.length, 90);
  assert.ok(
    distanceKm([
      { lat: 0, lon: 179 },
      { lat: 0, lon: -179 },
    ]) < 223,
  );
});
test("bounds reject reversed, empty, wrapped or out-of-range areas", () => {
  assert.ok(validBounds(bounds));
  assert.ok(!validBounds([40, 64, 5, 99]));
  assert.ok(!validBounds([-91, 0, 90, 10]));
  assert.ok(!validBounds([0, 179, 10, -179]));
  assert.ok(!validBounds([0, NaN, 10, 20]));
});
