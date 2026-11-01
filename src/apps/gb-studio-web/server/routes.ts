import { Router, Request, Response } from "express";
import Path from "path";
import fs from "fs-extra";
import os from "os";
import loadProjectData from "lib/project/loadProjectData";
import saveProjectData from "lib/project/saveProjectData";
import { loadProjectResourceChecksums } from "lib/project/loadResourceChecksums";
import createProject from "lib/project/createProject";
import buildProject from "lib/compiler/buildProject";
import { collectBuildUsage } from "lib/compiler/buildUsage";
import { readDebuggerSymbols } from "lib/debugger/readDebuggerSymbols";
import keyBy from "lodash/keyBy";
import pickBy from "lodash/pickBy";
import { getROMFilename, getROMFileStem } from "shared/lib/helpers/filePaths";
import { getBackgroundInfo, getSceneTilemapInfo } from "lib/helpers/validation";
import { compileSprite } from "lib/compiler/compileSprites";
import {
  assetsRoot,
  projectTemplatesRoot,
  localesRoot,
  musicTemplatesRoot,
  buildUUID,
} from "consts";
import getTmp from "lib/helpers/getTmp";
import { decompressProjectResources } from "shared/lib/resources/compression";
import { getGlobalPluginsPath } from "lib/pluginManager/globalPlugins";
import { assetFilename } from "shared/lib/helpers/assets";
import { guardAssetWithinProject } from "lib/helpers/assets";
import { loadUGESong, saveUGESong } from "shared/lib/uge/ugeHelper";
import { convertMODDataToUGESong } from "shared/lib/uge/mod2uge/import";
import { writeFileWithBackupAsync } from "lib/helpers/fs/writeFileWithBackup";
import { loadMusicData } from "lib/project/loadMusicData";
import { TemplateManager } from "lib/templates/templateManager";
import { getRequestProjectState, setUserOpenProject } from "./state";
import { startWatchingUserProject } from "./watcher";
import { emitToUser } from "./ws";
import { authRouter } from "./routes/authRoutes";
import { authMiddleware } from "./auth";
import {
  getProjectById,
  getProjectByPath,
  saveProjectRecord,
  ProjectRecord,
} from "./db";
import crypto from "node:crypto";
import { adminRouter } from "./routes/adminRoutes";

const templateManager = new TemplateManager();

export const apiRouter = Router();

// Resolve authenticated user sessions across all API endpoints.
apiRouter.use(authMiddleware);

apiRouter.use("/auth", authRouter);
apiRouter.use("/admin", adminRouter);

const sendFileSafe = async (res: Response, filePath: string) => {
  try {
    const resolvedPath = Path.resolve(filePath);
    if (!(await fs.pathExists(resolvedPath))) {
      res.status(404).send("Not Found");
      return;
    }
    const stat = await fs.stat(resolvedPath);
    let target = resolvedPath;
    if (stat.isDirectory()) {
      target = Path.join(resolvedPath, "index.html");
      if (!(await fs.pathExists(target))) {
        res.status(404).send("Not Found");
        return;
      }
    }
    res.sendFile(target);
  } catch (err) {
    console.error("Error sending file:", err);
    res.status(500).send("Internal Server Error");
  }
};

// --- Asset Serving ---
apiRouter.get("/assets/project/*", async (req: Request, res: Response) => {
  const relPath = req.params[0] || (req.params as any)["0"] || "";
  if (!getRequestProjectState(req).projectRoot) {
    res.status(400).send("No open project");
    return;
  }
  const fullPath = Path.join(getRequestProjectState(req).projectRoot, relPath);
  guardAssetWithinProject(fullPath, getRequestProjectState(req).projectRoot);
  await sendFileSafe(res, fullPath);
});

apiRouter.get("/assets/app/*", async (req: Request, res: Response) => {
  const relPath = req.params[0] || (req.params as any)["0"] || "";
  const fullPath = Path.join(assetsRoot, relPath);
  await sendFileSafe(res, fullPath);
});

apiRouter.get("/assets/plugins/*", async (req: Request, res: Response) => {
  const relPath = req.params[0] || (req.params as any)["0"] || "";
  const fullPath = Path.join(getGlobalPluginsPath(), relPath);
  await sendFileSafe(res, fullPath);
});

