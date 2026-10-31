import crypto from "crypto";
import { Router, Request, Response } from "express";
import {
  countUsers,
  createUser,
  getUserByUsername,
  createSession,
  deleteSession,
} from "../db";
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "../auth";

export const authRouter = Router();

// Report system onboarding status and current authentication state.
authRouter.get("/status", (req: Request, res: Response) => {
  const setupRequired = countUsers() === 0;
  res.json({
    setupRequired,
    authenticated: !!req.user,
    user: req.user,
  });
});

// Handle first-time system onboarding to create the primary administrator.
authRouter.post("/setup", (req: Request, res: Response) => {
  if (countUsers() > 0) {
    res.status(403).json({ error: "System is already initialized." });
    return;
  }

  const { username, password } = req.body || {};
  const trimmed = typeof username === "string" ? username.trim() : "";

  if (!trimmed || trimmed.length < 3) {
    res
      .status(400)
      .json({ error: "Username must be at least 3 characters long." });
    return;
  }

  if (typeof password !== "string" || password.length < 6) {
    res
      .status(400)
      .json({ error: "Password must be at least 6 characters long." });
    return;
  }

  const { hash, salt } = hashPassword(password);
  const userId = crypto.randomUUID();

  const user = createUser({
    id: userId,
    username: trimmed,
    password_hash: hash,
    salt,
    role: "admin",
  });

  const token = generateSessionToken();
  createSession(token, user.id);
  setSessionCookie(res, token);

  res.json({ success: true, token, user });
});

// Authenticate existing users and issue an active session.
authRouter.post("/login", (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const token = generateSessionToken();
  createSession(token, user.id);
  setSessionCookie(res, token);

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
  });
});

// Terminate the active user session and purge the session cookie.
authRouter.post("/logout", (req: Request, res: Response) => {
  if (req.sessionToken) {
    deleteSession(req.sessionToken);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

authRouter.get("/me", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: req.user });
});
