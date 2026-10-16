import { useEffect } from "react";
import { useStore } from "../store.js";

export function useAirTraffic() {
  const paused = useStore((s) => s.paused),
    demo = useStore((s) => s.demo);
  useEffect(() => {
    if (paused || demo) return;
    let stopped = false,
      timer,
      controller;
    async function poll() {
      if (stopped) return;
      if (document.hidden || !navigator.onLine) {
        if (!navigator.onLine)
          useStore.setState({
            connection: "offline",
            issue: "You’re offline. Saved observations remain available.",
          });
        timer = setTimeout(poll, 5000);
        return;
      }
      const s = useStore.getState();
      if (s.nextAt > Date.now()) {
        timer = setTimeout(poll, Math.min(s.nextAt - Date.now(), 5000));
        return;
      }
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 28000);
      useStore.setState({ fetching: true });
      try {
        const res = await fetch("/api/aircraft", { signal: controller.signal });
        const data = await res.json();
        if (stopped) return;
        if (!Array.isArray(data.states)) throw new Error("Invalid data");
        if (data.fetchedAt) useStore.getState().ingest(data);
        else
          useStore.setState({
            connection: "degraded",
            issue: data.issue || "No observations are available yet.",
            retryAt: data.retryAt,
            remaining: data.remaining,
            authMode: data.authMode,
            upstreamStatus: data.upstreamStatus,
            nextPollMs: data.nextPollMs || 60000,
            nextAt: Date.now() + (data.nextPollMs || 60000),
          });
      } catch {
        if (!stopped)
          useStore.setState({
            connection: navigator.onLine ? "degraded" : "offline",
            issue:
              "OpenSky could not be reached. Keeping saved observations and retrying.",
            nextAt: Date.now() + 60000,
          });
      } finally {
        clearTimeout(timeout);
        if (!stopped) {
          useStore.setState({ fetching: false });
          timer = setTimeout(poll, 1000);
        }
      }
    }
    const wake = () => {
      clearTimeout(timer);
      poll();
    };
    // Avoid overlapping requests when visibility changes during an active request.
    const onWake = () => {
      if (!useStore.getState().fetching) wake();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    useStore.setState({ fetching: false });
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      useStore.setState({ fetching: false });
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [paused, demo]);
}