// --- Preview runner serving (compiled HTML5 game) ---
apiRouter.get("/preview/*", async (req: Request, res: Response) => {
  const relPath = req.params[0] || (req.params as any)["0"] || "";
  const tmpPath = await getTmp();
  const tmpBuildDir = Path.join(tmpPath, buildUUID, "build", "web");
  const fullPath = Path.join(tmpBuildDir, relPath);

  if (relPath === "index.html" || relPath === "") {
    try {
      const htmlFile =
        relPath === "" ? Path.join(tmpBuildDir, "index.html") : fullPath;
      if (await fs.pathExists(htmlFile)) {
        let content = await fs.readFile(htmlFile, "utf8");
        // Inject parent window API bridge so the emulator debugger works seamlessly in web.
        const bridgeScript = `
<script>
if (!window.API) {
  const parentAPI = (window.parent && window.parent.API) || (window.opener && window.opener.API);
  if (parentAPI) {
    window.API = {
      ...parentAPI,
      events: {
        ...parentAPI.events,
        debugger: {
          ...parentAPI.events.debugger,
          data: {
            subscribe: (listener) => parentAPI._subscribeGameDebugger(listener),
          },
        },
      },
    };
  }
}
</script>
`;
        content = content.replace("</head>", `${bridgeScript}</head>`);
        res.setHeader("Content-Type", "text/html");
        res.send(content);
        return;
      }
    } catch (e) {
      console.warn("Failed injecting bridge into preview index.html:", e);
    }
  }

  await sendFileSafe(res, fullPath);
});

// --- Project Endpoints ---
const getUserProjectsDir = (userId: string = "anonymous") => {
  const base =
    process.env.PROJECTS_DIR || Path.join(os.homedir(), "GBStudioProjects");
  if (userId === "anonymous") return base;
  return Path.join(base, "users", userId);
};

const isProjectPathAllowed = (
  userId: string,
  targetPath: string,
  role?: string,
): boolean => {
  const resolved = Path.resolve(targetPath);
  if (resolved.startsWith(Path.resolve(projectTemplatesRoot))) {
    return true;
  }
  const userDir = Path.resolve(getUserProjectsDir(userId));
  if (resolved.startsWith(userDir + Path.sep) || resolved === userDir) {
    return true;
  }
  if (role === "admin" || userId === "anonymous") {
    const base = Path.resolve(
      process.env.PROJECTS_DIR || Path.join(os.homedir(), "GBStudioProjects"),
    );
    return resolved.startsWith(base + Path.sep) || resolved === base;
  }
  return false;
};

export const TEMPLATE_PROJECTS: Record<
  string,
  { id: string; name: string; templateKey: string }
> = {
  "a0000000-0000-4000-8000-000000000001": {
    id: "a0000000-0000-4000-8000-000000000001",
    name: "Blank Project",
    templateKey: "blank",
  },
  "a0000000-0000-4000-8000-000000000002": {
    id: "a0000000-0000-4000-8000-000000000002",
    name: "GB HTML Sample",
    templateKey: "gbhtml",
  },
  "a0000000-0000-4000-8000-000000000003": {
    id: "a0000000-0000-4000-8000-000000000003",
    name: "GBS2 Sample",
    templateKey: "gbs2",
  },
};

const findTemplateByPath = (targetPath: string) => {
  const resolved = Path.resolve(targetPath);
  for (const tpl of Object.values(TEMPLATE_PROJECTS)) {
    const tplPath = Path.resolve(
      Path.join(projectTemplatesRoot, tpl.templateKey, "project.gbsproj"),
    );
    if (resolved === tplPath) {
      return tpl;
    }
  }
  return undefined;
};

export const cloneTemplateForUser = async (
  userId: string,
  templateKey: string,
  templateName: string,
): Promise<ProjectRecord> => {
  const userProjectsDir = getUserProjectsDir(userId);
  await fs.ensureDir(userProjectsDir);

  let projectName = templateName;
  let counter = 1;
  let targetFolder = Path.join(userProjectsDir, projectName);
  while (await fs.pathExists(targetFolder)) {
    counter++;
    projectName = `${templateName} ${counter}`;
    targetFolder = Path.join(userProjectsDir, projectName);
  }

  const projectPath = await createProject({
    name: projectName,
    template: templateKey,
    path: userProjectsDir,
  });

  const record = saveProjectRecord({
    id: crypto.randomUUID(),
    user_id: userId,
    name: projectName,
    path: projectPath,
  });

  return record;
};

