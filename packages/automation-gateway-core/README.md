# @tingrudeng/automation-gateway-core

ForgeFlow automation gateway runtime 的共享协议与 Trae 自动化基础能力包。

当前范围：
- 解析 Trae automation task 输出的 final report 字段
- 在接受真实输出前识别模板占位 report
- 校验 report task id 是否仍匹配 dispatcher 正在处理的 task
- 提供共享 Trae automation gateway request handler、HTTP JSON IO、debug logger、driver 创建规则、持久化 session-store 原语、Trae CDP / DOM driver helper
- 提供共享 Trae clean relaunch 原语，包括 macOS `.app` 名称解析、退出既有 Trae app、等待旧 CDP 端口释放
- 提供共享 Trae launch target helper，包括 macOS `.app` 到 `Contents/MacOS/*` 可执行文件的解析规则

这个包刻意保持小范围：
- 只包含解析、校验、gateway protocol、本地 JSON session-store helper、Trae browser automation driver helper、clean relaunch 原语和 launch target helper
- 不包含 worker lifecycle 逻辑
- 适合同时被 packaged Trae runtime、源码调试脚本和后续 gateway-side validation path 复用

## Exports

```ts
import {
  getLastReportFieldValue,
  createAutomationGatewayDebugLogger,
  createPersistentAutomationSessionStore,
  createTraeAutomationDriver,
  prepareCleanRelaunch,
  resolveMacAppBundleExecutable,
  resolveAutomationGatewayDriver,
  isEquivalentReportedTaskId,
  isPlaceholderTaskId,
  looksLikeTemplatePlaceholderReport,
} from "@tingrudeng/automation-gateway-core";
```

## 仓库内用法

```bash
pnpm --filter @tingrudeng/automation-gateway-core test
pnpm --filter @tingrudeng/automation-gateway-core typecheck
pnpm --filter @tingrudeng/automation-gateway-core build
```

## 说明

- 这是 library package，不是直接机器入口。
- 当前主要 consumer 是 `@tingrudeng/trae-beta-runtime` 和仓库内 Trae 源码调试脚本。
- 发布步骤见 `PUBLISHING.md`。
