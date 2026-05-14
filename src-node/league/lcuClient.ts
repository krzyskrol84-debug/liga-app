import https from "node:https";
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import type { LeagueClientConnectionInfo, LeagueClientProtocol } from "./lockfile.js";

export type LcuClientConfig = {
  protocol: LeagueClientProtocol;
  port: number;
  password: string;
  host?: string;
  username?: string;
  timeoutMs?: number;
};

export type LcuRequestOptions = Omit<
  AxiosRequestConfig,
  "baseURL" | "url" | "method" | "auth" | "httpsAgent" | "data"
>;

export class LeagueClientApiError extends Error {
  readonly status?: number;
  readonly method?: string;
  readonly endpoint?: string;
  readonly responseBody?: unknown;

  constructor(message: string, options: {
    status?: number;
    method?: string;
    endpoint?: string;
    responseBody?: unknown;
    cause?: unknown;
  } = {}) {
    super(message);
    this.name = "LeagueClientApiError";
    this.status = options.status;
    this.method = options.method;
    this.endpoint = options.endpoint;
    this.responseBody = options.responseBody;
    this.cause = options.cause;
  }
}

export class LeagueClientApi {
  private readonly client: AxiosInstance;

  readonly baseUrl: string;

  constructor(config: LcuClientConfig) {
    const host = config.host ?? "127.0.0.1";
    const username = config.username ?? "riot";

    this.baseUrl = `${config.protocol}://${host}:${config.port}`;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeoutMs ?? 10_000,
      auth: {
        username,
        password: config.password,
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });
  }

  static fromLockfile(info: LeagueClientConnectionInfo, options: Partial<LcuClientConfig> = {}) {
    return new LeagueClientApi({
      protocol: info.protocol,
      port: info.port,
      password: info.password,
      username: info.username,
      ...options,
    });
  }

  async get<TResponse>(endpoint: string, options?: LcuRequestOptions): Promise<TResponse> {
    return this.request<TResponse>("GET", endpoint, undefined, options);
  }

  async post<TResponse, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    options?: LcuRequestOptions,
  ): Promise<TResponse> {
    return this.request<TResponse>("POST", endpoint, body, options);
  }

  async put<TResponse, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    options?: LcuRequestOptions,
  ): Promise<TResponse> {
    return this.request<TResponse>("PUT", endpoint, body, options);
  }

  async patch<TResponse, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    options?: LcuRequestOptions,
  ): Promise<TResponse> {
    return this.request<TResponse>("PATCH", endpoint, body, options);
  }

  async delete<TResponse>(endpoint: string, options?: LcuRequestOptions): Promise<TResponse> {
    return this.request<TResponse>("DELETE", endpoint, undefined, options);
  }

  async raw<TResponse = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<TResponse>> {
    try {
      return await this.client.request<TResponse>(config);
    } catch (error) {
      throw toLeagueClientApiError(error, config.method, config.url);
    }
  }

  private async request<TResponse>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    endpoint: string,
    body?: unknown,
    options?: LcuRequestOptions,
  ): Promise<TResponse> {
    try {
      const response = await this.client.request<TResponse>({
        ...options,
        method,
        url: normalizeEndpoint(endpoint),
        data: body,
      });

      return response.data;
    } catch (error) {
      throw toLeagueClientApiError(error, method, endpoint);
    }
  }
}

export function createLeagueClientApi(config: LcuClientConfig): LeagueClientApi {
  return new LeagueClientApi(config);
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function toLeagueClientApiError(error: unknown, method?: string, endpoint?: string): LeagueClientApiError {
  if (axios.isAxiosError(error)) {
    return fromAxiosError(error, method, endpoint);
  }

  if (error instanceof Error) {
    return new LeagueClientApiError(error.message, {
      method,
      endpoint,
      cause: error,
    });
  }

  return new LeagueClientApiError("Unknown League Client API error.", {
    method,
    endpoint,
    cause: error,
  });
}

function fromAxiosError(error: AxiosError, method?: string, endpoint?: string): LeagueClientApiError {
  if (error.response) {
    return new LeagueClientApiError(
      `League Client API responded with HTTP ${error.response.status}.`,
      {
        status: error.response.status,
        method: method ?? error.config?.method?.toUpperCase(),
        endpoint: endpoint ?? error.config?.url,
        responseBody: error.response.data,
        cause: error,
      },
    );
  }

  if (error.request) {
    return new LeagueClientApiError("League Client API did not respond.", {
      method: method ?? error.config?.method?.toUpperCase(),
      endpoint: endpoint ?? error.config?.url,
      cause: error,
    });
  }

  return new LeagueClientApiError(error.message, {
    method: method ?? error.config?.method?.toUpperCase(),
    endpoint: endpoint ?? error.config?.url,
    cause: error,
  });
}
