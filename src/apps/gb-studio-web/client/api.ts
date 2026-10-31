import type RendererAPI from "renderer/lib/api/setup";
import type { ThemeInterface } from "ui/theme/ThemeInterface";
import darkTheme from "ui/theme/darkTheme";

type Listener = (...args: any[]) => void;

class EventEmitter {
  private listeners: Record<string, Set<Listener>> = {};

  on(channel: string, listener: Listener) {
    if (!this.listeners[channel]) {
      this.listeners[channel] = new Set();
    }
    this.listeners[channel].add(listener);
    return () => {
      this.listeners[channel]?.delete(listener);
    };
  }

  emit(channel: string, ...args: unknown[]) {
    const set = this.listeners[channel];
    if (set) {
      for (const listener of set) {
        try {
          listener(undefined, ...args);
        } catch (e) {
          console.error(`Error in event listener for ${channel}:`, e);
        }
      }
    }
  }
}

export const eventBus = new EventEmitter();

let latestDebuggerInitData: any = null;
const gameDebuggerListeners = new Set<(event: unknown, data: any) => void>();

// Dispatch packets directly to the active web player emulator.
const sendToGameDebugger = (packet: any) => {
  gameDebuggerListeners.forEach((listener) => {
    try {
      listener(undefined, packet);
    } catch (e) {
      console.error("Error delivering packet to game debugger:", e);
    }
  });
  sendWs("debugger:data", packet);
};

let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

export const connectWebSocket = () => {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let token: string | null = null;
  try {
    token = localStorage.getItem("gbs_token");
  } catch (_e) {
    // Ignore storage errors
  }
  const wsUrl = `${protocol}//${window.location.host}/ws${
    token ? `?token=${encodeURIComponent(token)}` : ""
  }`;

  socket = new WebSocket(wsUrl);

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.channel) {
        eventBus.emit(data.channel, ...(data.args || []));
      }
    } catch (e) {
      console.error("Failed to parse WebSocket message:", e);
    }
  };

  socket.onclose = () => {
    socket = null;
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 2000);
    }
  };

  socket.onerror = (err) => {
    console.warn("WebSocket connection error:", err);
  };
};

const sendWs = (channel: string, ...args: unknown[]) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ channel, args }));
  }
};

const createSubscribeAPI = <T extends (...args: any[]) => void>(
  channel: string,
) => {
  return {
    subscribe: (listener: T) => {
      return eventBus.on(channel, listener);
    },
    once: (listener: T) => {
      const unsubscribe = eventBus.on(channel, (...args: unknown[]) => {
        unsubscribe();
        listener(...args);
      });
    },
  };
};

const createWatchSubscribeAPI = <T>(channel: string) => {
  return {
    changed: createSubscribeAPI<
      (event: any, filename: string, data: T) => void
    >(`${channel}:changed`),
    renamed: createSubscribeAPI<
      (
        event: any,
        oldFilename: string,
        newFilename: string,
        plugin: string | undefined,
      ) => void
    >(`${channel}:renamed`),
    removed: createSubscribeAPI<
      (event: any, filename: string, plugin: string | undefined) => void
    >(`${channel}:removed`),
  };
};

// Clipboard memory buffer store
const clipboardBuffers = new Map<string, Buffer>();
let inMemoryClipboardText = "";

