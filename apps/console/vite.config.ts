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

function loadConfigFile(): ConsoleConfig {
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

function loadConfig(): ConsoleConfig {
  const fileConfig = loadConfigFile();
  // 环境变量用于 CI / 临时调试覆盖，本地持久配置仍来自配置文件。
  return {
    dispatcherToken: process.env.FORGEFLOW_CONSOLE_API_TOKEN || fileConfig.dispatcherToken,
    dispatcherUrl: process.env.FORGEFLOW_CONSOLE_DISPATCHER_URL || fileConfig.dispatcherUrl,
  };
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
