# E2E Smoke Checklist

## 1. 仓库接入检查

- `.orchestrator/project.yaml` 已存在
- `AGENTS.md` 已存在
- `GEMINI.md` 已存在
- `.github/workflows/ai-dispatch.yml` 已存在
- `.github/workflows/ai-ci.yml` 已存在
- `.github/workflows/ai-verify-merge.yml` 已存在

## 2. GitHub 基础检查

- Actions 已开启
- self-hosted runner 在线
- `OPENAI_API_KEY` 已配置
- `GEMINI_API_KEY` 已配置
- `main` 的 branch rule 已保存

## 3. 调度链路检查

- 手工触发 `ai-dispatch`
- workflow 能读取 `.orchestrator/project.yaml`
- workflow 日志能看到 request summary
- dispatcher 能生成结构化任务

## 4. 执行链路检查

- 能创建任务分支
- 能创建独立 worktree
- 能选择 worker 池
- worker 能返回结果

## 5. PR / 验证链路检查

- 能创建 PR
- `ai-ci` 成功
- `ai-verify-merge` 成功
- review gate 可给出通过/阻塞结论

## 6. 合并检查

- PR 合并后 `main` 仍可正常拉取
- 没有出现越界改动
- 没有遗漏任务结果或验证记录
