import type { NextFunction, Request, Response } from "express";
import { backendConfig } from "../config.js";

type Bucket = {
  resetAt: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

export function rateLimitMiddleware(request: Request, response: Response, next: NextFunction) {
  const now = Date.now();
  const key = `${request.ip}:${request.path}`;
  const current = buckets.get(key);

  if (!current || now >= current.resetAt) {
    buckets.set(key, {
      resetAt: now + backendConfig.rateLimitWindowMs,
      count: 1,
    });
    return next();
  }

  if (current.count >= backendConfig.rateLimitMaxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    response.setHeader("Retry-After", String(retryAfterSeconds));
    return response.status(429).json({
      ok: false,
      error: "Too many requests.",
      retryAfterSeconds,
    });
  }

  current.count += 1;
  buckets.set(key, current);
  return next();
}