apiRouter.get("/projects", async (req: Request, res: Response) => {
  const userId = req.user ? req.user.id : "anonymous";
  const userProjectsDir = getUserProjectsDir(userId);
  const templates = Object.values(TEMPLATE_PROJECTS).map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
  }));

  const userProjects: { id: string; name: string }[] = [];
  try {
    if (await fs.pathExists(userProjectsDir)) {
      const entries = await fs.readdir(userProjectsDir);
      for (const entry of entries) {
        const entryDir = Path.join(userProjectsDir, entry);
        const stat = await fs.stat(entryDir);
        if (stat.isDirectory()) {
          const files = await fs.readdir(entryDir);
          const projFile = files.find((f) => f.endsWith(".gbsproj"));
          if (projFile) {
            const fullProjPath = Path.join(entryDir, projFile);
            let record = getProjectByPath(fullProjPath);
            if (!record) {
              record = saveProjectRecord({
                id: crypto.randomUUID(),
                user_id: userId,
                name: entry,
                path: fullProjPath,
              });
            }
            userProjects.push({
              id: record.id,
              name: record.name,
            });
          }
        }
      }
    }

    if (req.user?.role === "admin") {
      const baseDir =
        process.env.PROJECTS_DIR || Path.join(os.homedir(), "GBStudioProjects");
      if (await fs.pathExists(baseDir)) {
        const rootEntries = await fs.readdir(baseDir);
        for (const entry of rootEntries) {
          if (entry === "users") continue;
          const entryDir = Path.join(baseDir, entry);
          const stat = await fs.stat(entryDir);
          if (stat.isDirectory()) {
            const files = await fs.readdir(entryDir);
            const projFile = files.find((f) => f.endsWith(".gbsproj"));
            if (projFile) {
              const fullProjPath = Path.join(entryDir, projFile);
              let record = getProjectByPath(fullProjPath);
              if (!record) {
                record = saveProjectRecord({
                  id: crypto.randomUUID(),
                  user_id: userId,
                  name: `${entry} (Legacy)`,
                  path: fullProjPath,
                });
              }
              if (!userProjects.some((p) => p.id === record.id)) {
                userProjects.push({
                  id: record.id,
                  name: record.name,
                });
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("Failed scanning user projects dir", e);
  }

  const currentPath = getRequestProjectState(req).projectPath;
  let currentProjectId: string | undefined = undefined;
  if (currentPath) {
    const templateMatch = findTemplateByPath(currentPath);
    if (templateMatch) {
      currentProjectId = templateMatch.id;
    } else {
      const record = getProjectByPath(currentPath);
      currentProjectId = record?.id;
    }
  }

  res.json({
    currentProjectId,
    templates,
    userProjects,
  });
});

apiRouter.post("/projects/open", async (req: Request, res: Response) => {
  const userId = req.user ? req.user.id : "anonymous";
  const { projectId, projectPath } = req.body || {};
  let targetPath = projectPath;
  let targetId = projectId;

  if (targetId) {
    if (TEMPLATE_PROJECTS[targetId]) {
      const tpl = TEMPLATE_PROJECTS[targetId];
      const record = await cloneTemplateForUser(
        userId,
        tpl.templateKey,
        tpl.name,
      );
      targetId = record.id;
      targetPath = record.path;
    } else {
      const record = getProjectById(targetId);
      if (record) {
        targetPath = record.path;
      }
    }
  } else if (targetPath) {
    const templateMatch = findTemplateByPath(targetPath);
    if (templateMatch) {
      const record = await cloneTemplateForUser(
        userId,
        templateMatch.templateKey,
        templateMatch.name,
      );
      targetId = record.id;
      targetPath = record.path;
    } else {
      let record = getProjectByPath(targetPath);
      if (!record) {
        record = saveProjectRecord({
          id: crypto.randomUUID(),
          user_id: userId,
          name: Path.basename(Path.dirname(targetPath)),
          path: targetPath,
        });
      }
      targetId = record.id;
    }
  }

  if (!targetPath || !(await fs.pathExists(targetPath))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!isProjectPathAllowed(userId, targetPath, req.user?.role)) {
    res.status(403).json({
      error: "Access denied: Project is outside your user workspace.",
    });
    return;
  }

  const state = setUserOpenProject(userId, targetPath);
  startWatchingUserProject(userId, targetPath);

  if (!targetId) {
    const record = getProjectByPath(targetPath);
    targetId = record?.id;
  }

  res.json({
    success: true,
    projectId: targetId,
  });
});

apiRouter.get("/projects/load", async (req: Request, res: Response) => {
  const userId = req.user ? req.user.id : "anonymous";
  const queryId = (req.query.project as string) || (req.query.id as string);
  const queryPath = req.query.path as string | undefined;

  let targetPath = queryPath;
  if (queryId) {
    if (TEMPLATE_PROJECTS[queryId]) {
      const tpl = TEMPLATE_PROJECTS[queryId];
      const record = await cloneTemplateForUser(
        userId,
        tpl.templateKey,
        tpl.name,
      );
      targetPath = record.path;
    } else {
      const record = getProjectById(queryId);
      if (record) {
        targetPath = record.path;
      }
    }
  }

  if (targetPath && (await fs.pathExists(targetPath))) {
    if (!isProjectPathAllowed(userId, targetPath, req.user?.role)) {
      res.status(403).json({
        error: "Access denied: Project is outside your user workspace.",
      });
      return;
    }
    setUserOpenProject(userId, targetPath);
    startWatchingUserProject(userId, targetPath);
  }

  const state = getRequestProjectState(req);
  if (!state.projectPath) {
    res.status(400).json({ error: "No open project" });
    return;
  }
  try {
    const data = await loadProjectData(state.projectPath);
    res.json(data);
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/create", async (req: Request, res: Response) => {
  const { name, template = "blank" } = req.body || {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Invalid project name" });
    return;
  }
  const userId = req.user ? req.user.id : "anonymous";
  const userProjectsDir = getUserProjectsDir(userId);
  await fs.ensureDir(userProjectsDir);

  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  const targetDir = Path.join(userProjectsDir, safeName);
  if (await fs.pathExists(targetDir)) {
    res.status(400).json({ error: "A project with this name already exists" });
    return;
  }

  const templateKey =
    template === "gbhtml" || template === "gbs2" ? template : "blank";

  try {
    const projectPath = await createProject({
      name: name.trim(),
      template: templateKey,
      path: userProjectsDir,
    });

    const newId = crypto.randomUUID();
    saveProjectRecord({
      id: newId,
      user_id: userId,
      name: name.trim(),
      path: projectPath,
    });

    setUserOpenProject(userId, projectPath);
    startWatchingUserProject(userId, projectPath);

    res.json({
      success: true,
      projectId: newId,
      name: name.trim(),
    });
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.get("/projects/checksums", async (req: Request, res: Response) => {
  const state = getRequestProjectState(req);
  if (!state.projectPath) {
    res.status(400).json({ error: "No open project" });
    return;
  }
  try {
    const checksums = await loadProjectResourceChecksums(state.projectPath);
    res.json(checksums);
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/save", async (req: Request, res: Response) => {
  const state = getRequestProjectState(req);
  const userId = req.user ? req.user.id : "anonymous";
  if (!state.projectPath) {
    res.status(400).json({ error: "No open project" });
    return;
  }
  const resolved = Path.resolve(state.projectPath);
  if (resolved.startsWith(Path.resolve(projectTemplatesRoot))) {
    res.status(403).json({
      error:
        "Cannot save changes to a read-only template in appData. Please clone or create a user project.",
    });
    return;
  }
  try {
    const patch = req.body;
    await saveProjectData(state.projectPath, patch, {
      progress: (completed, total) => {
        emitToUser(userId, "project:save-progress", completed, total);
      },
    });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error("Save project error:", err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/create", async (req: Request, res: Response) => {
  try {
    const userId = req.user ? req.user.id : "anonymous";
    const userDir = getUserProjectsDir(userId);
    const input = req.body || {};
    input.path = userDir;
    await fs.ensureDir(input.path);
    const projectPath = await createProject(input);
    setUserOpenProject(userId, projectPath);
    startWatchingUserProject(userId, projectPath);
    res.json({ success: true, projectPath });
  } catch (err: unknown) {
    console.error("Create project error:", err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/build", async (req: Request, res: Response) => {
  if (!getRequestProjectState(req).projectPath) {
    res.status(400).json({ error: "No open project" });
    return;
  }
  try {
    const { project: bodyProject, options } = req.body || {};
    const projectRoot = getRequestProjectState(req).projectRoot;
    const tmpPath = await getTmp();
    const outputRoot = Path.join(tmpPath, buildUUID);

    const userId = req.user ? req.user.id : "anonymous";
    const progress = (message: string) => {
      console.log("[Build Progress]", message);
      emitToUser(userId, "build:log", message);
    };
    const warnings = (message: string) => {
      console.warn("[Build Warning/Error]", message);
      emitToUser(userId, "build:error", message);
    };

    const colorOnly = bodyProject.settings?.colorMode === "color";
    const buildType = options?.buildType || "web";

    let project = bodyProject;
    if (
      Array.isArray(project.scenes) &&
      typeof project.scenes[0]?.collisions === "string"
    ) {
      project = decompressProjectResources(project);
    }

    const romFilename = getROMFilename(
      bodyProject.settings?.romFilename,
      bodyProject.metadata?.name,
      colorOnly,
      buildType,
    );
    const romStem = getROMFileStem(
      bodyProject.settings?.romFilename,
      bodyProject.metadata?.name,
    );

    const buildResult = await buildProject(project, {
      projectRoot,
      outputRoot,
      romFilename,
      tmpPath,
      buildType,
      engineSchema: options?.engineSchema,
      debugEnabled: options?.debugEnabled || false,
      make: true,
      progress,
      warnings,
    });

    if (buildResult.status === "failed") {
      if (buildResult.stage === "prepare") {
        res.json({
          status: "failed",
          stage: buildResult.stage,
          error: buildResult.error,
        });
        return;
      }
      try {
        const usage = await collectBuildUsage({
          manifest: buildResult.manifest,
          scriptMap: buildResult.compiledData?.scriptMap,
          mode: buildResult.stage === "make" ? "partial" : "complete",
          tmpPath,
          progress,
          warnings,
        });
        res.json({
          status: "failed",
          stage: buildResult.stage,
          error: buildResult.error,
          usage,
        });
      } catch {
        res.json(buildResult);
      }
      return;
    }

    // Calculate complete ROM usage statistics for the build.
    let usage: any = undefined;
    try {
      usage = await collectBuildUsage({
        manifest: buildResult.manifest,
        scriptMap: buildResult.compiledData.scriptMap,
        mode: "complete",
        tmpPath,
        progress,
        warnings,
      });
    } catch (err) {
      console.warn("Failed collecting build usage:", err);
    }

    // Extract symbols and variable mappings when debug mode is enabled.
    let debuggerSymbols: any = undefined;
    let debuggerInitData: any = undefined;

    if (options?.debugEnabled) {
      try {
        const { memoryMap, globalVariables } = await readDebuggerSymbols(
          outputRoot,
          romStem,
        );
        debuggerInitData = {
          memoryMap,
          globalVariables,
          pauseOnScriptChanged:
            bodyProject.settings?.debuggerPauseOnScriptChanged,
          pauseOnWatchedVariableChanged:
            bodyProject.settings?.debuggerPauseOnWatchedVariableChanged,
          breakpoints: (bodyProject.settings?.debuggerBreakpoints || []).map(
            (breakpoint: any) => breakpoint.scriptEventId,
          ),
          watchedVariables:
            bodyProject.settings?.debuggerWatchedVariables || [],
          variableMap: keyBy(
            Object.values(buildResult.compiledData.variableMap),
            "id",
          ),
        };
        const gbvmScripts = pickBy(buildResult.compiledData.files, (_, key) =>
          key.endsWith(".s"),
        );
        debuggerSymbols = {
          variableDataBySymbol: buildResult.compiledData.variableMap,
          sceneMap: buildResult.compiledData.sceneMap,
          gbvmScripts,
        };
      } catch (err) {
        console.warn("Failed reading debugger symbols:", err);
      }
    }

    res.json({
      status: "success",
      usage,
      debuggerSymbols,
      debuggerInitData,
    });
  } catch (err: unknown) {
    console.error("Build project error:", err);
    emitToUser(
      userId,
      "build:error",
      err instanceof Error ? err.message : String(err),
    );
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post(
  "/projects/background-info",
  async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const info = await getBackgroundInfo(
        body.background,
        body.tileset,
        body.is360,
        body.uiPalette,
        body.colorMode,
        body.colorCorrection,
        body.autoTileFlipEnabled,
        getRequestProjectState(req).projectRoot,
      );
      res.json(info);
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

apiRouter.post(
  "/projects/scene-tilemap-info",
  async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const info = await getSceneTilemapInfo(
        body.scene,
        body.tilesets,
        body.colorMode,
        body.autoTileFlipEnabled,
        getRequestProjectState(req).projectRoot,
      );
      res.json(info);
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

apiRouter.post(
  "/projects/sprite-compile",
  async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const projectRoot = getRequestProjectState(req).projectRoot;
      const filename = assetFilename(projectRoot, "sprites", body.spriteData);
      guardAssetWithinProject(filename, projectRoot);
      const result = await compileSprite(
        { ...body.spriteData, colorMode: "mixed" },
        false,
        projectRoot,
        body.defaultSpriteMode,
      );
      res.json(result);
    } catch (err: unknown) {
      console.error("Sprite compile error:", err);
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// --- Tracker Endpoints ---
apiRouter.post("/tracker/load", async (req: Request, res: Response) => {
  try {
    const { assetPath } = req.body || {};
    const projectRoot = getRequestProjectState(req).projectRoot;
    const filename = Path.join(projectRoot, assetPath);
    guardAssetWithinProject(filename, projectRoot);
    const data = await fs.readFile(filename);
    const song = loadUGESong(data);
    if (song) {
      song.filename = assetPath;
    }
    res.json(song);
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/tracker/save", async (req: Request, res: Response) => {
  try {
    const { song } = req.body || {};
    const projectRoot = getRequestProjectState(req).projectRoot;
    if (
      Path.resolve(projectRoot).startsWith(Path.resolve(projectTemplatesRoot))
    ) {
      res.status(403).json({
        error: "Cannot save music to a read-only template in appData.",
      });
      return;
    }
    const filename = Path.join(projectRoot, song.filename);
    guardAssetWithinProject(filename, projectRoot);
    const data = saveUGESong(song);
    await writeFileWithBackupAsync(filename, data);
    res.json({ success: true });
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/tracker/new", async (req: Request, res: Response) => {
  try {
    const { assetPath } = req.body || {};
    const projectRoot = getRequestProjectState(req).projectRoot;
    const filename = Path.join(projectRoot, assetPath);
    guardAssetWithinProject(filename, projectRoot);

    const templatePath = Path.join(musicTemplatesRoot, "template.uge");
    const copy2 = async (oPath: string, targetPath: string): Promise<any> => {
      const exists = await fs.pathExists(targetPath);
      if (!exists) {
        await fs.copy(oPath, targetPath, {
          overwrite: false,
          errorOnExist: true,
        });
        const data = await loadMusicData(projectRoot)(targetPath);
        return data;
      } else {
        const ext = ".uge";
        if (!targetPath.endsWith(ext)) {
          throw new Error(`Invalid filename ${targetPath}`);
        }
        const baseName = targetPath.slice(0, targetPath.length - ext.length);
        const matches = baseName.match(/\d+$/);
        let newBaseName = `${baseName} 1`;
        if (matches) {
          const number = parseInt(matches[0], 10) + 1;
          newBaseName = baseName.replace(/\d+$/, `${number}`);
        }
        const newPath = `${newBaseName}.uge`;
        return await copy2(oPath, newPath);
      }
    };
    const result = await copy2(templatePath, filename);
    res.json(result);
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/tracker/convert-mod", async (req: Request, res: Response) => {
  try {
    const { asset } = req.body || {};
    const projectRoot = getRequestProjectState(req).projectRoot;
    const filename = assetFilename(projectRoot, "music", asset);
    const newFilename = filename.replace(/\.[^/.]+$/, ".uge");
    guardAssetWithinProject(filename, projectRoot);

    const modData = await fs.readFile(filename);
    const song = convertMODDataToUGESong(
      modData,
      !asset.settings?.disableSpeedConversion,
    );
    const ugeData = saveUGESong(song);
    await writeFileWithBackupAsync(newFilename, ugeData);

    const resourceData = await loadMusicData(projectRoot)(newFilename);
    res.json(resourceData);
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.get("/templates", (_req: Request, res: Response) => {
  try {
    const templates = templateManager.getPluginTemplates();
    res.json(templates);
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.get("/l10n/:locale", async (req: Request, res: Response) => {
  const locale = req.params.locale || "en";
  const localePath = Path.join(localesRoot, `${locale}.json`);
  await sendFileSafe(res, localePath);
});
