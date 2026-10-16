export const WORLD = {
  id: "world",
  name: "The whole planet",
  short: "Worldwide",
  bounds: [-90, -180, 90, 180],
  center: [24, 35],
  description: "No borders. Just busy skies.",
};

export const REGIONS = [
  {
    id: "india",
    name: "Indian subcontinent",
    short: "South Asia",
    center: [23, 79],
    bounds: [5, 64, 38, 99],
    description: "From the Himalayas to the Indian Ocean",
  },
  {
    id: "europe",
    name: "Europe",
    short: "Europe",
    center: [49, 12],
    bounds: [35, -12, 62, 35],
    description: "A crossroads of busy European skies",
  },
  {
    id: "north-america",
    name: "North America",
    short: "North America",
    center: [38, -98],
    bounds: [20, -130, 57, -60],
    description: "Coast to coast, and everything in between",
  },
  {
    id: "east-asia",
    name: "East Asia",
    short: "East Asia",
    center: [31, 119],
    bounds: [15, 100, 48, 145],
    description: "Across the western Pacific skies",
  },
  {
    id: "middle-east",
    name: "Middle East",
    short: "Middle East",
    center: [26, 47],
    bounds: [12, 32, 40, 63],
    description: "Where continents connect",
  },
  {
    id: "oceania",
    name: "Australia & New Zealand",
    short: "Oceania",
    center: [-28, 143],
    bounds: [-48, 110, -10, 179],
    description: "A window into the southern skies",
  },
  {
    id: "south-america",
    name: "South America",
    short: "South America",
    center: [-16, -62],
    bounds: [-56, -82, 13, -34],
    description: "From the Andes to the Atlantic",
  },
  {
    id: "africa",
    name: "Africa",
    short: "Africa",
    center: [3, 21],
    bounds: [-35, -18, 37, 52],
    description: "Explore a continent of connections",
  },
];

export function validBounds(bounds) {
  return (
    Array.isArray(bounds) &&
    bounds.length === 4 &&
    bounds.every(Number.isFinite) &&
    bounds[0] >= -90 &&
    bounds[2] <= 90 &&
    bounds[1] >= -180 &&
    bounds[3] <= 180 &&
    bounds[0] < bounds[2] &&
    bounds[1] < bounds[3]
  );
}
export const inBounds = (lat, lon, b) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= b[0] &&
  lat <= b[2] &&
  lon >= b[1] &&
  lon <= b[3];
export const boundsKey = (b) => b.map((v) => Number(v).toFixed(3)).join(",");
