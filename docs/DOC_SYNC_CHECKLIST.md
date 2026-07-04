---
ai_summary:
  purpose: "定义 forgeflow-platform 任务收尾前的文档同步门禁和受影响文档更新映射。"
  read_when:
    - "任务准备收尾前，需要判断是否更新文档。"
    - "新增、归档、重命名或修改权威文档后。"
    - "PR 摘要需要说明 doc impact 或 no doc impact 时。"
  source_of_truth:
    - "AGENTS.md"
    - "docs/README.md"
    - "docs/AI_CONTEXT.md"
    - "scripts/validate_docs.py"
    - "package.json"
  verify_with:
    - "python3 scripts/validate_docs.py . --profile generic"
    - "pnpm docs:validate"
    - "git diff --check"
  stale_when:
    - "文档入口、权威级别、验证脚本或任务收尾要求变化。"
    - "README、runbook、contract、module README 的同步边界变化。"
---

# Doc Sync Checklist

Every code task must either update the affected docs or explicitly record `no doc impact` with a reason.

## Purpose

定义代码、接口、运行时或文档变更收尾前必须完成的文档同步检查。

## Source of truth

- `AGENTS.md` 定义任务执行、提交边界和收尾要求。
- `docs/README.md` 定义文档导航、权威级别和 legacy 边界。
- `docs/AI_CONTEXT.md` 定义 AI 快速上下文地图。
- `scripts/validate_docs.py` 定义上下文包结构校验规则。
- `package.json` 定义 `docs:validate` 等可运行校验命令。

## Key facts

- 任务结束前必须更新受影响文档，或明确写出 `no doc impact` 和原因。
- 运行时、接口、状态机、持久化、坑点和技术债都有对应文档同步入口。
- 文档入口、权威级别或归档变化必须同步 `docs/README.md` 和 `docs/AI_CONTEXT.md`。
- 文档结构变更后运行 `python3 scripts/validate_docs.py . --profile generic` 或 `pnpm docs:validate`。

## How to verify

Quick:

```bash
python3 scripts/validate_docs.py . --profile generic
pnpm docs:validate
git diff --check
```

Full:

```bash
pnpm test
pnpm typecheck
```

## Stale when

- 新增、归档、重命名或升级稳定文档。
- 文档同步规则、模块 README 边界或 `scripts/validate_docs.py` 校验契约变化。
- `package.json` 中的文档验证命令变化。

## 适合读者

适合所有准备结束任务的人类维护者、AI 代理、worker 执行者和代码审查者。

## 一分钟摘要

- 任务结束前必须更新受影响文档，或明确写出 `no doc impact` 和原因。
- 运行时、接口、状态机、持久化、坑点和技术债都有对应文档同步入口。
- 文档入口、权威级别或归档变化必须同步 `docs/README.md` 和 `docs/AI_CONTEXT.md`。
- 文档结构变更后运行 `pnpm docs:validate`。

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
