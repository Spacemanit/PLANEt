export const PLANE_MODELS = {
  ss500: {
    id: "ss500",
    url: "/assets/plane-ss500.glb",
    name: "SS500 cartoon plane",
  },
  prop: {
    id: "prop",
    url: "/assets/plane-prop.glb",
    name: "Cartoon prop plane",
  },
};

export function planeModelFor(aircraft, preference = "auto") {
  if (PLANE_MODELS[preference]) return PLANE_MODELS[preference];
  return [2, 3, 8, 9, 12].includes(aircraft?.category)
    ? PLANE_MODELS.prop
    : PLANE_MODELS.ss500;
}

// The previous selection camera was 2.65 scene units above Earth's surface.
export const FLIGHT_VIEW_DISTANCE = 2.65 / 2;
