import { Router } from "express";
import { getDatabaseUrlDebugInfo } from "../config.js";
import { prisma } from "../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", async (_request, response) => {
  const databaseUrl = getDatabaseUrlDebugInfo(process.env.DATABASE_URL);

  if (!databaseUrl.loaded) {
    response.status(503).json({
      ok: false,
      service: "liga-backend",
      database: {
        ok: false,
        error: "DATABASE_URL is not configured.",
      },
    });
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({
      ok: true,
      service: "liga-backend",
      database: {
        ok: true,
      },
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      service: "liga-backend",
      database: {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown database error",
      },
    });
  }
});
