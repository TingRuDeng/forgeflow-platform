# vNext Runtime Reliability 推进计划

## 目标

按 `/Users/dengtingru/Downloads/ForgeFlow vNext 完整方案.md` 的路线，优先推进 Phase 0 与 PR 1：建立 vNext 运行可靠性 RFC、Worker Protocol v1 文档和协议类型包，为后续 TaskAttempt、LeaseToken enforcement、ArtifactBundle 和 Runtime Event Ledger 打基础。

## 非目标

- 本切片不改 dispatcher 运行逻辑。
- 本切片不改 Trae worker 实际请求流程。
- 本切片不新增数据库迁移。
- 本切片不让现有 v0 worker 强制升级。
- 本切片不实现 retry scheduler、console timeline 或 artifact 存储。

## 当前事实

- `packages/result-contracts/src/index.ts` 已用 Zod 定义 run result、review finding、worker evidence 和 review decision evidence，但没有 attempt、leaseToken、artifact bundle 或 protocol envelope。
- `packages/task-schema/src/index.ts` 当前 `WorkerPoolSchema` 只包含 `codex` / `gemini`，与 provider registry 的 `trae` 已支持事实不完全收敛。
- `packages/provider-registry/src/index.ts` 已声明 `ProviderId = "claude" | "codex" | "gemini" | "opencode" | "qwen" | "trae"`，并包含 Trae automation 权限。
- `apps/dispatcher/src/modules/server/runtime-state.ts` 当前以 Task / Assignment 为主，已有 `traceId`、`events`、assignment lease，但没有 `TaskAttempt` 一等模型。
- `apps/dispatcher/src/modules/server/leases.ts` 当前已经收窄为 assignment-only，适合在后续 PR 里单独升级为 attempt-bound `LeaseToken`。
- `scripts/validate_docs.py` 只强制校验既有权威文档和 active docs；新增 `docs/rfcs/*` 当前不会被自动作为权威文档校验。

## 设计原则

- 先契约，后运行时；先类型可验证，后接入 mutation。
- 不重写现有 dispatcher；新增 vNext 类型包时保持现有包不破坏。
- 新文档必须明确“vNext 目标契约”，不能伪装成当前已实现能力。
- 协议字段采用 Zod schema + TypeScript infer，避免文档和类型双轨漂移。
- 任何运行时接入都必须用后续独立 PR 完成，并补 stale write / idempotency / compatibility 测试。

## 决策日志

- 2026-05-12：选择先做 Phase 0 + PR 1，而不是直接改 runtime-state。原因是 vNext 文档跨度很大，直接加入 TaskAttempt/LeaseToken 会同时触碰状态机、SQLite、Trae runtime 和 CLI，风险过高。
- 2026-05-12：`packages/worker-protocol` 只提供协议类型和 schema，不依赖 dispatcher 内部实现。原因是它要成为 worker/runtime/dispatcher 的共享契约。
- 2026-05-12：文档放入 `docs/rfcs/` 和 `docs/WORKER_PROTOCOL_V1.md` 等主动入口。RFC 标记为规划权威，活跃实现仍以现有 `docs/API_ENDPOINTS.md`、`docs/STATE_MACHINE.md` 和代码为准。

## 方案对比

### 方案 A：只做 Phase 0 文档

影响范围最小，只新增 RFC 和协议文档。缺点是没有可执行类型，不足以约束后续 worker / dispatcher 实现，容易继续文档先行漂移。

### 方案 B：Phase 0 文档 + `packages/worker-protocol` 类型包

新增协议文档和可测试类型包，不改运行时。后续 TaskAttempt、ArtifactBundle、Review Workflow 可以直接复用同一套 schema。缺点是需要一次性补 package、测试、文档导航和 CI 类型检查。

### 方案 C：直接实现 TaskAttempt + LeaseToken enforcement

