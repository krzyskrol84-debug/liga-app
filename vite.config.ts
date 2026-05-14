import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.BACKEND_URL || env.VITE_BACKEND_URL || "http://127.0.0.1:8787";

  return {
    base: command === "build" ? "./" : "/",
    plugins: [react(), tailwindcss()],
    define: {
      __BACKEND_URL__: JSON.stringify(backendUrl),
    },
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port: 1420,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
