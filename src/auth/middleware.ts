import type { Request, Response, NextFunction } from "express";
import { appConfig, isDev } from "../config.js";
import { timingSafeEqual } from "node:crypto";

/**
 * Express middleware that validates the API key from the Authorization header.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth in development if explicitly configured
  if (isDev && appConfig.MCP_SKIP_AUTH) {
    next();
    return;
  }

  // Allow health check through without auth
  if (req.path === "/health") {
    next();
    return;
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    res.status(401).json({ error: "Invalid Authorization format. Expected: Bearer <token>" });
    return;
  }

  const providedKey = parts[1]!;
  const expectedKey = appConfig.MCP_API_KEY;

  if (!timingSafeCompare(providedKey, expectedKey)) {
    if (isDev) {
      console.warn("[Auth] Invalid API key attempt");
    }
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  next();
}

/**
 * Timing-safe string comparison that handles different-length strings
 * without leaking length information.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");

  // Pad to equal length to avoid leaking length info
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);

  // Both must be the original length AND content-equal
  return bufA.length === bufB.length && timingSafeEqual(paddedA, paddedB);
}