能最快触达 vNext 核心价值，但会同时改 `runtime-state.ts`、`dispatcher-server.ts`、`runtime-state-sqlite.ts`、Trae runtime、CLI 和测试矩阵。当前没有共享协议包，容易把 v1/v0 兼容逻辑写散。

## 推荐方案

推荐方案 B。它是最小可维护切片：有可执行契约、有测试，不改变现有主链行为，也为后续 PR 4-7 留出清晰接口。

淘汰方案 A：只有文档，不能形成验证闭环。  
淘汰方案 C：跨度太大，会绕过“协议先行”和 v0 compatibility 设计。

## 执行计划

- [x] 创建 `packages/worker-protocol/package.json`，包名使用 `@forgeflow/worker-protocol`，脚本包含 `typecheck` 与 `test`。
- [x] 创建 `packages/worker-protocol/tsconfig.json`，沿用根 `tsconfig.base.json`，`rootDir` 为 `.`。
- [x] 创建 `packages/worker-protocol/src/index.ts`，导出：
  - `ProtocolVersionSchema`
  - `TraceIdSchema`
  - `IdempotencyKeySchema`
  - `WorkerProtocolEnvelopeSchema`
  - `WorkerRegistrationRequestSchema`
  - `WorkerRegistrationResponseSchema`
  - `TaskAttemptStatusSchema`
  - `TaskAttemptSchema`
  - `LeaseTokenSchema`
  - `RuntimeLeaseSchema`
  - `RuntimeEventTypeSchema`
  - `RuntimeEventSchema`
  - `ArtifactBundleSchema`
  - `ReviewDecisionSchema`
  - `FailureCodeSchema`
  - 对应 `z.infer` 类型
- [x] 创建 `packages/worker-protocol/tests/index.test.ts`，先写失败测试覆盖：
  - envelope 缺少 `leaseToken` 时失败
  - protocolVersion 只接受 `2026-05-v1`
  - ArtifactBundle 至少要求 `schemaVersion`、`taskId`、`attemptId`、`changedFiles`、`refs`
  - RuntimeEventType 只接受固定 taxonomy
  - ReviewDecision 支持 `reject_fixable`、`redrive`、`block`
- [x] 运行 `pnpm --filter @forgeflow/worker-protocol test`，确认 RED。
- [x] 实现最小 schema，使测试 GREEN。
- [x] 运行 `pnpm --filter @forgeflow/worker-protocol test && pnpm --filter @forgeflow/worker-protocol typecheck`。
- [x] 新增 `docs/rfcs/0001-runtime-reliability-vnext.md`，说明 vNext 目标、非目标、迁移阶段和当前未实现边界。
- [x] 新增 `docs/WORKER_PROTOCOL_V1.md`，说明 v1 envelope、register、claim、start、heartbeat/progress、result 和错误语义。
- [x] 新增 `docs/TASK_ATTEMPT_MODEL.md`，说明 Task 与 TaskAttempt 分离、状态、兼容迁移和后续 SQLite 方向。
- [x] 新增 `docs/ARTIFACT_BUNDLE_V1.md`，说明 ArtifactBundle schema、存储引用、review 展示和 retention 边界。
- [x] 更新 `docs/README.md`，把 vNext 文档列入“规划/协议草案”入口，并明确不是当前运行时已实现能力。
- [x] 更新 `docs/AI_CONTEXT.md`，在高风险误读点里加入“vNext 文档是目标契约，不代表当前实现已接入”。
- [x] 更新 `docs/TECH_DEBT.md`，将 TaskAttempt、Worker Protocol、ArtifactBundle、Runtime Event taxonomy 标成待收敛技术债。
- [x] 更新 `tasks/vnext-runtime-reliability.md` 进度和 Review 小结。
- [x] 运行 `pnpm docs:validate`。
- [x] 运行 `pnpm --filter @forgeflow/worker-protocol test`。
- [x] 运行 `pnpm --filter @forgeflow/worker-protocol typecheck`。
- [x] 运行 `pnpm typecheck`。
- [x] 运行 `pnpm test` 或至少 `pnpm --filter @forgeflow/worker-protocol test && pnpm --filter @forgeflow/result-contracts test && pnpm --filter @forgeflow/task-schema test`；如果全量耗时可接受，优先全量。
- [x] 运行 `pnpm lint && git diff --check`。

