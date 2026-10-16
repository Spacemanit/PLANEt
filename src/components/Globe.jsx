import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { freshness } from "../lib/aircraft.js";
import { useStore } from "../store.js";
import { planeModelFor, FLIGHT_VIEW_DISTANCE } from "../lib/models.js";
import { Globe2, LoaderCircle, MousePointer2, RotateCcw } from "lucide-react";

const RADIUS = 2.05;
export function geoVector(lat, lon, radius = RADIUS) {
  const phi = (lat * Math.PI) / 180,
    theta = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    radius * Math.cos(phi) * Math.cos(theta),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(theta),
  );
}
function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    if (child.material)
      for (const material of [].concat(child.material)) material.dispose();
  });
}
function lineFrom(points, color, opacity = 1) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
}
const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main(){vUv=uv;vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const fragmentShader = `
  uniform sampler2D earthMap;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main(){
    vec3 tex=texture2D(earthMap,vUv).rgb;
    float ocean=step(tex.r*1.45,tex.b)*step(tex.g,0.12);
    vec3 climate=texture2D(earthMap,vUv,5.0).rgb;
    float bright=dot(climate,vec3(0.299,0.587,0.114));
    float desert=smoothstep(0.22,0.32,bright);
    vec3 land=mix(vec3(0.36,0.65,0.30),vec3(0.74,0.69,0.38),desert);
    land=mix(land,vec3(0.95,0.97,0.84),smoothstep(0.80,0.90,abs(vUv.y-0.5)*2.0));
    vec3 sea=vec3(0.19,0.56,0.72);
    vec3 color=mix(land,sea,ocean);
    float lighting=dot(normalize(vNormal),normalize(vec3(-0.5,0.7,1.8)));
    float shade=lighting>0.1?1.0:0.83;
    gl_FragColor=vec4(color*shade,1.0);
    #include <colorspace_fragment>
  }
`;

export default function Globe({ aircraft, selected, now }) {
  const container = useRef(null),
    sceneRef = useRef(null),
    latest = useRef({ aircraft, selected });
  const [load, setLoad] = useState({ state: "loading", progress: 0 }),
    [hover, setHover] = useState(null);
  const region = useStore((s) => s.region),
    focusVersion = useStore((s) => s.focusVersion);
  const showTrails = useStore((s) => s.showTrails),
    showClouds = useStore((s) => s.showClouds);
  const modelStyle = useStore((s) => s.modelStyle);
  const [modelStatus, setModelStatus] = useState({ state: "idle" });
  const [retry, setRetry] = useState(0);
  latest.current = { aircraft, selected };

  useEffect(() => {
    const host = container.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      setLoad({
        state: "error",
        message:
          "3D graphics are unavailable in this browser. You can still explore flights in the list.",
      });
      return;
    }
    let alive = true,
      frame,
      texture = null,
      pointerDown = null,
      tween = null,
      hovering = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D Earth. Drag to rotate, scroll to zoom, or select a flight in the aircraft list.",
    );
    renderer.domElement.setAttribute("role", "img");
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#fff9dc", "#68886d", 2.4));
    const sunlight = new THREE.DirectionalLight("#fff7de", 3);
    sunlight.position.set(4, 7, 5);
    scene.add(sunlight);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.05, 100);
    camera.position.copy(geoVector(...useStore.getState().region.center, 7.5));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.minDistance = 0.65;
    controls.maxDistance = 12;
    controls.rotateSpeed = 0.55;
    const base = new THREE.Group();
    scene.add(base);
    const placeholder = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 64, 32),
      new THREE.MeshBasicMaterial({ color: "#87b7c9" }),
    );
    base.add(placeholder);
    const outline = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 1.006, 72, 48),
      new THREE.MeshBasicMaterial({ color: "#3e614b", side: THREE.BackSide }),
    );
    base.add(outline);
    // A quiet graticule makes orientation legible without competing with the aircraft.
    const grid = new THREE.Group();
    scene.add(grid);
    for (let lat = -60; lat <= 60; lat += 30) {
      const points = [];
      for (let lon = -180; lon <= 180; lon += 2)
        points.push(geoVector(lat, lon, RADIUS * 1.002));
      grid.add(lineFrom(points, "#eef8e8", 0.13));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const points = [];
      for (let lat = -90; lat <= 90; lat += 2)
        points.push(geoVector(lat, lon, RADIUS * 1.002));
      grid.add(lineFrom(points, "#eef8e8", 0.13));
    }
    const clouds = new THREE.Group();
    scene.add(clouds);
    const cloudMaterial = new THREE.MeshBasicMaterial({ color: "#f9fcf4" });
    const cloudGeometry = new THREE.SphereGeometry(1, 12, 8);
    for (const [lat, lon, scale] of [
      [-5, 59, 0.85],
      [40, 54, 0.7],
      [5, 112, 0.8],
      [-22, 91, 0.8],
      [39, 99, 0.65],
      [-32, 46, 1],
      [-7, 146, 0.8],
      [52, -32, 0.8],
      [10, -31, 1],
      [33, -110, 0.8],
    ]) {
      const cloud = new THREE.Group();
      cloud.position.copy(geoVector(lat, lon, RADIUS * 1.014));
      cloud.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        cloud.position.clone().normalize(),
      );
      for (const [x, y, s] of [
        [-0.09, 0, 0.075],
        [0, 0.025, 0.1],
        [0.1, 0, 0.07],
        [0.035, -0.025, 0.075],
      ]) {
        const puff = new THREE.Mesh(cloudGeometry, cloudMaterial);
        puff.position.set(x * scale, y * scale, 0.015);
        puff.scale.set(s * scale, s * 0.6 * scale, s * 0.47 * scale);
        cloud.add(puff);
      }
      clouds.add(cloud);
    }
    const trails = new THREE.Group();
    scene.add(trails);
    const markers = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        vertexShader: `attribute vec3 markerColor;attribute float markerSize;varying vec3 vColor;void main(){vColor=markerColor;vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=markerSize*${Math.min(window.devicePixelRatio, 1.75).toFixed(2)};}`,
        fragmentShader: `varying vec3 vColor;void main(){float r=length(gl_PointCoord-0.5)*2.0;if(r>1.0)discard;float alpha=1.0-smoothstep(0.88,1.0,r);vec3 c=vColor;if(r>0.34&&r<0.64)c=vec3(1.0,0.98,0.91);gl_FragColor=vec4(c,alpha);\n#include <colorspace_fragment>\n}`,
        transparent: true,
        depthWrite: false,
      }),
    );
    scene.add(markers);
    let markerIds = [],
      markerLookup = new Map();
    const selection = new THREE.Group();
    scene.add(selection);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.093, 48),
      new THREE.MeshBasicMaterial({
        color: "#e86748",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      }),
    );
    selection.add(ring);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, 0.1, 6),
      new THREE.MeshBasicMaterial({ color: "#e86748" }),
    );
    stem.rotation.x = Math.PI / 2;
    stem.position.z = -0.045;
    selection.add(stem);
    selection.visible = false;
    const loader = new GLTFLoader();
    const planeGroup = new THREE.Group();
    planeGroup.visible = false;
    scene.add(planeGroup);
    const templates = new Map(),
      loadingModels = new Map();
    const bands = new THREE.DataTexture(
      new Uint8Array([
        140, 140, 140, 255, 205, 205, 205, 255, 255, 255, 255, 255,
      ]),
      3,
      1,
      THREE.RGBAFormat,
    );
    bands.minFilter = bands.magFilter = THREE.NearestFilter;
    bands.needsUpdate = true;
    let planeVariant = null,
      modelRequest = 0;
    async function loadPlane(info) {
      if (templates.has(info.id)) return templates.get(info.id);
      if (!loadingModels.has(info.id))
        loadingModels.set(
          info.id,
          loader
            .loadAsync(info.url)
            .then((gltf) => {
              const content = gltf.scene;
              content.updateMatrixWorld(true);
              const box = new THREE.Box3().setFromObject(content),
                size = box.getSize(new THREE.Vector3());
              content.position.sub(box.getCenter(new THREE.Vector3()));
              const wrapper = new THREE.Group();
              wrapper.add(content);
              wrapper.scale.setScalar(0.3 / Math.max(size.x, size.y, size.z));
              const materials = new Set();
              content.traverse((child) => {
                if (!child.isMesh) return;
                const convert = (old) => {
                  materials.add(old);
                  return new THREE.MeshToonMaterial({
                    color: old.color.clone(),
                    map: old.map,
                    gradientMap: bands,
                    side: THREE.DoubleSide,
                    transparent: old.transparent,
                    opacity: old.opacity,
                  });
                };
                child.material = Array.isArray(child.material)
                  ? child.material.map(convert)
                  : convert(child.material);
              });
              materials.forEach((material) => material.dispose());
              if (!alive) {
                disposeObject(wrapper);
                return wrapper;
              }
              templates.set(info.id, wrapper);
              return wrapper;
            })
            .finally(() => loadingModels.delete(info.id)),
        );
      return loadingModels.get(info.id);
    }
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.055;
    const mouse = new THREE.Vector2();
    const pick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(markers);
      for (const hit of hits) {
        const id = markerIds[hit.index],
          a = markerLookup.get(id);
        if (
          a &&
          geoVector(a.latitude, a.longitude)
            .normalize()
            .dot(camera.position.clone().normalize()) >
            RADIUS / camera.position.length()
        )
          return a;
      }
      return null;
    };
    const onDown = (e) => {
      pointerDown = { x: e.clientX, y: e.clientY };
      tween = null;
    };
    const onMove = (e) => {
      const a = pick(e);
      hovering = Boolean(a);
      renderer.domElement.style.cursor = a ? "pointer" : "grab";
      setHover(
        a
          ? {
              id: a.id,
              x: e.clientX - host.getBoundingClientRect().left,
              y: e.clientY - host.getBoundingClientRect().top,
            }
          : null,
      );
    };
    const onClick = (e) => {
      if (
        pointerDown &&
        Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 5
      )
        return;
      const a = pick(e);
      if (a) useStore.getState().selectAircraft(a.id);
    };
    const onLeave = () => {
      setHover(null);
      hovering = false;
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    controls.addEventListener("start", () => {
      tween = null;
    });
    const onContextLost = (e) => {
      e.preventDefault();
      setLoad({
        state: "error",
        message:
          "The 3D view was interrupted. Reload the globe to continue, or use the aircraft list.",
      });
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    const observer = new ResizeObserver(() => {
      const w = host.clientWidth,
        h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    observer.observe(host);
    const api = {
      async updateModel(active, preference) {
        const request = ++modelRequest;
        if (!active || freshness(active, Date.now()) === "lost") {
          planeGroup.visible = false;
          planeVariant = null;
          setModelStatus({ state: "idle" });
          return;
        }
        const info = planeModelFor(active, preference),
          lat = (active.latitude * Math.PI) / 180,
          lon = (active.longitude * Math.PI) / 180;
        const normal = geoVector(active.latitude, active.longitude, 1);
        const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon));
        const south = new THREE.Vector3(
          Math.sin(lat) * Math.cos(lon),
          -Math.cos(lat),
          -Math.sin(lat) * Math.sin(lon),
        );
        planeGroup.position.copy(normal.clone().multiplyScalar(RADIUS + 0.15));
        planeGroup.quaternion.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(east, normal, south),
        );
        planeGroup.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            (-(active.heading || 0) * Math.PI) / 180,
          ),
        );
        if (planeVariant === info.id) {
          planeGroup.visible = true;
          return;
        }
        planeGroup.visible = false;
        setModelStatus({ state: "loading", name: info.name });
        try {
          const template = await loadPlane(info);
          if (!alive || request !== modelRequest) return;
          planeGroup.clear();
          planeGroup.add(template.clone(true));
          planeGroup.visible = true;
          planeVariant = info.id;
          setModelStatus({ state: "ready", name: info.name });
        } catch {
          if (alive && request === modelRequest)
            setModelStatus({ state: "error", name: info.name });
        }
      },
      updateAircraft(list, active, show, now) {
        markerIds = list.map((a) => a.id);
        markerLookup = new Map(list.map((a) => [a.id, a]));
        renderer.domElement.dataset.aircraftCount = String(list.length);
        const positions = [],
          colors = [],
          sizes = [];
        for (const a of list) {
          positions.push(
            ...geoVector(a.latitude, a.longitude, RADIUS * 1.016).toArray(),
          );
          const color = new THREE.Color(
            a.id === active?.id
              ? "#d64e31"
              : freshness(a, now) === "stale"
                ? "#a5a997"
                : "#e49a3b",
          );
          colors.push(color.r, color.g, color.b);
          sizes.push(a.id === active?.id ? 17 : list.length > 1000 ? 6 : 9);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        geometry.setAttribute(
          "markerColor",
          new THREE.Float32BufferAttribute(colors, 3),
        );
        geometry.setAttribute(
          "markerSize",
          new THREE.Float32BufferAttribute(sizes, 1),
        );
        markers.geometry.dispose();
        markers.geometry = geometry;
        geometry.computeBoundingSphere();
        disposeObject(trails);
        trails.clear();
        if (show) {
          // Only observed tracks are drawn; gaps are split, never extrapolated.
          const visible = active
            ? [...list.filter((a) => a.id !== active.id).slice(0, 249), active]
            : list.slice(0, 250);
          for (const a of visible) {
            const segments = [];
            let segment = [];
            for (const p of a.history) {
              const last = segment.at(-1);
              if (last && p.time - last.time > 180) {
                if (segment.length > 1) segments.push(segment);
                segment = [];
              }
              segment.push(p);
            }
            if (segment.length > 1) segments.push(segment);
            for (const points of segments) {
              const vectors = points.map((p) =>
                geoVector(p.lat, p.lon, RADIUS * 1.01),
              );
              // Interpolated segments follow the globe surface, not a route prediction.
              const curve = new THREE.CatmullRomCurve3(vectors);
              const path = curve
                .getPoints(Math.max(12, Math.min(120, points.length * 3)))
                .map((v) => v.normalize().multiplyScalar(RADIUS * 1.01));
              const tube = new THREE.TubeGeometry(
                new THREE.CatmullRomCurve3(path),
                path.length - 1,
                a.id === active?.id ? 0.009 : 0.0045,
                4,
                false,
              );
              trails.add(
                new THREE.Mesh(
                  tube,
                  new THREE.MeshBasicMaterial({
                    color: a.id === active?.id ? "#dc7555" : "#b98f51",
                    transparent: true,
                    opacity: a.id === active?.id ? 1 : 0.78,
                  }),
                ),
              );
            }
          }
        }
        selection.visible = Boolean(
          active && freshness(active, now) !== "lost",
        );
        if (active) {
          selection.position.copy(
            geoVector(active.latitude, active.longitude, RADIUS * 1.025),
          );
          selection.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            selection.position.clone().normalize(),
          );
        }
      },
      focus(lat, lon, close = false) {
        const direction = geoVector(lat, lon, 1);
        const target = close
          ? direction.clone().multiplyScalar(RADIUS + 0.15)
          : new THREE.Vector3();
        const north = new THREE.Vector3(
          -Math.sin((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180),
          Math.cos((lat * Math.PI) / 180),
          Math.sin((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180),
        );
        const destination = close
          ? target
              .clone()
              .add(
                direction
                  .clone()
                  .addScaledVector(north, 0.35)
                  .normalize()
                  .multiplyScalar(FLIGHT_VIEW_DISTANCE),
              )
          : direction.clone().multiplyScalar(7.5);
        tween = {
          from: camera.position.clone(),
          to: destination,
          rotation: new THREE.Quaternion().setFromUnitVectors(
            camera.position.clone().normalize(),
            destination.clone().normalize(),
          ),
          fromTarget: controls.target.clone(),
          target,
          start: performance.now(),
          duration: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : 1100,
        };
      },
      zoom(amount) {
        tween = null;
        camera.position
          .sub(controls.target)
          .multiplyScalar(amount)
          .add(controls.target);
        if (camera.position.length() < RADIUS + 0.35)
          camera.position.setLength(RADIUS + 0.35);
        controls.update();
      },
      clouds,
    };
    sceneRef.current = api;
    api.updateAircraft(
      latest.current.aircraft,
      latest.current.selected,
      useStore.getState().showTrails,
      Date.now(),
    );
    loader.load(
      "/assets/earth.glb",
      (gltf) => {
        if (!alive) {
          disposeObject(gltf.scene);
          return;
        }
        let surface;
        gltf.scene.traverse((child) => {
          if (child.isMesh && child.name.startsWith("Surface")) surface = child;
        });
        if (!surface) {
          setLoad({
            state: "error",
            message:
              "The Earth model could not be read. The aircraft list is still available.",
          });
          return;
        }
        texture = surface.material.map;
        const geometry = surface.geometry.clone();
        geometry.computeBoundingSphere();
        geometry.scale(
          RADIUS / geometry.boundingSphere.radius,
          RADIUS / geometry.boundingSphere.radius,
          RADIUS / geometry.boundingSphere.radius,
        );
        // The supplied GLB uses Z as north; orient it to Three.js Y-up before plotting WGS84 fixes.
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.ShaderMaterial({
          uniforms: { earthMap: { value: texture } },
          vertexShader,
          fragmentShader,
        });
        base.remove(placeholder);
        placeholder.geometry.dispose();
        placeholder.material.dispose();
        base.add(new THREE.Mesh(geometry, material));
        // Keep only the surface map; discard the original emissive/atmospheric layers.
        const disposableTextures = new Set();
        gltf.scene.traverse((obj) => {
          if (obj.material)
            for (const m of [].concat(obj.material))
              for (const v of Object.values(m))
                if (v?.isTexture && v !== texture) disposableTextures.add(v);
        });
        disposableTextures.forEach((t) => t.dispose());
        disposeObject(gltf.scene);
        setLoad({ state: "ready", progress: 100 });
      },
      (event) => {
        if (alive)
          setLoad({
            state: "loading",
            progress: event.total
              ? Math.round((event.loaded / event.total) * 100)
              : 0,
          });
      },
      () => {
        if (alive)
          setLoad({
            state: "error",
            message:
              "The Earth model could not load. Reload the globe or continue with the aircraft list.",
          });
      },
    );
    let lastFrame = 0;
    const animate = (time) => {
      if (!alive) return;
      frame = requestAnimationFrame(animate);
      if (document.hidden || time - lastFrame < 28) return;
      lastFrame = time;
      if (tween) {
        const t =
            tween.duration === 0
              ? 1
              : Math.min(1, (time - tween.start) / tween.duration),
          ease = t * t * (3 - 2 * t);
        const direction = tween.from
          .clone()
          .normalize()
          .applyQuaternion(new THREE.Quaternion().slerp(tween.rotation, ease));
        camera.position.copy(
          direction.multiplyScalar(
            THREE.MathUtils.lerp(tween.from.length(), tween.to.length(), ease),
          ),
        );
        controls.target.lerpVectors(tween.fromTarget, tween.target, ease);
        if (t === 1) tween = null;
      }
      controls.update();
      if (camera.position.length() < RADIUS + 0.35)
        camera.position.setLength(RADIUS + 0.35);
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      sceneRef.current = null;
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      disposeObject(scene);
      templates.forEach((template) => disposeObject(template));
      bands.dispose();
      texture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [retry]);

  useEffect(() => {
    sceneRef.current?.updateAircraft(aircraft, selected, showTrails, now);
  }, [aircraft, selected, showTrails, Math.floor(now / 15000)]);
  useEffect(() => {
    sceneRef.current?.updateModel(selected, modelStyle);
  }, [selected, modelStyle, retry, Math.floor(now / 15000)]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.clouds.visible = showClouds;
  }, [showClouds, load.state]);
  useEffect(() => {
    if (selected)
      sceneRef.current?.focus(selected.latitude, selected.longitude, true);
    else sceneRef.current?.focus(...region.center);
  }, [focusVersion, region]);
  const hovered = hover && aircraft.find((a) => a.id === hover.id);
  return (
    <div className="globe-stage">
      <div className="globe-halo" aria-hidden="true" />
      <div ref={container} className="globe-canvas" />
      {load.state === "loading" && (
        <div className="globe-loading">
          <LoaderCircle size={16} className="spin" />
          <span>
            Unpacking our little planet
            {load.progress > 0 ? ` · ${load.progress}%` : "…"}
          </span>
        </div>
      )}
      {load.state === "error" && (
        <div className="globe-error">
          <Globe2 size={28} />
          <p>{load.message}</p>
          <button
            className="button small"
            onClick={() => {
              setLoad({ state: "loading", progress: 0 });
              setRetry((r) => r + 1);
            }}
          >
            Reload globe
          </button>
        </div>
      )}
      {hovered && (
        <div
          className="map-tooltip"
          style={{
            left: Math.min(
              hover.x + 14,
              (container.current?.clientWidth || 800) - 170,
            ),
            top: Math.max(8, hover.y - 60),
          }}
        >
          <strong>{hovered.callsign || hovered.id.toUpperCase()}</strong>
          <span>{hovered.country} · Click to explore</span>
        </div>
      )}
      {selected && (
        <div className="model-overlay">
          <div role="status" className={`model-status ${modelStatus.state}`}>
            {modelStatus.state === "loading" ? (
              <>
                <LoaderCircle size={13} className="spin" /> Unpacking a little
                plane…
              </>
            ) : modelStatus.state === "error" ? (
              "The plane model could not load. Flight details are still available."
            ) : modelStatus.state === "ready" ? (
              <>
                <span className="model-ready-dot" /> 3D plane ready
              </>
            ) : (
              "Last reported position"
            )}
          </div>
          <label>
            Plane style
            <select
              aria-label="3D plane style"
              value={modelStyle}
              onChange={(e) =>
                useStore.getState().setFilter("modelStyle", e.target.value)
              }
            >
              <option value="auto">Automatic cartoon</option>
              <option value="ss500">SS500 cartoon plane</option>
              <option value="prop">Cartoon prop plane</option>
            </select>
          </label>
          <small>Illustrative model · exact airframe unknown</small>
        </div>
      )}
      <div className="globe-instruction">
        <MousePointer2 size={13} />
        <span>
          {selected
            ? "Your flight, with a little extra personality."
            : "Spin the world. Pick a dot. Meet a plane."}
        </span>
      </div>
      <div className="globe-controls" aria-label="Globe controls">
        <button
          aria-label="Zoom in"
          onClick={() => sceneRef.current?.zoom(0.66)}
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => sceneRef.current?.zoom(1.2)}
        >
          −
        </button>
        <span />
        <button
          aria-label="Recenter globe"
          onClick={() => useStore.getState().recenter()}
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  );
}
