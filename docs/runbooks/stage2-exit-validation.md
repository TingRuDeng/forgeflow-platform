# Stage 2 Exit Validation

这份 runbook 只服务阶段二出口验证。

它把权威文档里阶段二主链要求，映射成仓库内可重复执行的验证入口，避免“感觉上已经完成”。

## 1. 对应的阶段二出口

按 `docs/external/4、项目迭代规划与路线图.md`，阶段二至少要收住这几类内容：

- `dependsOn / continuation / review decision` 状态机真正生效
- worker result canonicalization
- runtime ownership 收口到 `apps/dispatcher`
- metrics / trace / alert 主链成立
- 关键失败链路可回归

当前仓库把这组出口收口成一条可重复执行的命令：

```bash
pnpm verify:stage2
git diff --check
```

## 2. `pnpm verify:stage2` 覆盖什么

当前脚本会顺序执行：

- dispatcher 核心状态机与 server 测试
- `review-memory` / `task-worktree` ownership 回归
- generic worker daemon failure 回归
- Trae worker evidence / phase events 回归
- control-layer CLI `watch` / `inspect` 摘要回归
- console task detail / metrics 面板回归
- `@tingrudeng/trae-beta-runtime` 全包测试
- 全量 `pnpm typecheck`

它不替代：

- `pnpm test`
- `git diff --check`

原因：

- `pnpm verify:stage2` 是阶段二出口的 targeted gate
- `pnpm test` 仍然是通用仓库级验证
- `git diff --check` 负责格式与尾随空白门禁

## 3. 当前阶段二出口信号

完成阶段二时，至少要看到这些信号都成立：

- dispatcher ownership：
  - `apps/dispatcher/src/modules/server/review-memory.ts`
  - `apps/dispatcher/src/modules/server/task-worktree.ts`
  - `scripts/lib/*` 对应文件只保留 bootstrap / compatibility wrapper
- 状态机：
  - `dependsOn` 未满足前保持 `planned`
  - `claim-task` 走显式 `POST`
  - `merge / block / rework / changes_requested` 收敛到统一 review 语义
  - `cancelled` 已接入 dispatcher 状态机和 console
- worker 结果：
  - dispatcher 会 canonicalize `taskId / workerId / pool / repo / defaultBranch / branchName / mode`
  - worker 只能上送执行证据
- trace / metrics：
  - snapshot / `/api/metrics` / CLI summary / console 都能看到 `traceId`
  - `/api/metrics` 暴露 `retryRatePct`
  - `/api/metrics` 暴露 `branchProtectionHitCount`
  - `/api/metrics` 暴露 `repoConcurrencySaturation`
  - `/api/metrics` 暴露 `failureCodes` / `reviewReasonCodes`
- failure taxonomy：
  - Trae runtime phase events 已结构化回写
  - Trae worker evidence 带 blocker code
  - generic worker daemon 失败结果也带 blocker code

## 4. 建议同时看的产物

执行 `pnpm verify:stage2` 后，建议再联合确认：

```bash
curl -s http://127.0.0.1:8787/health
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" http://127.0.0.1:8787/api/metrics
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" http://127.0.0.1:8787/api/dashboard/snapshot
forgeflow-review-orchestrator inspect --state-dir .forgeflow-dispatcher --task-id <task-id> --summary
forgeflow-review-orchestrator watch --state-dir .forgeflow-dispatcher --task-id <task-id> --summary
```

重点观察：

- `traceId`
- `failureCode`
- `reviewState`
- `canRedrive`
- `latestProgressSummary`
- `branchProtectionHitCount`
- `repoConcurrencySaturation`

## 5. 当前边界

阶段二在当前仓库内的出口定义是：

- 主链规则闭环
- 权威 ownership 收口
- 结构化 trace / metrics / failure signals 可用
- 可重复 targeted regression 已存在

它不宣称以下长期项已经完成：

- 多实例 lease / lock
- 外部 DB / queue
- 完整 OTel collector / exporter 管线
- SLO / burn-rate 正式治理
