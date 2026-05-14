import type { NextFunction, Request, Response } from "express";
import { logDebug, logWarn } from "../lib/logger.js";

export function requestLogger(request: Request, response: Response, next: NextFunction) {
  const startedAt = Date.now();

  response.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const level = response.statusCode >= 400 ? logWarn : logDebug;
    level("request", {
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs,
      ip: request.ip,
    });
  });

  next();
}
