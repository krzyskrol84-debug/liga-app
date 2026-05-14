import { backendConfig } from "../config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(level: LogLevel) {
  return levelWeight[level] >= levelWeight[backendConfig.logLevel];
}

export function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = context ? { message, ...context } : { message };
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : level === "info" ? console.info : console.debug;
  logger("[backend]", payload);
}

export function logDebug(message: string, context?: Record<string, unknown>) {
  log("debug", message, context);
}

export function logInfo(message: string, context?: Record<string, unknown>) {
  log("info", message, context);
}

export function logWarn(message: string, context?: Record<string, unknown>) {
  log("warn", message, context);
}

export function logError(message: string, context?: Record<string, unknown>) {
  log("error", message, context);
}
