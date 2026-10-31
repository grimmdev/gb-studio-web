import crypto from "crypto";
import Path from "path";
import fs from "fs-extra";
import { Router, Request, Response } from "express";
import {
  getAllUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUserPassword,
  updateUserRole,
  deleteUser,
  getSetting,
  setSetting,
} from "../db";
import { requireAdmin, hashPassword } from "../auth";
import { clearUserState } from "../state";
import { stopWatchingUserProject } from "../watcher";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

// List registered users and their respective project totals.
adminRouter.get("/users", async (_req: Request, res: Response) => {
  try {
    const users = getAllUsers();
    const baseProjectsDir =
      process.env.PROJECTS_DIR || Path.join(process.cwd(), "GBStudioProjects");

    const enriched = await Promise.all(
      users.map(async (u) => {
        const userDir = Path.join(baseProjectsDir, "users", u.id);
        let projectCount = 0;
        if (await fs.pathExists(userDir)) {
          const entries = await fs.readdir(userDir);
          projectCount = entries.length;
        }
        return {
          ...u,
          projectCount,
        };
      }),
    );

    res.json({ users: enriched });
  } catch (err: unknown) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Allow administrators to provision new user accounts directly.
adminRouter.post("/users", (req: Request, res: Response) => {
  const { username, password, role } = req.body || {};
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

  const existing = getUserByUsername(trimmed);
  if (existing) {
    res.status(400).json({ error: "Username is already taken." });
    return;
  }

  const userRole = role === "admin" ? "admin" : "user";
  const { hash, salt } = hashPassword(password);
  const userId = crypto.randomUUID();

  const user = createUser({
    id: userId,
    username: trimmed,
    password_hash: hash,
    salt,
    role: userRole,
  });

  res.json({ success: true, user });
});

// Reset the password for a specified user account.
adminRouter.patch("/users/:id/password", (req: Request, res: Response) => {
  const { id } = req.params;
  const { password } = req.body || {};

  if (typeof password !== "string" || password.length < 6) {
    res
      .status(400)
      .json({ error: "Password must be at least 6 characters long." });
    return;
  }

  const user = getUserById(id);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  const { hash, salt } = hashPassword(password);
  updateUserPassword(id, hash, salt);

  res.json({ success: true });
});

// Update the role assignment for an existing user account.
adminRouter.patch("/users/:id/role", (req: Request, res: Response) => {
  const { id } = req.params;
  const { role } = req.body || {};

  if (role !== "admin" && role !== "user") {
    res.status(400).json({ error: "Invalid role specified." });
    return;
  }

  const user = getUserById(id);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  updateUserRole(id, role);
  res.json({ success: true });
});

// Remove a user account, tear down active watchers, and purge state.
adminRouter.delete("/users/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  if (req.user?.id === id) {
    res
      .status(400)
      .json({ error: "Administrators cannot delete their own account." });
    return;
  }

  const user = getUserById(id);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  stopWatchingUserProject(id);
  clearUserState(id);
  deleteUser(id);

  res.json({ success: true });
});

// Query system-level administrative settings.
adminRouter.get("/settings", (_req: Request, res: Response) => {
  const allowRegistration = getSetting("allow_registration") === "true";
  res.json({ allowRegistration });
});

// Persist system configuration updates.
adminRouter.post("/settings", (req: Request, res: Response) => {
  const { allowRegistration } = req.body || {};
  if (typeof allowRegistration === "boolean") {
    setSetting("allow_registration", allowRegistration ? "true" : "false");
  }
  res.json({ success: true });
});

