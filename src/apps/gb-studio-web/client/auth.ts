import { eventBus } from "./api";

export interface CurrentUser {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at: number;
  updated_at: number;
}

const TOKEN_KEY = "gbs_token";
let activeUser: CurrentUser | null = null;

export const getStoredToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (_e) {
    return null;
  }
};

export const setStoredToken = (token: string | null): void => {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (_e) {
    // Ignore storage errors
  }
};

const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
};

// Retrieve the current in-memory authenticated user.
export const getCurrentUser = (): CurrentUser | null => {
  return activeUser;
};

// Update the current user context and notify UI listeners.
export const setCurrentUser = (user: CurrentUser | null): void => {
  activeUser = user;
  eventBus.emit("web:auth:changed", user);
};

// Query system onboarding status and restore existing sessions.
export const checkAuthStatus = async (): Promise<{
  setupRequired: boolean;
  authenticated: boolean;
  user?: CurrentUser;
}> => {
  try {
    const res = await fetch("/api/auth/status", {
      headers: getAuthHeaders(),
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`Failed to check auth status: ${res.statusText}`);
    }
    const data = await res.json();
    if (data.authenticated && data.user) {
      setCurrentUser(data.user);
    } else {
      setCurrentUser(null);
    }
    return data;
  } catch (err) {
    console.error("Auth status query failed:", err);
    return { setupRequired: false, authenticated: false };
  }
};

// Trigger administrator onboarding for uninitialized installations.
export const setupAdministrator = async (
  username: string,
  password: string,
): Promise<{ success: boolean; user?: CurrentUser; error?: string }> => {
  try {
    const res = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || "Setup failed" };
    }
    if (data.token) {
      setStoredToken(data.token);
    }
    setCurrentUser(data.user);
    return { success: true, user: data.user };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// Log in with username and password.
export const login = async (
  username: string,
  password: string,
): Promise<{ success: boolean; user?: CurrentUser; error?: string }> => {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || "Login failed" };
    }
    if (data.token) {
      setStoredToken(data.token);
    }
    setCurrentUser(data.user);
    return { success: true, user: data.user };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// Terminate the current session and reload project context.
export const logout = async (): Promise<void> => {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: "include",
    });
  } catch (e) {
    console.warn("Logout error:", e);
  }
  setStoredToken(null);
  setCurrentUser(null);
  window.location.reload();
};
