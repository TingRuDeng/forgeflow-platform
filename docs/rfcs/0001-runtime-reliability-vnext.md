# RFC 0001：vNext Runtime Reliability

## 目的

定义 ForgeFlow vNext 运行可靠性路线的边界、实体、迁移阶段和第一批可交付切片。

## 适合读者

适合维护 dispatcher、worker runtime、CLI、Console、review workflow 和持久化投影的维护者与 AI 代理。

## 一分钟摘要

- vNext 不重写 ForgeFlow，而是把现有 dispatcher / worker / review 主链升级为可靠控制面。
- 第一阶段先稳定 Worker Protocol v1、TaskAttempt、ArtifactBundle 和 Runtime Event taxonomy。
- 当前 RFC 是目标契约，不代表 dispatcher 已经接入 TaskAttempt 或 LeaseToken enforcement。
- 后续运行时接入必须保持 v0 兼容，先 fake worker / schema 测试，再接 Trae runtime。

```yaml
ai_summary:
  authority: "vNext 运行可靠性规划、实体边界、迁移阶段和首批 PR 顺序"
  scope: "Worker Protocol v1、TaskAttempt、LeaseToken、ArtifactBundle、Runtime Event Ledger、Review Workflow 的目标边界"
  read_when:
    - "准备推进 vNext runtime reliability 工作前"
    - "判断某个 vNext 能力是否当前已实现或只是目标契约时"
    - "拆分 TaskAttempt、ArtifactBundle、LeaseToken enforcement PR 前"
  verify_with:
    - "../WORKER_PROTOCOL_V1.md"
    - "../TASK_ATTEMPT_MODEL.md"
    - "../ARTIFACT_BUNDLE_V1.md"
    - "../../packages/worker-protocol/src/index.ts"
  stale_when:
    - "Worker Protocol 版本、TaskAttempt 状态、ArtifactBundle schema 或迁移阶段变化"
```

## 权威边界

本文是 vNext 规划 RFC，不替代当前实现文档。当前已实现接口以 `../API_ENDPOINTS.md` 为准，当前状态机以 `../STATE_MACHINE.md` 为准，当前持久化事实以 `../DATABASE_SCHEMA.md` 和代码为准。

## 如何验证

- 运行 `pnpm --filter @forgeflow/worker-protocol test` 验证协议类型包。
- 运行 `pnpm docs:validate` 验证主动文档结构和链接。
- 对照 `../../packages/worker-protocol/src/index.ts` 确认本文提到的 v1 类型确实存在。

## 非目标

- 不把 ForgeFlow 改成通用 agent framework。
- 不引入 swarm 作为核心数据模型。
- 不把 Trae wrapper 变成唯一核心。
- 不在第一阶段强制所有 v0 worker 升级。

## 目标模型

vNext 的第一等公民包括：

- `Task`：用户或系统希望完成的业务目标。
- `TaskAttempt`：某个 worker 对 task 的一次真实执行尝试。
- `LeaseToken`：attempt 写入权限凭证。
- `ArtifactBundle`：一次 attempt 的标准审查证据包。
- `RuntimeEvent`：append-only 运行账本事件。
- `Review`：绑定 attempt 和 artifact 的审查记录。

## 分阶段推进

Phase 0 建立 RFC、协议文档和共享类型包，不改运行逻辑。

Phase 1 收敛 schema、事件 taxonomy、review reason codes 和协议 envelope。

Phase 2 接入 TaskAttempt、SQLite attempts、LeaseToken enforcement、ArtifactBundle 和 retry scheduler。

Phase 3 将 Console 升级为 operator console，展示 task detail、timeline、review inbox 和 artifact tabs。

Phase 4 再推进 runtime pluralism、policy engine、evaluation / replay 和 memory layer。

## 首批 PR 顺序

1. Worker Protocol v1 Types。
2. Schema Runtime Convergence。
3. Runtime Event Taxonomy。
4. TaskAttempt In-memory。
5. SQLite Attempts。
6. LeaseToken Enforcement。
7. ArtifactBundle v1。
8. Review Reason Codes。
9. Console Timeline MVP。
10. Retry Scheduler MVP。
