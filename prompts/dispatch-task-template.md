# Dispatch Task 模板

给 ForgeFlow worker 派发代码任务时，优先使用这份模板作为任务级 prompt 骨架。

这份模板不重复粘贴 `docs/AGENT_STARTER_PROMPT.md` 的全文，而是把它作为前置阅读要求，再补上本次任务特有的边界、验收和交付要求。

适用场景：

- 通过 dispatcher / worker-review-orchestrator 给 `codex`、`gemini`、`Trae` worker 派发任务
- 需要稳定携带仓库级上下文
- 需要避免每次临时手写 prompt 导致边界漂移

不适用场景：

- 控制层会话开场
- 业务仓的 agent bootstrap
- 不涉及代码交付的纯讨论任务

## 模板

```text
你在 ForgeFlow 仓库里执行一个明确范围的任务。

在开始之前，先阅读：
1. AGENTS.md
2. docs/README.md
3. docs/AGENT_STARTER_PROMPT.md
4. 如果目标模块有本地 README.md，也先阅读对应 README

任务目标：
<用 1 到 3 句写清本次要完成的目标>

任务背景：
<只写本次任务需要的背景，不复制仓库通用规则>

严格范围限制：
只允许修改这些文件：
- <path 1>
- <path 2>

不要修改：
- <disallowed path 1>
- <disallowed path 2>

硬约束：
- 只在 assigned task branch 上工作
- 不要扩 scope
- 不要提交 docs-only 结果，除非本任务明确就是文档任务
- 不要返回“现有实现已经足够”作为完成结果，除非你能给出代码与验证证据
- 如果产出代码，必须提供 branch / commit / push / test evidence
- 如果本次不需要改文档，收尾时明确写出 `no doc impact` 和原因

必须完成的工作：
1. <required item 1>
2. <required item 2>
3. <required item 3>

非目标：
- <non-goal 1>
- <non-goal 2>

验收命令：
- <command 1>
- <command 2>
- git diff --check

完成后严格按下面模板回复：

## 任务完成
- 结果: 成功 / 失败
- 修改文件:
  - <file list>
- 测试结果:
  - <command + result>
- 风险:
  - <无则写 无>
- Git 证据:
  - branch: <branch>
  - commit: <commit>
  - push: <success/failed/not_attempted>
  - push_error: <无则写 无>
- 备注:
  - <简短说明>
```

## 使用约定

- 仓库级规则始终以 `AGENTS.md` 为准。
- 文档导航始终以 `docs/README.md` 为准。
- `docs/AGENT_STARTER_PROMPT.md` 只负责统一入口提醒，不替代本模板里的任务级约束。
- 本模板只放可复用骨架；每个具体任务仍需填写目标、范围、非目标、验收命令和交付证据要求。
