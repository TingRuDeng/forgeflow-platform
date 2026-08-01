import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { normalizeOptionalDispatcherToken } from '@tingrudeng/beta-runtime-core/runtime/dispatcher-auth.js'
import { loadConsoleConfigFile, type ConsoleConfig } from './config-file.mjs'

function loadConfig(): ConsoleConfig {
  const fileConfig = loadConsoleConfigFile();
  const environmentToken = normalizeOptionalDispatcherToken(
    process.env.FORGEFLOW_CONSOLE_API_TOKEN,
    'FORGEFLOW_CONSOLE_API_TOKEN',
  );
  // 环境变量用于 CI / 临时调试覆盖，本地持久配置仍来自配置文件。
  return {
    dispatcherToken: environmentToken ?? fileConfig.dispatcherToken,
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
