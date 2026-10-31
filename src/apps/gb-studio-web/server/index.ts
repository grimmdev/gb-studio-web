import http from "http";
import Path from "path";
import fs from "fs-extra";
import os from "os";
import crypto from "node:crypto";
import express from "express";
import { apiRouter } from "./routes";
import { authMiddleware } from "./auth";
import { initWebSocketServer } from "./ws";
import { setOpenProject } from "./state";
import { startWatchingProject } from "./watcher";
import { projectTemplatesRoot } from "consts";
import createProject from "lib/project/createProject";
import { getAllProjects, saveProjectRecord } from "./db";
import pkg from "../../../../package.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.VERSION) g.VERSION = pkg.version;
if (!g.RELEASE_VERSION) g.RELEASE_VERSION = pkg.version;

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const WEB_DIST = fs.existsSync(Path.resolve(__dirname, "index.html"))
  ? __dirname
  : Path.resolve(__dirname, "../../../../out/web");

const initActiveProject = async () => {
  if (process.env.DEFAULT_PROJECT) {
    if (fs.existsSync(process.env.DEFAULT_PROJECT)) {
      console.log(`Setting default active project: ${process.env.DEFAULT_PROJECT}`);
      setOpenProject(process.env.DEFAULT_PROJECT);
      startWatchingProject(process.env.DEFAULT_PROJECT);
    }
    return;
  }
  const existingProjects = getAllProjects();
  const validProject = existingProjects.find((p) => {
    try {
      const resolved = Path.resolve(p.path);
      if (resolved.startsWith(Path.resolve(projectTemplatesRoot))) {
        return false;
      }
      return fs.existsSync(resolved);
    } catch {
      return false;
    }
  });

  if (validProject) {
    console.log(`Setting active project from database: ${validProject.path}`);
    setOpenProject(validProject.path);
    startWatchingProject(validProject.path);
  } else {
    try {
      const baseDir =
        process.env.PROJECTS_DIR || Path.join(os.homedir(), "GBStudioProjects");
      await fs.ensureDir(baseDir);
      const sampleDir = Path.join(baseDir, "GB HTML Sample");
      let projFile = Path.join(sampleDir, "project.gbsproj");
      if (!fs.existsSync(projFile)) {
        projFile = await createProject({
          name: "GB HTML Sample",
          template: "gbhtml",
          path: baseDir,
        });
      }
      saveProjectRecord({
        id: crypto.randomUUID(),
        user_id: "anonymous",
        name: "GB HTML Sample",
        path: projFile,
      });
      setOpenProject(projFile);
      startWatchingProject(projFile);
      console.log(`Initialized user sample project: ${projFile}`);
    } catch (e) {
      console.warn("Could not initialize default sample project:", e);
    }
  }
};
initActiveProject();

const app = express();

// CORS middleware
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// JSON body parsing with large limit for game project payloads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Attach session authentication middleware.
app.use(authMiddleware);

// Mount API routes under /api
app.use("/api", apiRouter);

// Serve static frontend assets from out/web
app.use(
  express.static(WEB_DIST, {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  }),
);

// SPA fallback to index.html or helpful status screen
app.get("*", async (_req, res) => {
  const indexPath = Path.join(WEB_DIST, "index.html");
  if (await fs.pathExists(indexPath)) {
    res.sendFile(indexPath);
    return;
  }

  res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>GB Studio Web Server</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #1a1a24; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { background: #262636; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 500px; }
      h1 { color: #58a6ff; margin-top: 0; }
      code { background: #111; padding: 0.2rem 0.4rem; border-radius: 4px; color: #7ee787; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>GB Studio Web API Server</h1>
      <p>Node.js & Express server is active on <code>http://${HOST}:${PORT}</code>.</p>
      <p>WebSocket hub is active on <code>ws://${HOST}:${PORT}/ws</code>.</p>
      <p>Active project: <code>${defaultProject}</code></p>
    </div>
  </body>
</html>`);
});

const server = http.createServer(app);
initWebSocketServer(server);

server.listen(PORT, HOST, () => {
  console.log(`GB Studio Web Server running at http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint ready at ws://${HOST}:${PORT}/ws`);
});

export { app, server };
