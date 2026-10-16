import { REGIONS } from "../../shared/regions.js";
// Deliberately synthetic trajectories; never mixed into the live data store.
const FLIGHTS = [
  ["a10001", "IGO214", "India", 28.4, 76.9, 132, 10500, 231, 4],
  ["a10002", "AIC302", "India", 23.5, 78.8, 64, 11200, 249, 6],
  ["a10003", "UAE508", "United Arab Emirates", 20.1, 73.2, 104, 11800, 255, 6],
  ["a10004", "IGO681", "India", 17.8, 78.1, 192, 9400, 215, 4],
  ["a10005", "AXB711", "India", 12.9, 75.8, 321, 10300, 228, 4],
  ["a10006", "QTR572", "Qatar", 23.9, 69.3, 98, 12100, 252, 6],
  ["a10007", "SEJ452", "India", 25.8, 82.2, 273, 9800, 221, 4],
  ["a10008", "IGO339", "India", 19.8, 82.4, 31, 10900, 240, 4],
  ["a10009", "AIC865", "India", 28.1, 74.1, 221, 11400, 234, 4],
  ["a1000a", "SIA423", "Singapore", 13.1, 83.5, 121, 11500, 260, 6],
  ["a1000b", "IGO902", "India", 26.5, 88.1, 95, 8700, 223, 4],
  ["a1000c", "BBC305", "Bangladesh", 23.4, 90.2, 264, 10200, 236, 4],
  ["a1000d", "ALK196", "Sri Lanka", 8.7, 79.9, 348, 10000, 237, 4],
  ["a1000e", "THA318", "Thailand", 18.1, 88.2, 106, 11700, 255, 6],
  ["a1000f", "VTJPK", "India", 21.3, 77.1, 173, 6400, 165, 2],
  ["a10010", "IGO725", "India", 16.3, 74.2, 16, 9100, 218, 4],
  ["a10011", "AIC543", "India", 15.2, 79.9, 352, 10800, 246, 4],
  ["a10012", "ETD643", "United Arab Emirates", 25.3, 66.7, 124, 11500, 248, 6],
  ["a10013", "IGO119", "India", 29.7, 80.1, 172, 9700, 226, 4],
  ["a10014", "VTKLM", "India", 19.1, 72.9, 0, 20, 0, 2],
  ["a10015", "IGO467", "India", 23.0, 85.7, 211, 9300, 230, 4],
  ["a10016", "AIC209", "India", 30.5, 75.8, 142, 11000, 244, 4],
  ["a10017", "QTR918", "Qatar", 10.5, 77.6, 112, 11900, 250, 6],
  ["a10018", "IGO551", "India", 22.4, 72.9, 43, 10800, 232, 4],
];
const DEMO_EPOCH = Math.floor(Date.now() / 1000);
export function demoRows(bounds, now = Date.now(), offsetSeconds = 0) {
  if (bounds[1] === -180 && bounds[3] === 180) {
    const countries = [
      "India",
      "Germany",
      "United States",
      "Japan",
      "United Arab Emirates",
      "Australia",
      "Brazil",
      "South Africa",
    ];
    return REGIONS.flatMap((region, cluster) =>
      demoRows(region.bounds, now, offsetSeconds).map((row, i) => {
        row[0] = (parseInt(row[0], 16) + cluster * 0x10000).toString(16);
        if (cluster) {
          row[1] = `PLN${cluster}${String(i + 1).padStart(3, "0")}`;
          if (row[2] === "India") row[2] = countries[cluster];
        }
        return row;
      }),
    );
  }
  const t = Math.floor(now / 1000) + offsetSeconds;
  const centerLat = (bounds[0] + bounds[2]) / 2,
    centerLon = (bounds[1] + bounds[3]) / 2;
  return FLIGHTS.map(
    (
      [id, callsign, country, lat, lon, heading, altitude, velocity, category],
      i,
    ) => {
      const minutes = (t - DEMO_EPOCH) / 60;
      const h = (heading * Math.PI) / 180;
      const baseLat =
        centerLat + (lat - 21) * Math.min(1, (bounds[2] - bounds[0]) / 33);
      lat = baseLat + (Math.cos(h) * minutes * velocity * 60) / 111320;
      lon =
        centerLon +
        (lon - 79) * Math.min(1, (bounds[3] - bounds[1]) / 35) +
        (Math.sin(h) * minutes * velocity * 60) /
          (111320 * Math.cos((baseLat * Math.PI) / 180));
      const observedAltitude =
        altitude + (i === 19 ? 0 : Math.sin((t - DEMO_EPOCH) / 500 + i) * 120);
      return [
        id,
        callsign,
        country,
        t - (i === 8 ? 130 : 0),
        t,
        lon,
        lat,
        observedAltitude,
        i === 19,
        velocity,
        heading,
        i === 19 ? 0 : Math.cos((t - DEMO_EPOCH) / 500 + i) * 0.24,
        null,
        observedAltitude + 80,
        "2000",
        false,
        0,
        category,
      ];
    },
  );
}
