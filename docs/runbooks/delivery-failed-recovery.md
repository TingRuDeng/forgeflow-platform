# Delivery Failed Recovery

适用范围：

- `submitResult` 重试耗尽
- `git push` 失败
- 自动 draft PR 创建失败

## 1. 先确认不是代码执行失败

看 dispatcher task / review：

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot
curl -s http://127.0.0.1:8787/api/metrics
```

重点看：

- `deliveryFailedCount`
- 最新 task 是否已进入 `failed`

## 2. 查 worker 侧产物

失败结果会保留在 `.worktrees/failed/<task-id>/` 下。

检查：

- `worker-result.json`
- `worker-verification.json`
- `worker-output.raw.txt`

## 3. 常见处理

- `submitResult` 失败：先恢复 dispatcher，再 redrive
- `push` 失败：先修 git / remote / auth，再 redrive
- draft PR 失败：先确认 GitHub token / 权限，再 redrive 或手开 PR

## 4. redrive

```bash
forgeflow-review-orchestrator redrive \
  --dispatcher-url http://127.0.0.1:8787 \
  --task-id <task-id>
```

## 5. 分支规则

- 原远端产物已验证，且只是小修：可复用原分支
- 原远端产物未验证，或换 worker / 换环境：新开 `-rN` 分支

