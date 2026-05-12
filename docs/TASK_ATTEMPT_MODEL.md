# TaskAttempt Model

## 目的

定义 vNext 中 Task 与 TaskAttempt 的职责分离，明确 retry、redrive、lease、result、artifact 和 review 应绑定到具体执行尝试。

## 适合读者

适合修改 dispatcher 状态机、SQLite projection、query store、CLI inspect、Console timeline 和 worker result 写回的维护者与 AI 代理。

## 一分钟摘要

- `Task` 是业务目标，`TaskAttempt` 是一次真实执行。
- 一个 task 可以有多个 attempts，但短期内同一 task 最多一个 active attempt。
- result、ArtifactBundle、Review、LeaseToken 都应该绑定 `attemptId`。
- 当前文档是 vNext 目标模型，现有 runtime-state 尚未持久化 `taskAttempts[]`。

```yaml
ai_summary:
  authority: "TaskAttempt 目标模型、状态语义、迁移策略和当前未实现边界"
  scope: "vNext Task/Attempt 分离，不替代当前 dispatcher 状态机"
  read_when:
    - "实现 TaskAttempt memory model 前"
    - "改造 claim/start/result/review 绑定 attempt 前"
    - "设计 retry、redrive、timeline 或 SQLite attempts 前"
  verify_with:
    - "../packages/worker-protocol/src/index.ts"
    - "STATE_MACHINE.md"
    - "DATABASE_SCHEMA.md"
  stale_when:
    - "TaskAttempt 字段、状态、迁移策略或 SQLite attempts projection 变化"
```

## 权威边界

本文是 vNext 目标模型。当前已实现状态仍以 `STATE_MACHINE.md`、`DATABASE_SCHEMA.md` 和 `apps/dispatcher/src/modules/server/runtime-state.ts` 为准。

## 如何验证

- 运行 `pnpm --filter @forgeflow/worker-protocol test` 验证 `TaskAttemptSchema`。
- 对照 `apps/dispatcher/src/modules/server/runtime-state.ts` 确认当前是否已经接入。
- 后续接入时必须增加 stale result、retry、redrive 和 synthetic attempt migration 测试。

## Task 与 Attempt

`Task` 表示业务目标，例如“修复 read-only 写冻结缺口”。`TaskAttempt` 表示某个 worker 对这个目标的一次执行。

这层分离解决的问题：

- retry 不覆盖历史执行。
- stale worker result 能被拒绝并保留审计记录。
- review 能指向具体 artifact。
- console timeline 能展示第几次执行失败或成功。

## Attempt 状态

v1 状态集合：

- `created`
- `leased`
- `starting`
- `running`
- `checkpointed`
- `result_submitted`
- `succeeded`
- `failed`
- `expired`
- `cancelled`
- `superseded`

## 关键规则

- claim 创建 attempt 并返回 leaseToken。
- start/progress/result 都必须携带 attemptId 和 leaseToken。
- review 必须绑定 attemptId。
- redrive 创建新 attempt，不覆盖旧 attempt。
- 过期 attempt 保留历史，不删除审计证据。

## 兼容迁移

vNext alpha 可允许 v0 worker 继续工作：

- dispatcher 为 v0 claim 自动生成 attemptId。
- v0 result 自动绑定当前 active attempt。
- CLI doctor 给出 v0 warning。
- vNext stable 之后再考虑移除 v0 mutation。