## 验证矩阵

| 验证项 | 命令 | 通过标准 |
|---|---|---|
| 文档结构 | `pnpm docs:validate` | 无输出且退出码为 0 |
| worker-protocol 单测 | `pnpm --filter @forgeflow/worker-protocol test` | schema 测试全部通过 |
| worker-protocol 类型 | `pnpm --filter @forgeflow/worker-protocol typecheck` | TypeScript 无错误 |
| 仓库类型 | `pnpm typecheck` | 所有 workspace typecheck 通过 |
| 相关包回归 | `pnpm --filter @forgeflow/result-contracts test && pnpm --filter @forgeflow/task-schema test` | 现有契约测试不回归 |
| 静态检查 | `pnpm lint && git diff --check` | ESLint 和空白检查通过 |

## 风险与预想失败场景

- 新增包未被 pnpm workspace 正确识别：通过 `pnpm --filter @forgeflow/worker-protocol test` 暴露。
- 文档把 vNext 目标误写成当前实现：通过 `docs/README.md`、`docs/AI_CONTEXT.md` 的权威边界说明降低误读风险。
- schema 与后续 runtime 接入不匹配：本 PR 只稳定基础 envelope 和实体，不加入 dispatcher 内部状态迁移。
- zod schema 过度严格导致未来扩展困难：保留 `metadata` / `payload` / `refs` 的 record 字段，但不做静默 fallback。

## HARD-GATE

当前阶段只完成规划。用户确认前不进行代码修改、不新增 package、不新增 vNext 文档。

## 进度记录

- 2026-05-12：已创建 `@forgeflow/worker-protocol` 包、失败测试和最小 schema；RED 失败原因为 `../src/index.js` 尚不存在，GREEN 后 6 个测试通过。
- 2026-05-12：已运行 `pnpm install --lockfile-only` 同步新增 workspace package 到锁文件。
- 2026-05-12：已新增 vNext RFC、Worker Protocol v1、TaskAttempt Model、ArtifactBundle v1 文档，并同步 `docs/README.md`、`docs/AI_CONTEXT.md`、`docs/TECH_DEBT.md`。
- 2026-05-12：已完成文档、worker-protocol、全仓 typecheck、相关包回归、全量测试、lint 和 diff 检查。

## 验证结果

- `pnpm docs:validate`：通过。
- `pnpm --filter @forgeflow/worker-protocol test`：通过，6 个测试通过。
- `pnpm --filter @forgeflow/worker-protocol typecheck`：通过。
- `pnpm typecheck`：通过，22 个 workspace 项目完成类型检查。
- `pnpm --filter @forgeflow/result-contracts test && pnpm --filter @forgeflow/task-schema test`：通过。
- `pnpm lint && git diff --check`：通过。
- `pnpm test`：通过，包含新增 `@forgeflow/worker-protocol` 测试。

## Review 小结

已完成 vNext Phase 0 + PR 1 切片：新增 `@forgeflow/worker-protocol` 包，提供 Worker Protocol v1 envelope、TaskAttempt、RuntimeLease、RuntimeEvent、ArtifactBundle、ReviewDecision 和 FailureCode schema；新增 vNext RFC、Worker Protocol、TaskAttempt 和 ArtifactBundle 文档；同步文档导航、AI 上下文和技术债。

本切片没有修改 dispatcher、Trae runtime、CLI 或 Console 的运行逻辑。当前 vNext 文档与 `packages/worker-protocol` 只代表目标契约，下一步接入运行时仍需要独立计划和兼容测试。

剩余风险：TaskAttempt / LeaseToken enforcement 尚未接入 mutation 路径，v0 worker compatibility adapter 尚未实现，ArtifactBundle 也尚未成为 worker result 强制输出。
