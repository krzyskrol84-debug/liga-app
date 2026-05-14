import axios, { type AxiosInstance } from "axios";

export type RiotRegion = "americas" | "asia" | "europe" | "sea";
export type RiotPlatform =
  | "br1"
  | "eun1"
  | "euw1"
  | "jp1"
  | "kr"
  | "la1"
  | "la2"
  | "na1"
  | "oc1"
  | "tr1"
  | "ru"
  | "ph2"
  | "sg2"
  | "th2"
  | "tw2"
  | "vn2";

export type RiotApiClientOptions = {
  apiKey?: string;
  region?: RiotRegion;
  platform?: RiotPlatform;
  timeoutMs?: number;
  minRequestDelayMs?: number;
};

export type RiotAccount = {
  puuid: string;
  gameName: string;
  tagLine: string;
};

export type RiotMatchHistoryOptions = {
  start?: number;
  count?: number;
  queue?: number;
  type?: string;
  startTime?: number;
  endTime?: number;
};

export class RiotApiError extends Error {
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "RiotApiError";
    this.status = options.status;
    this.details = options.details;
  }
}

export class RiotApiClient {
  private readonly key: string | null;
  private readonly regional: AxiosInstance;
  private readonly platformClient: AxiosInstance;
  private readonly minRequestDelayMs: number;
  private lastRequestAt = 0;

  constructor(options: RiotApiClientOptions = {}) {
    this.key = options.apiKey ?? process.env.RIOT_API_KEY ?? null;
    const region = options.region ?? "europe";
    const platform = options.platform ?? "euw1";
    this.minRequestDelayMs = options.minRequestDelayMs ?? 1_250;
    this.regional = createHttp(`https://${region}.api.riotgames.com`, options.timeoutMs);
    this.platformClient = createHttp(`https://${platform}.api.riotgames.com`, options.timeoutMs);
  }

  isConfigured(): boolean {
    return Boolean(this.key);
  }

  async getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotAccount> {
    return this.get(this.regional, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
  }

  async getMatchIdsByPuuid(puuid: string, options: RiotMatchHistoryOptions = {}): Promise<string[]> {
    return this.get(this.regional, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`, {
      start: options.start ?? 0,
      count: options.count ?? 20,
      queue: options.queue,
      type: options.type,
      startTime: options.startTime,
      endTime: options.endTime,
    });
  }

  async getMatch(matchId: string): Promise<unknown> {
    return this.get(this.regional, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
  }

  async getSummonerByPuuid(puuid: string): Promise<unknown> {
    return this.get(this.platformClient, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`);
  }

  async getLocalMatchHistory(gameName: string, tagLine: string, options: RiotMatchHistoryOptions = {}) {
    const account = await this.getAccountByRiotId(gameName, tagLine);
    const matchIds = await this.getMatchIdsByPuuid(account.puuid, options);
    const matches: unknown[] = [];

    for (const matchId of matchIds) {
      matches.push(await this.getMatch(matchId));
    }

    return { account, matchIds, matches };
  }

  private async get<T>(client: AxiosInstance, endpoint: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.key) {
      throw new RiotApiError("RIOT_API_KEY is not configured. Core local features still work without Riot API.");
    }

    await this.waitForRateLimit();

    try {
      const response = await client.get<T>(endpoint, {
        params: compactParams(params),
        headers: { "X-Riot-Token": this.key },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new RiotApiError("Riot API request failed.", {
          status: error.response?.status,
          details: {
            url: endpoint,
            response: error.response?.data,
          },
        });
      }

      throw new RiotApiError("Unknown Riot API request failure.", { details: error });
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const waitMs = Math.max(0, this.minRequestDelayMs - elapsed);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestAt = Date.now();
  }
}

function createHttp(baseURL: string, timeoutMs = 15_000): AxiosInstance {
  return axios.create({ baseURL, timeout: timeoutMs });
}

function compactParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null));
}
