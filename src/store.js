import { create } from "zustand";
import { WORLD } from "../shared/regions.js";
import { mergeAircraft } from "./lib/aircraft.js";
import { demoRows } from "./lib/demo.js";

let restored = {};
try {
  restored = JSON.parse(localStorage.getItem("planet-observations-v2") || "{}");
} catch {
  /* Storage may be disabled. */
}
const initialAircraft =
  restored.aircraft && typeof restored.aircraft === "object"
    ? restored.aircraft
    : {};
let demoTimer = null;
export const useStore = create((set, get) => ({
  region: WORLD,
  modelStyle: "auto",
  aircraft: initialAircraft,
  liveAircraft: {},
  selectedId: null,
  query: "",
  altitude: "all",
  status: "all",
  country: "all",
  category: "all",
  filtersOpen: false,
  showTrails: true,
  showClouds: true,
  paused: false,
  demo: false,
  fetching: false,
  connection: "connecting",
  issue: null,
  fetchedAt: restored.fetchedAt || null,
  remaining: null,
  retryAt: null,
  nextAt: Date.now(),
  nextPollMs: 60000,
  authMode: null,
  snapshotTime: null,
  upstreamStatus: null,
  receivedCount: null,
  focusVersion: 0,
  view: "airspace",
  customRegion: null,
  setFilter: (name, value) => set({ [name]: value }),
  clearFilters: () =>
    set({
      query: "",
      altitude: "all",
      status: "all",
      country: "all",
      category: "all",
    }),
  selectAircraft: (id) =>
    set({ selectedId: id, focusVersion: get().focusVersion + 1 }),
  recenter: () =>
    set({ selectedId: null, focusVersion: get().focusVersion + 1 }),
  setPaused: (paused) =>
    set({
      paused,
      nextAt: paused ? get().nextAt : Math.max(Date.now(), get().retryAt || 0),
    }),
  ingest: (payload) => {
    const s = get();
    const aircraft = mergeAircraft(
      s.aircraft,
      payload.states,
      s.region.bounds,
      payload.time,
      Date.now(),
    );
    set({
      aircraft,
      fetchedAt: payload.fetchedAt,
      snapshotTime: payload.time,
      upstreamStatus: payload.upstreamStatus,
      receivedCount: payload.states.length,
      remaining: payload.remaining,
      retryAt: payload.retryAt,
      nextPollMs: payload.nextPollMs,
      nextAt: Date.now() + payload.nextPollMs,
      authMode: payload.authMode,
      issue: payload.issue,
      connection: payload.issue
        ? "degraded"
        : payload.stale
          ? "cached"
          : "live",
    });
    persist(get());
  },
  seedDemo: () => {
    const s = get(),
      now = Date.now();
    let aircraft = {};
    for (let offset = -1800; offset <= 0; offset += 30)
      aircraft = mergeAircraft(
        aircraft,
        demoRows(s.region.bounds, now, offset),
        s.region.bounds,
        Math.floor(now / 1000) + offset,
        now + offset * 1000,
      );
    set({
      aircraft,
      connection: "demo",
      fetchedAt: now,
      nextAt: now + 10000,
      issue: null,
      retryAt: null,
      remaining: null,
      snapshotTime: Math.floor(now / 1000),
      receivedCount: Object.keys(aircraft).length,
    });
  },
  setDemo: (demo) => {
    if (demo === get().demo) return;
    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
    if (demo) {
      set({
        demo: true,
        liveAircraft: get().aircraft,
        selectedId: null,
        paused: false,
      });
      get().seedDemo();
      demoTimer = setInterval(() => {
        const s = get();
        if (s.paused) return;
        const now = Date.now();
        set({
          aircraft: mergeAircraft(
            s.aircraft,
            demoRows(s.region.bounds, now),
            s.region.bounds,
            Math.floor(now / 1000),
            now,
          ),
          fetchedAt: now,
          snapshotTime: Math.floor(now / 1000),
          nextAt: now + 10000,
        });
      }, 10000);
    } else
      set({
        demo: false,
        aircraft: get().liveAircraft,
        liveAircraft: {},
        selectedId: null,
        connection: "connecting",
        fetchedAt: null,
        issue: null,
        nextAt: Date.now(),
        remaining: null,
        snapshotTime: null,
        upstreamStatus: null,
        receivedCount: null,
        paused: false,
      });
  },
}));

function persist(state) {
  if (state.demo) return;
  try {
    const entries = Object.values(state.aircraft)
      .sort((a, b) => (b.positionTime || 0) - (a.positionTime || 0))
      .slice(0, 1500);
    localStorage.setItem(
      "planet-observations-v2",
      JSON.stringify({
        regionId: state.region.id,
        fetchedAt: state.fetchedAt,
        aircraft: Object.fromEntries(
          entries.map((a) => [a.id, { ...a, history: a.history.slice(-10) }]),
        ),
      }),
    );
  } catch {
    /* An unavailable/full local cache must not interrupt monitoring. */
  }
}
