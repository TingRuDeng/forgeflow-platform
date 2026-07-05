# 当前项目审查修复任务

- [x] M23 串行：补齐 Console artifact 下载和跨任务筛选工作台。
- [x] M23 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M23 Review 小结

已把 Console artifact 体验从单任务 refs 展开推进到审查工作台：`ArtifactSummary` 支持读取真实 artifact file API 的 `content` 字段并下载 manifest 文件；新增 `ArtifactWorkbench`，支持按任务、仓库、摘要、文件和 ref 跨任务筛选 artifact bundle，并可点击跳转到对应任务详情。

Review Gate：finished。Spec 符合度通过，本轮补齐 Console 审查工作台产品化中的下载和跨任务筛选；安全检查通过，下载只读取既有 `/api/artifacts/:bundleId/files/:fileName` API，仍使用 `encodeURIComponent`，未新增外部网络或路径拼接入口；复杂度检查通过，新组件职责单一且低于 300 行；Document-refresh: needed，原因：Console artifact 能力和技术债状态变化，已同步 `docs/TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：Console 仍未提供跨任务批量审查动作、批量 reason code / must-fix 编辑和批量提交决策。

- [x] M22 串行：补齐 production cutover primary backend readiness gate。
- [x] M22 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M22 Review 小结

已把 `pnpm verify:shadow-cutover` 升级为生产 cutover 预检：除要求 shadow 已配置且零 drift 外，还要求 `RUNTIME_STATE_BACKEND=postgres` 与 `DISPATCHER_PRIMARY_POSTGRES_URL` 已配置；`check-shadow-drift.mjs` 新增 `--require-primary-backend` 和 `primaryBackend` 输出，`DISPATCHER_SHADOW_MODE=primary` 继续保留为明确拒绝的旧 shadow mode，避免误当主存储开关。

Review Gate：finished。Spec 符合度通过，本轮把 cutover gate 从 shadow-only 扩展为 shadow + primary backend 双门禁；安全检查通过，未新增 secret 或隐式切主；复杂度检查局部通过，新增逻辑集中在 `check-shadow-drift.mjs`，测试覆盖 primary backend 未选择与已配置两条路径；Document-refresh: needed，原因：production cutover 预检语义变化，已同步 README、API endpoints、runtime-state query 契约、Stage 3 runbook 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts`、`env CI=true RUNTIME_STATE_BACKEND=postgres DISPATCHER_PRIMARY_POSTGRES_URL=postgres://example.invalid/forgeflow DISPATCHER_SHADOW_MODE=disabled DISPATCHER_QUEUE_SHADOW_MODE=disabled DISPATCHER_POSTGRES_URL= node scripts/check-shadow-drift.mjs .forgeflow-dispatcher --require-primary-backend`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：该预检验证配置与 drift 条件，不替代真实生产 Postgres 连通性、备份恢复、RTO/RPO、DNS/进程切换和回滚演练。

- [x] M21 串行：补齐 `/api/query/*` Postgres primary snapshot reads。
- [x] M21 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M21 Review 小结

已补齐 `/api/query/*` 在 `RUNTIME_STATE_BACKEND=postgres` 下的读取路径：`runtime-state-query-store` 新增 async facade，SQLite backend 继续走现有 structured projection，Postgres backend 读取 primary snapshot；dispatcher 的 dashboard/context/metrics/slo/leases/query/projection-health 结构化读取路径统一 await async facade。

Review Gate：finished。Spec 符合度通过，本轮把剩余 query endpoint 从 SQLite-only 收敛为 backend-aware async path；安全检查通过，未新增 secret、隐式切主或静默 fallback，缺少 `DISPATCHER_PRIMARY_POSTGRES_URL` 仍由 Postgres state backend 显式失败；复杂度检查局部通过，新增逻辑集中在 query facade 和 dispatcher route await 调用，新增测试低于 300 行；Document-refresh: needed，原因：`/api/query/*` Postgres backend 能力和剩余 cutover 边界变化，已同步 README、runtime-state query 契约、Stage 3 runbook 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher build`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server-postgres.test.ts tests/modules/server/runtime-state-postgres.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server.test.ts`（默认沙箱因 `listen EPERM 127.0.0.1` 超时后，按同命令非沙箱重跑通过，65 tests passed）、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：完整 production primary-store cutover 还需要生产阈值演练、外部存储运维确认，并重新评估 `DISPATCHER_SHADOW_MODE=primary` 的硬拒绝门禁是否切换为正式开关。

- [x] M20 串行：补齐 dispatcher HTTP route 主链 async Postgres state path。
- [x] M20 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M20 Review 小结

已补齐 dispatcher HTTP route 主链 async Postgres state path：`handleDispatcherHttpRequest()` 升级为 async，`withStateAsync()` 使用 `loadRuntimeStateAsync()` / `saveRuntimeStateAsync()`；`startDispatcherServer()`、state-dir worker client、review decision client 和 runtime glue 都会 await handler，`--persistence-backend postgres` 可设置 `RUNTIME_STATE_BACKEND=postgres`。在 postgres backend 下，route mutation 会通过 `DISPATCHER_PRIMARY_POSTGRES_URL` 和 `@forgeflow/dispatcher-store-postgres` 的 primary snapshot 原语持久化；同步 `loadRuntimeState()` / `saveRuntimeState()` 仍显式失败，避免误用同步路径。

