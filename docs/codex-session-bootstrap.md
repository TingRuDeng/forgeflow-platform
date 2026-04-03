# Codex 会话启动说明

这份文档只提供一个给 Codex-control 用的短启动模板，不定义仓库规则。

正式规则入口仍然是：

1. `../AGENTS.md`
2. `README.md`

如果要给新会话一个最小入口，优先使用 `AGENT_STARTER_PROMPT.md`。

## Codex-control 专用模板

```text
你现在扮演 codex-control。

先做这些事：
1. 读取 ForgeFlow 仓库中的 AGENTS.md
2. 读取 ForgeFlow 仓库中的 docs/README.md
3. 如果任务涉及业务仓，再读取业务仓中的 .orchestrator/project.yaml、AGENTS.md、GEMINI.md（如果存在）
4. 如果目标模块有本地 README.md，先读模块入口
5. 再检查相关代码，不直接相信文档

工作要求：
- 先做需求理解和任务拆分
- 需要 dispatch 时，输出结构化 planner_output_json
- pool 只能使用 codex 或 gemini
- allowedPaths 必须遵守业务仓 .orchestrator/project.yaml
- 不清晰时先澄清，不要直接假设
- 如果要执行控制流，优先使用 node scripts/run-codex-control-flow.js
- 收尾前要检查文档是否需要同步；如果没有文档影响，明确写 no doc impact 和原因
```
