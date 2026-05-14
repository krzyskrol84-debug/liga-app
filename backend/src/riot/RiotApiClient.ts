import { prisma } from "../lib/prisma.js";
import { backendConfig } from "../config.js";

export type PlatformRegion =
  | "br1"
  | "eun1"
  | "euw1"
  | "jp1"
  | "kr"
  | "la1"
  | "la2"
  | "me1"
  | "na1"
  | "oc1"
  | "ph2"
  | "ru"
  | "sg2"
  | "th2"
  | "tr1"
  | "tw2"
  | "vn2";

export type RoutingRegion = "europe" | "americas" | "asia" | "sea";

export type MatchQueryOptions = {
  start?: number;
  count?: number;
  queue?: number;
  type?: string;
  startTime?: number;
  endTime?: number;
};

export type AccountDto = {
  puuid: string;
  gameName: string;
  tagLine: string;
};

export type SummonerDto = {
  id: string;
  accountId?: string;
  puuid: string;
  name?: string;
  profileIconId?: number;
  revisionDate?: number;
  summonerLevel?: number;
};

export type LeagueEntryDto = {
  leagueId?: string;
  queueType?: string;
  tier?: string;
  rank?: string;
  summonerId: string;
  puuid?: string;
  summonerName?: string;
  leaguePoints?: number;
  wins?: number;
  losses?: number;
  veteran?: boolean;
  inactive?: boolean;
  freshBlood?: boolean;
  hotStreak?: boolean;
};

export type LeagueListDto = {
  leagueId?: string;
  tier?: string;
  queue?: string;
  name?: string;
  entries?: LeagueEntryDto[];
};

export type MatchParticipantDto = {
  puuid?: string;
  championId: number;
  teamId?: number;
  teamPosition?: string;
  win: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
  summoner1Id: number;
  summoner2Id: number;
  perks?: {
    styles?: Array<{
      style?: number;
      selections?: Array<{
        perk?: number;
      }>;
    }>;
  };
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
};

export type MatchDto = {
  metadata?: {
    matchId?: string;
  };
  info?: {
    gameVersion?: string;
    queueId?: number;
    gameDuration?: number;
    gameCreation?: number;
    gameEndTimestamp?: number;
    participants?: MatchParticipantDto[];
  };
};

type RiotApiClientOptions = {
  timeoutMs?: number;
  maxRetries?: number;
};

type RequestContext = {
  jobName: string;
  target: string;
  method: "GET";
  url: string;
  platformRegion?: PlatformRegion;
  routingRegion?: RoutingRegion;
};

type LoggerLevel = "info" | "warn" | "error";
type QueueTask<T> = () => Promise<T>;

export class RiotApiError extends Error {
  public readonly status: number | null;
  public readonly url: string;
  public readonly body: string | null;

  constructor(message: string, options: { status: number | null; url: string; body?: string | null }) {
    super(message);
    this.name = "RiotApiError";
    this.status = options.status;
    this.url = options.url;
    this.body = options.body ?? null;
  }
}

