# vNext 第十批：Retry Scheduler MVP

## 目标

让 dispatcher 在 reconcile 阶段识别 worker 离线后的过期执行尝试，按最小 retry policy 自动重排一次，耗尽后明确失败，并写入可审计的 redrive / timeout 事件。

## 计划

- [x] 增加过期 running attempt 的扫描与事件记录。
- [x] 增加最小 retry policy：默认最多两次 attempt。
- [x] retry 未耗尽时释放 worker/assignment，并把任务重新放回 ready 队列。
- [x] retry 耗尽时把任务明确落到 failed。
- [x] 更新状态机 / API / 运维文档，并运行最小充分验证。

## 验收

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts` 通过。
- `pnpm typecheck`、`pnpm docs:validate`、`git diff --check` 通过。

## Review 小结

- 已补齐 reconcile 过期 running attempt 扫描、`attempt_expired` / `task_redriven` 事件和默认最多 2 次 attempt 的最小 retry policy。
- retry 未耗尽时释放 worker / assignment 并回到 `ready`；retry 耗尽时明确落到 `failed`，避免任务长期卡在 `in_progress`。
- 已同步 `docs/STATE_MACHINE.md`、`docs/API_ENDPOINTS.md`、`docs/DATABASE_SCHEMA.md`、`docs/TASK_ATTEMPT_MODEL.md` 和 `docs/README.md`。
- 验证已通过：`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts`、`pnpm typecheck`、`pnpm docs:validate`、`pnpm lint`、`pnpm test`、`git diff --check`。
