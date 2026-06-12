# 当前项目审查修复任务

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
