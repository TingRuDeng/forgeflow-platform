# ArtifactBundle v1

## 目的

定义一次 TaskAttempt 产出的标准审查证据包，让 review、redrive、replay 和 evaluation 都能引用同一份 artifact。

## 适合读者

适合维护 result-contracts、Trae runtime result 写回、CLI artifact 命令、Console review 页面和 artifact retention 的开发者与 AI 代理。

## 一分钟摘要

- ArtifactBundle 绑定 `taskId` 和 `attemptId`。
- 最小 bundle 包含 `schemaVersion`、`changedFiles` 和 `refs`。
- 大对象不直接塞进 runtime-state，优先存引用；review 需要的短 diff / log / test 摘要可通过 `retainedContent` 保留正文片段。
- 当前 `packages/result-contracts` 已提供可执行 schema，dispatcher 会保存 result 产出的 bundle，并把 bundleId 绑定到 active attempt。

```yaml
ai_summary:
  authority: "ArtifactBundle v1 目标 schema、证据边界、存储引用和 review 展示原则"
  scope: "vNext artifact 契约、当前 dispatcher 存储边界和 CLI 获取方式"
  read_when:
    - "扩展 worker result 或 result-contracts 前"
    - "实现 CLI artifact get 或 Console artifact tabs 前"
    - "设计 artifact retention 或 replay fixture 前"
  verify_with:
    - "../packages/result-contracts/src/index.ts"
    - "../packages/result-contracts/tests/index.test.ts"
    - "../apps/dispatcher/src/modules/server/runtime-state.ts"
    - "contracts/run-result-v1.md"
  stale_when:
    - "ArtifactBundle 字段、存储策略、refs 语义或 retention 策略变化"
```

## 权威边界

本文是 vNext artifact 契约和当前实现边界。字段 schema 以 `packages/result-contracts/src/index.ts` 为准；完整 worker protocol 目标仍看 `WORKER_PROTOCOL_V1.md`。

## 如何验证

- 运行 `pnpm --filter @forgeflow/result-contracts test`。
- 运行 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts`。
- 运行 `pnpm --filter @tingrudeng/worker-review-orchestrator-cli test -- tests/cli.test.ts`。

## 最小 Bundle

```json
{
  "schemaVersion": "artifact-bundle/v1",
  "taskId": "task-1",
  "attemptId": "attempt-1",
  "changedFiles": [
    {
      "path": "apps/dispatcher/src/modules/server/runtime-state.ts",
      "changeType": "modified"
    }
  ],
  "refs": {
    "diff": "artifact://attempt-1/diff.patch"
  }
}
```

## 字段边界

- `summary`：worker 对本次 attempt 的简要说明。
- `branch` / `commit` / `pullRequestUrl`：代码交付定位。
- `changedFiles`：用于 review 和风险提示的变更摘要。
- `refs`：指向 diff、logs、tests、screenshots、terminal transcript 或 structured report。
- `retainedContent`：可选的短正文片段，目前支持 `diff`、`logs`、`testResults`，用于 Console / review 快速查看。
- `testResults`：结构化测试结果摘要。
- `riskNotes`：worker 主动提示的风险。
- `nextActions`：建议的后续动作。

## 存储策略

runtime-state 只应保存 bundle 摘要、引用和受限正文片段。大型 diff、完整日志、截图、完整测试输出这类大对象应放在 artifact store 或本地 artifact 目录，并通过 `refs` 引用。

当前实现：

- `RuntimeState.artifactBundles[]` 保存 bundle 摘要、refs 和可选 `retainedContent`。
- SQLite structured projection 使用 `artifact_bundles` 表承载查询投影，并保存 `retained_content_json`。
- `TaskAttempt.artifactBundleId` 指向当前 attempt 的 bundle。
- `/api/artifacts/:bundleId` 可按 bundleId 获取单个 bundle。
- CLI 使用 `forgeflow-review-orchestrator artifact-get --bundle-id <id>` 获取 bundle。
- Trae runtime 在拿到 `attempt_id` 后会随 submitResult 提交 minimal bundle。
- Console 任务详情提供摘要、引用和正文 tabs；正文 tab 展示 `retainedContent` 中的 diff / logs / testResults。

## Review 展示

Review UI 和 CLI inspect 应优先展示：

1. summary。
2. branch / commit / PR。
3. changedFiles。
4. testResults。
5. riskNotes。
6. refs 中的 diff 和 logs。
7. retainedContent 中的短正文片段。
