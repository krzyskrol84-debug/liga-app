import type { NextFunction, Request, Response } from "express";

export function noStoreForApiRoutes(request: Request, response: Response, next: NextFunction) {
  if (request.path === "/health" || request.path.startsWith("/api/")) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
  }

  next();
}
