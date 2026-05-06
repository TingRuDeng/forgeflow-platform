# Doc Sync Checklist

Every code task must either update the affected docs or explicitly record `no doc impact` with a reason.

## 目的

定义代码、接口、运行时或文档变更收尾前必须完成的文档同步检查。

## 适合读者

适合所有准备结束任务的人类维护者、AI 代理、worker 执行者和代码审查者。

## 一分钟摘要

- 任务结束前必须更新受影响文档，或明确写出 `no doc impact` 和原因。
- 运行时、接口、状态机、持久化、坑点和技术债都有对应文档同步入口。
- 文档入口、权威级别或归档变化必须同步 `docs/README.md` 和 `docs/AI_CONTEXT.md`。
- 文档结构变更后运行 `pnpm docs:validate`。

```yaml
ai_summary:
  authority: "文档同步收尾门禁和受影响文档更新映射"
  scope: "README、docs 导航、onboarding、架构、接口、持久化、坑点、技术债和模块 README 同步规则"
  read_when:
    - "任务准备收尾前"
    - "判断是否需要同步文档"
    - "新增、归档或修改权威文档后"
  verify_with:
    - "docs/README.md"
    - "docs/AI_CONTEXT.md"
    - "scripts/validate_docs.py"
    - "pnpm docs:validate"
  stale_when:
    - "新增稳定文档、模块 README、校验脚本或文档同步规则变化"
```

## 权威边界

本文件只定义文档同步门禁，不替代 `AGENTS.md` 的执行规则或 `docs/README.md` 的导航职责。

## 如何验证

- 运行 `pnpm docs:validate` 检查文档结构和链接。
- 检查本次改动是否命中下方 Update Map。
- 如果没有文档影响，在交付说明中明确写出 `no doc impact` 和原因。

## 1. Rule of Completion

A task is not complete until one of these is true:

- the impacted docs were updated in the same change
- the task summary explicitly says `no doc impact` and explains why

Do not silently skip this check.

## 2. Update Map

Update `README.md` when:

- the main supported runtime path changes
- startup commands change
- worker positioning changes
- Trae path positioning changes

Update `docs/README.md` when:

- document authority changes
- reading order changes
- new stable docs are added
- documents are archived, renamed, or removed from the active path

Update `docs/AI_CONTEXT.md` when:

- authority map changes
- task reading paths change
- critical evidence entrypoints change
- high-risk misread points change

Update `docs/onboarding.md` when:

- business-repo onboarding steps change
- required templates, workflows, or repo prerequisites change
- the recommended execution path for new adopters changes

Update `docs/ARCHITECTURE.md` when:

- runtime ownership changes
- new services or long-lived processes are added
- control-flow boundaries shift
- persistence authority changes

Update `docs/API_ENDPOINTS.md` when:

- dispatcher HTTP routes change
- Trae automation gateway routes change
- response envelopes or endpoint ownership changes

Update `docs/DATABASE_SCHEMA.md` when:

- dispatcher state shape changes
- review-memory shape changes
- session-store shape or storage path changes
- any real database-backed persistence becomes active

Update `docs/KNOWN_PITFALLS.md` when:

- a repeated implementation trap is verified in code, config, logs, or recurring failures
- a listed pitfall is no longer true

Update `docs/TECH_DEBT.md` when:

- confirmed architectural mismatches are introduced
- a listed debt item is materially reduced or removed

Update local module `README.md` files when:

- module ownership changes
- active entrypoints move
- local non-obvious constraints change

## 3. Archive Rules

If a doc is no longer authoritative:

- move it under `docs/archive/` if it still has historical value
- remove dead references from active docs
- do not leave it in the active root path looking current

## 4. Completion Note Template

Use one of these in summaries or PR notes:

- `doc impact: updated README.md, docs/README.md, docs/API_ENDPOINTS.md`
- `no doc impact: changed test-only assertions in apps/dispatcher without changing runtime behavior or interfaces`
