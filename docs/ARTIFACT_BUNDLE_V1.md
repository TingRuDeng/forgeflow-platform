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
- `packages/worker-protocol` 直接复用并重导出该 schema，不再维护第二份 ArtifactBundle 定义。

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
    "diff": "artifact://attempt-1/diff.patch",
    "trajectory": "artifact://attempt-1/trajectory.json"
  },
  "trajectory": {
    "schemaVersion": "artifact-trajectory/v1",
    "steps": [
      {
        "sequence": 1,
        "phase": "verification",
        "action": "pnpm test",
        "observation": "58 tests passed",
        "status": "succeeded",
        "exitCode": 0
      }
    ]
  }
}
```

## 字段边界

- `summary`：worker 对本次 attempt 的简要说明。
- `branch` / `commit` / `pullRequestUrl`：代码交付定位。
- `changedFiles`：用于 review 和风险提示的变更摘要；dispatcher 会与 result 顶层 `changedFiles` 取去重并集，不能用其中一侧的空列表隐藏另一侧文件。
- `refs`：指向 diff、logs、tests、screenshots、terminal transcript、structured report 或 trajectory。
- `trajectory`：可选的结构化、可回放步骤轨迹，schemaVersion 固定为 `artifact-trajectory/v1`；每个 step 至少包含 `sequence`、`phase`、`action` 和 `status`，可附带 `observation`、`command`、`exitCode`、`artifactRef`。
- `retainedContent`：可选的短正文片段，目前支持 `diff`、`logs`、`testResults`、`trajectory`，用于 Console / review 快速查看。
- `testResults`：结构化测试结果摘要。
- `riskNotes`：worker 主动提示的风险。
- `nextActions`：建议的后续动作。

## 存储策略

runtime-state 只应保存 bundle 摘要、引用和受限正文片段。大型 diff、完整日志、截图、完整测试输出这类大对象应放在 artifact store 或本地 artifact 目录，并通过 `refs` 引用。

当前实现：

- `RuntimeState.artifactBundles[]` 保存 bundle 摘要、refs、可选 `trajectory` 和可选 `retainedContent`。
- SQLite structured projection 使用 `artifact_bundles` 表承载查询投影，并保存 `trajectory_json` 与 `retained_content_json`。
- dispatcher 在 worker 未显式提交 `trajectory` 时，会从 verification commands 生成默认 `artifact-trajectory/v1` 步骤轨迹。
- dispatcher 将 result 顶层和 bundle 内的 `changedFiles` 合并成 canonical 文件清单，并用同一清单生成 review material 与风险等级。
- dispatcher HTTP 写入 worker result 或 Trae submit-result 时，会把 `trajectory` 或 `retainedContent.trajectory` 以及 `retainedContent.diff`、`retainedContent.logs`、`retainedContent.testResults` 落到 `${stateDir}/artifacts/<bundle-dir>/`。
- artifact store 使用 `manifest.json` 作为文件索引；当前会按实际内容生成 `result.json`、`diff.patch`、`session.log`、`test-results.txt`、`trajectory.json` 和 `trajectory.traj`。
- dispatcher 不再信任 worker 预填的本地 `artifact://` 占位引用：落盘后会用真实 `bundleId` 和 manifest 文件名重建 refs；`session.log` 同时作为 `logs` 与 `terminalTranscript` 引用。
- `DISPATCHER_ARTIFACT_RETENTION_MAX_BUNDLES` 可限制本地 artifact store 保留的最新 bundle 数，默认保留 100 个 bundle。
- retention 删除旧 bundle 目录时，同一次状态写入会同步裁剪 `RuntimeState.artifactBundles[]`，避免 Console / query index 长期指向已删除正文。
- `TaskAttempt.artifactBundleId` 指向当前 attempt 的 bundle。
- `/api/artifacts/:bundleId` 可按 bundleId 获取单个 bundle。
- `/api/artifacts/:bundleId/files/:fileName` 可按需读取 manifest 登记的 artifact 文件正文。
- CLI 使用 `forgeflow-review-orchestrator artifact-get --bundle-id <id>` 获取 bundle，使用 `--file diff.patch` 读取正文文件。
- Console 任务详情的 refs tab 可复制 `artifact://...` 引用，并通过 artifact 文件 API 按需展开 manifest 登记的 diff、log、test result 或 trajectory 文件正文。
- Trae runtime 在拿到 `attempt_id` 后会随 submitResult 提交 minimal bundle。
- Console 任务详情提供摘要、引用、正文和轨迹 tabs；轨迹 tab 支持按步骤前后回放 `trajectory.steps`，并可从当前 step 的 `artifactRef` 直接展开或下载 manifest 登记的观察文件。
- Console 任务详情在任务处于 `review` 状态时可直接提交 `merge` / `rework` / `block` 审查决策，并携带 `reasonCode`、`mustFix[]`、`canRedrive`、`redriveStrategy` 和高风险合并的 `acknowledgeRisk`，和 attempt timeline / artifact summary 共处同一审查上下文。
- dispatcher 会把当前 `TaskAttempt.attemptId`、`ArtifactBundle.bundleId` 和可选 bundle commit 组成 `reviewMaterial.freshness`。Console / orchestrator CLI 以 `expectedFreshness` 回传；当前 review 有 freshness 时，缺失或变化的 tuple 都返回 `409`，成功决策把 canonical tuple 记录为 `evidence.reviewedFreshness`。

## Review 展示

Review UI 和 CLI inspect 应优先展示：

1. summary。
2. branch / commit / PR。
3. changedFiles。
4. testResults。
5. trajectory.steps。
6. riskNotes。
7. refs 中的 diff 和 logs。
8. retainedContent 中的短正文片段。
