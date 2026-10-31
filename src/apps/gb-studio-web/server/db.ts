import { DatabaseSync } from "node:sqlite";
import Path from "path";
import fs from "fs-extra";
import os from "os";

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  role: "admin" | "user";
  created_at: number;
  updated_at: number;
}

export type SafeUser = Omit<UserRecord, "password_hash" | "salt">;

export interface SessionRecord {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

const getDatabasePath = () => {
  if (process.env.DB_PATH) {
    return Path.resolve(process.env.DB_PATH);
  }
  const baseDir =
    process.env.PROJECTS_DIR || Path.join(os.homedir(), "GBStudioProjects");
  return Path.join(baseDir, "gbstudio.sqlite");
};

// Initialize the SQLite database connection and run schema setup.
const dbPath = getDatabasePath();
fs.ensureDirSync(Path.dirname(dbPath));

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

export const closeDatabase = (): void => {
  db.close();
};

export const countUsers = (): number => {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
    count: number | bigint;
  };
  return Number(row?.count || 0);
};

export const getAllUsers = (): SafeUser[] => {
  const rows = db
    .prepare(
      "SELECT id, username, role, created_at, updated_at FROM users ORDER BY created_at ASC",
    )
    .all() as unknown as SafeUser[];
  return rows;
};

export const getUserById = (id: string): UserRecord | undefined => {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRecord
    | undefined;
};

export const getUserByUsername = (username: string): UserRecord | undefined => {
  return db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username.trim()) as UserRecord | undefined;
};

export const createUser = (
  user: Omit<UserRecord, "created_at" | "updated_at">,
): SafeUser => {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, salt, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    user.id,
    user.username.trim(),
    user.password_hash,
    user.salt,
    user.role,
    now,
    now,
  );
  return {
    id: user.id,
    username: user.username.trim(),
    role: user.role,
    created_at: now,
    updated_at: now,
  };
};

export const updateUserPassword = (
  id: string,
  password_hash: string,
  salt: string,
): void => {
  const now = Date.now();
  db.prepare(
    "UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?",
  ).run(password_hash, salt, now, id);
};

export const updateUserRole = (id: string, role: "admin" | "user"): void => {
  const now = Date.now();
  db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(
    role,
    now,
    id,
  );
};

export const deleteUser = (id: string): void => {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
};

export const createSession = (
  token: string,
  userId: string,
  durationMs: number = 30 * 24 * 60 * 60 * 1000,
): SessionRecord => {
  const now = Date.now();
  const expiresAt = now + durationMs;
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(token, userId, now, expiresAt);
  return {
    token,
    user_id: userId,
    created_at: now,
    expires_at: expiresAt,
  };
};

export const getSessionWithUser = (
  token: string,
): { session: SessionRecord; user: SafeUser } | null => {
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT s.token, s.user_id, s.created_at as session_created_at, s.expires_at,
              u.id, u.username, u.role, u.created_at, u.updated_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, now) as
    | {
      token: string;
      user_id: string;
      session_created_at: number;
      expires_at: number;
      id: string;
      username: string;
      role: "admin" | "user";
      created_at: number;
      updated_at: number;
    }
    | undefined;

  if (!row) return null;

  return {
    session: {
      token: row.token,
      user_id: row.user_id,
      created_at: row.session_created_at,
      expires_at: row.expires_at,
    },
    user: {
      id: row.id,
      username: row.username,
      role: row.role,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  };
};

export const deleteSession = (token: string): void => {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
};

export const cleanExpiredSessions = (): void => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
};

export const getSetting = (key: string): string | null => {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
};

export const setSetting = (key: string, value: string): void => {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
};

export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
}

export const getProjectById = (id: string): ProjectRecord | undefined => {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRecord
    | undefined;
};

export const getProjectByPath = (path: string): ProjectRecord | undefined => {
  const normalized = Path.resolve(path);
  return db
    .prepare("SELECT * FROM projects WHERE path = ? OR path = ?")
    .get(path, normalized) as ProjectRecord | undefined;
};

export const getProjectsByUserId = (userId: string): ProjectRecord[] => {
  return db
    .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as unknown as ProjectRecord[];
};

export const saveProjectRecord = (
  project: Omit<ProjectRecord, "created_at" | "updated_at"> & {
    created_at?: number;
    updated_at?: number;
  },
): ProjectRecord => {
  const resolvedPath = Path.resolve(project.path);
  const existing = getProjectByPath(resolvedPath) || getProjectById(project.id);
  const now = Date.now();
  if (existing) {
    db.prepare(
      "UPDATE projects SET name = ?, path = ?, updated_at = ? WHERE id = ?",
    ).run(project.name, resolvedPath, now, existing.id);
    return { ...existing, name: project.name, path: resolvedPath, updated_at: now };
  } else {
    const record: ProjectRecord = {
      id: project.id,
      user_id: project.user_id,
      name: project.name,
      path: resolvedPath,
      created_at: project.created_at || now,
      updated_at: project.updated_at || now,
    };
    db.prepare(
      "INSERT INTO projects (id, user_id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      record.id,
      record.user_id,
      record.name,
      record.path,
      record.created_at,
      record.updated_at,
    );
    return record;
  }
};

export const deleteProjectRecord = (id: string): void => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
};
