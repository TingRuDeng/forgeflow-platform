# Dispatcher 遗留 schema 常量删除

## 目标

- 删除未被运行时代码引用的 `apps/dispatcher/src/db/schema.ts`。
- 将持久化事实收敛到 live runtime SQLite backend：`apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`。
- 同步技术债、已知坑、数据库 schema、架构和 dispatcher README，避免后续维护者误改已删除的常量文件。

## 非目标

- 不修改 runtime-state SQLite 表结构。
- 不改变 JSON fallback / import 语义。
- 不改变 Postgres / queue shadow path 或 primary cutover 语义。

## 当前事实

- `rg` 只发现 `apps/dispatcher/src/db/schema.ts` 自身导出 `SQLITE_SCHEMA_STATEMENTS`，没有生产代码或测试引用。
- `runtime-state-sqlite.ts` 已持有 live SQLite snapshot / projection schema。
- 多份文档明确提示不要把 `src/db/schema.ts` 当 live path，说明该文件已成为误导性兼容残留。

## 执行计划

- [x] 删除 `apps/dispatcher/src/db/schema.ts`。
- [x] 更新 `docs/TECH_DEBT.md`，将技术债从“schema constants coexist”收敛为“SQLite + JSON fallback 边界”。
- [x] 更新 `docs/KNOWN_PITFALLS.md`、`docs/DATABASE_SCHEMA.md`、`docs/ARCHITECTURE.md` 和 `apps/dispatcher/README.md`。
- [x] 运行文档、类型、lint 和 dispatcher 持久化相关测试。

## 验证矩阵

- `rg -n "apps/dispatcher/src/db/schema.ts|src/db/schema.ts|SQLITE_SCHEMA_STATEMENTS" apps/dispatcher/src apps/dispatcher/README.md docs/TECH_DEBT.md docs/KNOWN_PITFALLS.md docs/DATABASE_SCHEMA.md docs/ARCHITECTURE.md packages scripts`
- `CI=true pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/runtime-state-json.test.ts --maxWorkers=1`
- `CI=true pnpm typecheck`
- `CI=true pnpm lint`
- `CI=true pnpm docs:validate`
- `python3 scripts/validate_docs.py . --profile generic`
- `git diff --check`

## 验证结果

- `rg -n "apps/dispatcher/src/db/schema.ts|src/db/schema.ts|SQLITE_SCHEMA_STATEMENTS" apps/dispatcher/src apps/dispatcher/README.md docs/TECH_DEBT.md docs/KNOWN_PITFALLS.md docs/DATABASE_SCHEMA.md docs/ARCHITECTURE.md packages scripts`：仅 `docs/TECH_DEBT.md` 保留“已删除”状态说明。
- `CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/runtime-state-json.test.ts --maxWorkers=1`：通过，2 个测试文件 / 21 个测试。
- `CI=true pnpm typecheck`：通过。
- `CI=true pnpm lint`：通过。
- `CI=true pnpm docs:validate`：通过。
- `python3 scripts/validate_docs.py . --profile generic`：通过。
- `git diff --check`：通过。

## Review 小结

终态：finished。

Spec 符合度：通过。未引用的 `apps/dispatcher/src/db/schema.ts` 已删除，live SQLite schema 事实收敛到 `runtime-state-sqlite.ts`，稳定文档同步移除“不要误改旧常量”的旧说法。

安全检查：通过。未新增 secret、外部输入、网络调用、fallback 或运行时行为变更。

测试与验证：通过。SQLite / JSON fallback 相关测试、typecheck、lint、文档校验和 diff 检查均已通过。

复杂度检查：通过。本轮删除遗留文件，只做文档事实同步，没有新增复杂函数或大文件。

Document-refresh: needed
原因：持久化技术债状态变化，已同步 `TECH_DEBT`、`KNOWN_PITFALLS`、`DATABASE_SCHEMA`、`ARCHITECTURE` 和 dispatcher README。

剩余风险：JSON fallback 仍是显式兼容边界，Postgres / queue shadow 仍不是默认 truth source。

潜在技术债：后续仍可继续评估是否收紧 JSON fallback 的使用场景，但这不属于本轮删除未引用 schema 常量的范围。

结论：通过。