Review Gate：finished。Spec 符合度通过，本轮把 Postgres primary 从 runtime-state async API 推进到 dispatcher HTTP route 主链，并同步修复 async handler 对 state-dir 直连客户端的兼容问题；安全检查通过，未新增 secret、隐式切主或静默 fallback，缺少 `DISPATCHER_PRIMARY_POSTGRES_URL` 会显式失败；复杂度检查局部通过，新增 route-level Postgres 测试低于 300 行，`dispatcher-server.ts` 是既有超大文件，本轮只做必要桥接；Document-refresh: needed，原因：HTTP route 主链 Postgres backend 能力和剩余 structured query cutover 边界变化，已同步 README、runtime-state query 契约、Stage 3 runbook 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher build`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server-postgres.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server.test.ts tests/modules/server/runtime-state-postgres.test.ts`（默认沙箱因 `listen EPERM 127.0.0.1` 超时后，按同命令非沙箱重跑通过，69 tests passed）、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/run-dispatcher-server.test.ts tests/modules/server/runtime-glue.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/submit-review-decision.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher-store-postgres test`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：`/api/query/*` structured read endpoints 仍绑定 SQLite structured projection；完整 production primary-store cutover 还需要 Postgres structured query projection 和生产阈值演练。

- [x] M19 串行：补齐 Postgres primary runtime-state snapshot 包级原语。
- [x] M19 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M19 Review 小结

已在 `@forgeflow/dispatcher-store-postgres` 增加 Postgres primary runtime-state snapshot 原语：`ensurePrimaryRuntimeStateTables()` 创建 `dispatcher_runtime_state` 单行 JSONB snapshot 表，`savePrimaryRuntimeStateSnapshot()` 支持 upsert 当前 runtime state，`loadPrimaryRuntimeStateSnapshot()` 支持读取最新 truth snapshot。该能力目前是包级原语，不改变 dispatcher 默认 SQLite 主链。

Review Gate：finished。Spec 符合度通过，本轮向真实 production cutover 推进了 Postgres primary store 底层读写能力；安全检查通过，未新增 secret、网络副作用或隐式切主，调用方必须显式传入 `PgClientLike`；复杂度检查通过，`packages/dispatcher-store-postgres/src/index.ts` 104 行、测试 74 行；Document-refresh: needed，原因：Postgres primary snapshot 原语状态和剩余 cutover 边界变化，已同步 runtime-state query 契约、Stage 3 runbook 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher-store-postgres test`、`CI=true pnpm --filter @forgeflow/dispatcher-store-postgres typecheck`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：dispatcher 主链仍是同步 `RuntimeStateStore` 接口，尚未接入异步 Postgres primary state path；真实 production cutover 仍未完成。

- [x] M18 串行：补齐 primary cutover 硬门禁，拒绝未实现的 `DISPATCHER_SHADOW_MODE=primary`。
- [x] M18 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M18 Review 小结

已补齐 primary cutover 硬门禁：`DISPATCHER_SHADOW_MODE=primary` 在当前没有 Postgres-backed primary `RuntimeStateStore` 时会被明确拒绝为 `primary_store_not_implemented`；shadow health / drift 会输出 `primary_unsupported`，`verify:shadow-cutover` 不会把 primary 模式误判为可切换。同步把 `runtime-state-shadow.ts` 拆分为 `runtime-state-shadow-drift.ts` 与 `runtime-state-shadow-snapshot.ts`，保留原模块导出路径，降低主文件职责和行数。

Review Gate：finished。Spec 符合度通过，本轮没有把 production cutover 伪装成已支持，而是补齐误启用 primary 的硬失败边界；安全检查通过，未新增 secret、外部写副作用或静默 fallback，primary 模式会显式失败；复杂度检查通过，`runtime-state-shadow.ts` 降至 213 行，新增 drift / snapshot 文件均低于 300 行；Document-refresh: needed，原因：primary 模式语义、cutover gate 失败原因和技术债边界发生变化，已同步 runtime-state query 契约、Stage 3 runbook、API 文档与技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-shadow-health.test.ts tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：真实 production primary-store cutover 仍未完成；下一步必须实现 Postgres-backed `RuntimeStateStore` 的 load/save truth source 或明确把目标收口为 shadow-only rollout。

- [x] M17 串行：补齐 shadow 自动 reconciliation cadence 入口和 production cutover 预检。
- [x] M17 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M17 Review 小结

已为 shadow drift gate 增加显式自动 reconciliation cadence 和生产 cutover 预检：`check-shadow-drift.mjs` 支持 `DISPATCHER_SHADOW_DRIFT_AUTO_RECONCILE=1`、`DISPATCHER_SHADOW_DRIFT_RECORD_ALERT=1`、`DISPATCHER_SHADOW_DRIFT_REQUIRE_CONFIGURED=1`，并新增 `cutover` 输出；`pnpm verify:shadow-drift:reconcile` 会显式执行 `--reconcile --record-alert`，`pnpm verify:shadow-cutover` 会要求 shadow 已配置且 `--max-mismatches 0 --max-delta 0` 通过。默认 `pnpm verify:shadow-drift` 仍保持只读 gate，不自动写运行时状态。

Review Gate：finished。Spec 符合度通过，补齐自动对账入口和 cutover 前置门禁；安全检查通过，默认路径无副作用，写入 runtime event 仍必须显式 `--record-alert` 或 env opt-in；复杂度检查通过，`check-shadow-drift.mjs` 191 行，新增 helper 均短函数；Document-refresh: needed，原因：operator 命令、环境变量、cutover 预检语义和技术债状态发生变化，已同步 `API_ENDPOINTS.md`、Stage 3 runbook、`README.md` 与 `TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts`、`CI=true pnpm verify:shadow-drift`、`CI=true pnpm verify:shadow-drift:reconcile`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。`pnpm verify:shadow-cutover` 在当前未配置 shadow 的本地环境中按设计会失败，该失败语义已由 `fails cutover readiness when shadow is not configured` 测试覆盖。

剩余风险：本轮提供的是显式自动对账入口和 cutover 预检，不等于实际把 Postgres / queue 切为 primary；真正 primary-store 切换仍需要生产阈值演练、外部存储运维确认和回滚流程。

- [x] M16 串行：补齐 Console artifact refs 复制和按需文件展开。
- [x] M16 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M16 Review 小结

已把 Console artifact 展示从 `TaskTimeline.tsx` 拆分到 `ArtifactSummary.tsx`，让 `TaskTimeline.tsx` 保持 attempt timeline / runtime events 职责；refs tab 现在支持复制 `artifact://...` 引用，并通过 `/api/artifacts/:bundleId/files/:fileName` 按需展开 manifest 登记文件正文。同步补充 Console i18n、列表详情测试和 artifact 文档事实。

Review Gate：finished。Spec 符合度通过，完成本轮 Console artifact refs 复制和按需文件展开；安全检查通过，读取路径只使用既有 dispatcher artifact 文件 API，前端对 artifact ref 做 `artifact://<bundleId>/<fileName>` 解析并对路径片段使用 `encodeURIComponent`，未新增 secret、外部网络副作用或静默成功路径；复杂度检查通过，新增 `ArtifactSummary.tsx` 291 行、`TaskTimeline.tsx` 105 行，核心交互已拆成 `ArtifactRefRow`、`readArtifactRefFile` 等 helper；Document-refresh: needed，原因：Console artifact refs 行为从只展示变为可复制和按需展开，已同步 `README.md`、`ARTIFACT_BUNDLE_V1.md` 与 `TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：本轮补齐的是单 task 详情侧 refs 文件展开和复制；下载按钮、跨任务 artifact 筛选、批量审查仍是 Console 审查工作台后续产品化项。

- [x] M15 串行：补齐 dispatcher 级 HITL interrupt/resume 基础协议。
- [x] M15 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M15 Review 小结

已新增 dispatcher 级 HITL interrupt/resume 基础协议：`waiting_for_input` 成为非终态 task / assignment 状态；`interruptTaskForInput()` 会把 `ready` / `assigned` / `in_progress` / `blocked` 任务暂停为 `waiting_for_input`，释放 worker 与 task resource leases，并把 active attempt 标记为 `checkpointed`；`resumeTaskFromInput()` 会保存 `resumePayload`，把任务恢复到 `ready`，并让下一次 claim 能拿到 resume payload。HTTP 新增 `POST /api/tasks/:taskId/interrupt` 与 `POST /api/tasks/:taskId/resume`；SQLite projection 保存 `waiting_for_input_json` 与 `resume_payload_json`；Console 状态 badge 和 i18n 已支持 `waiting_for_input`。

Review Gate：finished。Spec 符合度通过，覆盖 dispatcher 状态函数、HTTP API、SQLite roundtrip、状态枚举和 Console 状态展示；安全检查通过，未新增 secret、外部网络调用、路径访问或静默 fallback；复杂度检查通过，HITL 核心函数已拆分 helper，导出函数保持短流程；Document-refresh: needed，原因：任务状态机、HTTP API、SQLite projection 和技术债状态发生变化，已同步 `STATE_MACHINE.md`、`API_ENDPOINTS.md`、`DATABASE_SCHEMA.md`、`README.md` 与 `TECH_DEBT.md`。结论：通过。

验证已通过：RED 阶段确认 `interruptTaskForInput` 缺失、HTTP interrupt 路由返回 404；GREEN 后通过 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts`（默认沙箱因既有 auth middleware listener 用例 `listen EPERM 127.0.0.1` 失败后，按同命令非沙箱重跑通过，152 tests passed）、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter @forgeflow/task-schema test`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：本轮实现 dispatcher 级统一状态和 API；worker runtime 尚未主动发起 interrupt，也没有 Console 表单化输入 / resume payload 编辑体验，后续需要继续把 worker 主动暂停和 UI 操作接入这条主链。

- [x] M14 串行：补齐结构化可回放 trajectory schema、持久化和 Console 展示。
- [x] M14 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M14 Review 小结

已把 ArtifactBundle 的 trajectory 从可选 refs / retainedContent 字符串提升为结构化 `artifact-trajectory/v1` 字段，step 支持 `sequence`、`phase`、`action`、`observation`、`status`、`command`、`exitCode` 和 `artifactRef`。`packages/result-contracts` 与 `packages/worker-protocol` 已同步 schema；dispatcher 在 worker 未显式提交 trajectory 时，会根据 verification commands 生成默认可回放步骤；artifact store 会把结构化 trajectory 写入 `trajectory.json` 并更新 refs；SQLite projection 新增 `trajectory_json` roundtrip；Console 任务详情新增“轨迹 / Trajectory”tab，按步骤展示 action、observation、status 和命令证据。

Review Gate：finished。Spec 符合度通过，覆盖了结构化 schema、持久化、默认生成和 Console 展示；安全检查通过，未新增 secret、外部网络调用、路径穿越入口或静默 fallback；复杂度检查通过，`TaskTimeline.tsx` 仍低于 300 行，新增 schema / artifact store 改动保持局部；Document-refresh: needed，原因：ArtifactBundle 字段、SQLite projection、Console 展示和 API 描述发生变化，已同步 `ARTIFACT_BUNDLE_V1.md`、`API_ENDPOINTS.md`、`DATABASE_SCHEMA.md`、`README.md` 与 `TECH_DEBT.md`。结论：通过。

验证已通过：RED 阶段确认 `@forgeflow/result-contracts`、`@forgeflow/worker-protocol`、dispatcher artifact / SQLite、Console 测试均失败；GREEN 后通过 `CI=true pnpm --filter @forgeflow/result-contracts test`、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/artifact-store.test.ts`、`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter @forgeflow/result-contracts typecheck`、`CI=true pnpm --filter @forgeflow/worker-protocol typecheck`、`CI=true pnpm --filter @forgeflow/dispatcher typecheck`、`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`CI=true pnpm typecheck`、`git diff --check`。

剩余风险：本轮提供的是 attempt 级结构化可回放轨迹，默认生成来源是 verification commands；如果后续要达到完整 thought / action / observation 原始流，需要各 worker runtime 在执行过程中主动产出更细粒度 step。

- [x] M13 串行：下沉 `run-worker-assignment` 共享执行核心，减少 root / codex / gemini runtime 重复实现。
- [x] M13 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M13 Review 小结

已把 root `scripts/run-worker-assignment.ts`、`@tingrudeng/codex-beta-runtime` 和 `@tingrudeng/gemini-beta-runtime` 的 assignment 执行重复实现下沉到 `packages/beta-runtime-core/src/runtime/run-worker-assignment.ts`、`run-worker-assignment-cli.ts` 与 `run-worker-assignment-types.ts`。共享核心现在统一负责 prompt 拼接、assignment 读取、verification shell / nvm 包装、执行 timeout、workspace dependency symlink、worker-result / raw output / verification 文件写入；root 脚本只保留 dispatcher runtime factory bootstrap，Codex/Gemini 包只保留 provider CLI launch wrapper。新增共享 runner 测试覆盖 dry-run 与真实 launch / verification / result 写入，provider wrapper 测试锁定 Codex/Gemini launch argv。

Review Gate：finished。Spec 符合度通过，完成本轮 runtime executor / launch 去重的第一批可合并改动；安全检查通过，未新增 secret、凭据硬编码、网络副作用或无依据静默 fallback；复杂度检查通过，拆分后新增/修改的 runner 文件均低于 300 行；Document-refresh: needed，原因：worker runtime 去重状态发生变化，已同步 `docs/TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter @tingrudeng/beta-runtime-core test`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core typecheck`、`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test`、`CI=true pnpm --filter @tingrudeng/codex-beta-runtime typecheck`、`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test`、`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime typecheck`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/run-worker-assignment.test.ts`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`CI=true pnpm typecheck`、`git diff --check`。

剩余风险：本轮收敛的是 assignment runner、verification 和 provider launch wrapper；`scripts/lib/worker-daemon.ts` 的 live executor 生命周期仍包含 worktree、child worker execution、commit/push、PR 创建、失败 fallback result 和 cleanup，后续继续下沉时需要单独规划。

- [x] M12 串行：补齐 task-level terminationPolicy timeout 字段的运行时接入。
- [x] M12 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M12 Review 小结

已补齐 task-level `terminationPolicy` timeout 字段的运行时接入：`attemptLeaseTimeoutMs` 会决定 claim / reuse attempt 时的 `leaseExpiresAt`；`heartbeatTimeoutMs` 会在该 task 的 running attempt 过期恢复链路中覆盖 worker offline 判定；`assignmentTimeoutMs` 会在未 claim 的 assigned task 回收中覆盖全局 assignment timeout。未配置 task-level 字段时仍保留原有全局参数和默认值。

本轮按 TDD 执行：先新增 3 个 RED 测试并确认失败，失败分别指向默认 5 分钟 attempt lease、默认 heartbeat timeout 和未使用 task-level assignment timeout；再实现最小逻辑并确认 GREEN。Review Gate：finished。Spec 符合度通过；安全检查通过，未新增 secret、外部输入拼接、网络调用或静默 fallback；复杂度检查通过，改动集中在 timeout resolver 与调用点；Document-refresh: needed，原因：termination policy 的 timeout 字段从 schema-only 变为 runtime 生效，已同步 `TASK_ATTEMPT_MODEL.md` 和 `TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：本轮只补齐 dispatcher runtime-state 的 task-level timeout 主链；如果未来要把同一策略暴露到外部 SDK 文档或 Console 表单，还需要单独做 API / UI 层体验设计。

- [x] M11 串行：批次一，收敛 worker runtime 重复实现，优先统一 daemon cycle 与可发布 runtime 的核心行为。
- [x] M11 串行：批次二，补齐 trajectory artifact 协议、落盘与读取体验。
- [x] M11 串行：批次三，统一 HITL interrupt / resume 与 termination policy。
- [x] M11 串行：批次四，完善 shadow / DR 产品化门禁与 Console 审查工作台体验。
- [x] M11 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M11 Review 小结

已按四个批次完成本轮深度审查后的收敛优化：worker daemon 脚本侧主循环改为复用 dispatcher runtime-glue 的 `runWorkerDaemonCycle`，脚本侧只保留真实 worktree / worker 执行器与失败结果 fallback，并删除旧 `processTaskAssignment` 重复主循环；ArtifactBundle 协议、worker-protocol、artifact store、Console retained content 与文档已补齐 `trajectory` 引用和 retained 正文落盘；task schema、runtime-state 和 SQLite projection 已支持 task-level `terminationPolicy.maxAttempts`，并在 reconcile 过期 attempt 时优先使用任务级终止策略；shadow drift gate 已支持 `DISPATCHER_SHADOW_DRIFT_MAX_MISMATCHES` 与 `DISPATCHER_SHADOW_DRIFT_MAX_DELTA` 环境变量，runbook / API 文档同步到 release / rollout gate 用法。

Review Gate：finished。Spec 符合度通过，四个已确认批次均有代码、测试与文档落点；安全检查通过，未新增真实 secret、凭据硬编码或无依据静默降级，新增 shadow drift 环境变量会校验为非负数；复杂度检查通过，本轮未引入新的跨模块大重构，脚本侧还删除了旧重复函数；Document-refresh: needed，原因：协议、artifact、termination policy、shadow gate 行为发生变化，已同步对应契约、runbook 和技术债文档。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-glue.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/artifact-store.test.ts tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/execution/shadow-drift.test.ts`、`CI=true pnpm --filter @forgeflow/result-contracts test`、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter @forgeflow/task-schema test`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 -m py_compile scripts/validate_docs.py`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check`。全量 `CI=true pnpm test` 在默认沙箱下先因 `listen EPERM 127.0.0.1` 与写入 `~/.forgeflow-trae-beta` 权限受限失败；按同一命令在非沙箱环境重跑后通过，覆盖 24 个 workspace project，其中 dispatcher 43 个测试文件 / 461 个测试全部通过。

剩余风险：task-level termination policy 当前只实际接入 `maxAttempts`，`attemptLeaseTimeoutMs`、`heartbeatTimeoutMs`、`assignmentTimeoutMs` 已进入 schema 但尚未接入对应超时调度逻辑；worker daemon 去重已收敛脚本主循环，但 `packages/beta-runtime-core` 仍保留自己的 runtime 实现路径，后续若继续追求单一实现还需要单独规划；shadow drift env gate 是 release / rollout 可配置阈值，不等于后台自动 reconciliation。

- [x] M10 串行：修复 `@tingrudeng/codex-beta-runtime` / `@tingrudeng/gemini-beta-runtime` 与 dispatcher v1 claim/envelope/token 协议漂移，并补协议测试。
- [x] M10 串行：修复 `runtime-glue-dispatcher-client` 的 worker cycle envelope 类型与测试，避免旧 payload 被测试固化。
- [x] M10 串行：收紧 release 自动发布门禁，避免 push 到 main 后绕过 CI 直接发布 npm 包。
- [x] M10 串行：补齐 Console 审查结构化表单、风险确认、错误反馈和 token 配置文档。
- [x] M10 串行：同步已过期文档事实，运行最小充分验证并补充 review 小结。

## M10 Review 小结

已修复远程 `@tingrudeng/codex-beta-runtime` / `@tingrudeng/gemini-beta-runtime` 与 dispatcher v1 worker 协议漂移：worker daemon 现在通过 `POST /api/workers/:workerId/claim-task` 领取任务，带 `DISPATCHER_API_TOKEN` 时发送 bearer token，并把 dispatcher 返回的 `attemptId`、`leaseToken`、`protocolVersion`、`traceId`、`idempotencyKey` 透传到 start/result mutation。同步修复 `runtime-glue-dispatcher-client` 的 worker cycle envelope，避免源码测试继续固化旧 payload。

已收紧 release 自动发布门禁：`.github/workflows/release.yml` 的 push 自动发布在 `npm publish` 前先执行 lint、文档校验、typecheck、测试和 shadow drift gate，并用 workflow 测试锁定顺序。Console 任务详情补齐结构化审查表单、风险确认、review decision 错误反馈和 token 配置文档；相关文档入口已同步到 `README.md`、`docs/README.md`、`docs/onboarding.md`、runtime 包 README、`TECH_DEBT.md`、`KNOWN_PITFALLS.md` 和 `ARTIFACT_BUNDLE_V1.md`。

验证已通过：`pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check`、runtime / dispatcher 受影响 Vitest、Console 受影响 Vitest，以及 `tsc --noEmit` 覆盖 codex runtime、gemini runtime、dispatcher 和 Console。`pnpm docs:validate` 初次因 pnpm 依赖状态检查在受限网络下触发 registry 访问被中止；恢复依赖后已重新通过。

剩余风险：本轮未跑全量 `pnpm test` / `pnpm typecheck`，只跑了受影响测试和受影响包类型检查；release workflow 的全量门禁需要在 GitHub Actions 上由真实 CI 环境最终验证。

- [x] M9 串行：第 1 轮 Artifact store + retention，支持 artifact 文件落盘、索引、保留策略和按需读取。
- [x] M9 串行：第 2 轮 shadow reconciliation + alerting，定义 drift 阈值、告警事件和自动对账入口。
- [x] M9 串行：第 3 轮 Console review workflow，打通 artifact / attempt / review decision 的审查操作链路。
- [x] M9 串行：第 4 轮移除 v0 / 空 envelope 兼容路径，保留可审计迁移边界。
- [x] M9 串行：第 5 轮生产级 DR 多场景 drill，覆盖 host failure、磁盘损坏和多节点恢复验收。
- [x] M9 串行：第 6 轮 Worker SDK / 第三方准入，稳定 worker 接入 API、provider capability 和准入门禁。

## M9 第 1 轮 Review 小结

已新增 dispatcher 本地 artifact store：worker v1 result 与 Trae submit-result 成功记录 ArtifactBundle 后，会把 `retainedContent.diff`、`retainedContent.logs`、`retainedContent.testResults` 写入 `${stateDir}/artifacts/<bundle-dir>/`，生成 `manifest.json` 索引，并把 bundle refs 更新为 `artifact://<bundleId>/<fileName>`。新增 `/api/artifacts/:bundleId/files/:fileName` 按需读取 manifest 登记文件，拒绝路径穿越；CLI `artifact-get --file <name>` 支持 dispatcher URL 与本地 state-dir 两种读取模式。保留策略通过 `DISPATCHER_ARTIFACT_RETENTION_MAX_BUNDLES` 控制，默认保留 100 个 bundle。

验证已通过：Artifact store 单测先因模块缺失失败后通过；worker v1 artifact HTTP 集成测试先因 refs 未更新失败后通过；Trae submit-result artifact 测试先因 refs 未更新失败后通过；CLI `artifact-get --file` 注入测试先失败后通过；`tests/artifact.test.ts`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：artifact store 当前是 dispatcher stateDir 下的本地文件 store，不是远端对象存储；Console 仍展示 retainedContent tabs，按需文件展开 / 下载体验留到第 3 轮 Console review workflow 处理。

## M9 第 2 轮 Review 小结

已为 shadow drift 增加阈值化告警和 operator 对账入口：`evaluateRuntimeStateShadowDriftAlert` 会根据 mismatch 数量和绝对 delta 输出 `none` / `warning` / `critical`；`scripts/check-shadow-drift.mjs` 支持 `--max-mismatches`、`--max-delta`、`--reconcile` 和 `--record-alert`。默认 `pnpm verify:shadow-drift` / release gate 仍只读无副作用；operator 显式使用 `--reconcile` 时会把当前 SQLite truth 重放到 shadow projection / queue 后复查；显式使用 `--record-alert` 时会写入 `shadow_drift_detected` system event。

验证已通过：shadow alert RED 测试先因函数缺失失败后通过；shadow drift 脚本 RED 测试先因 usage 拒绝新参数失败后通过；`runtime-state-shadow-health.test.ts`、`shadow-drift.test.ts`、`workflows.test.ts`、`pnpm docs:validate`、`pnpm lint`、`pnpm typecheck`、`git diff --check` 均通过。

剩余风险：自动对账当前是 operator 显式命令，不是后台定时任务；`--record-alert` 是显式写事件入口，默认 release gate 不写 runtime-state，避免 CI/release gate 产生隐式状态副作用。

## M9 第 3 轮 Review 小结

已打通 Console review workflow 最小闭环：任务详情页保留 attempt timeline、runtime events、artifact summary / refs / retained content，并在任务处于 `review` 状态时提供 `merge` / `rework` / `block` 审查按钮。App 会将决策提交到 `/api/reviews/:taskId/decision`，写入 actor、notes、时间戳并刷新 dashboard snapshot。

验证已通过：Console RED 测试先因缺少合并按钮和 App 提交链路失败后通过；`pnpm --filter console exec vitest run`、`pnpm --filter console build`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：Console 当前提交固定 notes 和 actor，不提供 reason code / must-fix 表单；artifact 文件 API 已可按需读取，但 Console 侧 refs 仍以展示为主，文件展开 / 下载体验后续可继续细化。

## M9 第 4 轮 Review 小结

已移除 dispatcher worker mutation 的 v0 / 空 envelope 兼容路径：claim 后的通用 worker start/result、Trae start/result 都必须携带 `attemptId`、`leaseToken`、`protocolVersion`、`traceId` 和 `idempotencyKey`，缺字段、无 active attempt 或 stale attempt 写入都会被拒绝。同步把旧测试夹具改为先 claim/start 再提交 result，并把 Worker Protocol、Task Attempt、API 和技术债文档里的旧兼容表述改为当前事实。

验证已通过：新增/调整的 RED 测试先暴露空 envelope 仍可被旧夹具绕过，修复后 `pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts tests/modules/server/runtime-dispatcher-server.test.ts`、`pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/clients.test.ts tests/runtime/worker.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：独立 progress mutation 仍未升级为 attempt 级 v1 endpoint；Worker Protocol package 的目标 schema 仍未成为 dispatcher HTTP route 的唯一请求解析入口。

## M9 第 5 轮 Review 小结

已把 live dispatcher DR drill 扩展为多场景验收：`scripts/verify-live-dispatcher-dr.mjs` 现在会在 live HTTP 写入期间备份，恢复前主动破坏当前 SQLite runtime 文件，校验磁盘损坏后可从备份恢复；同时通过 `SIGKILL` 子进程模拟 host / 进程丢失并在替换 stateDir 拉起 dispatcher；还会把同一备份恢复到两个独立 stateDir，启动两个 dispatcher 并校验 task / event 计数一致。同步修正旧 dist/bridge 测试夹具，使其遵守第 4 轮完整 v1 envelope 主链。

验证已通过：RED 测试先失败于 `hostFailure` 输出缺失；修复后 `pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/stage3-live-dr.test.ts`、`node scripts/verify-live-dispatcher-dr.mjs`、`pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-state.test.ts tests/modules/server/submit-review-decision.test.ts`、`pnpm verify:stage3`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：当前多节点恢复是本地双 stateDir 一致性验收，不等同真实跨主机 quorum / fencing / DNS 切流演练；物理断电仍需生产环境 runbook 单独覆盖。

## M9 第 6 轮 Review 小结

已落地内部 Worker SDK / 第三方准入最小闭环：`@forgeflow/worker-protocol` 新增 `WorkerSdkStartPayloadSchema`、`WorkerSdkResultPayloadSchema`、`buildWorkerStartPayload` 和 `buildWorkerResultPayload`，用于 worker adapter 复用完整 v1 envelope 构造 start/result payload；`@forgeflow/provider-registry` 新增 `evaluateProviderAdmission`，已知 provider 按支持模式和权限键校验，未知第三方 provider 默认拒绝，只有白名单且声明 `worker-protocol-v1` 时才放行。同步更新 README、Worker Protocol、provider capability contract、Stage 3 runbook 和技术债文档。

验证已通过：RED 测试先失败于 helper / admission gate 缺失；修复后 `pnpm --filter @forgeflow/worker-protocol test`、`pnpm --filter @forgeflow/worker-protocol typecheck`、`pnpm --filter @forgeflow/provider-registry test`、`pnpm --filter @forgeflow/provider-registry typecheck`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：当前 helper 是仓库内部 SDK 契约，不等于公网 npm SDK 长期兼容承诺；第三方 provider admission 仍是代码级白名单门禁，没有自助注册 / 撤销后台。

- [x] M8 串行：收尾 PR #112 后的本地分支和远端分支状态。
- [x] M8 串行：同步 read-only `/api` 写方法冻结的文档事实。
- [x] M8 串行：对齐 Trae automation gateway 双实现差异并补共享测试。
- [x] M8 串行：推进 repo / branch / session lease 强约束。
- [x] M8 串行：推进 v1 worker protocol 强制化和可配置 retry policy。
- [x] M8 串行：推进 ArtifactBundle retention 与 review workflow / Console artifact tabs。
- [x] M8 串行：把 shadow drift 巡检接入 release / rollout gate。
- [x] M8 串行：增强生产级 DR 演练覆盖。

## M8 Review 小结

已完成平台硬化 8 项：收尾旧 Trae 分支并建立新迭代分支；同步 read-only 文档事实；对齐 scripts/lib Trae gateway 的 metadata/debugLog/session 解析；把 task claim lease 扩展到 assignment / repo / branch / session；对 claim-backed start/result 强制完整 v1 envelope，并支持 `maxTaskAttempts` retry policy；ArtifactBundle 支持受限 retainedContent 并在 Console 提供摘要 / 引用 / 正文 tabs；`verify:stage3` 与 release workflow 接入 shadow drift gate；live DR drill 增加 SIGKILL crash/restart 恢复验证。

验证已通过：result-contracts、Console Lists、Trae gateway/session-store、runtime-state、runtime-state-sqlite、dispatcher-server、shadow-drift/workflows/stage3-live-dr、`pnpm test`、`pnpm verify:stage3`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check`。

剩余风险：read-only 仍只覆盖 dispatcher HTTP API 写方法；repo / branch / session lease 约束 dispatcher task 生命周期，不覆盖 dispatcher 外部直接操作；ArtifactBundle 仍没有完整 artifact store 与清理策略；shadow drift gate 不等于自动 reconciliation；DR drill 已覆盖 SIGKILL restart，但仍不是物理断电、磁盘损坏或多节点仲裁恢复演练。

- [x] M7 串行：对齐 scripts/lib Trae gateway 默认 session-store 路径到发布包路径。
- [x] M7 串行：补充路径契约测试并同步文档。
- [x] M7 串行：运行验证、Review Gate 并提交本地变更。

- [x] M6 串行：对齐 `scripts/lib` Trae gateway prepare-session 会话状态。
- [x] M6 串行：补充 source / packaged gateway parity 测试。
- [x] M6 串行：修正 Trae gateway 技术债事实并运行验证。
- [x] M6 串行：Review Gate 并提交本地变更。

- [x] M5 串行：手动发布 post-publish git record 失败时自动创建恢复 issue。
- [x] M5 串行：补充 workflow 测试和 release 文档。
- [x] M5 串行：运行验证、Review Gate 并提交本地变更。

- [x] M4 串行：新增 shadow drift operator check，比较 SQLite truth source 与 shadow projection / queue counts。
- [x] M4 串行：补充 drift summary 单测和 CLI 脚本测试。
- [x] M4 串行：同步 runbook、API / DB 文档和技术债边界。
- [x] M4 串行：运行验证、Review Gate 并提交本地变更。

- [x] M3 串行：新增 live dispatcher DR drill 脚本，覆盖真实 HTTP 写入期间的 SQLite/WAL 备份恢复。
- [x] M3 串行：补充脚本级测试和 `verify:stage3:live` 命令入口。
- [x] M3 串行：同步 DR runbook、技术债和 README 的演练边界。
- [x] M3 串行：运行验证、Review Gate 并提交本地变更。

- [x] 修复 dispatcher read-only 写冻结缺口，补齐真实写路由拦截，并避免只读 GET 在 read-only 下落盘。
- [x] 将 dispatcher POST 鉴权前置到 body 解析之前，并补充 worker register 结构化输入校验。
- [x] 让 shadow 写失败可观测，并把 shadow health 接入 DR 状态。
- [x] 将 DR drill 升级为真实 SQLite/WAL 备份恢复验证。
- [x] 将文档校验接入 CI，并修正手动发布版本不可追踪问题。
- [x] 运行最小充分验证并补充 review 小结。

## Review 小结

已修复 read-only 写冻结、POST 鉴权前置、worker register 输入校验、shadow 写失败可观测、真实 SQLite DR 演练、CI 文档门禁和手动发布版本落账问题。

验证已通过：`pnpm docs:validate`、`git diff --check`、受影响 dispatcher 测试、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm -r --if-present build`、`pnpm coverage:critical`。

剩余风险：非 assignment lease 仍只是结构与指标层能力，repo/branch/session 强约束需要后续单独设计；手动发布现在先 commit/tag/push 再 publish，若 npm publish 失败，git 历史中会保留未发布版本，需要按发布 runbook 人工处置。

# Goal 2：收窄 lease 为 assignment-only

- [x] 新增测试，锁定 dashboard active lease 指标只暴露 assignment 资源类型。
- [x] 将 lease 类型、聚合指标和 SQLite session 投影收窄到 assignment-only。
- [x] 同步更新 runtime-state query 契约、指标 runbook 和已知坑文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已将 dispatcher lease 模型收窄为 assignment-only：`LeaseResourceType` 只允许 `assignment`，dashboard `activeLeases.byResourceType` 只输出 assignment 计数，SQLite 结构化投影不再从 `session` lease 写入 `sessions` 表。已同步权威文档，明确 repo/branch/session 不是当前 lease 强约束能力。

验证已通过：新增测试先失败后通过，`pnpm --filter @forgeflow/dispatcher test tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm docs:validate`、`pnpm typecheck`、`pnpm lint`、`git diff --check`、`pnpm verify:stage3`。

剩余风险：历史 runtime snapshot 如果人工写入过非 assignment lease，当前变更不会为它们提供迁移语义；repo/branch/session 的真实强约束仍需后续按独立 Goal 设计。

# 成熟产品验收：read-only 硬冻结

- [x] 补充 RED 测试，证明 read-only 模式会拒绝未来新增或遗漏登记的 `/api` 写请求。
- [x] 将 read-only mutation 判断从手写路由列表收敛为默认拒绝 `/api` 写方法。
- [x] 同步 `API_ENDPOINTS`、Stage 3 runbook 和技术债文档，移除 read-only matcher 漂移风险。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已将 read-only 模式从手写写路由列表收敛为默认冻结 `/api` 下 `POST` / `PUT` / `PATCH` / `DELETE`，并新增未登记 `/api/future-write` 的回归测试，避免后续新增写路由遗漏 matcher 后绕过冻结。

验证已通过：RED 测试先返回 `404` 后修复为 `503 read_only_mode`；`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 全部通过。

剩余风险：read-only 只冻结 dispatcher HTTP API 写方法；直接修改运行时文件、外部数据库或操作系统层面的写入仍需由运维流程单独管控。

# 成熟产品验收：技术债事实同步

- [x] 对照真实代码核对 shadow status、Stage 3 DR drill 和 release workflow 的技术债描述。
- [x] 修正 `docs/TECH_DEBT.md` 中已过期或过度表述的债务项。
- [x] 修正 DR runbook 中对 `verify-stage3-dr` 的过期边界说明。
- [x] 运行文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已按真实代码修正技术债事实：shadow 写失败已经通过 `/api/dr/status` 暴露 in-memory 状态，但尚未持久化为运行时事件；`verify-stage3-dr` 已经创建真实 SQLite 并校验 integrity/checksum，但仍不是 live dispatcher WAL 压力演练；手动 release 已先 commit/tag/push 再 publish，剩余风险是 publish 失败后 git 版本领先 npm。

验证已通过：`pnpm docs:validate`、`git diff --check`。

剩余风险：本批只同步文档事实，不实现持久化 shadow failure event、live DR 压力演练或 release 失败自动恢复。

# 成熟产品验收：Trae attempt lease envelope

- [x] 补充 RED 测试，证明 Trae runtime start/result 会携带 dispatcher 返回的 `attempt_id` / `lease_token`。
- [x] 补充 RED 测试，证明 Trae dispatcher 路由会把 `attempt_id` / `lease_token` 传入状态机校验。
- [x] 修改 Trae runtime client 与 worker，传递 `attemptId` / `leaseToken`。
- [x] 修改 dispatcher Trae start/result 路由，透传 attempt lease 字段。
- [x] 同步 Worker Protocol / TaskAttempt / 技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已把 Trae 主链从“fetch 返回 attempt lease 但 runtime 不使用”推进到 start/result 回写携带并校验 `attempt_id` / `lease_token`。同时修复 `runtime-dispatcher-server.ts:overwriteRuntimeState` 漏复制 `taskAttempts` / `artifactBundles` 的状态覆盖缺口，以及 SQLite projection 重写时未清空 `artifact_bundles` 导致重复插入的缺口。

验证已通过：Trae runtime RED 测试先失败，dispatcher RED 测试先暴露 attempt 缺失与 stale lease 未校验；修复后 `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 全部通过。

剩余风险：Trae 仍使用 v0 兼容路由，尚未强制完整 v1 envelope 的 `protocolVersion`、`traceId` 和 `idempotencyKey`。

# 成熟产品验收：v1 worker envelope 最小闭环

- [x] 补充 RED 测试，证明 Trae runtime start/result 会携带 `protocol_version`、`trace_id` 和 `idempotency_key`。
- [x] 补充 RED 测试，证明 dispatcher Trae fetch-task 会返回完整 envelope，并拒绝 v1 envelope mismatch。
- [x] 实现 Trae runtime 与 dispatcher 之间的完整 envelope 透传和 active attempt 校验。
- [x] 同步 Worker Protocol / TaskAttempt / 技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成 Trae 主链 v1 envelope 最小闭环：`fetch-task` 返回 `protocol_version`、`trace_id`、`idempotency_key`，Trae runtime 在 start/result 回写时携带这些字段，dispatcher 对声明 v1 envelope 的 start/result 写入校验 active attempt 的协议版本、traceId 和 idempotencyKey。

验证已通过：RED 测试先失败于缺失完整 envelope 字段；修复后 `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 通过。

剩余风险：通用 v0 worker routes 仍保留空 envelope 兼容；跨请求 idempotency payload 冲突检测尚未实现。

# 成熟产品验收：shadow 写失败 durable health record

- [x] 补充 RED 测试，证明 shadow 写失败会落 `runtime-state-shadow-status.json`。
- [x] 实现 shadow 写状态文件持久化，并让 `/api/dr/status` 读取 stateDir 下的 durable record。
- [x] 保持 shadow 写失败不影响 SQLite 主链写入结果。
- [x] 同步 Stage 3 / DR runbook 和技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成 shadow 写状态 durable health record：shadow sync 成功、跳过或失败后写入 `runtime-state-shadow-status.json`，`/api/dr/status.shadowWrite` 合并读取 stateDir 下的记录，源码脚本与打包 dispatcher runtime 的 backup/restore 都会复制该文件。

验证已通过：RED 测试先失败于未生成 health record、DR status 未读取持久化记录，以及缺少 shadow health 选择逻辑；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/runtime-state-shadow-health.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm --filter @tingrudeng/forgeflow-dispatcher test -- tests/backup.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check`、`pnpm verify:stage3` 通过。

剩余风险：shadow failure 仍不是 `RuntimeState.events[]` 中的一等审计事件；shadow drift 自动对账和 primary cutover 仍需单独设计。

# 成熟产品验收：通用 worker v1 envelope 校验

- [x] 补 RED 测试，证明通用 worker start/result 声明 v1 envelope 时会校验 trace/idempotency mismatch。
- [x] 将通用 worker start/result 路由补齐 `protocolVersion`、`traceId`、`idempotencyKey` 传参。
- [x] 同步技术债和任务记录中该缺口状态。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成通用 worker v1 envelope 校验补齐：`/api/workers/:workerId/start-task` 和 `/api/workers/:workerId/result` 会把 `protocolVersion`、`traceId`、`idempotencyKey` 传入状态机，声明 v1 envelope 时必须与 active attempt 一致。空 envelope 的 v0 worker 兼容路径保持不变。

验证已通过：RED 测试先失败于错误 `traceId` 仍返回 200；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 通过。

剩余风险：跨请求 idempotency payload 指纹冲突检测尚未实现；空 envelope v0 worker 兼容路径仍保留，后续是否强制升级需要单独评估。

# 成熟产品验收：Stage 3 DR WAL 演练

- [x] 补 RED 测试，要求 DR 脚本输出 `walIncluded: true` 且恢复多条 snapshot。
- [x] 调整 DR 脚本，在打开的 WAL 连接上写入多轮 snapshot 后执行备份。
- [x] 同步 runbook 和技术债边界。
- [x] 运行受影响测试、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成 Stage 3 DR WAL 演练升级：`verify-stage3-dr` 会在打开的 WAL 连接上写入 4 条 snapshot，备份时确认包含 `runtime-state.db-wal`，恢复后校验 integrity、snapshot count、latest sequence 和 checksum。

验证已通过：RED 测试先失败于缺少 `walIncluded`；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/execution/stage3-dr.test.ts`、`node scripts/verify-stage3-dr.mjs`、`pnpm docs:validate`、`git diff --check`、`pnpm verify:stage3` 通过。

剩余风险：该脚本仍不是 live dispatcher 并发写入、锁竞争或崩溃恢复演练；生产级 DR drill 仍需单独设计。

# project-context-bootstrap 上下文文档升级

## 目标

使用 `project-context-bootstrap` 技能升级当前仓库上下文包，保留已有中文文档体系和 ForgeFlow 项目事实。

## 非目标

- 不生成 Android MVP profile 文档，因为仓库没有 Gradle 或 Android Manifest 信号。
- 不粗暴覆盖现有 `README.md`、架构、接口、数据库或 runbook 详情文档。
- 不新增工具专属适配文档。

## 当前事实

- 已存在 `AGENTS.md`、`docs/README.md`、`docs/AI_CONTEXT.md` 和 `scripts/validate_docs.py`，本次走 upgrade mode。
- 当前文档主体语言是中文，应继续使用简体中文。
- `package.json` 已提供 `docs:validate`、`test`、`typecheck`、`verify:stage2`、`verify:stage3`。
- 技能 canonical validator 要求 `--profile`、frontmatter `ai_summary`、`source_of_truth` 路径、具体 `verify_with` 命令和 legacy detail docs 边界。

## 决策日志

- 采用核心包原地升级方案，只升级上下文入口和校验器。
- 使用 `docs/README.md` 的 `## Legacy detail docs` 标记旧详情文档边界，避免把历史文档当作新契约文档强制改写。
- 校验器保持 canonical 行为，但跳过 `.git`、`node_modules`、`.worktrees` 等本地依赖或运行时目录，避免无关 Markdown 链接污染校验结果。

## 执行计划

- [x] 升级 `scripts/validate_docs.py`，支持 generic/android profile、frontmatter 摘要、legacy detail docs 和本地链接校验。
- [x] 升级 `docs/AI_CONTEXT.md` 为当前技能契约，同时保留 ForgeFlow 关键上下文。
- [x] 升级 `docs/README.md` 的元信息、阅读路径和 legacy detail docs 边界。
- [x] 升级 `AGENTS.md` 的上下文入口说明和验证命令。
- [x] 运行文档校验、Python 编译校验和 diff 检查，并修复发现的问题。
- [x] 使用 review-gate 做交付前审查并补充 Review 小结。

## 验证矩阵

- quick: `python3 -m py_compile scripts/validate_docs.py`
- quick: `python3 scripts/validate_docs.py . --profile generic`
- quick: `pnpm docs:validate`
- quick: `git diff --check`

## 进度记录

- [x] 已完成只读现状分析并获得用户确认。
- [x] 已完成核心包升级，未生成 Android MVP profile 文档。
- [x] 第一轮校验发现 legacy detail docs 解析误命中行内代码、历史 `docs/superpowers` 链接被扫描；已修复为按二级标题匹配 legacy 区域，并跳过历史目录。
- [x] 校验器文件已压缩到 300 行以内。

## 验证结果

- `python3 -m py_compile scripts/validate_docs.py` 通过。
- `python3 scripts/validate_docs.py . --profile generic` 通过。
- `pnpm docs:validate` 通过。
- `python3 scripts/validate_docs.py /Users/dengtingru/.agents/skills/project-context-bootstrap/examples/fixtures/android-client-context --profile android` 通过。
- `git diff --check` 通过。

## Review 小结

终态：finished。

Spec 符合度：通过。已升级核心上下文包：`AGENTS.md`、`docs/README.md`、`docs/AI_CONTEXT.md`、`scripts/validate_docs.py`。本次采用 upgrade mode，没有覆盖旧详情文档，而是在 `docs/README.md` 标明 legacy detail docs 边界，并用校验器保证核心上下文包、frontmatter、source_of_truth、verify_with 和本地链接可验证。

安全检查：通过。未新增 secret、凭据或网络调用；校验脚本只读取本地 Markdown 和路径。

测试与验证：通过。`python3 -m py_compile scripts/validate_docs.py`、`python3 scripts/validate_docs.py . --profile generic`、`pnpm docs:validate`、Android fixture profile 校验和 `git diff --check` 均通过。

复杂度检查：通过。`scripts/validate_docs.py` 为 299 行，所有函数均不超过 50 行；`docs/AI_CONTEXT.md` 为 107 行，未超过上下文预算。

Document-refresh: needed
原因：本次任务目标就是升级上下文文档体系，已同步 `AGENTS.md`、`docs/README.md` 和 `docs/AI_CONTEXT.md`。

## 二轮审查修复小结

- [x] 删除 `AGENTS.md` 内旧 fenced `ai_summary`，避免新 frontmatter 和旧摘要双头并存。
- [x] 将 `docs/README.md` 的 `Authority Map` 收敛为 `Detailed Doc Map`，明确 legacy detail docs 不能单独替代代码和验证命令。
- [x] 在 `docs/AI_CONTEXT.md` 增加非 Trae runtime / npm 包的读取路径，避免 Trae-first 被误读成只维护 Trae。
- [x] 升级 `scripts/validate_docs.py`，把 `AGENTS.md` 纳入 authority doc 校验，并拒绝重复 `ai_summary:`。

二轮验证已通过：`python3 scripts/validate_docs.py . --profile generic`、`pnpm docs:validate`、`python3 -m py_compile scripts/validate_docs.py`、`git diff --check`。

剩余风险：旧格式详情文档尚未逐份迁移到新 authority doc contract；本次通过 legacy 边界要求使用时回到代码和命令验证。

潜在技术债：后续如果要让所有稳定详情文档也进入新契约，需要逐份补 frontmatter、source_of_truth 和验证命令，不能批量套模板。

结论：通过。

# 2026-07-03 beta runtime 重复实现漂移门禁

## 目标

治理 Codex/Gemini packaged runtime 的重复实现风险。当前两个包的 `worker-daemon.ts` 和 `task-worktree.ts` 完全一致，`run-worker-assignment.ts` 因 Codex/Gemini CLI 参数不同不纳入一致性门禁。

## 执行计划

- [x] P1 串行：补 parity gate，要求两个 beta runtime 的共享 worker daemon / task worktree 源文件保持一致。
- [x] P2 串行：实现最小 parity 测试辅助函数。
- [x] P3 串行：运行 beta runtime 测试、typecheck、lint、docs 校验和 diff 检查。
- [x] P4 串行：执行 review-gate 并补充收尾小结。

## 并行说明

本轮不使用 subagent。改动集中在测试门禁与任务记录，串行处理可以避免误改发布结构。

## 验证结果

- `CI=true pnpm --filter @tingrudeng/codex-beta-runtime test`：通过，3 个测试文件 / 9 个测试。
- `CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test`：通过，2 个测试文件 / 8 个测试。
- `CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher test`：通过，43 个测试文件 / 456 个测试。
- `CI=true HOME=/private/tmp/forgeflow-test-home pnpm test`：通过，递归全量测试通过。
- `CI=true pnpm typecheck`：通过。
- `CI=true pnpm lint`：通过。
- `CI=true pnpm docs:validate`：通过。
- `git diff --check`：通过。

## Review-gate 小结

终态：finished

Spec 符合度：符合。新增 parity gate 覆盖 Codex/Gemini beta runtime 的共享 `worker-daemon.ts` 与 `task-worktree.ts`，没有把 provider CLI 差异文件纳入强一致。

安全检查：未新增 secret、外部输入处理或网络写入路径。

测试与验证：最小包测试、dispatcher 集成测试、全量测试、typecheck、lint、docs 校验和 diff 检查均已通过。

复杂度检查：新增测试辅助函数短小，dispatcher 测试脚本变更只显式绑定已有配置；未新增复杂分支。

Document-refresh: not-needed
原因：本轮只新增测试门禁和测试运行配置，不改变用户能力、协议或对外文档语义。

剩余风险：parity gate 阻止共享源文件单边漂移，但尚未把重复实现抽成真正共享发布模块。

潜在技术债：后续若要彻底去重，需要设计 beta runtime 共享包的发布、版本和回滚边界，不能只靠测试一致性长期替代抽象。

结论：通过。

# 2026-07-03 dispatcher 全量测试稳定性修复

## 目标

处理上一轮剩余风险：全量 `pnpm test` 中 dispatcher 环境敏感测试失败，尤其是 JSON stdout 污染、live DR child ready 解析和 dist build lock 连锁超时。

## 执行计划

- [x] P1 串行：定位 `shadow-drift` / `submit-review-decision` stdout JSON 污染根因。
- [x] P1 串行：定位 `stage3-live-dr` 中 `undefined/api/workers/register` 与 child ready 超时根因。
- [x] P2 串行：将 dispatcher dist 自动构建日志从 stdout 移到 stderr，保持 JSON CLI stdout 纯净。
- [x] P2 串行：增强 live DR child ready 解析，只接受包含 `status=listening` 和 `baseUrl` 的 JSON 对象。
- [x] P2 串行：live DR child 进程设置 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1`，避免 readiness 窗口内重复构建。
- [x] P3 串行：复跑失败子集、完整验证组合和全量测试。
- [x] P4 串行：执行 review-gate 并补充收尾小结。

## 验证结果

- RED：`CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/stage3-live-dr.test.ts --maxWorkers=1` 先失败于 child ready 超时；此前全量测试还失败于 stdout JSON 污染和 dist build lock 连锁超时。
- GREEN：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/server/submit-review-decision.test.ts --maxWorkers=1` 通过，2 个测试文件、6 个测试通过。
- GREEN：`CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/stage3-live-dr.test.ts --maxWorkers=1` 通过，1 个测试文件、1 个测试通过。
- GREEN：`CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/server/submit-review-decision.test.ts tests/modules/execution/stage3-live-dr.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/trae-automation-worker.test.ts --maxWorkers=1` 通过，5 个测试文件、27 个测试通过。
- GREEN：`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test` 通过，2 个测试文件、7 个测试通过。
- GREEN：`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test` 通过，2 个测试文件、8 个测试通过。
- GREEN：`CI=true pnpm --filter @forgeflow/provider-registry test` 通过，1 个测试文件、7 个测试通过。
- GREEN：`CI=true pnpm --filter console build` 通过。
- GREEN：`CI=true pnpm typecheck` 通过。
- GREEN：`CI=true pnpm lint` 通过。
- GREEN：`CI=true pnpm docs:validate` 通过。
- GREEN：`git diff --check` 通过。
- GREEN：`CI=true HOME=/private/tmp/forgeflow-test-home pnpm test` 非沙箱通过；dispatcher 43 个测试文件、456 个测试通过。

## Review 小结

终态：finished。

Spec 符合度：通过。已处理全量测试剩余风险：JSON CLI stdout 不再混入 dispatcher dist 构建日志，live DR child ready 解析支持多行 ready JSON 且不会把普通日志误认为 ready，child 进程跳过重复 dist 构建。

安全检查：通过。未新增 secret、凭据或外部输入拼接；只调整测试/运维脚本输出通道和子进程构建环境标志。

测试与验证：通过。失败子集、完整影响范围、全量 `pnpm test`、typecheck、lint、docs 校验和 diff 检查均已通过。

复杂度检查：通过。`parseChildServerOutput` 保持单一职责，未引入超过 50 行函数；本轮脚本改动局部且未新增大文件。

Document-refresh: not-needed
原因：本轮修复测试稳定性和脚本输出通道，没有改变公开架构、接口或运行契约。

剩余风险：全量测试需要非沙箱环境运行，因为 live dispatcher 测试需要监听 `127.0.0.1`；在沙箱内仍会因权限限制失败。

潜在技术债：dispatcher dist 自动构建仍会在多个测试进程中重复触发，虽然当前锁与 stderr 输出已稳定，但后续可考虑测试启动前统一预构建并设置 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1`。

结论：通过。

# 2026-07-03 runtime 审查发现修复

## 目标

修复 6 月 30 日到 7 月 3 日变动审查中确认的交付可靠性、凭据隔离、能力声明和 Console 配置文档漂移问题。

## 执行计划

- [x] P1 串行：为 packaged Codex runtime 补充 push / PR 失败和子进程 env 隔离 RED 测试。
- [x] P1 串行：为 packaged Gemini runtime 补充同等 RED 测试。
- [x] P1 串行：修复 packaged Codex / Gemini runtime 的 push / PR 失败处理和 env allowlist。
- [x] P2 串行：修正 Gemini provider registry 的 review 能力声明，并补准入测试。
- [x] P2 串行：修正 Console 配置脚本与 README 漂移。
- [x] P3 串行：运行受影响测试、typecheck、docs 校验和 diff 检查。
- [x] P4 串行：执行 review-gate 并补充收尾小结。

## 并行说明

本轮不使用 subagent。两个 packaged runtime 文件结构高度重复，但改动函数同名且测试模式相同；主流程串行处理可以减少重复实现漂移。验证命令之间可并行执行，但最终由主流程统一汇总。

## 验证结果

- RED：`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test` 先失败，push / PR 失败路径错误返回 `completed`，env 测试暴露真实 GitHub fetch 路径。
- RED：`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test` 同样失败。
- RED：`CI=true pnpm --filter @forgeflow/provider-registry test` 先失败，Gemini `review` 被错误声明为支持。
- GREEN：`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test` 通过，2 个测试文件、7 个测试通过。
- GREEN：`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test` 通过，2 个测试文件、8 个测试通过。
- GREEN：`CI=true pnpm --filter @forgeflow/provider-registry test` 通过，1 个测试文件、7 个测试通过。
- GREEN：`CI=true pnpm --filter console build` 通过。
- GREEN：`CI=true pnpm typecheck` 通过。
- GREEN：`CI=true pnpm lint` 通过。
- GREEN：`CI=true pnpm docs:validate` 通过。
- GREEN：`git diff --check` 通过。
- 全量：`CI=true pnpm test` 在 dispatcher 既有环境敏感测试失败；复跑非沙箱仍失败于 `stage3-live-dr` 的 `undefined/api/workers/register`、`shadow-drift` / `submit-review-decision` stdout JSON 混入构建日志，以及 dispatcher dist build lock 连锁超时。本轮直接相关套件均已单独通过。

## Review 小结

终态：finished。

Spec 符合度：通过。已修复 packaged Codex / Gemini runtime 的 push / PR 失败静默完成问题、子进程 env 凭据暴露问题、Gemini provider review 能力漂移，以及 Console 配置文档与实现不一致。

安全检查：通过。未新增 secret；assignment / 模型子进程改为 allowlist 环境变量，默认不再继承 `GITHUB_TOKEN`、`DISPATCHER_API_TOKEN` 或任意自定义 secret。

测试与验证：通过。新增 RED/GREEN 覆盖 packaged runtime 交付失败、PR 失败、env 隔离和 Gemini review 准入；受影响套件、typecheck、lint、docs 校验和 diff 检查均通过。

复杂度检查：通过。新增测试文件均为 279 行；新增 helper 函数未超过 50 行。两个 packaged runtime 生产文件仍超过 300 行，这是既有文件规模技术债，本轮未扩大职责边界。

Document-refresh: needed
原因：Console README 的配置命令与环境变量说明属于本轮修复对象，已同步更新。

剩余风险：全量 `pnpm test` 仍受 dispatcher 既有环境敏感测试影响，失败点不在本轮修改文件内；本轮直接相关验证已全部通过。

潜在技术债：Codex/Gemini packaged runtime 仍存在重复实现，后续应抽共享 helper 或生成模板，避免 env allowlist 与交付错误处理再次漂移。

结论：通过。

# Console 与运行入口质量修复

## 目标

收口当前审查发现的高价值问题：源码仓 Trae automation gateway JS/TS 漂移、Console 非 2xx 错误处理、任务分页缩短后的空页、终端日志强制滚动、Worker 启停反馈，以及未引用的 Vite 模板样式。

## 非目标

- 不做 Console 大规模视觉重设计。
- 不改变 dispatcher 状态机或 worker 协议语义。
- 不在本轮处理手动发布两阶段恢复方案，因为该项需要单独调整 release 策略和现有测试契约。

## 执行计划

- [x] 补 RED 测试，锁定源码仓 gateway release session、Console fetcher、分页收缩和终端滚动行为。
- [x] 同步 `scripts/lib/trae-automation-gateway.js` 与客户端 release session 能力。
- [x] 修复 Console fetcher、Worker 启停刷新、分页 clamp 和终端跟随滚动逻辑。
- [x] 清理未引用的 Vite 模板样式与资产，微调 Console 响应式布局。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 使用 review-gate 做交付前审查并补充 Review 小结。

## 验证结果

- RED：新增 gateway release session 测试先失败于 `ApiError: Not found`。
- RED：新增 Console 测试先失败于非 2xx 响应被当作数据、分页缩短后空页、终端日志强制滚动。
- GREEN：`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/trae-automation-gateway.test.ts` 通过，35 个测试文件、394 个测试通过。
- GREEN：`pnpm --filter console exec vitest run src/__tests__/App.test.tsx src/components/__tests__/Lists.test.tsx src/components/__tests__/TerminalPanel.test.tsx` 通过，3 个测试文件、16 个测试通过。
- GREEN：`pnpm --filter console lint` 通过。
- GREEN：`pnpm --filter console build` 通过。
- GREEN：`pnpm typecheck` 通过。
- GREEN：`pnpm docs:validate` 通过。
- GREEN：`git diff --check` 通过。

## Review 小结

终态：finished。

Spec 符合度：通过。已修复源码仓 Trae gateway JS release session 漂移、Console 非 2xx 错误处理、Worker 启停刷新、任务分页缩短空页和终端日志强制滚动；同时清理未引用 Vite 模板样式与资产，并拆分 `TaskDetailsPanel` 降低 `Lists.tsx` 复杂度。

安全检查：通过。未新增 secret、凭据或外部输入拼接；新增 fetcher 对非 2xx 响应显式抛错，不吞掉后端失败。

测试与验证：通过。受影响 dispatcher / Console 测试、Console lint/build、根 typecheck、文档校验和 diff 检查均已通过。

复杂度检查：通过。`Lists.tsx` 已降到 189 行，`TaskDetailsPanel.tsx` 为 261 行，新增组件均按职责拆分；未新增超过 300 行文件。

Document-refresh: not-needed
原因：本次为运行入口与 Console 行为修复，没有改变稳定文档描述的架构、接口或持久化契约。

剩余风险：手动发布两阶段恢复仍是单独技术债，本轮未改 `.github/workflows/release.yml`；任务详情的展示密度仍可在后续做进一步 UX 设计。

潜在技术债：`scripts/lib` 仍保留 checked-in JS 与 TS 双轨，后续应考虑统一构建产物刷新或减少源码仓 live entrypoint 对手工同步的依赖。

结论：通过。
