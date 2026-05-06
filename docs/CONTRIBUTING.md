# Contributing Guide

这份文档只定义主链贡献约束、ADR 触发条件、兼容性规则与契约变更 checklist。

仓库规则仍以 `../AGENTS.md` 为准；这里不重复定义 branch / merge 权限边界。

## 目的

说明主线贡献时何时需要 ADR、如何处理兼容性、契约变更和 dispatcher / worker 变更的额外检查。

## 适合读者

适合准备提交主线变更的人类维护者、AI 代理、代码审查者和 release 维护者。

## 一分钟摘要

- 本文件补充贡献检查，不替代 `../AGENTS.md`。
- 影响公共契约、状态机、持久化或 agent/worker 权限时需要更严格的设计记录和验证。
- dispatcher / worker 变更必须核对运行时入口、状态落账、失败语义和文档同步。
- 最小验证仍以 `pnpm test`、`pnpm typecheck`、`git diff --check` 为基线。

```yaml
ai_summary:
  authority: "贡献流程补充、ADR 触发条件、兼容性和契约变更检查"
  scope: "主线变更、dispatcher/worker 变更、协议变更和最小验证"
  read_when:
    - "准备提交影响主链的变更"
    - "判断是否需要 ADR 或契约同步"
    - "审查 dispatcher / worker 变更风险"
  verify_with:
    - "AGENTS.md"
    - "docs/DOC_SYNC_CHECKLIST.md"
    - "pnpm test"
    - "pnpm typecheck"
  stale_when:
    - "贡献流程、ADR 规则、验证命令或兼容性边界变化"
```

## 权威边界

本文件只补充贡献约束。执行权限、分支、提交、推送和合并规则以 `../AGENTS.md` 为准；具体文档同步门禁以 `DOC_SYNC_CHECKLIST.md` 为准。

## 如何验证

- 检查 `../AGENTS.md` 是否仍是唯一规则入口。
- 检查 `DOC_SYNC_CHECKLIST.md` 是否仍覆盖受影响文档。
- 运行本次变更涉及的测试、`pnpm typecheck` 和 `git diff --check`。
- 运行 `pnpm docs:validate` 检查本文结构和链接。

## 1. 什么时候必须补 ADR

出现以下任一情况时，改动里必须附 ADR 或等价决策记录：

- dispatcher 状态机语义变化
- worker result / review decision / assignment contract 变化
- dispatcher 真相源、持久化或 runtime ownership 边界变化
- 对外 HTTP 路径、方法或鉴权语义变化
- 发布或回滚门禁变化

建议位置：

- `docs/plans/` 里的活跃设计文档，或
- 新增独立 ADR 文档并在 `docs/README.md` 补入口

## 2. 兼容性规则

阶段二之后，主链契约默认遵守：

- 优先 additive 变更，不静默删字段
- 不再新增带副作用的 GET
- dispatcher-owned 字段不能再由 worker 覆盖
- `rework` / `changes_requested` / continuation / redrive 语义必须在类型、实现、文档里一致
- generic pool 表达优先，不再回退到 `codex/gemini-only` 新契约

如果必须做破坏性变更，提交中必须写清：

- 旧行为是什么
- 新行为是什么
- 兼容窗口多长
- 调用方要迁移什么
- 如何回滚

## 3. 契约变更 Checklist

- 更新实现代码
- 更新回归测试
- 更新 `README.md`
- 更新 `docs/README.md`
- 更新 `docs/onboarding.md`
- 更新 `docs/API_ENDPOINTS.md` 或对应 `docs/contracts/*`
- 如涉及状态语义，更新 `docs/STATE_MACHINE.md`
- 如涉及持久化形态，更新 `docs/DATABASE_SCHEMA.md`
- 如涉及运行边界，更新 `docs/ARCHITECTURE.md`
- 收尾前检查 `docs/DOC_SYNC_CHECKLIST.md`

## 4. 对 dispatcher / worker 变更的额外要求

- 提供 branch / commit / push / 验证证据
- 不把 worker 本地成功误报成平台已交付
- review 前校验远端 SHA，不能只信 worker 回执
- redrive 时遵守“复用原分支 / 新开 `-rN` 分支”的审查规则
- 自动 draft PR 只能在门禁满足时开启，worker 不得自行 merge

## 5. 推荐最小验证

默认至少执行：

```bash
pnpm test
pnpm typecheck
git diff --check
```

如果是局部模块，也至少补对应子集测试，并在合并前补足必要全量验证。
