# ArtifactBundle v1

## 目的

定义一次 TaskAttempt 产出的标准审查证据包，让 review、redrive、replay 和 evaluation 都能引用同一份 artifact。

## 适合读者

适合维护 result-contracts、Trae runtime result 写回、CLI artifact 命令、Console review 页面和 artifact retention 的开发者与 AI 代理。

## 一分钟摘要

- ArtifactBundle 绑定 `taskId` 和 `attemptId`。
- 最小 bundle 包含 `schemaVersion`、`changedFiles` 和 `refs`。
- 大对象不直接塞进 runtime-state，优先存引用。
- 当前只在 `packages/worker-protocol` 定义目标 schema，现有 worker result 尚未强制产出 bundle。

```yaml
ai_summary:
  authority: "ArtifactBundle v1 目标 schema、证据边界、存储引用和 review 展示原则"
  scope: "vNext artifact 契约，不替代当前 result-contracts 已实现字段"
  read_when:
    - "扩展 worker result 或 result-contracts 前"
    - "实现 CLI artifact get 或 Console artifact tabs 前"
    - "设计 artifact retention 或 replay fixture 前"
  verify_with:
    - "../packages/worker-protocol/src/index.ts"
    - "../packages/worker-protocol/tests/index.test.ts"
    - "contracts/run-result-v1.md"
  stale_when:
    - "ArtifactBundle 字段、存储策略、refs 语义或 retention 策略变化"
```

## 权威边界

本文是 vNext 目标契约。当前已实现 run result 仍以 `contracts/run-result-v1.md` 和 `packages/result-contracts/src/index.ts` 为准。

## 如何验证

- 运行 `pnpm --filter @forgeflow/worker-protocol test`。
- 对照 `../packages/worker-protocol/src/index.ts` 的 `ArtifactBundleSchema`。
- 后续接入 worker result 时，补充 invalid bundle rejection 测试。

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
- `testResults`：结构化测试结果摘要。
- `riskNotes`：worker 主动提示的风险。
- `nextActions`：建议的后续动作。

## 存储策略

runtime-state 只应保存 bundle 摘要和引用。diff、日志、截图、完整测试输出这类大对象应放在 artifact store 或本地 artifact 目录，并通过 `refs` 引用。

## Review 展示

Review UI 和 CLI inspect 应优先展示：

1. summary。
2. branch / commit / PR。
3. changedFiles。
4. testResults。
5. riskNotes。
6. refs 中的 diff 和 logs。
