import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { AppStatus } from "../types/app";

export function useAppStatus() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    async function load() {
      try {
        const current = await invoke<AppStatus>("get_app_status");
        if (mounted) {
          setStatus(current);
        }

        unlisten = await listen<AppStatus>("app_status_changed", (event) => {
          setStatus(event.payload);
        });
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void load();

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  return { status, error };
}
