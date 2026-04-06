import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface ConsoleConfig {
  dispatcherToken?: string;
  dispatcherUrl?: string;
}

const CONFIG_FILENAME = ".forgeflow-console.json";

function getConfigPath(): string {
  const projectConfig = path.join(process.cwd(), CONFIG_FILENAME);
  if (fs.existsSync(projectConfig)) {
    return projectConfig;
  }
  return path.join(os.homedir(), CONFIG_FILENAME);
}

function loadConfig(): ConsoleConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

const config = loadConfig();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    port: 8788,
    proxy: {
      '/api': {
        target: config.dispatcherUrl || 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure(proxy) {
          if (config.dispatcherToken) {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('authorization', `Bearer ${config.dispatcherToken}`);
            });
          }
        },
      },
    },
  },
});
