import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LeagueLockfileErrorCode =
  | "LOCKFILE_NOT_FOUND"
  | "LOCKFILE_READ_FAILED"
  | "INVALID_LOCKFILE_FORMAT"
  | "INVALID_PID"
  | "INVALID_PORT"
  | "INVALID_PROTOCOL"
  | "EMPTY_PASSWORD";

export class LeagueLockfileError extends Error {
  readonly code: LeagueLockfileErrorCode;
  readonly details?: unknown;

  constructor(code: LeagueLockfileErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "LeagueLockfileError";
    this.code = code;
    this.details = details;
  }
}

export type LeagueClientProtocol = "http" | "https";

export type LeagueLockfileData = {
  processName: string;
  pid: number;
  port: number;
  password: string;
  protocol: LeagueClientProtocol;
};

export type LeagueClientConnectionInfo = LeagueLockfileData & {
  lockfilePath: string;
  baseUrl: string;
  username: "riot";
  authHeader: string;
};

export type FindLeagueLockfileOptions = {
  lockfilePath?: string;
  leagueClientDir?: string;
  searchRoots?: string[];
};

const LOCKFILE_NAME = "lockfile";
const DEFAULT_WINDOWS_DIRS = [
  "C:\\Riot Games\\League of Legends",
  "C:\\Program Files\\Riot Games\\League of Legends",
  "C:\\Program Files (x86)\\Riot Games\\League of Legends",
];

export async function getLeagueClientConnectionInfo(
  options: FindLeagueLockfileOptions = {},
): Promise<LeagueClientConnectionInfo> {
  const lockfilePath = await findLeagueLockfile(options);
  return readLeagueLockfile(lockfilePath);
}

export async function findLeagueLockfile(
  options: FindLeagueLockfileOptions = {},
): Promise<string> {
  const checkedPaths: string[] = [];
  const candidates = buildLockfileCandidates(options);

  for (const candidate of candidates) {
    checkedPaths.push(candidate);

    if (await isReadableFile(candidate)) {
      return candidate;
    }
  }

  throw new LeagueLockfileError(
    "LOCKFILE_NOT_FOUND",
    "League Client lockfile was not found. Start League of Legends client or pass leagueClientDir/lockfilePath explicitly.",
    { checkedPaths },
  );
}

export async function readLeagueLockfile(lockfilePath: string): Promise<LeagueClientConnectionInfo> {
  let content: string;

  try {
    content = await readFile(lockfilePath, "utf8");
  } catch (error) {
    throw new LeagueLockfileError(
      "LOCKFILE_READ_FAILED",
      `Could not read League Client lockfile: ${lockfilePath}`,
      { lockfilePath, cause: formatUnknownError(error) },
    );
  }

  const data = parseLeagueLockfile(content, lockfilePath);

  return {
    ...data,
    lockfilePath,
    baseUrl: `${data.protocol}://127.0.0.1:${data.port}`,
    username: "riot",
    authHeader: createBasicAuthHeader("riot", data.password),
  };
}

export function parseLeagueLockfile(content: string, sourcePath = LOCKFILE_NAME): LeagueLockfileData {
  const raw = content.trim();
  const parts = raw.split(":");

  if (parts.length !== 5) {
    throw new LeagueLockfileError(
      "INVALID_LOCKFILE_FORMAT",
      `Invalid League Client lockfile format in ${sourcePath}. Expected: process:pid:port:password:protocol.`,
      { sourcePath, raw },
    );
  }

  const [processName, pidRaw, portRaw, password, protocolRaw] = parts;
  const pid = Number(pidRaw);
  const port = Number(portRaw);
  const protocol = protocolRaw.toLowerCase();

  if (!Number.isInteger(pid) || pid <= 0) {
    throw new LeagueLockfileError("INVALID_PID", `Invalid League Client pid in ${sourcePath}.`, {
      sourcePath,
      pid: pidRaw,
    });
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LeagueLockfileError("INVALID_PORT", `Invalid League Client port in ${sourcePath}.`, {
      sourcePath,
      port: portRaw,
    });
  }

  if (!password) {
    throw new LeagueLockfileError("EMPTY_PASSWORD", `League Client lockfile password is empty in ${sourcePath}.`, {
      sourcePath,
    });
  }

  if (protocol !== "http" && protocol !== "https") {
    throw new LeagueLockfileError(
      "INVALID_PROTOCOL",
      `Invalid League Client protocol in ${sourcePath}. Expected http or https.`,
      { sourcePath, protocol: protocolRaw },
    );
  }

  return {
    processName,
    pid,
    port,
    password,
    protocol,
  };
}

export function createBasicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function buildLockfileCandidates(options: FindLeagueLockfileOptions): string[] {
  const candidates = [
    normalizeLockfilePath(options.lockfilePath),
    options.leagueClientDir ? path.join(options.leagueClientDir, LOCKFILE_NAME) : undefined,
    normalizeLockfilePath(process.env.LEAGUE_LOCKFILE_PATH),
    process.env.LEAGUE_CLIENT_DIR ? path.join(process.env.LEAGUE_CLIENT_DIR, LOCKFILE_NAME) : undefined,
    ...getDefaultLeagueClientDirs().map((dir) => path.join(dir, LOCKFILE_NAME)),
    ...(options.searchRoots ?? []).map((root) => path.join(root, LOCKFILE_NAME)),
  ];

  return uniqueStrings(candidates.filter(isDefined));
}

function normalizeLockfilePath(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return path.basename(value).toLowerCase() === LOCKFILE_NAME ? value : path.join(value, LOCKFILE_NAME);
}

function getDefaultLeagueClientDirs(): string[] {
  if (process.platform !== "win32") {
    return [];
  }

  const userHomeCandidates = [
    path.join(os.homedir(), "Riot Games", "League of Legends"),
    path.join(os.homedir(), "Games", "Riot Games", "League of Legends"),
  ];

  return [...DEFAULT_WINDOWS_DIRS, ...userHomeCandidates];
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      return false;
    }

    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return String(error);
}