export class RiotApiClient {
  private static readonly maxConcurrentRequests = 4;
  private static activeRequests = 0;
  private static queue: Array<() => void> = [];
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: RiotApiClientOptions = {}) {
    this.apiKey = backendConfig.riotApiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 4;
  }

  async getAccountByRiotId(
    gameName: string,
    tagLine: string,
    platformRegion: PlatformRegion,
  ): Promise<AccountDto> {
    const routingRegion = mapPlatformToRoutingRegion(platformRegion);
    const encodedGameName = encodeURIComponent(gameName);
    const encodedTagLine = encodeURIComponent(tagLine);
    const path = `/riot/account/v1/accounts/by-riot-id/${encodedGameName}/${encodedTagLine}`;

    return this.requestJson<AccountDto>(
      buildRoutingBaseUrl(routingRegion),
      path,
      {
        jobName: "riot.account.by-riot-id",
        target: `${gameName}#${tagLine}`,
        method: "GET",
        url: `${buildRoutingBaseUrl(routingRegion)}${path}`,
        platformRegion,
        routingRegion,
      },
    );
  }

  async getMatchIdsByPuuid(
    puuid: string,
    routingRegion: RoutingRegion,
    options: MatchQueryOptions = {},
  ): Promise<string[]> {
    const query = buildQueryString(options);
    const path = `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids${query}`;

    return this.requestJson<string[]>(
      buildRoutingBaseUrl(routingRegion),
      path,
      {
        jobName: "riot.match.ids-by-puuid",
        target: puuid,
        method: "GET",
        url: `${buildRoutingBaseUrl(routingRegion)}${path}`,
        routingRegion,
      },
    );
  }

  async getMatchById(matchId: string, routingRegion: RoutingRegion): Promise<MatchDto> {
    const path = `/lol/match/v5/matches/${encodeURIComponent(matchId)}`;

    return this.requestJson<MatchDto>(
      buildRoutingBaseUrl(routingRegion),
      path,
      {
        jobName: "riot.match.by-id",
        target: matchId,
        method: "GET",
        url: `${buildRoutingBaseUrl(routingRegion)}${path}`,
        routingRegion,
      },
    );
  }

  async getAccountByPuuid(
    puuid: string,
    platformRegion: PlatformRegion,
  ): Promise<AccountDto> {
    const routingRegion = mapPlatformToRoutingRegion(platformRegion);
    const path = `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`;

    return this.requestJson<AccountDto>(
      buildRoutingBaseUrl(routingRegion),
      path,
      {
        jobName: "riot.account.by-puuid",
        target: puuid,
        method: "GET",
        url: `${buildRoutingBaseUrl(routingRegion)}${path}`,
        platformRegion,
        routingRegion,
      },
    );
  }

  async getSummonerBySummonerId(
    summonerId: string,
    platformRegion: PlatformRegion,
  ): Promise<SummonerDto> {
    const baseUrl = buildPlatformBaseUrl(platformRegion);
    const path = `/lol/summoner/v4/summoners/${encodeURIComponent(summonerId)}`;

    return this.requestJson<SummonerDto>(
      baseUrl,
      path,
      {
        jobName: "riot.summoner.by-summoner-id",
        target: summonerId,
        method: "GET",
        url: `${baseUrl}${path}`,
        platformRegion,
      },
    );
  }

  async getChallengerLeague(
    queue: string,
    platformRegion: PlatformRegion,
  ): Promise<LeagueListDto> {
    return this.getTopLeague("challengerleagues", queue, platformRegion);
  }

  async getGrandmasterLeague(
    queue: string,
    platformRegion: PlatformRegion,
  ): Promise<LeagueListDto> {
    return this.getTopLeague("grandmasterleagues", queue, platformRegion);
  }

  async getMasterLeague(
    queue: string,
    platformRegion: PlatformRegion,
  ): Promise<LeagueListDto> {
    return this.getTopLeague("masterleagues", queue, platformRegion);
  }

  async getLeagueEntries(
    queue: string,
    tier: string,
    division: string,
    platformRegion: PlatformRegion,
    page = 1,
  ): Promise<LeagueEntryDto[]> {
    const baseUrl = buildPlatformBaseUrl(platformRegion);
    const encodedQueue = encodeURIComponent(queue);
    const encodedTier = encodeURIComponent(tier);
    const encodedDivision = encodeURIComponent(division);
    const path = `/lol/league/v4/entries/${encodedQueue}/${encodedTier}/${encodedDivision}?page=${page}`;

    return this.requestJson<LeagueEntryDto[]>(
      baseUrl,
      path,
      {
        jobName: "riot.league.entries",
        target: `${tier}:${division}:${queue}`,
        method: "GET",
        url: `${baseUrl}${path}`,
        platformRegion,
      },
    );
  }

  private async getTopLeague(
    endpoint: "challengerleagues" | "grandmasterleagues" | "masterleagues",
    queue: string,
    platformRegion: PlatformRegion,
  ): Promise<LeagueListDto> {
    const baseUrl = buildPlatformBaseUrl(platformRegion);
    const encodedQueue = encodeURIComponent(queue);
    const path = `/lol/league/v4/${endpoint}/by-queue/${encodedQueue}`;

    return this.requestJson<LeagueListDto>(
      baseUrl,
      path,
      {
        jobName: `riot.league.${endpoint}`,
        target: queue,
        method: "GET",
        url: `${baseUrl}${path}`,
        platformRegion,
      },
    );
  }

  private async requestJson<T>(baseUrl: string, path: string, context: RequestContext): Promise<T> {
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      attempt += 1;
      const url = `${baseUrl}${path}`;

      try {
        const response = await RiotApiClient.runQueued(async () =>
          fetch(url, {
            method: context.method,
            headers: {
              Accept: "application/json",
              "X-Riot-Token": this.apiKey,
            },
            signal: AbortSignal.timeout(this.timeoutMs),
          }),
        );

        if (response.ok) {
          this.log("info", {
            message: "Riot API request succeeded.",
            status: response.status,
            attempt,
            url,
            context,
          });
          return (await response.json()) as T;
        }

        const body = await safeReadBody(response);

        if (response.status === 429 && attempt <= this.maxRetries) {
          const retryAfterMs = getRetryAfterMs(response.headers.get("Retry-After"));
          const delayMs = retryAfterMs ?? getExponentialBackoffMs(attempt);
          this.log("warn", {
            message: `Riot API rate limited the request. Retrying in ${delayMs}ms.`,
            status: response.status,
            attempt,
            url,
            context,
          });
          await this.writeFetchJobLog("retrying", context, {
            statusCode: response.status,
            attempt,
            retryAfterMs: delayMs,
            body,
            errorMessage: `Rate limited with status ${response.status}.`,
          });
          await sleep(delayMs);
          continue;
        }

        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt <= this.maxRetries) {
          const delayMs = getExponentialBackoffMs(attempt);
          this.log("warn", {
            message: `Riot API temporary error. Retrying in ${delayMs}ms.`,
            status: response.status,
            attempt,
            url,
            context,
          });
          await this.writeFetchJobLog("retrying", context, {
            statusCode: response.status,
            attempt,
            retryAfterMs: delayMs,
            body,
            errorMessage: `Temporary Riot API error ${response.status}.`,
          });
          await sleep(delayMs);
          continue;
        }

        const error = new RiotApiError(`Riot API request failed with status ${response.status}.`, {
          status: response.status,
          url,
          body,
        });

        await this.writeFetchJobLog("failed", context, {
          statusCode: response.status,
          attempt,
          body,
          errorMessage: error.message,
        });

        this.log("error", {
          message: error.message,
          status: response.status,
          attempt,
          url,
          context,
        });

        throw error;
      } catch (error) {
        if (error instanceof RiotApiError) {
          throw error;
        }

        if (attempt <= this.maxRetries) {
          const delayMs = getExponentialBackoffMs(attempt);
          this.log("warn", {
            message: `Riot API request error. Retrying in ${delayMs}ms: ${getSafeErrorMessage(error)}`,
            attempt,
            url,
            context,
          });
          await this.writeFetchJobLog("retrying", context, {
            attempt,
            retryAfterMs: delayMs,
            errorMessage: getSafeErrorMessage(error),
          });
          await sleep(delayMs);
          continue;
        }

        const requestError = new RiotApiError(`Riot API request failed: ${getSafeErrorMessage(error)}`, {
          status: null,
          url,
        });

        await this.writeFetchJobLog("failed", context, {
          attempt,
          errorMessage: requestError.message,
        });

        this.log("error", {
          message: requestError.message,
          attempt,
          url,
          context,
        });

        throw requestError;
      }
    }

    const exhaustedError = new RiotApiError("Riot API request exhausted all retries.", {
      status: null,
      url: `${baseUrl}${path}`,
    });

    await this.writeFetchJobLog("failed", context, {
      attempt: this.maxRetries + 1,
      errorMessage: exhaustedError.message,
    });

    throw exhaustedError;
  }

  private log(
    level: LoggerLevel,
    payload: {
      message: string;
      status?: number;
      attempt?: number;
      url: string;
      context: RequestContext;
    },
  ) {
    const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    logger("[RiotApiClient]", {
      message: payload.message,
      status: payload.status,
      attempt: payload.attempt,
      method: payload.context.method,
      url: payload.url,
      target: payload.context.target,
      platformRegion: payload.context.platformRegion,
      routingRegion: payload.context.routingRegion,
    });
  }

  private async writeFetchJobLog(
    status: string,
    context: RequestContext,
    details: {
      statusCode?: number;
      attempt?: number;
      retryAfterMs?: number;
      body?: string | null;
      errorMessage?: string;
    },
  ) {
    try {
      await prisma.fetchJobLog.create({
        data: {
          jobName: context.jobName,
          status,
          target: context.target,
          startedAt: new Date(),
          finishedAt: new Date(),
          errorMessage: details.errorMessage ?? null,
          metadata: JSON.stringify({
            method: context.method,
            url: context.url,
            platformRegion: context.platformRegion,
            routingRegion: context.routingRegion,
            statusCode: details.statusCode ?? null,
            attempt: details.attempt ?? null,
            retryAfterMs: details.retryAfterMs ?? null,
            body: details.body ?? null,
          }),
        },
      });
    } catch (error) {
      console.warn("[RiotApiClient] Could not write FetchJobLog entry.", {
        jobName: context.jobName,
        target: context.target,
        reason: getSafeErrorMessage(error),
      });
    }
  }

  private static async runQueued<T>(task: QueueTask<T>): Promise<T> {
    if (RiotApiClient.activeRequests >= RiotApiClient.maxConcurrentRequests) {
      await new Promise<void>((resolve) => {
        RiotApiClient.queue.push(resolve);
      });
    }

    RiotApiClient.activeRequests += 1;
    try {
      return await task();
    } finally {
      RiotApiClient.activeRequests = Math.max(0, RiotApiClient.activeRequests - 1);
      const next = RiotApiClient.queue.shift();
      next?.();
    }
  }
}

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503]);

