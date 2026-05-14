import type { NextFunction, Request, Response } from "express";

export function requestLogger(request: Request, response: Response, next: NextFunction) {
  const startedAt = Date.now();

  response.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.info("[backend] request", {
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs,
      ip: request.ip,
    });
  });

  next();
}
