# 文档上下文迁移任务

- [x] 审计现有规则入口、文档导航、稳定知识层和归档区。
- [x] 对照代码验证 dispatcher、lease、read-only、shadow、DR 脚本和发布 workflow 事实。
- [x] 补齐新版人机双友好文档结构和 `docs/AI_CONTEXT.md`。
- [x] 补充文档校验脚本并接入根目录命令。
- [x] 归档旧版重复文档并修正引用。
- [x] 运行文档校验、相关测试和 diff 检查。

## Review 小结

已完成增量迁移，没有从零重写旧文档。新增 `docs/AI_CONTEXT.md` 和 `scripts/validate_docs.py`，权威文档补齐目的、读者、摘要、`ai_summary`、边界和验证入口；根目录旧版 v1 手册已移入 `docs/archive/`。已运行 `pnpm docs:validate`、`python3 -m py_compile scripts/validate_docs.py`、`pnpm typecheck`、`pnpm test`、`git diff --check`。
