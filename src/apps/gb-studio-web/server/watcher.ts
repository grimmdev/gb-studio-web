import Path from "path";
import watchProject from "lib/project/watchProject";
import { loadSpriteData } from "lib/project/loadSpriteData";
import { loadBackgroundData } from "lib/project/loadBackgroundData";
import { loadMusicData } from "lib/project/loadMusicData";
import { loadSoundData } from "lib/project/loadSoundData";
import { loadFontData } from "lib/project/loadFontData";
import { loadAvatarData } from "lib/project/loadAvatarData";
import { loadEmoteData } from "lib/project/loadEmoteData";
import { loadTilesetData } from "lib/project/loadTilesetData";
import { loadEngineSchema } from "lib/project/loadEngineSchema";
import loadAllScriptEventHandlers from "lib/project/loadScriptEventHandlers";
import { cloneDictionary } from "lib/helpers/clone";
import { listProjectWebTemplates } from "lib/compiler/webBuild";
import parseAssetPath from "shared/lib/assets/parseAssetPath";
import { emitToUser } from "./ws";

const userWatchers = new Map<string, () => void>();

// Stop active project file watchers for a user.
export const stopWatchingUserProject = (userId: string): void => {
  const existing = userWatchers.get(userId);
  if (existing) {
    try {
      existing();
    } catch (e) {
      console.error(`Error stopping watcher for user ${userId}:`, e);
    }
    userWatchers.delete(userId);
  }
};

// Initiate isolated filesystem watching scoped to a user and project.
export const startWatchingUserProject = (
  userId: string,
  projectPath: string,
) => {
  stopWatchingUserProject(userId);

  const projectRoot = Path.dirname(projectPath);

  const closeWatcher = watchProject(projectPath, {
    onChangedSprite: async (filename: string) => {
      const data = await loadSpriteData(projectRoot)(filename);
      if (data) {
        emitToUser(userId, "watch:sprite:changed", filename, data);
      }
    },
    onChangedBackground: async (filename: string) => {
      const data = await loadBackgroundData(projectRoot)(filename);
      if (data) {
        emitToUser(userId, "watch:background:changed", filename, data);
      }
    },
    onChangedUI: (filename: string) => {
      emitToUser(userId, "watch:ui:changed", { filename });
    },
    onChangedMusic: async (filename: string) => {
      const data = await loadMusicData(projectRoot)(filename);
      if (data) {
        emitToUser(userId, "watch:music:changed", filename, data);
      }
    },
    onChangedSound: async (filename: string) => {
      const data = await loadSoundData(projectRoot)(filename);
      if (data) {
        emitToUser(userId, "watch:sound:changed", filename, data);
      }
    },
    onChangedFont: async (filename: string) => {
      const data = await loadFontData(projectRoot)(filename);
      if (data) {
        emitToUser(userId, "watch:font:changed", filename, data);
      }
    },
    onChangedAvatar: async (filename: string) => {
      const data = await loadAvatarData(projectRoot)(filename);
      if (data) {
        emitToUser(userId, "watch:avatar:changed", filename, data);
      }
    },
    onChangedEmote: async (filename: string) => {
      const data = await loadEmoteData(projectRoot)(filename);
      if (data) {
        emitToUser(userId, "watch:emote:changed", filename, data);
      }
    },
    onChangedTileset: async (filename: string) => {
      const data = await loadTilesetData(projectRoot)(filename);
      if (data) {
        emitToUser(userId, "watch:tileset:changed", filename, data);
      }
    },
    onRemoveSprite: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "sprites");
      emitToUser(userId, "watch:sprite:removed", file, plugin);
    },
    onRemoveBackground: async (filename: string) => {
      const { file, plugin } = parseAssetPath(
        filename,
        projectRoot,
        "backgrounds",
      );
      emitToUser(userId, "watch:background:removed", file, plugin);
    },
    onRemoveUI: async (filename: string) => {
      emitToUser(userId, "watch:ui:removed", filename);
    },
    onRemoveMusic: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "music");
      emitToUser(userId, "watch:music:removed", file, plugin);
    },
    onRemoveSound: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "sounds");
      emitToUser(userId, "watch:sound:removed", file, plugin);
    },
    onRemoveFont: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "fonts");
      emitToUser(userId, "watch:font:removed", file, plugin);
    },
    onRemoveAvatar: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "avatars");
      emitToUser(userId, "watch:avatar:removed", file, plugin);
    },
    onRemoveEmote: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "emotes");
      emitToUser(userId, "watch:emote:removed", file, plugin);
    },
    onRemoveTileset: async (filename: string) => {
      const { file, plugin } = parseAssetPath(
        filename,
        projectRoot,
        "tilesets",
      );
      emitToUser(userId, "watch:tileset:removed", file, plugin);
    },
    onChangedEngineSchema: async (_filename: string) => {
      const engineSchema = await loadEngineSchema(projectRoot);
      emitToUser(userId, "watch:engineSchema:changed", engineSchema);
    },
    onChangedEventPlugin: async (_filename: string) => {
      const scriptEventHandlers = await loadAllScriptEventHandlers(projectRoot);
      emitToUser(
        userId,
        "watch:scriptEventDefs:changed",
        cloneDictionary(scriptEventHandlers),
      );
    },
    onChangedWebTemplates: async () => {
      const templates = await listProjectWebTemplates(projectRoot);
      emitToUser(userId, "watch:webTemplates:changed", templates);
    },
  });

  userWatchers.set(userId, closeWatcher);
  return closeWatcher;
};

// Legacy fallback helper.
export const startWatchingProject = (projectPath: string) => {
  return startWatchingUserProject("anonymous", projectPath);
};
