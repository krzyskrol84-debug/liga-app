import { Router } from "express";
import { matchAnalyzer } from "../analytics/MatchAnalyzer.js";

export const debugRouter = Router();

debugRouter.get("/analyzer-sample", async (_request, response, next) => {
  try {
    return response.json(await matchAnalyzer.getAnalyzerSample());
  } catch (error) {
    next(error);
  }
});
