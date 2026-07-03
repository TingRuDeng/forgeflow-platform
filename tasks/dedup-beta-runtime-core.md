# beta runtime 彻底去重计划

## 目标

- 将 Codex/Gemini beta runtime 中完全重复的 worker daemon 与 task worktree 实现抽到共享发布包。
- 保持 `@tingrudeng/codex-beta-runtime` 和 `@tingrudeng/gemini-beta-runtime` 的现有导出路径与 CLI 行为兼容。
- 删除上一轮临时 parity gate，改用共享源码和共享测试作为长期门禁。

## 非目标

- 不合并 Codex/Gemini 的 provider CLI 执行逻辑。
- 不改变 dispatcher HTTP 协议、worker protocol 或任务状态机。
- 不发布 npm 包，只保证本仓库 build/test/package 路径可验证。

## 当前事实

- `packages/codex-beta-runtime/src/runtime/worker-daemon.ts` 与 `packages/gemini-beta-runtime/src/runtime/worker-daemon.ts` 完全一致，均导出 `createDispatcherClient`、`runWorkerDaemonCycle`、`runWorkerDaemon` 等 API。
- `packages/codex-beta-runtime/src/runtime/task-worktree.ts` 与 `packages/gemini-beta-runtime/src/runtime/task-worktree.ts` 完全一致，均导出 `safeTaskDirName` 与 `prepareTaskWorktree`。
- `packages/codex-beta-runtime/src/runtime/run-worker-assignment.ts` 与 `packages/gemini-beta-runtime/src/runtime/run-worker-assignment.ts` 存在 provider CLI 差异，应继续保留在各自包内。
- `packages/codex-beta-runtime/src/runtime/worker.ts` 与 `packages/gemini-beta-runtime/src/runtime/worker.ts` 仍通过本包相对路径导入 `./worker-daemon.js`，因此 wrapper re-export 可以保持入口兼容。
- `scripts/release-package.ts` 通过 `pnpm list --filter @tingrudeng/<package>` 定位发布包，新增 `@tingrudeng/beta-runtime-core` 后可复用现有发布脚本。

## 决策日志

- 推荐新增 `packages/beta-runtime-core`，把共享 runtime 控制逻辑放入独立公共包。
- Codex/Gemini 包保留 `src/runtime/worker-daemon.ts` 与 `src/runtime/task-worktree.ts` 作为薄 wrapper，只 re-export core 包，避免破坏既有 import 路径。
- Codex/Gemini 包新增 `@tingrudeng/beta-runtime-core: workspace:*` 依赖，并补发布前 workspace 依赖重写逻辑，避免 npm 包发布时携带不可解析的 workspace 协议。
- 把 worker daemon 行为测试迁移到共享 core 包，用 provider 参数化覆盖 Codex/Gemini 两套输入；两个 runtime 包保留轻量 wrapper/export 测试。

## 执行计划

- [x] P1 串行：创建 `packages/beta-runtime-core`，迁移共享 `worker-daemon.ts` 与 `task-worktree.ts`。
- [x] P2 串行：将 Codex/Gemini 的同名 runtime 文件改为薄 wrapper re-export。
- [x] P3 串行：给 Codex/Gemini package 增加 core 依赖与发布前 workspace 依赖重写脚本。
- [x] P4 串行：迁移/参数化 worker daemon 测试到 core 包，删除旧 parity gate。
- [x] P5 串行：更新 release/publishing 相关说明或脚本入口，确保 core 可单独 dry-run。
- [x] P6 串行：执行验证矩阵并运行 review-gate。

## 预期验证

- `CI=true pnpm --filter @tingrudeng/beta-runtime-core test`
- `CI=true pnpm --filter @tingrudeng/beta-runtime-core typecheck`
- `CI=true pnpm --filter @tingrudeng/beta-runtime-core build`
- `CI=true pnpm --filter @tingrudeng/codex-beta-runtime test`
- `CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test`
- `CI=true pnpm --filter @tingrudeng/codex-beta-runtime build`
- `CI=true pnpm --filter @tingrudeng/gemini-beta-runtime build`
- `node scripts/release-package.js --package beta-runtime-core --bump prerelease --dry-run`
- `node scripts/release-package.js --package codex-beta-runtime --bump prerelease --dry-run`
- `node scripts/release-package.js --package gemini-beta-runtime --bump prerelease --dry-run`
- `CI=true pnpm typecheck`
- `CI=true pnpm lint`
- `CI=true pnpm docs:validate`
- `git diff --check`

## 进度记录

- 2026-07-03：完成只读分析与计划草案，等待 HARD-GATE 确认。
- 2026-07-03：P1 完成，已新增 `@tingrudeng/beta-runtime-core` 并迁入共享 daemon/worktree 源码。
- 2026-07-03：P2 完成，Codex/Gemini 的 `worker-daemon.ts` 与 `task-worktree.ts` 已改为 core re-export wrapper。
- 2026-07-03：P3 完成，Codex/Gemini 已依赖 `@tingrudeng/beta-runtime-core`，并新增发布前 workspace 依赖重写脚本。
- 2026-07-03：P4 完成，worker daemon 行为测试已迁移到 core 包并按 Codex/Gemini pool 参数化，旧 parity gate 已删除。
- 2026-07-03：P5 完成，Codex/Gemini 发布说明已补充 core 先发布和 release dry-run 校验。
- 2026-07-03：P6 完成，core/Codex/Gemini 局部验证、发布 dry-run、仓库级类型检查、lint、文档校验、diff 校验和串行全量测试均已通过。
- 2026-07-03：`CI=true pnpm test` 在默认 workspace 并发下曾因 `apps/dispatcher/tests/modules/server/dispatcher-server.test.ts` 首个用例 15 秒超时失败；单独复跑该用例通过，随后用 `CI=true pnpm -r --workspace-concurrency=1 --if-present test` 串行复跑全量通过，判断为并发资源竞争导致的验证噪音，不是本轮 runtime 去重回归。
- 2026-07-03：review-gate 发现 `packages/beta-runtime-core/src/runtime/worker-daemon.ts` 原迁移文件过大，已继续拆分为 dispatcher client、task processor、task output、types、env、git、utils 等小模块；最大新增源码文件 210 行。

## Review 小结

- 终态：finished。
- Spec 符合度：通过；共享 daemon/worktree 只保留在 `@tingrudeng/beta-runtime-core`，Codex/Gemini 保留旧路径 wrapper。
- 安全检查：通过；未新增 secret，worker 子进程环境 allowlist 行为由 core 参数化测试覆盖。
- 测试与验证：通过；局部测试、类型检查、构建、发布 dry-run、仓库级 typecheck/lint/docs/diff 和串行全量测试均有命令证据。
- 复杂度检查：通过；重复实现被删除，旧 runtime 包只保留 re-export wrapper，core runtime 已按职责拆分，新增源码文件均低于 300 行。
- Document-refresh: needed
- 原因：新增发布包和发布顺序改变，已同步 runtime 包发布说明并补充 core 包发布文档。
- 剩余风险：npm 实际发布仍需按 core → provider runtime 顺序执行，本轮仅验证 dry-run。
- 潜在技术债：`scripts/rewrite-workspace-deps.mjs` 与 Trae 旧脚本存在历史兼容关系，后续可在确认发布流程稳定后删除旧脚本入口。
- 结论：通过。
