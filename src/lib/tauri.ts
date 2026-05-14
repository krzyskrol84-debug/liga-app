import { invoke } from "@tauri-apps/api/core";

export function callBackend<T>(command: string, args?: Record<string, unknown>) {
  return invoke<T>(command, args);
}