function buildRoutingBaseUrl(region: RoutingRegion): string {
  return `https://${region}.api.riotgames.com`;
}

function buildPlatformBaseUrl(region: PlatformRegion): string {
  return `https://${region}.api.riotgames.com`;
}

function mapPlatformToRoutingRegion(region: PlatformRegion): RoutingRegion {
  switch (region) {
    case "euw1":
    case "eun1":
    case "tr1":
    case "ru":
    case "me1":
      return "europe";
    case "na1":
    case "br1":
    case "la1":
    case "la2":
      return "americas";
    case "kr":
    case "jp1":
      return "asia";
    case "oc1":
    case "ph2":
    case "sg2":
    case "th2":
    case "tw2":
    case "vn2":
      return "sea";
    default:
      return "europe";
  }
}

function buildQueryString(options: MatchQueryOptions): string {
  const query = new URLSearchParams();

  if (options.start !== undefined) query.set("start", String(options.start));
  if (options.count !== undefined) query.set("count", String(options.count));
  if (options.queue !== undefined) query.set("queue", String(options.queue));
  if (options.type !== undefined) query.set("type", options.type);
  if (options.startTime !== undefined) query.set("startTime", String(options.startTime));
  if (options.endTime !== undefined) query.set("endTime", String(options.endTime));

  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

function getRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) return null;

  const asSeconds = Number(retryAfterHeader);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000;
  }

  const asDate = Date.parse(retryAfterHeader);
  if (Number.isNaN(asDate)) {
    return null;
  }

  return Math.max(0, asDate - Date.now());
}

function getExponentialBackoffMs(attempt: number): number {
  const cappedAttempt = Math.min(attempt, 6);
  return 500 * 2 ** (cappedAttempt - 1);
}

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function safeReadBody(response: Response): Promise<string | null> {
  try {
    const body = await response.text();
    return body.length > 0 ? body : null;
  } catch {
    return null;
  }
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
