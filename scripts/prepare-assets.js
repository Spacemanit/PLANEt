import "./prepare-earth.js";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "public/assets");
await mkdir(output, { recursive: true });
await copyFile(
  path.join(root, ".cache/earth.glb"),
  path.join(output, "earth.glb"),
);
await copyFile(
  path.join(root, "cartoon_plane.glb"),
  path.join(output, "plane-prop.glb"),
);

// Convert the SS500's retired specular/glossiness extension into standard PBR
// before GLTFLoader reads it. Geometry, texture bytes, and attribution stay intact.
const bytes = await readFile(path.join(root, "ss500_cartoon_plane.glb"));
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
for (const material of gltf.materials || []) {
  const old = material.extensions?.KHR_materials_pbrSpecularGlossiness;
  if (!old) continue;
  material.pbrMetallicRoughness = {
    baseColorFactor: old.diffuseFactor || [1, 1, 1, 1],
    ...(old.diffuseTexture ? { baseColorTexture: old.diffuseTexture } : {}),
    metallicFactor: 0,
    roughnessFactor: Math.max(0.4, 1 - (old.glossinessFactor ?? 1)),
  };
  delete material.extensions.KHR_materials_pbrSpecularGlossiness;
}
for (const key of ["extensionsRequired", "extensionsUsed"])
  if (gltf[key]) {
    gltf[key] = gltf[key].filter(
      (name) => name !== "KHR_materials_pbrSpecularGlossiness",
    );
    if (!gltf[key].length) delete gltf[key];
  }
const json = Buffer.from(JSON.stringify(gltf));
const jsonChunk = Buffer.concat([
  json,
  Buffer.alloc((4 - (json.length % 4)) % 4, 0x20),
]);
const remainingChunks = bytes.subarray(20 + jsonLength);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + jsonChunk.length + remainingChunks.length, 8);
header.writeUInt32LE(jsonChunk.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
await writeFile(
  path.join(output, "plane-ss500.glb"),
  Buffer.concat([header, jsonChunk, remainingChunks]),
);
console.log("Earth and both plane models are ready as static assets.");
