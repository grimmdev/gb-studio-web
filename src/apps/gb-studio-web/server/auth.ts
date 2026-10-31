import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { getSessionWithUser, SafeUser } from "./db";

declare global {
  namespace Express {
    interface Request {
      user?: SafeUser;
      sessionToken?: string;
    }
  }
}

const SESSION_COOKIE_NAME = "gbs_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Hash passwords using scrypt with a unique per-user salt.
export const hashPassword = (password: string): { hash: string; salt: string } => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
};

// Verify credentials with constant-time comparison to prevent timing attacks.
export const verifyPassword = (
  password: string,
  storedHash: string,
  salt: string,
): boolean => {
  const hashBuffer = crypto.scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");
  if (hashBuffer.length !== storedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(hashBuffer, storedBuffer);
};

export const generateSessionToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

// Extract session token from cookies or the Authorization bearer header.
export const extractSessionToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
        return decodeURIComponent(cookie.slice(SESSION_COOKIE_NAME.length + 1));
      }
    }
  }

  return null;
};

export const setSessionCookie = (res: Response, token: string): void => {
  const isSecure = process.env.COOKIE_SECURE === "true";
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
};

export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
  });
};

// Resolve authenticated user sessions for inbound API requests.
export const authMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const token = extractSessionToken(req);
  if (token) {
    const sessionData = getSessionWithUser(token);
    if (sessionData) {
      req.user = sessionData.user;
      req.sessionToken = token;
    }
  }
  next();
};

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: Admin privileges required" });
    return;
  }
  next();
};