const downloadBytes = (filename: string, data: Uint8Array) => {
  const blob = new Blob([Uint8Array.from(data)], {
    type: "application/octet-stream",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const pickFileBytes = async (extension: string): Promise<Uint8Array | null> => {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extension;
    input.onchange = async () => {
      if (input.files && input.files[0]) {
        const buf = await input.files[0].arrayBuffer();
        resolve(new Uint8Array(buf));
      } else {
        resolve(null);
      }
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
};

// Web Music Session & Response Listeners
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let musicSessionPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const musicResponseListeners = new Set<(event: unknown, data: any) => void>();

const ensureMusicSession = async () => {
  if (!musicSessionPromise) {
    musicSessionPromise = import("components/music/helpers/musicSession").then(
      (module) => {
        const session = module.default();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session.subscribe((data: any) => {
          musicResponseListeners.forEach((listener) =>
            listener(undefined, data),
          );
        });
        return session;
      },
    );
  }
  return musicSessionPromise;
};

export const createWebRendererAPI = (): typeof RendererAPI => {
  connectWebSocket();

  return {
    platform: "web",
    env: "web",
    test: () => console.log("GB Studio Web API Active"),
    app: {
      openExternal: (url: string) => {
        window.open(url, "_blank");
        return Promise.resolve();
      },
      openHelp: (helpPage: string) => {
        window.open(`https://www.gbstudio.dev/docs/${helpPage}`, "_blank");
        return Promise.resolve();
      },
      openFolder: (_path: string) => {
        eventBus.emit("web:project-picker");
        return Promise.resolve();
      },
      openImageFile: (path: string) => {
        const url =
          path.startsWith("/") || path.startsWith("http")
            ? path
            : `/api/assets/project/${path}`;
        window.open(url, "_blank");
        return Promise.resolve();
      },
      openModFile: (_path: string) => Promise.resolve(),
      openFile: (_path: string) => Promise.resolve(),
      getIsFullScreen: () =>
        Promise.resolve(Boolean(document.fullscreenElement)),
      deleteBuildCache: () => Promise.resolve(),
      setZoomLevel: () => {},
      getPatrons: () =>
        Promise.resolve({
          patrons: [],
          silverPatrons: [],
          goldPatrons: [],
          platinumPatrons: [],
        } as any),
      showProjectWindow: () => Promise.resolve(),
    },
    l10n: {
      getL10NStrings: async () => {
        const res = await fetch("/api/l10n/en");
        return res.ok ? res.json() : {};
      },
    },
    theme: {
      getTheme: () => Promise.resolve(darkTheme),
      onChange: (callback: (theme: ThemeInterface) => void) => {
        return eventBus.on("update-theme", callback);
      },
    },
    templates: {
      getTemplatesList: async () => {
        const res = await fetch("/api/templates");
        return res.ok ? res.json() : [];
      },
    },
    paths: {
      getDocumentsPath: () => Promise.resolve("/"),
      getTmpPath: () => Promise.resolve("/tmp"),
    },
    settings: {
      get: (key: string) => {
        const val = localStorage.getItem(`gbs_${key}`);
        try {
          return Promise.resolve(val ? JSON.parse(val) : undefined);
        } catch {
          return Promise.resolve(val);
        }
      },
      getString: (key: string, fallback: string) => {
        const val = localStorage.getItem(`gbs_${key}`);
        return Promise.resolve(val ?? fallback);
      },
      getNumber: (key: string, fallback: number) => {
        const val = localStorage.getItem(`gbs_${key}`);
        if (!val) return Promise.resolve(fallback);
        const num = parseFloat(val);
        return Promise.resolve(isNaN(num) ? fallback : num);
      },
      set: (key: string, value: unknown) => {
        localStorage.setItem(`gbs_${key}`, JSON.stringify(value));
        return Promise.resolve();
      },
      delete: (key: string) => {
        localStorage.removeItem(`gbs_${key}`);
        return Promise.resolve();
      },
      app: {
        setUIScale: () => Promise.resolve(),
        getUIScale: () => Promise.resolve(0),
        setTrackerKeyBindings: () => Promise.resolve(),
        getTrackerKeyBindings: () => Promise.resolve(0),
      },
    },
    dialog: {
      chooseDirectory: () => Promise.resolve(undefined),
      chooseFile: () => Promise.resolve(undefined),
      showError: (title: string, content: string) => {
        alert(`${title}\n\n${content}`);
      },
      confirmEnableColorDialog: () => Promise.resolve(0),
      confirmDeleteCustomEvent: () => Promise.resolve(0),
      confirmReplaceCustomEvent: () => Promise.resolve(0),
      confirmDeletePrefab: () => Promise.resolve(0),
      confirmReplacePrefab: () => Promise.resolve(0),
      confirmUnpackPrefab: () => Promise.resolve(0),
      confirmDeletePreset: () => Promise.resolve(0),
      confirmApplyPreset: () => Promise.resolve(0),
      confirmDeleteConstant: () => Promise.resolve(0),
      confirmDeleteVariable: () => Promise.resolve(0),
      confirmUnsavedChangesTrackerDialog: () => Promise.resolve(0),
      migrateWarning: () => Promise.resolve(true as any),
    },
    project: {
      getRecentProjects: async () => {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = await res.json();
          return data.templates.map((t: any) => ({
            name: t.name,
            path: t.path,
            dir: t.path,
          }));
        }
        return [];
      },
      removeRecentProject: () => {},
      clearRecentProjects: () => {},
      openProjectPicker: () => {
        eventBus.emit("web:project-picker");
      },
      openProject: async (projectPath: string) => {
        const res = await fetch("/api/projects/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath }),
        });
        return res.ok;
      },
      getResourceChecksums: async () => {
        const res = await fetch("/api/projects/checksums");
        return res.ok ? res.json() : {};
      },
      createProject: async (input: any) => {
        const res = await fetch("/api/projects/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        return res.ok ? res.json() : null;
      },
      updateProjectWindowMenu: () => {},
      close: () => {},
      build: async (data: any, options: any) => {
        const res = await fetch("/api/projects/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: data, options }),
        });
        const result = await res.json();
        if (result.debuggerInitData) {
          latestDebuggerInitData = result.debuggerInitData;
        }
        // If web build succeeded, emit open-play modal event
        if (result.status === "success" && options.buildType === "web") {
          eventBus.emit("web:play", {
            url: "/api/preview/index.html",
            debug: Boolean(options.debugEnabled),
          });
        }
        return result;
      },
      buildCancel: async () => {
        await fetch("/api/projects/build-cancel", { method: "POST" });
      },
      onBuildLog: (listener: any) => {
        return eventBus.on("build:log", listener);
      },
      onBuildError: (listener: any) => {
        return eventBus.on("build:error", listener);
      },
      ejectEngine: () => Promise.resolve(),
      exportProject: async () => {},
      getBackgroundInfo: async (...args: any[]) => {
        const res = await fetch("/api/projects/background-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            background: args[0],
            tileset: args[1],
            is360: args[2],
            uiPalette: args[3],
            colorMode: args[4],
            colorCorrection: args[5],
            autoTileFlipEnabled: args[6],
          }),
        });
        return res.ok ? res.json() : null;
      },
      getSceneTilemapInfo: async (...args: any[]) => {
        const res = await fetch("/api/projects/scene-tilemap-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scene: args[0],
            tilesets: args[1],
            colorMode: args[2],
            autoTileFlipEnabled: args[3],
          }),
        });
        return res.ok ? res.json() : null;
      },
      extractBackgroundMonoTiles: async (...args: any[]) => {
        const res = await fetch("/api/projects/background-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            background: args[0],
            uiPalette: args[1],
            colorCorrection: args[2],
          }),
        });
        return res.ok ? res.json() : null;
      },
      addFile: async () => {},
      loadProject: async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const queryId = urlParams.get("project") || urlParams.get("id");
        const queryPath = urlParams.get("path");
        let url = "/api/projects/load";
        if (queryId) {
          url += `?project=${encodeURIComponent(queryId)}`;
        } else if (queryPath) {
          url += `?path=${encodeURIComponent(queryPath)}`;
        }
        const res = await fetch(url);
        return res.ok ? res.json() : null;
      },
      saveProject: async (data: any) => {
        await fetch("/api/projects/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      },
      setModified: async () => {},
      setUnmodified: async () => {},
      renameAsset: async () => true,
      removeAsset: async () => true,
      getWebTemplates: async () => [],
      ejectWebTemplate: async () => undefined,
    },
    script: {
      getScriptAutoLabel: () => Promise.resolve(""),
      scriptEventPostUpdateFn: (_cmd: any, _fieldKey: any, args: any) =>
        Promise.resolve(args),
      scriptEventUpdateFn: (_cmd: any, _fieldKey: any, value: any) =>
        Promise.resolve(value),
    },
    dataTable: {
      exportCSV: async () => {},
      importCSV: async () => undefined,
    },
    music: {
      openMusic: async () => {
        const session = await ensureMusicSession();
        session.open();
      },
      closeMusic: async () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendToMusicWindow: (data: any) => {
        void ensureMusicSession().then((session) => {
          session.send(data);
        });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendToProjectWindow: (data: any) => {
        musicResponseListeners.forEach((listener) => listener(undefined, data));
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMidiInputMenuState: (state: any) =>
        sendWs("music:midi-menu-state", state),
      playUGE: async () => {},
      playMOD: async () => {},
    },
    soundfx: {
      playWav: async () => {},
      playVGM: async () => {},
      playFXHammer: async () => {},
    },
    tracker: {
      addNewUGEFile: async (assetPath: string) => {
        const res = await fetch("/api/tracker/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetPath }),
        });
        return res.ok ? res.json() : null;
      },
      loadUGEFile: async (assetPath: string) => {
        const res = await fetch("/api/tracker/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetPath }),
        });
        if (!res.ok) {
          throw new Error(`Failed to load song: ${res.statusText}`);
        }
        return res.json();
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      saveUGEFile: async (song: any) => {
        const res = await fetch("/api/tracker/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ song }),
        });
        if (!res.ok) {
          throw new Error(`Failed to save song: ${res.statusText}`);
        }
        return res.json();
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      convertModToUge: async (asset: any) => {
        const res = await fetch("/api/tracker/convert-mod", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset }),
        });
        return res.ok ? res.json() : null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportInstrument: async (instrument: any) => {
        const { saveUGIInstrument } = await import("shared/lib/uge/ugiHelper");
        const data = saveUGIInstrument(instrument);
        const safeName =
          instrument.name?.replace(/[^a-zA-Z0-9_-]/g, "_") || "instrument";
        downloadBytes(`${safeName}.ugi`, new Uint8Array(data));
      },
      importInstrument: async () => {
        const { loadUGIInstrument } = await import("shared/lib/uge/ugiHelper");
        const bytes = await pickFileBytes(".ugi");
        if (!bytes) return null;
        return loadUGIInstrument(Buffer.from(bytes));
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportWave: async (wave: any, suggestedName: string) => {
        const { saveUGWave } = await import("shared/lib/uge/ugwHelper");
        const data = saveUGWave(wave);
        downloadBytes(`${suggestedName || "wave"}.ugw`, new Uint8Array(data));
      },
      importWave: async () => {
        const { loadUGWave } = await import("shared/lib/uge/ugwHelper");
        const bytes = await pickFileBytes(".ugw");
        if (!bytes) return null;
        return loadUGWave(Buffer.from(bytes));
      },
    },
    sprite: {
      compileSprite: async (spriteData: any, defaultSpriteMode: any) => {
        const res = await fetch("/api/projects/sprite-compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spriteData, defaultSpriteMode }),
        });
        return res.ok ? res.json() : null;
      },
    },
    clipboard: {
      readText: async () => {
        if (navigator?.clipboard?.readText) {
          try {
            return await navigator.clipboard.readText();
          } catch {
            return inMemoryClipboardText;
          }
        }
        return inMemoryClipboardText;
      },
      readBuffer: async (format: string) => {
        return clipboardBuffers.get(format) || Buffer.alloc(0);
      },
      writeText: async (value: string) => {
        inMemoryClipboardText = value;
        if (navigator?.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            // Ignore permission error
          }
        }
      },
      writeBuffer: async (format: string, buffer: Buffer) => {
        clipboardBuffers.set(format, buffer);
      },
    },
    _subscribeGameDebugger: (listener: (event: unknown, data: any) => void) => {
      gameDebuggerListeners.add(listener);
      return () => {
        gameDebuggerListeners.delete(listener);
      };
    },
    debugger: {
      pause: async () => {
        sendToGameDebugger({ action: "pause" });
      },
      resume: async () => {
        sendToGameDebugger({ action: "resume" });
      },
      setPauseOnScriptChanged: async (enabled: any) => {
        sendToGameDebugger({ action: "pause-on-script", data: enabled });
      },
      setPauseOnWatchVariableChanged: async (enabled: any) => {
        sendToGameDebugger({ action: "pause-on-var", data: enabled });
      },
      setGlobal: async (symbol: any, value: any, index: any) => {
        sendToGameDebugger({
          action: "set-global",
          data: { symbol, value, index },
        });
      },
      step: async () => {
        sendToGameDebugger({ action: "step" });
      },
      stepFrame: async () => {
        sendToGameDebugger({ action: "step-frame" });
      },
      setBreakpoints: async (breakpoints: any) => {
        sendToGameDebugger({ action: "set-breakpoints", data: breakpoints });
      },
      setWatchedVariableIds: async (ids: any) => {
        sendToGameDebugger({ action: "set-watched", data: ids });
      },
      setBackgroundPreviewType: async (type: any) => {
        sendToGameDebugger({
          action: "set-background-preview-type",
          data: type,
        });
      },
      sendToProjectWindow: async (data: any) => {
        if (data?.action === "initialized" && latestDebuggerInitData) {
          sendToGameDebugger({
            action: "listener-ready",
            data: latestDebuggerInitData,
          });
        }
        eventBus.emit("debugger:data", data);
        sendWs("debugger:data-receive", data);
      },
    },
    pluginManager: {
      getPluginsList: async () => [],
      getPluginRepos: async () => [],
      addPluginRepo: async () => {},
      removePluginRepo: async () => {},
      addPlugin: async () => {},
      removePlugin: async () => {},
      getInstalledPlugins: async () => [],
    },
    events: {
      menu: {
        saveProject: createSubscribeAPI("menu:save-project"),
        saveProjectAs: createSubscribeAPI("menu:save-project-as"),
        onSaveAndCloseProject: createSubscribeAPI(
          "menu:save-project-and-close",
        ),
        undo: createSubscribeAPI("menu:undo"),
        redo: createSubscribeAPI("menu:redo"),
        pasteInPlace: createSubscribeAPI("menu:paste-in-place"),
        selectAll: {
          subscribe: (listener: () => void) => {
            return eventBus.on("menu:select-all", listener);
          },
        },
        midiInputToggle: createSubscribeAPI("menu:midi-input-toggle"),
        midiInputSelect: createSubscribeAPI("menu:midi-input-select"),
        setSection: createSubscribeAPI("menu:section"),
        reloadAssets: createSubscribeAPI("menu:reload-assets"),
        zoom: createSubscribeAPI("menu:zoom"),
        run: createSubscribeAPI("menu:run"),
        build: createSubscribeAPI("menu:build"),
        ejectEngine: createSubscribeAPI("menu:eject-engine"),
        ejectWebTemplate: createSubscribeAPI("menu:eject-web-template"),
        exportProject: createSubscribeAPI("menu:export-project"),
        pluginRun: createSubscribeAPI("menu:plugin-run"),
      },
      app: {
        isFullScreenChanged: createSubscribeAPI("app:is-full-screen:changed"),
      },
      music: {
        data: createSubscribeAPI("music:data"),
        response: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          subscribe: (listener: any) => {
            musicResponseListeners.add(listener);
            return () => {
              musicResponseListeners.delete(listener);
            };
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          once: (listener: any) => {
            const wrapped = (...args: any[]) => {
              musicResponseListeners.delete(wrapped);
              listener(...args);
            };
            musicResponseListeners.add(wrapped);
          },
        },
      },
      debugger: {
        data: createSubscribeAPI("debugger:data"),
        disconnected: createSubscribeAPI("debugger:disconnected"),
      },
      project: {
        saveProgress: createSubscribeAPI("project:save-progress"),
      },
      settings: {
        uiScaleChanged: createSubscribeAPI("setting:ui-scale:changed"),
        trackerKeyBindingsChanged: createSubscribeAPI(
          "setting:tracker-keybindings:changed",
        ),
        settingChanged: createSubscribeAPI("setting:changed"),
      },
      templates: {
        templatesListChanged: createSubscribeAPI("templates:list:changed"),
      },
      watch: {
        sprite: createWatchSubscribeAPI("watch:sprite"),
        background: createWatchSubscribeAPI("watch:background"),
        music: createWatchSubscribeAPI("watch:music"),
        sound: createWatchSubscribeAPI("watch:sound"),
        font: createWatchSubscribeAPI("watch:font"),
        avatar: createWatchSubscribeAPI("watch:avatar"),
        emote: createWatchSubscribeAPI("watch:emote"),
        tileset: createWatchSubscribeAPI("watch:tileset"),
        ui: createWatchSubscribeAPI("watch:ui"),
        webTemplates: {
          changed: createSubscribeAPI("watch:webTemplates:changed"),
        },
        engineSchema: {
          changed: createSubscribeAPI("watch:engineSchema:changed"),
        },
        scriptEventDefs: {
          changed: createSubscribeAPI("watch:scriptEventDefs:changed"),
        },
      },
    },
  } as unknown as typeof RendererAPI;
};

export const installWebRendererApi = () => {
  const api = createWebRendererAPI();
  (window as any).API = api;
  return api;
};
