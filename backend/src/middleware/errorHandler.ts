import type { NextFunction, Request, Response } from "express";

export function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction) {
  const message = error instanceof Error ? error.message : "Unknown backend error";
  console.error("[backend] unhandled error", {
    method: request.method,
    path: request.path,
    message,
  });

  response.status(500).json({
    ok: false,
    error: "Internal server error.",
    message,
  });
}
