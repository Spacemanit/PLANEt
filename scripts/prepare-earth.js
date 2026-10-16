import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Strip unused atmosphere, clouds, and emissive textures. The source GLB and
// the surface's geometry/texture bytes are preserved without image resampling.
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "realistic_earth_8k.glb"),
  output = path.join(root, ".cache/earth.glb");
const sourceStat = await stat(source);
let current = false;
try {
  current = (await stat(output)).mtimeMs >= sourceStat.mtimeMs;
} catch {}
if (!current) {
  const bytes = await readFile(source);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2)
    throw new Error("Expected a GLB 2.0 Earth model.");
  const jsonSize = bytes.readUInt32LE(12),
    gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString("utf8")),
    binStart = 28 + jsonSize;
  const node = gltf.nodes.find(
    (n) => n.name?.startsWith("Surface") && n.mesh !== undefined,
  );
  if (!node) throw new Error("The source GLB has no Surface mesh.");
  const sourceMesh = gltf.meshes[node.mesh],
    sourceMaterial = gltf.materials[sourceMesh.primitives[0].material];
  const sourceTexture =
    gltf.textures[sourceMaterial.pbrMetallicRoughness.baseColorTexture.index];
  const sourceImage = gltf.images[sourceTexture.source];
  const accessorIds = [
    ...new Set(
      sourceMesh.primitives.flatMap((p) =>
        [...Object.values(p.attributes), p.indices].filter(
          (i) => i !== undefined,
        ),
      ),
    ),
  ];
  const viewIds = [
    ...new Set([
      ...accessorIds.map((i) => gltf.accessors[i].bufferView),
      sourceImage.bufferView,
    ]),
  ];
  const parts = [],
    views = [];
  let offset = 0;
  for (const id of viewIds) {
    const view = gltf.bufferViews[id],
      data = bytes.subarray(
        binStart + (view.byteOffset || 0),
        binStart + (view.byteOffset || 0) + view.byteLength,
      );
    views.push({ ...view, buffer: 0, byteOffset: offset });
    const pad = Buffer.alloc((4 - (data.length % 4)) % 4);
    parts.push(data, pad);
    offset += data.length + pad.length;
  }
  const optimized = {
    asset: gltf.asset,
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: node.name, mesh: 0 }],
    meshes: [
      {
        name: sourceMesh.name,
        primitives: sourceMesh.primitives.map((p) => ({
          attributes: Object.fromEntries(
            Object.entries(p.attributes).map(([k, v]) => [
              k,
              accessorIds.indexOf(v),
            ]),
          ),
          ...(p.indices === undefined
            ? {}
            : { indices: accessorIds.indexOf(p.indices) }),
          material: 0,
          mode: p.mode ?? 4,
        })),
      },
    ],
    accessors: accessorIds.map((i) => ({
      ...gltf.accessors[i],
      bufferView: viewIds.indexOf(gltf.accessors[i].bufferView),
    })),
    bufferViews: views,
    buffers: [{ byteLength: offset }],
    materials: [
      {
        name: "PLANEt surface",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    textures: [
      {
        source: 0,
        ...(sourceTexture.sampler !== undefined ? { sampler: 0 } : {}),
      },
    ],
    ...(sourceTexture.sampler !== undefined
      ? { samplers: [gltf.samplers[sourceTexture.sampler]] }
      : {}),
    images: [
      { ...sourceImage, bufferView: viewIds.indexOf(sourceImage.bufferView) },
    ],
  };
  const json = Buffer.from(JSON.stringify(optimized)),
    jsonPadding = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20),
    jsonChunk = Buffer.concat([json, jsonPadding]),
    bin = Buffer.concat(parts);
  const header = Buffer.alloc(20),
    binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonChunk.length + bin.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.concat([header, jsonChunk, binHeader, bin]));
  console.log(
    `Earth model ready: ${(sourceStat.size / 1e6).toFixed(1)} MB → ${((28 + jsonChunk.length + bin.length) / 1e6).toFixed(1)} MB. Original preserved.`,
  );
}
