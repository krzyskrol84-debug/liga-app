import { Router } from "express";
import { dataDragonService } from "../riot/DataDragonService.js";

export const dataDragonRouter = Router();

dataDragonRouter.get("/patch", async (_request, response, next) => {
  try {
    const result = await dataDragonService.getLatestPatch();
    response.json(result);
  } catch (error) {
    next(error);
  }
});

dataDragonRouter.get("/champions", async (_request, response, next) => {
  try {
    const result = await dataDragonService.getChampions();
    response.json(result);
  } catch (error) {
    next(error);
  }
});
