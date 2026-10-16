import express from "express";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createOpenSky } from "./opensky.js";
import { createAircraftHandler } from "./handler.js";

const root = fileURLToPath(new URL("../", import.meta.url));
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  /* Host environment or credentials.json can be used instead. */
}
const production =
  process.argv.includes("--production") ||
  process.env.NODE_ENV === "production";
let credentials = {};
try {
  credentials = JSON.parse(
    await readFile(path.join(root, "credentials.json"), "utf8"),
  );
} catch {
  /* Anonymous access is supported. */
}
if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET)
  credentials = {
    clientId: process.env.OPENSKY_CLIENT_ID,
    clientSecret: process.env.OPENSKY_CLIENT_SECRET,
  };
let initialCache = [];
try {
  initialCache = JSON.parse(
    await readFile(path.join(root, ".cache/opensky.json"), "utf8"),
  );
} catch {
  /* First run. */
}
const opensky = createOpenSky({
  credentials,
  initialCache,
  onCache: async (entries) => {
    await mkdir(path.join(root, ".cache"), { recursive: true });
    await writeFile(
      path.join(root, ".cache/opensky.json"),
      JSON.stringify(entries),
    );
  },
});

const app = express();
app.disable("x-powered-by");
app.set("env", production ? "production" : "development");
app.use((req, res, next) => {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(req.path);
  } catch {
    return res.sendStatus(400);
  }
  if (
    /credentials\.json|\/server\/|\/\.cache\/|\/\.env(?:\.|\/|$)/i.test(
      requestedPath,
    )
  )
    return res.sendStatus(404);
  next();
});
app.get("/api/health", (_, res) => res.json({ ok: true }));
app.all("/api/aircraft", createAircraftHandler(opensky));
app.use(
  "/assets",
  express.static(path.join(root, production ? "dist/assets" : "public/assets")),
);
if (production) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`PLANEt is ready at http://${host}:${port}`),
);
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is in use. Set PORT to another port.`
      : "Unable to start PLANEt.",
  );
  process.exit(1);
});
