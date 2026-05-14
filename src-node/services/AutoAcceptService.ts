import type { LeagueClientApi } from "../league/lcuClient.js";
import { getCurrentGameflowPhase } from "../league/champSelect.js";
import type { AutoAcceptSettings } from "../models/appModels.js";
import { getReadyCheck } from "../league/autoAccept.js";
import { LeagueClientApiError } from "../league/lcuClient.js";

export class AutoAcceptService {
  private lastAcceptedAt = 0;
  private lastReadyCheckKey: string | null = null;

  constructor(private readonly lcu: LeagueClientApi) {}

  async run(settings: AutoAcceptSettings) {
    if (!settings.enabled) return { skipped: true, reason: "disabled" };
    const gameflowPhase = await getCurrentGameflowPhase(this.lcu);
    if (gameflowPhase !== "ReadyCheck") {
      return { skipped: true, reason: "not_ready_check", gameflowPhase };
    }

    const readyCheck = await getReadyCheck(this.lcu);
    const readyCheckKey = `${readyCheck.state}:${readyCheck.timer}:${readyCheck.playerResponse}`;
    if (readyCheck.playerResponse === "Accepted" || readyCheck.state !== "InProgress") {
      return {
        skipped: true,
        reason: "ready_check_not_actionable",
        gameflowPhase,
        readyCheck,
        log: "detected ReadyCheck",
      };
    }

    const now = Date.now();
    if (now - this.lastAcceptedAt < settings.cooldownMs) {
      return { skipped: true, reason: "cooldown", gameflowPhase, readyCheck };
    }
    if (this.lastReadyCheckKey === readyCheckKey) {
      return { skipped: true, reason: "already_accepted_session", gameflowPhase, readyCheck };
    }

    try {
      await this.lcu.post<void>("/lol-matchmaking/v1/ready-check/accept");
    } catch (error) {
      if (error instanceof LeagueClientApiError) {
        return {
          skipped: true,
          reason: "accept_failed",
          gameflowPhase,
          readyCheck,
          status: error.status ?? null,
          body: error.responseBody ?? null,
          log: ["detected ReadyCheck", "accept request sent", "accept failed status/body"],
        };
      }
      throw error;
    }

    this.lastAcceptedAt = now;
    this.lastReadyCheckKey = readyCheckKey;
    return {
      accepted: true,
      gameflowPhase,
      readyCheck,
      endpoint: "/lol-matchmaking/v1/ready-check/accept",
      log: ["detected ReadyCheck", "accept request sent", "accept success"],
    };
  }

  reset(): void {
    this.lastReadyCheckKey = null;
  }
}
