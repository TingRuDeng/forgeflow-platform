# Worktree Cleanup Runbook

适用范围：

- 任务 worktree 清理
- 孤儿 `.worktrees` 排查
- reuse/reset/clean 行为确认

## 1. 查看当前 worktree

```bash
git worktree list
find . -maxdepth 2 -type d -name ".worktrees"
```

## 2. 常规清理

如果任务已结束但目录残留：

```bash
git worktree remove --force <path-to-worktree>
```

## 3. 孤儿目录排查

```bash
find . -type d -path "*/.worktrees/*" -maxdepth 4
```

检查点：

- 是否还有已结束任务目录
- 是否存在未被 git worktree 管理的脏目录

## 4. 风险规则

- 不复用默认分支名作为任务分支
- reuse 时必须先 `reset --hard` + `clean -fd`
- 清理失败时，不要把旧目录当新任务基线继续跑

## 5. 指标

如果 worker 成功把清理失败回写到 dispatcher：

```bash
curl -s http://127.0.0.1:8787/api/metrics
```

重点看：

- `cleanupFailureCount`

