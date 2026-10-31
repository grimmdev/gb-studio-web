import Path from "path";
import { Request } from "express";

export interface UserState {
  userId: string;
  projectPath: string;
  projectRoot: string;
  cancelBuild: (() => void) | null;
}

const userStates = new Map<string, UserState>();

// Resolve or initialize user-isolated project state.
export const getUserState = (userId: string): UserState => {
  let state = userStates.get(userId);
  if (!state) {
    state = {
      userId,
      projectPath: "",
      projectRoot: "",
      cancelBuild: null,
    };
    userStates.set(userId, state);
  }
  return state;
};

export const setUserOpenProject = (
  userId: string,
  projectPath: string,
): UserState => {
  const state = getUserState(userId);
  state.projectPath = Path.resolve(projectPath);
  state.projectRoot = Path.dirname(state.projectPath);
  return state;
};

export const getUserProjectPath = (userId: string): string => {
  return getUserState(userId).projectPath;
};

export const getUserProjectRoot = (userId: string): string => {
  return getUserState(userId).projectRoot;
};

export const setUserCancelBuild = (
  userId: string,
  cancelBuild: (() => void) | null,
): void => {
  const state = getUserState(userId);
  state.cancelBuild = cancelBuild;
};

export const clearUserState = (userId: string): void => {
  userStates.delete(userId);
};

// Determine project state from the incoming request context.
export const getRequestProjectState = (req: Request): UserState => {
  const userId = req.user ? req.user.id : "anonymous";
  return getUserState(userId);
};

// Legacy compatibility shim for un-migrated call sites.
export const serverState = new Proxy(
  {} as {
    projectPath: string;
    projectRoot: string;
    cancelBuild: (() => void) | null;
  },
  {
    get(_target, prop) {
      const defaultState = getUserState("anonymous");
      return (defaultState as any)[prop];
    },
    set(_target, prop, value) {
      const defaultState = getUserState("anonymous");
      (defaultState as any)[prop] = value;
      return true;
    },
  },
);

export const setOpenProject = (projectPath: string) => {
  setUserOpenProject("anonymous", projectPath);
};

export const getOpenProjectRoot = (): string => {
  return getUserProjectRoot("anonymous");
};

export const getOpenProjectPath = (): string => {
  return getUserProjectPath("anonymous");
};
