# 当前项目审查修复任务

- [x] M92 串行：让 Release workflow 在 provider runtime 发布后运行 published smoke。
- [x] M91 串行：新增已发布 runtime 包 registry 安装 / CLI smoke。
- [x] M90 串行：让 release workflow 复用通用 release package 检测脚本。
- [x] M89 串行：新增 runtime npm 包名 / Trusted Publisher 设置报告并共享 runtime package spec。
- [x] M88 串行：新增 runtime tarball 本地打包 / 安装 smoke 门禁。
- [x] M87 串行：校验已发布 runtime 包依赖元数据是否与源码发布清单一致。
- [x] M86 串行：让 release preflight 提前阻断未配置 npm 包名。
- [x] M85 串行：为 runtime 包发布清单增加可复现 readiness gate。
- [x] M84 串行：让 Console Artifact Workbench 支持跨任务 runtime event 搜索。
- [x] M83 串行：把 packaged worker daemon cycle 收敛到 beta-runtime-core shared cycle。
- [x] M82 串行：让 Console runtime events 支持按事件类型筛选。
- [x] M81 串行：让 Console 任务详情 runtime events 支持完整展开。
- [x] M80 串行：把 Codex/Gemini packaged worker CLI 下沉到 beta-runtime-core。
- [x] M79 串行：绑定 post-cutover completion evidence 到当前 approval marker。
- [x] M78 串行：新增 shadow primary cutover completion evidence。
- [x] M77 串行：在 `/api/dr/status` 与 Console DR 面板暴露 primary cutover evidence 状态。

## M92 Review 小结

已让 `scripts/verify-published-runtime-smoke.mjs` 支持 `--package <name>`：传入 `codex-beta-runtime`、`gemini-beta-runtime`、`trae-beta-runtime` 时会自动映射到对应 provider smoke group；传入 `beta-runtime-core`、`automation-gateway-core` 等非 provider 包时会显式跳过，不把 support core 发布误判成 provider smoke 缺失。

`.github/workflows/release.yml` 的手动发布和自动发布现在都会在 `npm publish` 成功后运行 `node scripts/verify-published-runtime-smoke.mjs --package <package> --require-published`。手动发布路径中该步骤位于 `npm publish` 之后、git commit/tag/push 之前；若 provider runtime 发布后无法从 registry 安装或 CLI 无法启动，workflow 会在记录 git 版本历史前失败，并复用既有发布后 git 恢复 issue 机制。

Review Gate：finished。Spec 符合度通过，本轮只把已存在的 published smoke 接入 release post-publish，不改变 publish、version bump、preflight 或非 provider 包发布语义。安全检查通过，新增步骤只读安装已发布包并校验 CLI，不读取 secret、不写 registry、不启动 worker / gateway 长进程；非 provider 包显式 skip。复杂度检查通过，脚本 211 行、测试 145 行、workflow 测试 134 行，均低于 300 行。Document-refresh: not-needed，原因：外部 operator 命令未变化，只是 release workflow 内部在 publish 后调用既有 smoke。结论：通过。

验证已通过：`node --check scripts/verify-published-runtime-smoke.mjs` 通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/published-runtime-smoke.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，2 个测试文件、10 个测试通过；真实 registry `node scripts/verify-published-runtime-smoke.mjs --package codex-beta-runtime --require-published --registry-timeout-ms 5000` 通过；`node scripts/verify-published-runtime-smoke.mjs --package beta-runtime-core --require-published --registry-timeout-ms 5000` 按预期 skip。`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：post-publish smoke 已接入 release workflow；完整全量 provider smoke 仍依赖 `@tingrudeng/beta-runtime-core` 和 `@tingrudeng/gemini-beta-runtime` 完成 npm 包名 / Trusted Publisher 配置并发布。

## M91 Review 小结

已新增 `scripts/verify-published-runtime-smoke.mjs` 和根命令 `pnpm verify:runtime-packages:published-smoke`。该命令读取当前源码版本的 codex/gemini/trae provider runtime，先用共享 npm registry helper 确认对应包名和版本已发布，再用临时 npm cache 从 registry 安装精确版本，校验 provider CLI bin 存在，并运行 `--version` 与 `--help`。默认可跳过未发布包并输出 warning；根命令带 `--require-published`，适合作为发布后远端安装 smoke 的硬门禁。

Review Gate：finished。Spec 符合度通过，本轮只新增发布后 registry 安装 / CLI smoke，不改变 runtime 代码、release workflow、npm publish 行为或 worker 启动语义。安全检查通过，脚本只读查询 npm registry 并在临时目录执行 `npm install --ignore-scripts --no-audit --no-fund`，不读取 secret、不发布、不写 registry；缺失包名或版本在 hard mode 下显式失败。复杂度检查通过，新增脚本 183 行、测试 115 行，均低于 300 行。Document-refresh: needed，原因：新增生产发布后 provider runtime smoke 命令，已同步 README、docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`node --check scripts/verify-published-runtime-smoke.mjs`、`node --check scripts/lib/npm-registry-status.mjs` 通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/published-runtime-smoke.test.ts tests/modules/execution/runtime-package-install.test.ts tests/modules/execution/runtime-package-setup-report.test.ts --maxWorkers=1` 通过，3 个测试文件、7 个测试通过；真实 registry smoke `node scripts/verify-published-runtime-smoke.mjs --groups codex --require-published --registry-timeout-ms 5000` 通过，确认 `@tingrudeng/codex-beta-runtime@0.1.0-beta.2` 可安装且 CLI 可执行；真实 registry hard smoke `node scripts/verify-published-runtime-smoke.mjs --groups gemini --require-published --registry-timeout-ms 5000` 按预期失败为 `setup_required`。`CI=true pnpm verify:runtime-packages`、`CI=true pnpm verify:runtime-packages:install`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：published smoke 已具备仓库侧执行入口；完整目标仍需要 npm 侧创建 / 绑定 `@tingrudeng/beta-runtime-core` 与 `@tingrudeng/gemini-beta-runtime`，发布缺失版本后再跑全量 `pnpm verify:runtime-packages:published` 和 `pnpm verify:runtime-packages:published-smoke`。

## M90 Review 小结

已新增 `scripts/lib/npm-registry-status.mjs`，把 npm registry package/version 状态查询、fixture 读取和 `setup_required` / `publish_version` / `registry_unknown` / `up_to_date` 分类抽成共享 helper。`scripts/report-runtime-package-setup.mjs` 已改为复用该 helper，并在 JSON 输出中移除完整 registry `versions` 元数据，只保留状态和当前版本。

已新增 `scripts/detect-release-packages.mjs`，扫描 `packages/*/package.json` 中所有 `@tingrudeng/*` 包，用共享 registry helper 输出 `packages`、`newPackages`、`unknownPackages` 和逐包 action。`.github/workflows/release.yml` 的 `detect-changes` job 已改为运行该脚本并用 `jq` 读取 JSON 输出，不再在 workflow YAML 中维护第二套 `npm view` / grep / sed 分支逻辑。

Review Gate：finished。Spec 符合度通过，本轮只收敛 release package 检测实现，不改变自动发布矩阵语义、手动发布 preflight、npm publish 或版本 bump 行为。安全检查通过，检测脚本只读查询 npm registry，不发布、不写 registry、不读取 secret；`--require-known` 会把 registry unknown 显式失败。复杂度检查通过，新增 `npm-registry-status.mjs` 102 行、`detect-release-packages.mjs` 105 行，触碰文件均低于 300 行。Document-refresh: not-needed，原因：这是 release workflow 内部实现去重，外部发布入口和 operator 命令没有变化。结论：通过。

验证已通过：`node --check scripts/lib/npm-registry-status.mjs`、`node --check scripts/detect-release-packages.mjs`、`node --check scripts/report-runtime-package-setup.mjs` 通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/release-package-detect.test.ts tests/modules/execution/runtime-package-setup-report.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，3 个测试文件、11 个测试通过；提升权限真实 registry 复跑 `node scripts/detect-release-packages.mjs --json --require-known --registry-timeout-ms 5000` 通过，输出 `newPackages=[beta-runtime-core@0.1.0-beta.1, gemini-beta-runtime@0.1.0-beta.2]`、`packages=[]`、`unknownPackages=[]`；`node scripts/report-runtime-package-setup.mjs --registry-timeout-ms 5000` 通过并继续标记这两个 runtime 包为 `setup_required`。`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：workflow 检测逻辑已去重，但真实发布仍取决于 npm 包名创建、Trusted Publisher 绑定和后续 Release workflow 执行。

## M89 Review 小结

已新增 `scripts/lib/runtime-package-specs.mjs`，把 runtime 包名、角色、provider bin、workspace 依赖和安装 smoke 分组从 readiness / install 两个脚本中抽为共享只读规格，避免后续 codex / gemini / trae 发布包清单继续漂移。`scripts/check-runtime-package-readiness.mjs` 和 `scripts/verify-runtime-package-install.mjs` 已改为复用该规格。

已新增 `scripts/report-runtime-package-setup.mjs` 和根命令 `pnpm report:runtime-packages:setup`。该报告直接用 Node HTTPS 只读查询 npm registry，输出 Trusted Publisher 期望配置、runtime 包发布顺序、每个包名 / 当前源码版本的 package 和 version 状态，并在 `--require-ready` 下把缺失包名、未发布版本或 registry unknown 转为硬失败。测试使用显式 registry fixture，不依赖本地 npm 子进程、端口监听或真实 registry。

Review Gate：finished。Spec 符合度通过，本轮只新增发布设置报告并去重 runtime package spec，不改变 worker runtime、dispatcher API、release publish 行为或 CI 默认发布矩阵。安全检查通过，报告默认只读查询 `https://registry.npmjs.org/`，不写 registry、不发布、不读取 secret；registry 失败会显式输出 `registry_unknown` 和错误原因，不做假成功。复杂度检查通过，新增报告脚本 236 行、共享规格 90 行，触碰脚本均低于 300 行。Document-refresh: needed，原因：新增 operator 发布设置报告入口并改变 runtime package spec 权威边界，已同步 README、docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`node --check scripts/lib/runtime-package-specs.mjs`、`node --check scripts/report-runtime-package-setup.mjs`、`node --check scripts/check-runtime-package-readiness.mjs`、`node --check scripts/verify-runtime-package-install.mjs` 通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/runtime-package-setup-report.test.ts tests/modules/execution/runtime-package-readiness.test.ts tests/modules/execution/runtime-package-install.test.ts --maxWorkers=1` 通过，3 个测试文件、9 个测试通过；`CI=true pnpm verify:runtime-packages`、`CI=true pnpm verify:runtime-packages:install`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。真实 registry 报告在普通沙箱下因 DNS 限制输出 `registry_unknown(getaddrinfo ENOTFOUND registry.npmjs.org)`；提升权限复跑 `node scripts/report-runtime-package-setup.mjs --registry-timeout-ms 5000` 通过，并确认 `@tingrudeng/beta-runtime-core` 与 `@tingrudeng/gemini-beta-runtime` 仍是 `setup_required`。

剩余风险：报告能把 npm 包名 / Trusted Publisher 缺口变成可复现 operator 证据；它不能代替 npm 侧创建包名、绑定 Trusted Publisher、触发真实 Release workflow 和远端机器全局安装 smoke。

## M88 Review 小结

已新增 `scripts/verify-runtime-package-install.mjs` 和根命令 `pnpm verify:runtime-packages:install`。该命令会按 `codex`、`gemini`、`trae` 三组 runtime 包执行本地 tarball smoke：构建相关包，在临时 staging package.json 中把 `workspace:*` 依赖重写为当前 workspace 版本，使用临时 npm cache 执行 `npm pack` 和 `npm install --ignore-scripts`，然后校验 provider CLI bin 已安装、安装后的 package 依赖不再包含 `workspace:*`。CI 与 release workflow 已接入该门禁。

这补上了 registry 之外的发布形态证明：即使 npm 包名尚未创建，也能在仓库内验证即将发布的 tarball 可被 npm 安装，并且 codex/gemini provider runtime 会携带可解析的 `@tingrudeng/beta-runtime-core` 版本依赖。

Review Gate：finished。Spec 符合度通过，本轮新增的是本地 tarball 打包 / 安装 smoke，不改变 runtime 代码、发布版本、npm publish 行为或默认运行路径。安全检查通过，脚本只读取源码包、复制到临时 staging 目录、使用临时 npm cache 执行 `npm pack` / `npm install --ignore-scripts`；不访问 registry、不写源码 package.json、不发布、不引入 secret 或静默成功路径。复杂度检查通过，`scripts/verify-runtime-package-install.mjs` 210 行、新增测试 98 行，函数均短小。Document-refresh: needed，原因：新增 CI / release 级 runtime tarball 安装门禁，已同步 README、docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/runtime-package-install.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，2 个测试文件、8 个测试通过；`CI=true pnpm verify:runtime-packages:install` 通过，codex / gemini / trae 三组 runtime tarball 均本地安装成功；`node --check scripts/verify-runtime-package-install.mjs`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。RED 阶段曾因 npm 使用全局 cache 中 root-owned 文件导致 `npm pack` EPERM，已修为每组 smoke 使用临时 `NPM_CONFIG_CACHE`，避免开发机全局 npm 状态影响验证。

剩余风险：本地 tarball 安装 smoke 能证明发布包形态可安装；它不等于 npm registry 真实发布，也不覆盖远端机器的 dispatcher / provider credential / 网络连通性 smoke。`@tingrudeng/beta-runtime-core` 与 `@tingrudeng/gemini-beta-runtime` 仍需外部 npm 包名和 Trusted Publisher 配置。

## M87 Review 小结

已扩展 `scripts/check-runtime-package-readiness.mjs`：新增 `--check-published-metadata`，会在显式 registry 检查时读取 `npm view <package>@<version> dependencies --json`，并把本地 package.json 中的 `workspace:*` 依赖按当前 workspace 版本重写后，与已发布包的依赖元数据对比。新增根命令 `pnpm verify:runtime-packages:published`，用于生产发布窗口强制校验 runtime 包名、当前本地版本和已发布依赖元数据。

这能捕获一种关键漂移：包名和版本存在，但已发布包仍是旧形态，缺少本地源码当前要求的 `@tingrudeng/beta-runtime-core` / `@tingrudeng/automation-gateway-core` 依赖，从而导致远端安装包不能代表当前 runtime 去重后的实现。

Review Gate：finished。Spec 符合度通过，本轮只扩展 runtime package readiness 的显式生产发布校验，不改变默认 CI 行为、release workflow 行为、runtime 代码或 npm 发布动作。安全检查通过，新增逻辑只执行 `npm view <package>@<version> dependencies --json` 只读查询；失败或元数据不匹配会显式报错，不做静默放行、mock 成功路径或写 registry。复杂度检查通过，`scripts/check-runtime-package-readiness.mjs` 283 行，仍低于 300 行；新增函数均短小，测试文件 204 行。Document-refresh: needed，原因：新增 `pnpm verify:runtime-packages:published` 生产发布门禁，已同步 README、docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/runtime-package-readiness.test.ts --maxWorkers=1` 通过，1 个测试文件、4 个测试通过；`node --check scripts/check-runtime-package-readiness.mjs`、`CI=true pnpm verify:runtime-packages`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。真实 registry 只读命令 `node scripts/check-runtime-package-readiness.mjs --check-registry --check-published-metadata --registry-timeout-ms 5000` 本轮因 npm registry 查询超时只输出 warning 并通过非硬门禁模式；生产硬门禁应使用 `pnpm verify:runtime-packages:published`。

剩余风险：该门禁能发现已发布包依赖元数据漂移；真实 `@tingrudeng/beta-runtime-core` / `@tingrudeng/gemini-beta-runtime` 包名创建、Trusted Publisher 绑定和远端 smoke 仍需要外部 npm / 生产环境动作。

## M86 Review 小结

已排查 GitHub Release workflow run `28751633695`：`beta-runtime-core` 手动发布在 typecheck、runtime package readiness、测试、shadow drift gate、build 和 provenance 生成后，于 `npm publish --access public --provenance --tag beta` 返回 E404。根因是 `@tingrudeng/beta-runtime-core` 包名尚未在 npm registry 创建，或当前 Trusted Publisher 没有该包发布权限；旧 preflight 只校验仓库变量和 package metadata，未提前验证 npm 包名可见性。

已为 `scripts/release-publish-preflight.mjs` 增加 `--require-package-exists`，通过只读 `npm view <package> version` 在发布前校验包名存在；手动发布和自动发布 workflow 都已接入该参数。包名不存在、权限不足或 registry 查询失败时，workflow 会停在 Release preflight，并提示先创建 npm 包名和配置 Trusted Publisher，避免跑完构建后才在 `npm publish` PUT 阶段失败。

Review Gate：finished。Spec 符合度通过，本轮只把 npm 包名 / Trusted Publisher 可见性检查前移到 release preflight，不改变包版本、runtime 代码、发布命令或 package 内容。安全检查通过，新增逻辑只执行 `npm view <package> version` 只读查询，失败时显式阻断；不新增 secret、npm publish、写 registry、mock 成功路径或静默 fallback。复杂度检查通过，`scripts/release-publish-preflight.mjs` 159 行、新增测试 99 行，新增函数均保持短函数。Document-refresh: needed，原因：release workflow 发布前门禁语义变化，已同步 docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/release-publish-preflight.test.ts --maxWorkers=1` 先失败于 preflight 未检查 npm 包名存在；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/release-publish-preflight.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，2 个测试文件、7 个测试通过；`node --check scripts/release-publish-preflight.mjs`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。真实 preflight 命令 `NPM_TRUSTED_PUBLISHING_ENABLED=true node scripts/release-publish-preflight.mjs --package-dir packages/beta-runtime-core --expected-repo TingRuDeng/forgeflow-platform --require-trusted-publishing --require-package-exists` 已在 publish 前失败；本次网络返回 registry 查询超时，但失败位置已前移到 preflight。

剩余风险：该变更能把 npm 包名 / Trusted Publisher 缺口提前暴露为 preflight 失败；它不能代替外部 npm 管理动作，`@tingrudeng/beta-runtime-core` 与 `@tingrudeng/gemini-beta-runtime` 仍需在 npm 侧创建包名并绑定 GitHub Trusted Publisher 后才能真正发布。

## M85 Review 小结

已新增 `scripts/check-runtime-package-readiness.mjs` 和根命令 `pnpm verify:runtime-packages`，把 runtime 包发布清单变成可复现门禁。该脚本默认只做本地只读校验，覆盖 `automation-gateway-core`、`beta-runtime-core`、`codex-beta-runtime`、`gemini-beta-runtime`、`trae-beta-runtime` 的 public package 元数据、发布文件范围、build/typecheck/test 脚本、provider CLI bin、源码内 `workspace:*` 依赖以及发布前依赖重写规则。CI 与 release workflow 都已接入该门禁；需要生产发布前校验 npm registry 时，可显式运行 `node scripts/check-runtime-package-readiness.mjs --check-registry --require-published`，该模式只执行 `npm view` 只读查询。

Review Gate：finished。Spec 符合度通过，本轮只把 runtime 包发布清单和 registry 查询前置为可复现门禁，不改变 worker runtime、dispatcher API、发布版本号或 npm 发布行为。安全检查通过，默认模式不联网、不写文件、不发布；可选 registry 模式只执行 `npm view` 只读查询，且带超时控制；`--require-published` 会把缺失包名、缺失版本或查询失败显式失败，不做静默放行。复杂度检查通过，新增脚本 221 行、新增测试 165 行，单函数均保持短函数拆分。Document-refresh: needed，原因：runtime 包发布门禁和剩余外部边界变化，已同步 README、docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm verify:runtime-packages` 通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/runtime-package-readiness.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，2 个测试文件、9 个测试通过；`node scripts/check-runtime-package-readiness.mjs --check-registry --registry-timeout-ms 1` 通过并证明 registry 查询超时时会输出明确 warning；`node --check scripts/check-runtime-package-readiness.mjs`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。首次直接运行 `pnpm verify:runtime-packages` 时 pnpm 在非 TTY 下触发依赖目录清理确认并中止，按 pnpm 提示使用 `CI=true` 后通过。

剩余风险：该门禁能证明仓库内 runtime 包清单和 CI/release 接入未漂移；`@tingrudeng/beta-runtime-core` 与 `@tingrudeng/gemini-beta-runtime` 的 npm 包名创建、Trusted Publisher 配置和真实生产远端安装仍是外部动作，需要在发布窗口用 `--check-registry --require-published` 和实际远端 smoke 验证补证据。

## M84 Review 小结

已在 Console Artifact Workbench 顶部新增跨任务 runtime event 搜索区域。该区域直接消费 dashboard snapshot 的 `events[]`，展示 event type 聚合计数，支持按 event type 和全文查询筛选，并可点击事件跳转到对应任务详情。这样 reviewer 可先按 `delivery_failed`、`progress_reported`、任务标题、仓库或事件摘要定位风险任务，再进入 artifact / review / HITL 详情。

Review Gate：finished。Spec 符合度通过，本轮继续推进 Console 审查工作台产品化，只把 dashboard snapshot 已有 runtime events 聚合到 Artifact Workbench，不改变 dispatcher API、事件 payload、artifact schema、review decision 或后端保留策略。安全检查通过，筛选只作用于前端已加载事件数组，不新增 secret、外部网络、后端写路径、mock 成功路径或静默 fallback。复杂度检查通过，新增 `RuntimeEventWorkbench.tsx` 164 行，`ArtifactWorkbench.tsx` 249 行，`App.tsx` 保持 300 行。Document-refresh: needed，原因：Console 工作台新增跨任务 runtime event 搜索和 event type 聚合，已同步 README、docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx --maxWorkers=1` 先失败于缺少“运行事件搜索 / Runtime Event Search”；GREEN 后同命令通过，1 个测试文件、17 个测试通过。最终验证：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx src/__tests__/App.test.tsx --maxWorkers=1` 通过，2 个测试文件、22 个测试通过；`CI=true pnpm --filter console lint`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：本轮只做前端工作台聚合，不改变 dashboard snapshot API；运行事件保留范围仍由 dispatcher snapshot 和后端保留策略决定。

## M83 Review 小结

已把 `packages/beta-runtime-core/src/runtime/worker-daemon-cycle.ts` 设为 generic worker daemon 的唯一主循环实现。`packages/beta-runtime-core/src/runtime/worker-daemon.ts` 现在只负责 provider package root、live executor 和失败 result fallback adapter；`apps/dispatcher/src/modules/server/runtime-glue-worker-daemon-cycle.ts` 也改为复用同一个 shared cycle，`apps/dispatcher/src/modules/server/runtime-glue-dispatcher-client.ts` 只保留 HTTP / state-dir dispatcher client plumbing 和兼容 re-export。旧 `packages/beta-runtime-core/src/runtime/task-processor.ts:processTaskAssignment` 已删除，避免 packaged runtime 继续维护第二套 register / heartbeat / claim / start / completed submitResult retry 路径。

Review Gate：finished。Spec 符合度通过，本轮只收敛 generic Codex/Gemini worker daemon 主循环，不改变 live executor、assignment runner、provider launch builder、Trae worker 或 dispatcher HTTP 协议语义。安全检查通过，未新增 secret、外部网络、shell 拼接、mock 成功路径或静默 fallback；completed submitResult retry 和 delivery_failed 事件统一由 shared cycle 负责。复杂度检查通过，新增 `worker-daemon-cycle.ts` 230 行，拆分后的 dispatcher client / cycle adapter、packaged daemon adapter 和 task processor 均低于 300 行。Document-refresh: needed，原因：worker daemon 主循环权威边界变化，已同步 README、docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/beta-runtime-core exec vitest run tests/worker-daemon.test.ts --maxWorkers=1` 先失败于 packaged worker daemon 仍缺少 `./worker-daemon-cycle.js` adapter 且保留旧主循环；GREEN 后 `CI=true pnpm --filter @tingrudeng/beta-runtime-core test -- --maxWorkers=1` 通过，4 个测试文件、24 个测试通过。`CI=true pnpm --filter @forgeflow/dispatcher build` 通过。`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-glue.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/worker-daemon-thin-adapter.test.ts --maxWorkers=1` 通过，3 个测试文件、31 个测试通过。`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test -- tests/runtime-wrapper.test.ts tests/cli.test.ts --maxWorkers=1` 通过，2 个测试文件、4 个测试通过。`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test -- tests/runtime-wrapper.test.ts tests/cli.test.ts --maxWorkers=1` 通过，2 个测试文件、5 个测试通过。`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。默认沙箱下全量 `CI=true pnpm test` 因本地 HTTP server 监听 `127.0.0.1` 报 `listen EPERM`；非沙箱第一次复跑只剩 `trae-automation-worker.test.ts` 首个 prompt 测试 20s 偶发超时，隔离复跑该文件 13/13 通过，第二次非沙箱全量 `CI=true pnpm test` 通过，24 个 workspace project 完成，其中 dispatcher 54 个测试文件、527 个测试通过。

剩余风险：本轮收敛的是 generic Codex/Gemini worker daemon cycle；Trae automation worker 和 automation gateway 仍有自身协议适配，但不再与 generic worker daemon 共享这条主循环。完整生产部署仍需要已发布 runtime 包、固定版本和 CI 发布证据。

## M82 Review 小结

已在 Console 任务详情 runtime events 区域新增 event type 筛选。事件类型超过一种时展示下拉选择器，默认保留全部类型；选择 `delivery_failed`、`progress_reported` 等类型后，列表和计数都会基于过滤结果重新计算，再应用默认 10 条摘要 / 显示全部逻辑。这样 reviewer 面对较长事件流时可以先收窄到失败、暂停或进度类证据。

Review Gate：finished。Spec 符合度通过，本轮继续推进 Console 审查工作台产品化，只增强前端 runtime events 过滤，不改变 dashboard snapshot、事件 payload、dispatcher API、review decision 或 artifact 行为。安全检查通过，筛选只作用于已加载的前端事件数组，不新增 secret、网络调用、后端写路径、mock 成功路径或静默 fallback。复杂度检查通过，`TaskTimeline.tsx` 仍低于 300 行，新增测试继续位于独立文件。Document-refresh: needed，原因：Console 任务详情 runtime events 审查体验变化，已同步 docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/TaskTimelineRuntimeEvents.test.tsx --maxWorkers=1` 先失败于缺少“事件类型 / Event type”筛选控件；GREEN 后 `CI=true pnpm --filter console exec vitest run src/components/__tests__/TaskTimelineRuntimeEvents.test.tsx src/components/__tests__/Lists.test.tsx src/components/__tests__/TaskDetailsPanelTerminationPolicy.test.tsx --maxWorkers=1` 通过，3 个测试文件、19 个测试通过；`CI=true pnpm --filter console lint`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：单任务详情页 runtime events 已支持展开和按类型筛选；M84 已补齐跨任务事件筛选、按 event type 聚合摘要和全文事件搜索。

## M81 Review 小结

已让 Console 任务详情的运行时事件区从固定 `slice(0, 10)` 提升为可审查的摘要 / 完整列表切换。默认仍展示 10 条，避免详情面板过长；当事件数超过 10 条时显示 `10 / N` 计数和“显示全部 / 收起”操作，reviewer 可在同一详情页展开完整 runtime events，不需要跳到终端面板或后端原始数据核对。

Review Gate：finished。Spec 符合度通过，本轮继续推进 Console 审查工作台产品化，只增强运行时事件的可读证据，不改变 dashboard snapshot、事件排序、dispatcher API、review decision 或 artifact 行为。安全检查通过，新增状态只控制前端展示数量，不新增 secret、网络调用、后端写路径、mock 成功路径或静默 fallback。复杂度检查通过，`TaskTimeline.tsx` 保持低于 300 行，新测试拆到独立文件。Document-refresh: needed，原因：Console 任务详情 runtime events 审查体验变化，已同步 docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/TaskTimelineRuntimeEvents.test.tsx --maxWorkers=1` 先失败于缺少事件计数和展开按钮；GREEN 后 `CI=true pnpm --filter console exec vitest run src/components/__tests__/TaskTimelineRuntimeEvents.test.tsx src/components/__tests__/Lists.test.tsx src/components/__tests__/TaskDetailsPanelTerminationPolicy.test.tsx --maxWorkers=1` 通过，3 个测试文件、18 个测试通过；`CI=true pnpm --filter console lint`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：Console 任务详情已可展开完整 runtime events；M84 已补齐跨任务事件筛选、按 event type 聚合和专门事件搜索。

## M80 Review 小结

已新增 `packages/beta-runtime-core/src/runtime/provider-worker-cli.ts`，把 Codex/Gemini packaged runtime 的 worker CLI 参数解析、help 输出、必填参数校验、provider pool 校验、`--codex-bin` / `--gemini-bin` 环境变量 wiring 和 `runWorkerDaemon` 启动委托收敛到共享 core。`packages/codex-beta-runtime/src/runtime/worker.ts` 与 `packages/gemini-beta-runtime/src/runtime/worker.ts` 已从各 150 行重复实现降为 provider 配置型薄入口。

Review Gate：finished。Spec 符合度通过，本轮继续推进 runtime executor / launch 去重，只迁移 provider worker CLI glue，不改变 daemon cycle、dispatcher protocol、assignment runner、launch argv、submitResult 语义或发布配置。安全检查通过，新增 helper 只解析固定 CLI flag 并写入 provider 专属 env key，不新增 secret、网络调用、shell 拼接、mock 成功路径或静默 fallback。复杂度检查通过，新增 core helper 和测试均低于 300 行，两个 packaged runtime `worker.ts` 均低于 50 行。Document-refresh: needed，原因：Codex/Gemini packaged worker CLI 权威边界从各 runtime 包迁移到 beta-runtime-core，已同步 README、docs README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @tingrudeng/beta-runtime-core exec vitest run tests/provider-worker-cli.test.ts tests/worker-daemon.test.ts tests/run-worker-assignment.test.ts --maxWorkers=1`，3 个测试文件、21 个测试通过；`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test -- tests/runtime-wrapper.test.ts tests/cli.test.ts --maxWorkers=1`，2 个测试文件、4 个测试通过；`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test -- tests/runtime-wrapper.test.ts tests/cli.test.ts --maxWorkers=1`，2 个测试文件、5 个测试通过；`CI=true pnpm --filter @tingrudeng/codex-beta-runtime build`、`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：provider worker CLI 重复实现已下沉到共享 core；Gemini 远程包发布仍依赖 npm 包名和 Trusted Publisher 外部配置，真实生产部署仍需要固定版本和 CI 发布证据。

## M79 Review 小结

已让 `/api/dr/status.primaryCutover.completed` 不再只相信 `shadow-cutover-complete.json` 自身，而是同时校验 completion evidence 内嵌的 `ready_evidence.approval_evidence` 与当前 `shadow-cutover-approval.json` / archived drill evidence SHA-256 完全一致。旧 completion 文件若来自另一轮 approval，会返回 `failed`，避免新审批链复用旧完成证据。

Review Gate：finished。Spec 符合度通过，本轮只收紧 completed 状态判定，不改变 completion 脚本、pre-switch ready gate、Postgres primary backend guard 或 Console 展示结构。安全检查通过，只比较本地 evidence 路径和 SHA-256，不新增 secret、网络调用、shell 拼接、mock 成功路径或静默 fallback。Document-refresh: needed，原因：completed 状态语义从“completion 文件通过”收紧为“completion 文件绑定当前 approval marker”，已同步 API、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-primary-cutover.test.ts tests/modules/server/dispatcher-server-dr-status.test.ts --maxWorkers=1`，2 个测试文件、6 个测试通过；`CI=true pnpm --filter console exec vitest run src/components/__tests__/DrStatusPanel.test.tsx --maxWorkers=1`，1 个测试文件、2 个测试通过。

剩余风险：completion evidence 已与当前 approval marker 绑定；真实生产 cutover 仍需要 operator 完成进程 / 流量切换、外部 Postgres 运维、备份保留和回滚演练。

## M78 Review 小结

已新增 `scripts/verify-shadow-cutover-complete.mjs`、`pnpm verify:shadow-cutover:complete` 和 `pnpm verify:shadow-cutover:complete:evidence`。该 post-cutover gate 会复核 final ready evidence、确认 `RUNTIME_STATE_BACKEND=postgres` 与 `DISPATCHER_PRIMARY_POSTGRES_URL` 已选中，并读取 Postgres `dispatcher_runtime_state` primary snapshot；成功后可把 `.forgeflow-dispatcher/shadow-cutover-complete.json` 作为切换完成证据归档。`/api/dr/status.primaryCutover` 现在会读取 completion evidence，证据存在且 primary snapshot phase 通过时从 `ready` 推进到 `completed`；Console DR 状态面板同步展示完成证据和 primary snapshot sequence。源码与 packaged backup / restore 都会保留 `shadow-cutover-complete.json`。

Review Gate：finished。Spec 符合度通过，本轮继续推进 shadow 自动 reconciliation / production cutover 收口，补齐的是切换后的 completion evidence，不改变 pre-switch approval / ready gate、Postgres primary backend guard、revocation guard 或真实切换开关。安全检查通过，completion 脚本不打印 Postgres URL，只输出 selected/configured、snapshot sequence 和计数摘要；不新增 secret、shell 拼接、mock 成功路径或静默 fallback，Postgres 不可读会显式失败。复杂度检查通过，新增脚本与测试均低于 300 行，触碰文件职责未扩大。Document-refresh: needed，原因：新增 cutover completion 命令、DR status completed 状态和备份范围，已同步 README、API endpoints、docs README、Stage 3 runbook、backup / restore runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-primary-cutover.test.ts tests/modules/server/dispatcher-server-dr-status.test.ts tests/modules/execution/shadow-cutover-complete.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1`，4 个测试文件、13 个测试通过；`CI=true pnpm --filter console exec vitest run src/components/__tests__/DrStatusPanel.test.tsx src/__tests__/App.test.tsx --maxWorkers=1`，2 个测试文件、7 个测试通过；`CI=true pnpm --filter @tingrudeng/forgeflow-dispatcher exec vitest run tests/backup.test.ts --maxWorkers=1`，1 个测试通过；`node --check scripts/verify-shadow-cutover-complete.mjs` 通过。

剩余风险：completion evidence 能证明已选中 Postgres primary backend 且 primary snapshot 可读；真实生产 cutover 仍需要 operator 在生产环境完成进程 / 流量切换、外部 Postgres 运维、备份保留和回滚演练。
- [x] M76 串行：让 Postgres primary backend 强制校验 shadow cutover ready evidence。

## M77 Review 小结

已新增 dispatcher `primaryCutover` DR status：`/api/dr/status.primaryCutover` 会读取 approval marker、final ready evidence、revocation marker 和 primary backend 环境状态，返回 `unknown` / `ready` / `blocked` / `failed`。`ready` 要求 approval marker、archived drill evidence SHA-256 和 ready evidence 的 `approval_evidence` 完全匹配；revocation marker 存在时返回 `blocked`；证据损坏或不匹配时返回 `failed`。Console 首屏 DR 状态面板同步展示主库切换状态、审批证据、就绪证据、主库后端和撤销 / 错误原因。

Review Gate：finished。Spec 符合度通过，本轮推进 shadow 自动 reconciliation / production cutover 的可观测收尾，只把已有 cutover evidence gate 暴露为只读 DR status 和 Console 信号，不改变 Postgres primary backend guard、approval / ready / revoke 脚本或真实切换开关。安全检查通过，新增 helper 只读取固定 evidence JSON、计算本地 SHA-256 并返回状态摘要，不暴露 `DISPATCHER_PRIMARY_POSTGRES_URL`，不新增 secret、外部网络、shell 拼接、mock 成功路径或静默 fallback。复杂度检查通过，新增 `runtime-state-primary-cutover.ts` 203 行，新增测试文件 128 / 42 行，Console 面板 159 行。Document-refresh: needed，原因：`/api/dr/status` payload 和 Console DR 面板能力变化，已同步 README、API endpoints、docs README、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-primary-cutover.test.ts tests/modules/server/dispatcher-server-dr-status.test.ts --maxWorkers=1`，2 个测试文件、4 个测试通过；`CI=true pnpm --filter console exec vitest run src/components/__tests__/DrStatusPanel.test.tsx src/__tests__/App.test.tsx --maxWorkers=1`，2 个测试文件、7 个测试通过；`CI=true pnpm --filter console lint`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：仓库内 cutover evidence 已能通过 API 和 Console 审查；真实生产 cutover 仍需要 operator 在生产环境执行 drill / approval / ready evidence、配置 Postgres primary backend、切换进程环境并保留变更窗口证据。
- [x] M75 串行：让 runtime backup / restore 保留 shadow cutover drill / ready evidence。
- [x] M74 串行：补齐 shadow cutover ready 最终门禁 evidence 归档入口。
- [x] M73 串行：补齐 HITL resume payload 的 dispatcher 服务端 schema 校验。
- [x] M72 串行：收口 `DISPATCHER_SHADOW_MODE=primary` 的生产 cutover 兼容语义。
- [x] M71 串行：为结构化 trajectory 生成 `.traj` 回放文件。
- [x] M70 串行：在 Console 任务详情展示 task-level termination policy。
- [x] M69 串行：新增 shadow cutover ready 综合门禁。
- [x] M68 串行：新增 shadow cutover approval 独立校验入口。
- [x] M67 串行：新增 strict shadow cutover reconciler package script。
- [x] M66 串行：修正 runtime daemon 去重完成后的 TECH_DEBT / README 分类漂移。
- [x] M65 串行：让 shadow reconciler 支持 strict cutover 参数透传。
- [x] M64 串行：补齐 Console Artifact Workbench 卡片级 artifact 文件展开 / 下载入口。
- [x] M63 串行：补齐 Console Artifact Workbench 卡片级 artifact ref 复制入口。
- [x] M62 串行：新增 shadow drift 自动 reconciliation 长期运行入口。
- [x] M61 串行：补强 Postgres primary cutover approval 证据校验。
- [x] M60 串行：把 Trae worker phase events 纳入 artifact trajectory。
- [x] M59 串行：补齐 Trae automation worker 的 trajectory artifact parity。
- [x] M55 串行：把 Trae CDP / DOM driver 本体下沉到 automation-gateway-core。
- [x] M56 串行：继续拆分共享 `trae-dom-driver.ts` 大文件，按 browser expressions / response collection / driver facade 收敛到 300 行以内。
- [x] M57 串行：把 Codex/Gemini packaged runtime launch builder 下沉到 beta-runtime-core。
- [x] M58 串行：让 generic assignment runner 产出可回放 trajectory artifact。

## M76 Review 小结

已让 `RUNTIME_STATE_BACKEND=postgres` 的 primary backend guard 在连接 Postgres 前同时校验 `shadow-cutover-approval.json` 与 `shadow-cutover-ready.json`。新的 guard 要求 ready evidence 存在、`ok=true`、`strict_cutover_preflight` phase 通过且 reason 为 `cutover_ready`，并要求 `approval_evidence` 中的 `approvalPath`、`evidencePath`、`evidenceSha256` 与 approval marker / drill evidence 完全一致。这样 operator 不能只生成 approval marker 后绕过最终 ready gate 直接切主库；自定义 ready 文件路径可用 `DISPATCHER_PRIMARY_CUTOVER_READY_FILE`。

Review Gate：finished。Spec 符合度通过，本轮只收紧 Postgres primary backend 启动前 cutover evidence 门禁，不改变 shadow drift gate、drill / approve / ready / revoke 脚本、Postgres snapshot schema、HTTP async state path 或 `/api/query/*` 行为。安全检查通过，新增逻辑只读取本地固定 evidence JSON 并做字段 / hash / path 匹配，不新增 secret、网络调用、shell 拼接、mock 成功路径或静默 fallback；证据缺失或错配会在创建 Postgres client 前显式失败。复杂度检查通过，`runtime-state-postgres.ts` 186 行，相关测试文件 253 / 210 行，均低于 300 行。Document-refresh: needed，原因：production cutover primary backend guard 从 approval-only 扩展为 approval + ready evidence 硬门禁，已同步 README、API endpoints、runtime-state contract、docs README、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-postgres.test.ts --maxWorkers=1` 先失败于缺少 ready evidence / ready evidence 错配仍能连接 Postgres；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-postgres.test.ts tests/modules/server/dispatcher-server-postgres.test.ts --maxWorkers=1` 通过，2 个测试文件、12 个测试通过。`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。沙箱内 `env HOME=/private/tmp/forgeflow-test-home CI=true pnpm test` 因本地 HTTP server 监听 `127.0.0.1` 报 `listen EPERM` 失败；非沙箱复跑同一命令通过，24 个 workspace project 全量测试完成，dispatcher 51 个测试文件、516 个测试通过。

剩余风险：仓库内 primary backend 已不能绕过 final ready evidence；真实生产 cutover 仍需要 operator 在变更窗口执行 drill / approval / ready evidence、配置 Postgres primary URL、保存 evidence，并完成外部流量切换与回滚演练。

## M75 Review 小结

已把 `shadow-cutover-drill.json` 和 `shadow-cutover-ready.json` 加入 `backup-runtime-state.mjs` / `restore-runtime-state.mjs` 的文件清单，并让 `verify-stage3-dr.mjs` 写入四类 cutover 文件后验证它们都被备份和恢复。这样 primary backend approval 依赖的 drill evidence、最终 ready gate evidence、approval marker 和 revocation marker 能随 runtime state 一起恢复。

Review Gate：finished。Spec 符合度通过，本轮只扩展 runtime backup / restore 的 cutover evidence 文件范围，不改变 SQLite/WAL 备份、primary backend guard、approval 校验或 ready gate 语义。安全检查通过，脚本仍只复制固定文件名，不新增 secret、网络调用、shell 拼接、mock 成功路径或静默 fallback。复杂度检查通过，`backup-runtime-state.mjs` 51 行、`restore-runtime-state.mjs` 43 行、`verify-stage3-dr.mjs` 188 行，均低于 300 行。Document-refresh: needed，原因：备份恢复范围新增 cutover drill / ready evidence，已同步 runtime backup runbook、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`node scripts/verify-stage3-dr.mjs` 输出 `ok=true`，`copiedFiles` 和 `restoredFiles` 均包含 `shadow-cutover-drill.json`、`shadow-cutover-approval.json`、`shadow-cutover-ready.json`、`shadow-cutover-revocation.json`，同时 SQLite `integrityCheck=ok`、`snapshotCount=4`；`node --check scripts/backup-runtime-state.mjs`、`node --check scripts/restore-runtime-state.mjs`、`node --check scripts/verify-stage3-dr.mjs` 通过；`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：仓库内 backup / restore 已保留 cutover evidence；真实生产恢复仍需要 operator 确认备份目录安全保存，并在恢复后重新执行 ready / approval 检查。

## M74 Review 小结

已让 `scripts/verify-shadow-cutover-ready.mjs` 支持 `--output <path>`，并新增 `pnpm verify:shadow-cutover:ready:evidence`，将最终切换前 `strict_cutover_preflight` + `approval_evidence` payload 原子写入 `.forgeflow-dispatcher/shadow-cutover-ready.json`。这样 production cutover 的最后一道门禁不再只有 stdout，可和 drill evidence、approval marker、revocation marker 一起归档。

Review Gate：finished。Spec 符合度通过，本轮只补齐 production cutover 最终 ready gate 的 evidence 归档能力，不改变 strict preflight、approval marker、revocation marker、primary backend guard 或 shadow drift 判断语义。安全检查通过，脚本仍只调用固定仓库脚本并原子写本地 JSON 文件，不新增 secret、网络调用、shell 拼接、mock 成功路径或静默 fallback；即使 ready gate 失败，也会归档失败 phase payload 供审计。复杂度检查通过，`verify-shadow-cutover-ready.mjs` 108 行，`shadow-cutover-approval.test.ts` 260 行，`workflows.test.ts` 104 行，均低于 300 行。Document-refresh: needed，原因：新增 `verify:shadow-cutover:ready:evidence` operator 入口，已同步 README、API endpoints、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-cutover-approval.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，2 个测试文件、14 个测试通过；`node --check scripts/verify-shadow-cutover-ready.mjs`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：仓库内最终 ready evidence 归档已补齐；真实生产切换仍依赖 operator 在生产环境配置 Postgres、运行 drill / approval / ready evidence，并在变更窗口切换 `RUNTIME_STATE_BACKEND=postgres`。

## M73 Review 小结

已新增 `runtime-state-hitl.ts`，把 `resumePayloadSchema` 从仅供 Console 渲染 / 校验的 UI 契约，提升为 dispatcher 状态机的服务端校验边界。`resumeTaskFromInput()` 现在会在任务处于 `waiting_for_input` 且保存了 schema 时，校验必填字段、类型、枚举、数字范围、数组长度和字符串数组枚举；非法恢复输入会保持任务在 `waiting_for_input`，HTTP `/api/tasks/:taskId/resume` 返回 `400`。这样 worker、Console、CLI 或直接 HTTP 调用都共享同一 HITL resume 语义。

Review Gate：finished。Spec 符合度通过，本轮只补齐 HITL resume payload 在 dispatcher 服务端的 schema 校验，不改变 interrupt/checkpoint、lease 释放、resume 后重新 claim、Console 表单或 beta runtime assignment package 消费语义。安全检查通过，新增校验只检查已保存 schema 与入站 JSON object，不新增 secret、外部网络、shell 拼接、mock 成功路径或静默 fallback；非法 payload 会显式返回 `400` 并保持任务在 `waiting_for_input`。复杂度检查通过，新增 `runtime-state-hitl.ts` 107 行、`runtime-state-hitl.test.ts` 162 行、`dispatcher-server-hitl.test.ts` 142 行，均低于 300 行，helper 已拆分。Document-refresh: needed，原因：HITL resume API 边界从前端校验扩展为服务端契约校验，已同步 README、docs/README、API endpoints、Worker Protocol、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-hitl.test.ts --maxWorkers=1` 先失败于测试夹具未使用 `createDispatch` 生成的内部 task id；修正后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-hitl.test.ts tests/modules/server/dispatcher-server-hitl.test.ts --maxWorkers=1` 通过，2 个测试文件、3 个测试通过。受影响回归 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-hitl.test.ts tests/modules/server/dispatcher-server-hitl.test.ts --maxWorkers=1` 通过，3 个测试文件、70 个测试通过。`CI=true pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatcher-server.test.ts` 在非沙箱复跑通过，66 个测试通过；沙箱内同测试的 listener 用例因 `listen EPERM 127.0.0.1` 超时，这是本地监听权限限制。最终验证 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：HITL resume schema 服务端校验已覆盖当前共享子集；嵌套对象、对象数组或跨字段依赖仍不在当前 worker 共享 schema 子集内。

## M72 Review 小结

已把 `DISPATCHER_SHADOW_MODE=primary` 从旧的 `primary_store_not_implemented` 硬拒绝，收敛为生产 cutover 后的兼容状态：只有 `RUNTIME_STATE_BACKEND=postgres` 且 `DISPATCHER_PRIMARY_POSTGRES_URL` 已配置时，shadow health / drift / cutover 检查才把 primary mode 视为 supported + matched；否则仍显式失败为 `primary_backend_not_selected`。这样 primary store 真正开关仍由 `RUNTIME_STATE_BACKEND=postgres`、approval marker、ready gate 和 Postgres primary backend guard 控制，同时不再让旧 shadow-mode 哨兵阻断已完成门禁的切换后状态检查。

同步拆分 `shadow-drift.test.ts`，把 drill evidence 与 reconciler cadence 用例移动到 `shadow-cutover-automation.test.ts`，触碰后的测试文件行数分别为 258 / 150，`runtime-state-shadow.ts` 为 236 行，`check-shadow-drift.mjs` 为 221 行，均低于 300 行。

Review Gate：finished。Spec 符合度通过，本轮只收口 production cutover 的 primary shadow mode 兼容语义，不改变 `RUNTIME_STATE_BACKEND=postgres` 作为真实 primary store 开关、不降低 approval marker / ready gate / revocation guard。安全检查通过，未新增 secret、网络调用、shell 字符串拼接、mock 成功路径或静默 fallback；primary backend 未选择时仍显式失败为 `primary_backend_not_selected`。复杂度检查通过，所有触碰代码 / 测试文件均低于 300 行。Document-refresh: needed，原因：primary mode cutover 语义从“硬拒绝”变成“有门禁兼容状态”，已同步 API、runtime-state contract、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/server/runtime-state-shadow-health.test.ts --maxWorkers=1` 先失败于 primary mode 仍返回旧 `primary_store_not_implemented` 语义；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/shadow-cutover-automation.test.ts tests/modules/server/runtime-state-shadow-health.test.ts --maxWorkers=1` 通过，3 个测试文件、21 个测试通过。

剩余风险：仓库内 primary cutover 语义、ready gate 和兼容状态已收口；真实生产执行仍需要 operator 在变更窗口切换环境变量并保留 approval / drill evidence。

## M71 Review 小结

已让 dispatcher artifact store 在已有 `artifact-trajectory/v1` 的基础上额外生成 `trajectory.traj`。该文件使用 `artifact-traj/v1` 包装 taskId、attemptId、bundleId 和按 sequence 排序的 step，并显式提供 `thought`、`action`、`observation`、`state`、`query` 字段，便于审查工具按 `.traj` 风格读取行动 / 观察 / 状态过程。ArtifactBundle refs schema 也新增 `traj` 引用，Console refs / Workbench 会通过现有 artifact ref 展开 / 下载能力自然暴露该文件。

收尾时同步拆分 `packages/worker-protocol/src/index.ts` 的 ArtifactBundle / RuntimeEvent schema 到独立文件，避免继续扩大 worker protocol 单文件；`packages/result-contracts/tests/index.test.ts` 也拆出 artifact bundle 与 review finding 测试，触碰后的测试文件行数分别收敛为 300 / 103 / 104 行。全量测试过程中发现 dispatcher 两个集成测试仍局部覆盖 15 秒超时，低于项目 60 秒硬超时约束，已移除该局部覆盖并复跑通过。

Review Gate：finished。Spec 符合度通过，本轮完成 `.traj` 回放文件、ArtifactBundle `refs.traj` 契约、worker-protocol schema 拆分和 result-contracts 测试拆分，没有改变 worker result mutation、Console artifact 文件 API 或 dispatcher review decision 语义。安全检查通过，新增内容只结构化既有 trajectory step 元数据，不新增 secret、外部网络、命令拼接、mock 成功路径或静默 fallback。复杂度检查通过，`artifact-store.ts` 219 行，`worker-protocol/src/index.ts` 257 行，`worker-protocol/src/artifact-bundle.ts` 67 行，`worker-protocol/src/runtime-events.ts` 74 行，`result-contracts/tests/index.test.ts` 300 行。Document-refresh: needed，原因：ArtifactBundle 落盘文件与审查证据能力变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `artifact-store.test.ts`、`@forgeflow/result-contracts`、`@forgeflow/worker-protocol` 定向测试先失败于缺少 `traj` ref / `trajectory.traj`；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/artifact-store.test.ts --maxWorkers=1`、`CI=true pnpm --filter @forgeflow/result-contracts exec vitest run tests/index.test.ts tests/artifact-bundle.test.ts tests/review-finding.test.ts --maxWorkers=1`、`CI=true pnpm --filter @forgeflow/worker-protocol exec vitest run tests/index.test.ts --maxWorkers=1` 均通过。最终验证：`env HOME=/private/tmp/forgeflow-test-home CI=true pnpm test` 非沙箱通过；`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。默认沙箱下全量测试会因本地 HTTP server 测试监听 `127.0.0.1` 报 `listen EPERM`，已在非沙箱复跑确认通过。

剩余风险：`.traj` 文件现在提供 thought/action/observation/state/query 形状的回放证据；更细粒度 token / DOM / shell observation 仍取决于 worker 和 gateway 是否产出足够细的 trajectory steps。

## M70 Review 小结

已新增 `TaskTerminationPolicySection`，并在 Console `TaskDetailsPanel` 中展示任务级 `terminationPolicy`：`maxAttempts`、`attemptLeaseTimeoutMs`、`heartbeatTimeoutMs`、`assignmentTimeoutMs` 会以紧凑卡片显示，缺省 policy 不渲染该区块。这样 reviewer 在同一详情页可以同时看到 HITL resume payload 和终止 / 重试边界，不必只从 dispatcher 状态或 raw JSON 推断。

Review Gate：finished。Spec 符合度通过，本轮推进统一 HITL / termination policy 的 Console 可见性，只新增 task-level termination policy 展示，不改变 dispatcher retry、lease、HITL resume、review decision 或 artifact 展示语义。安全检查通过，组件只渲染已存在的 task 字段，不新增 secret、外部命令、网络调用、mock 成功路径或静默 fallback。复杂度检查通过，`TaskTerminationPolicySection.tsx` 44 行，`TaskDetailsPanel.tsx` 252 行，均低于 300 行；新测试拆到独立文件，避免继续扩大综合列表测试。Document-refresh: needed，原因：Console 任务详情能力变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx --maxWorkers=1` 先失败于 Console 找不到 `终止策略 / termination policy`；GREEN 后 `CI=true pnpm --filter console exec vitest run src/components/__tests__/TaskDetailsPanelTerminationPolicy.test.tsx src/components/__tests__/Lists.test.tsx --maxWorkers=1` 通过，2 个测试文件、17 个测试通过。最终验证 `CI=true pnpm --filter console lint`、`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：Console 已展示 task-level termination policy；更进一步的可编辑 policy 或全局 policy diff 不是本轮范围。

## M69 Review 小结

已新增 `scripts/verify-shadow-cutover-ready.mjs` 和 `pnpm verify:shadow-cutover:ready`。该入口会串行运行两个 phase：`strict_cutover_preflight` 调用既有 strict shadow cutover preflight，要求 shadow 配置、primary backend 配置和零 drift；`approval_evidence` 调用 `verify-shadow-cutover-approval.mjs`，要求 approval marker、归档 evidence SHA-256 和 revocation 状态同时有效。最终只有两个 phase 都通过才返回成功，并输出结构化 phase payload，便于 CI / operator 作为真正切换前最后门禁使用。

Review Gate：finished。Spec 符合度通过，本轮继续推进 shadow 自动 reconciliation / production cutover 收口，新增的是 strict preflight + approval evidence 组合门禁，不改变底层 drift gate、approval verifier、runtime primary backend guard 或 Postgres snapshot 语义。安全检查通过，脚本只调用仓库内固定 `check-shadow-drift.mjs` 和 `verify-shadow-cutover-approval.mjs`，通过 `spawnSync(process.execPath, argvArray)` 传参，不拼接 shell 字符串，不新增 secret、网络调用、mock 成功路径或静默 fallback；任何 phase 失败都会保留 statusCode / stderr / payload 并让 ready 命令非 0 退出。复杂度检查通过，`verify-shadow-cutover-ready.mjs` 84 行，测试文件 224 行，均低于 300 行。Document-refresh: needed，原因：新增切换前最终组合门禁，已同步 README、docs/README、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-cutover-approval.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 先失败于 `scripts/verify-shadow-cutover-ready.mjs` / package script 缺失；GREEN 后同命令通过，2 个测试文件、13 个测试通过。最终验证 `node --check scripts/verify-shadow-cutover-ready.mjs`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：ready 门禁能把本仓库 strict preflight 和 approval evidence 组合成最终切换前验证；真实 primary-store 切换仍依赖外部 Postgres、queue、进程切流和生产变更窗口执行。

## M68 Review 小结

已新增 `scripts/verify-shadow-cutover-approval.mjs` 和 `pnpm verify:shadow-cutover:approval`。该入口会在生产切换窗口开始前独立校验 `.forgeflow-dispatcher/shadow-cutover-approval.json`：要求 `approved=true`、`cutoverReason=cutover_ready`、`evidenceSha256` 格式有效，重新读取 `evidencePath` 计算 SHA-256，并在存在 `.forgeflow-dispatcher/shadow-cutover-revocation.json` 时直接失败。这样 operator / CI 可以在启动 Postgres primary backend 之前先验证审批证据链，而不是只依赖 dispatcher 启动时的被动 guard。

Review Gate：finished。Spec 符合度通过，本轮继续推进 shadow 自动 reconciliation / production cutover 收口，新增的是 approval marker 的独立 operator 校验入口，不改变 drill、approve、revoke、runtime primary backend guard 或 Postgres snapshot 语义。安全检查通过，脚本只读取本地 approval / revocation / evidence 文件并计算 SHA-256，不新增 secret、外部命令拼接、网络调用、mock 成功路径或静默 fallback；evidence 漂移和 revocation marker 会显式失败。复杂度检查通过，`verify-shadow-cutover-approval.mjs` 113 行，测试文件 188 行，均低于 300 行。Document-refresh: needed，原因：新增 cutover approval operator 命令，已同步 README、docs/README、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-cutover-approval.test.ts --maxWorkers=1` 先失败于 `scripts/verify-shadow-cutover-approval.mjs` 缺失；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-cutover-approval.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，2 个测试文件、12 个测试通过。最终验证 `node --check scripts/verify-shadow-cutover-approval.mjs`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：approval verifier 能证明本仓库归档证据链未漂移且未撤销；真实 primary-store 切换仍依赖外部 Postgres、queue、进程切流和生产变更窗口执行。

## M67 Review 小结

已新增 `pnpm verify:shadow-cutover:reconciler`，等价于 `node scripts/run-shadow-reconciler.mjs .forgeflow-dispatcher --require-configured --require-primary-backend --max-mismatches 0 --max-delta 0`。生产 cutover 窗口现在有稳定 package script 可直接交给 cron/systemd/容器健康任务使用，不需要 operator 复制长 node 命令。

Review Gate：finished。Spec 符合度通过，本轮推进 shadow 自动 reconciliation / production cutover 收口，只新增 strict reconciler package script 和文档入口，没有改变底层 drift gate、reconcile、approval、revoke 或 primary backend guard 语义。安全检查通过，脚本入口仍调用固定仓库脚本和固定参数，不新增 secret、外部命令拼接、mock 成功路径或静默 fallback。复杂度检查不涉及业务代码。Document-refresh: needed，原因：新增 package script 和 operator 入口，已同步 README、docs/README、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts --maxWorkers=1` 先失败于 `verify:shadow-cutover:reconciler` 不存在；GREEN 后同命令通过，5 个测试通过。最终验证 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts tests/modules/execution/shadow-drift.test.ts --maxWorkers=1`、`node --check scripts/run-shadow-reconciler.mjs`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：strict reconciler package script 能持续验证切换条件；真正 primary-store 切换仍依赖外部 Postgres、queue、进程切流和生产变更窗口执行。

## M66 Review 小结

已修正 runtime executor / launch 去重完成后的文档分类漂移：`docs/TECH_DEBT.md` 第 13 节不再把 daemon 去重写成“仍待迁移”，而是拆成“已完成的收口”和真实剩余边界；`README.md` 与 `docs/README.md` 也同步说明 codex/gemini worker daemon 的主循环、executor、launch builder 和失败回写已收敛到共享 runtime core，剩余边界是 Gemini / beta-runtime-core npm 包名和 Trusted Publisher 外部配置。

Review Gate：finished。Spec 符合度通过，本轮只修正 runtime 去重事实的权威文档分类，没有修改业务代码、运行时逻辑、测试夹具或发布脚本。安全检查通过，未新增 secret、外部命令、mock 成功路径或静默 fallback。复杂度检查不涉及代码。Document-refresh: needed，原因：文档本身是本轮修复对象，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：runtime 去重的代码侧已完成；未发布 npm 包的外部配置仍不是仓库内代码能单独完成的事项。

## M65 Review 小结

已让 `scripts/run-shadow-reconciler.mjs` 支持 `--require-configured`、`--require-primary-backend`、`--max-mismatches` 和 `--max-delta` 组合透传到底层 `check-shadow-drift.mjs`。生产变更窗口现在可以用 reconciler 长期运行严格 cutover 条件：shadow 必须已配置、primary backend 必须选择 Postgres 且配置 `DISPATCHER_PRIMARY_POSTGRES_URL`，并可要求零 drift。

Review Gate：finished。Spec 符合度通过，本轮推进 shadow 自动 reconciliation / production cutover 收口，补齐的是长期 reconciler 在生产切换窗口的 strict preflight 能力，不改变默认 `pnpm verify:shadow-drift:reconciler` 的宽松巡检行为，也不改变 approval / revoke marker 语义。安全检查通过，参数解析仍只接受已知开关和非负整数阈值，子进程通过 `spawnSync(process.execPath, argvArray)` 调用固定仓库脚本，不拼接 shell 字符串，不新增 secret、mock 成功路径或静默 fallback。复杂度检查通过，脚本仍保持单一职责。Document-refresh: needed，原因：reconciler CLI 能力变化，已同步 README、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts --maxWorkers=1` 先失败于 `run-shadow-reconciler.mjs` 不认识 `--require-configured`；GREEN 后同命令通过，12 个测试通过。最终验证 `node --check scripts/run-shadow-reconciler.mjs`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts tests/modules/execution/shadow-cutover-approval.test.ts --maxWorkers=1`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：strict reconciler 能持续验证本仓库 shadow/cutover 条件，但真实 primary-store 切换仍依赖外部 Postgres、queue、进程切流和变更窗口执行。

## M64 Review 小结

已把 Console Artifact Workbench 的 artifact ref 操作抽成 `ArtifactWorkbenchRefs.tsx`，卡片内现在可直接复制、展开和下载 manifest 登记的 `artifact://...` 文件。Workbench 主组件继续只负责跨任务筛选、证据对比、任务选择和卡片布局，搜索索引仍包含 ref 完整值。

Review Gate：finished。Spec 符合度通过，本轮补齐 Console 审查工作台的卡片级 artifact 文件读取入口，没有改变 dispatcher ArtifactBundle schema、artifact store manifest、artifact 文件 API 或 review decision payload。安全检查通过，文件读取仍复用既有 `/api/artifacts/:bundleId/files/:fileName` helper，路径解析和 URL 编码沿用 `artifactFileAccess.ts`；未新增 secret、外部命令、mock 成功路径或静默 fallback。复杂度检查通过，`ArtifactWorkbench.tsx` 228 行，`ArtifactWorkbenchRefs.tsx` 106 行，均低于 300 行。Document-refresh: needed，原因：Console Artifact Workbench 操作能力变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx --maxWorkers=1` 先失败于 Workbench 找不到“展开文件 diff”按钮；GREEN 后同命令通过，16 个测试通过。最终验证 `CI=true pnpm --filter console test`、`CI=true pnpm --filter console lint`、`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：跨任务 Workbench 已能复制、展开和下载单个 artifact ref；更复杂的多文件并排 diff 视图仍不是本轮范围。

## M63 Review 小结

已把 Console Artifact Workbench 的跨任务卡片从“只显示 artifact 引用数量”推进到可直接查看并复制每个 `artifact://...` ref。Workbench 搜索索引也同步纳入 ref 完整值，审查者可以按 artifact ref 精确定位产物，并在列表里复制 diff / log / report 引用，不必先跳回单任务详情页。

Review Gate：finished。Spec 符合度通过，本轮只推进 Console 审查工作台的卡片级 artifact ref 操作入口，没有改变 dispatcher ArtifactBundle schema、artifact store、artifact 文件 API 或 review decision payload。安全检查通过，复制操作只调用浏览器 clipboard，不读取文件、不新增 secret、网络调用、命令拼接、mock 成功路径或静默 fallback。复杂度检查通过，`ArtifactWorkbench.tsx` 276 行，低于 300 行；新增 helper 均保持单一职责。Document-refresh: needed，原因：Console Artifact Workbench 操作能力变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx --maxWorkers=1` 先失败于 Workbench 找不到 `artifact://bundle-auth/diff.patch`；GREEN 后同命令通过，16 个测试通过。最终验证 `CI=true pnpm --filter console test`、`CI=true pnpm --filter console lint`、`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。

剩余风险：Workbench 现在支持跨任务筛选、证据对比、跳转和 artifact ref 复制；按需展开文件正文仍在单任务详情的 artifact refs / trajectory tabs 中完成，尚未把文件正文预览复制到跨任务 Workbench。

## M62 Review 小结

已新增 `scripts/run-shadow-reconciler.mjs` 和 `pnpm verify:shadow-drift:reconciler`。该入口会周期性调用 `check-shadow-drift.mjs <stateDir> --reconcile --record-alert`，默认 5 分钟一次，并支持 `--once`、`--interval-ms`、`--max-runs`、`--max-mismatches`、`--max-delta`，可被 cron/systemd/容器健康任务直接托管。`--once` 会输出结构化 run summary，便于 CI 和 operator 验证自动 reconciliation cadence。

Review Gate：finished。Spec 符合度通过，本轮推进 shadow 自动 reconciliation，从一次性 `verify:shadow-drift:reconcile` 扩展为可长期运行的 reconciler 入口，不改变默认只读 `verify:shadow-drift` release gate，也不改变 cutover drill / approval / revoke 语义。安全检查通过，脚本只调用仓库内固定 `check-shadow-drift.mjs`，参数解析限制为数值和已知开关，不拼接 shell 字符串，不新增 secret、外部网络调用、mock 成功路径或静默 fallback；子命令失败会保留 statusCode / stderr 并让 reconciler 退出非 0。复杂度检查通过，新增脚本保持单一职责。Document-refresh: needed，原因：新增自动 reconciliation operator 入口，已同步 README、API、docs README、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts --maxWorkers=1` 先失败于缺少 `scripts/run-shadow-reconciler.mjs`；GREEN 后同命令通过，11 个测试通过。`workflows.test.ts` 已锁定 `verify:shadow-drift:reconciler` package script。

剩余风险：reconciler 入口负责自动执行本仓库 shadow replay 和 alert 记录；是否作为 systemd service、cronjob 或容器 sidecar 部署，仍由生产环境编排负责。

## M61 Review 小结

已补强 Postgres primary backend 的 cutover guard。`RUNTIME_STATE_BACKEND=postgres` 在连接 Postgres 前不再只检查 `shadow-cutover-approval.json` 的字段形状，还会读取 approval 里的 `evidencePath`，重新计算归档 `shadow-cutover-drill.json` 的 SHA-256，并要求它与 `evidenceSha256` 完全一致；如果 evidence 被篡改、删除或 marker 指向无效路径，会在创建 Postgres client 前失败。相关 Postgres primary 测试夹具改为生成真实 drill evidence 和 hash。

Review Gate：finished。Spec 符合度通过，本轮继续推进 shadow production cutover 收口，补强的是 primary-mode 启动前的证据完整性 guard，没有改变 drift gate、reconcile、cutover drill、approval/revoke 脚本、Postgres snapshot 表结构或 HTTP async state path。安全检查通过，只读取本地归档 evidence 并计算 SHA-256，不新增 secret、网络调用、mock 成功路径或静默 fallback；hash mismatch 会显式失败且不会连接 Postgres。复杂度检查通过，新增 helper 均低于 50 行。Document-refresh: needed，原因：primary cutover guard 从 marker shape 校验升级为 marker + evidence hash 校验，已同步 TECH_DEBT、API、runtime-state contract、Stage 3 runbook、docs README 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-postgres.test.ts --maxWorkers=1` 先失败于 evidence 被篡改后仍成功连接 primary backend；GREEN 后同命令通过，7 个测试通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-cutover-approval.test.ts tests/modules/server/runtime-state-postgres.test.ts tests/modules/server/dispatcher-server-postgres.test.ts --maxWorkers=1` 通过，3 个测试文件、13 个测试通过。

剩余风险：该 guard 能阻止本仓库 dispatcher 在 evidence 不匹配时进入 Postgres primary；真实生产 cutover 仍需要外部 Postgres / queue 运维、进程切流和变更窗口执行。

## M60 Review 小结

已把 Trae automation worker 的本地 `emitPhaseEvent` 同步采集为当前 task 的 artifact trajectory 输入。`buildTraeWorkerArtifactBundle` 现在会把 `readiness_wait_*`、`prepare_session_*`、`send_chat_*`、`session_recovery_*`、`artifact_check_*`、`workspace_prepare_*`、`start_task_*` 映射为 `artifact-trajectory/v1` step，并把 phase event 日志写入 `retainedContent.logs` / `retainedContent.trajectory`；即使 dispatcher `reportEvent` 不可用，本地 artifact 仍保留同一批 phase events。静态 result、verification、cleanup step 仍保留，用于覆盖 submitResult 构建后才发生的动作。

Review Gate：finished。Spec 符合度通过，本轮继续推进可回放 trajectory，从 M59 的 provider 级阶段提升到真实 phase event 驱动，不改变 dispatcher ArtifactBundle schema、event API、submitResult mutation 或 session recovery 语义。安全检查通过，采集内容只来自既有 phase event 类型、taskId、时间戳和已有 payload，不新增 secret、外部命令拼接、网络调用、mock 成功路径或静默 fallback。复杂度检查通过，`trae-worker-artifacts.ts` 262 行，低于 300 行；`worker.ts` 仍是既有大文件，本轮只增加 phase event 本地采集和按 taskId 过滤。Document-refresh: needed，原因：Trae trajectory 证据来源从静态阶段变为 phase event 驱动，已同步 README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/trae-beta-runtime exec vitest run tests/runtime/worker.test.ts --maxWorkers=1` 先失败于 trajectory action step 缺少 `responseLength` observation 且 retained trajectory 缺少 `send_chat_done`；GREEN 后同命令通过，29 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime typecheck` 通过。

剩余风险：Trae artifact trajectory 已包含真实 phase event，但还不是完整 token/DOM/action 级 `.traj`；如需更细 replay，需要 gateway driver 继续产出更细粒度 observation artifactRef。

## M59 Review 小结

已在 `packages/trae-beta-runtime/src/runtime/trae-worker-artifacts.ts` 新增 Trae worker artifact helper。Trae automation worker 的成功 submitResult 和失败 submitResult 现在都会在现有 `artifactBundle` 内附带结构化 `artifact-trajectory/v1`：覆盖 gateway readiness、session prepare、prompt action、verification、result 和 cleanup；同时写入受限 `retainedContent.logs`，并在存在测试输出时保留 `retainedContent.testResults`。`worker.ts` 只保留薄委托，避免继续扩大主运行时文件；`clients.ts` 的 submitResult 类型边界也改为复用同一 bundle 类型，避免 trajectory / retainedContent 在 client 层继续不可见。

Review Gate：finished。Spec 符合度通过，本轮补齐 M58 留下的 Trae provider parity，没有改变 dispatcher ArtifactBundle schema、artifact store、worker result mutation、session recovery 或远端 artifact verification 判定。安全检查通过，helper 只结构化既有 taskId、sessionId、summary、testOutput 和 verification 结果，不新增 secret、外部命令拼接、网络调用、mock 成功路径或静默 fallback。复杂度检查局部通过，新增 `trae-worker-artifacts.ts` 181 行；既有 `worker.ts` 仍超过 300 行但本轮删除本地 bundle 类型和旧构造体，只增加薄委托。Document-refresh: needed，原因：Trae automation worker 现在也会主动产出 trajectory artifact，已同步 README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/trae-beta-runtime exec vitest run tests/runtime/worker.test.ts --maxWorkers=1` 先失败于成功 / hard-cap 失败路径缺少 `artifactBundle.trajectory` 和 `retainedContent`；GREEN 后同命令通过，29 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime exec vitest run tests/runtime/worker.test.ts tests/runtime/clients.test.ts --maxWorkers=1` 通过，2 个测试文件、43 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime typecheck` 通过。

剩余风险：M60 已把 Trae phase events 接入 artifact trajectory；更细粒度的 thought/action/observation 全量流仍依赖未来 gateway driver 继续产出细粒度 observation artifactRef。

## M58 Review 小结

已在 `packages/beta-runtime-core/src/runtime/assignment-artifacts.ts` 新增 assignment artifact helper。generic `runWorkerAssignment` 现在会在 `worker-result.json` 内写入 `artifactBundle`：包含 preflight、worker action、每条 verification、result 四类 trajectory step；保留 `retainedContent.logs` 和 `retainedContent.testResults`，由 dispatcher artifact store 生成最终 manifest refs。失败路径会把 worker launch 的非 0 exitCode 写入 action step，避免把执行失败误标为成功。dispatcher runtime-state 测试已改为验证 `result.artifactBundle` 入口会被记录并绑定 active attempt。

Review Gate：finished。Spec 符合度通过，本轮推进可回放 trajectory 的 worker 产出侧，而不改变 ArtifactBundle schema、dispatcher artifact store、Console 展示或 worker result metadata canonicalization。安全检查通过，artifact helper 只结构化既有本地执行输出和 verification 结果，不新增 secret、网络调用、命令拼接、mock 成功路径或静默 fallback；未伪造最终 `artifact://<bundleId>/...` refs，最终 refs 仍由 dispatcher artifact store 生成。复杂度检查通过，新增 `assignment-artifacts.ts` 低于 300 行，`run-worker-assignment.ts` 只增加调用点。Document-refresh: needed，原因：generic assignment runner 现在会主动产出结构化 trajectory artifact，已同步 TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/beta-runtime-core exec vitest run tests/run-worker-assignment.test.ts --maxWorkers=1` 先失败于缺少 `artifactBundle`；补失败路径后同命令先失败于 launch 非 0 exitCode 被误标 `succeeded`。GREEN 后同命令通过，1 个测试文件、5 个测试通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts --maxWorkers=1` 通过，1 个测试文件、67 个测试通过。

剩余风险：generic Codex/Gemini runner 已能产出 replayable trajectory；M59 已补齐 Trae automation worker 的 provider 级 trajectory parity。若后续要达到 SWE-agent `.traj` 级别的逐条 thought/action/observation，需要继续把更细粒度 session progress 事件结构化。

## M57 Review 小结

已在 `packages/beta-runtime-core/src/runtime/provider-launch.ts` 新增共享 Codex/Gemini launch builder，统一 provider pool 校验、binary 解析、`FORGEFLOW_*_ARGS_JSON` / `FORGEFLOW_*_ARGS` 解析、Codex sandbox / model 和 Gemini model 参数构造。`packages/codex-beta-runtime/src/runtime/run-worker-assignment.ts` 与 `packages/gemini-beta-runtime/src/runtime/run-worker-assignment.ts` 改为薄 wrapper，只保留 CLI 入口和 `runWorkerAssignmentCli` 调用。两个 packaged runtime 的 `test` script 先构建 `@tingrudeng/beta-runtime-core`，避免 wrapper 测试读取过期 dist。

Review Gate：finished。Spec 符合度通过，本轮继续推进 runtime executor / launch 去重，收敛的是 Codex/Gemini provider launch builder，不改变 dispatcher runtime factories、assignment runner、verification runner 或 Trae runtime。安全检查通过，binary 探测仍只执行 `--version`，extra args JSON 校验失败会显式抛错；未新增 secret、网络调用、mock 成功路径或静默 fallback。复杂度检查通过，新增 `provider-launch.ts` 低于 300 行，两个 packaged runtime wrapper 删除重复解析逻辑后均低于 50 行。Document-refresh: needed，原因：Codex/Gemini packaged launch builder 权威边界从各 runtime 包迁移到 beta-runtime-core，已同步 TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/beta-runtime-core exec vitest run tests/run-worker-assignment.test.ts --maxWorkers=1` 先失败于缺少 `buildCodexLaunchCommand`。GREEN 后 `CI=true pnpm --filter @tingrudeng/beta-runtime-core exec vitest run tests/run-worker-assignment.test.ts --maxWorkers=1` 通过，1 个测试文件、4 个测试通过；`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test` 通过，2 个测试文件、4 个测试通过；`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test` 通过，2 个测试文件、5 个测试通过。

剩余风险：`beta-runtime-core` 仍保留 task processor、managed executor、live executor 和 `run-worker-assignment` runner 的组合路径；本轮只消除了 Codex/Gemini packaged runtime 的 launch builder 重复实现，没有重新设计 executor 生命周期。

## M56 Review 小结

已把共享 Trae DOM driver 拆为职责更窄的 core 模块：`trae-dom-driver-config.ts` 负责默认值、等待与运行时依赖注入；`trae-dom-browser-helpers.ts` / `trae-dom-expressions.ts` 负责浏览器端 helper 和表达式构造；`trae-dom-response-*` 负责响应提取、activity snapshot 与 completion 判断；`trae-dom-driver.ts` 只保留 driver facade、CDP target 连接和主执行流程。`scripts/lib/trae-dom-driver.ts` 与 `packages/trae-beta-runtime/src/runtime/trae-dom-driver.ts` 继续保持薄适配，不重新持有 DOM driver 本体。

Review Gate：finished。Spec 符合度通过，本轮只处理 M55 遗留的共享 core 文件过大问题，没有扩大 gateway route、session-store、HTTP JSON IO、debug logger 或 worker runtime 范围。安全检查通过，拆分仅移动既有表达式、选择器、响应提取和 CDP 调用逻辑，未新增 secret、外部命令拼接、mock 成功路径或静默 fallback；脚本侧兼容默认值仍显式保留。复杂度检查通过，`packages/automation-gateway-core/src/trae-dom-*.ts` 当前分别为 4 到 277 行，均低于 300 行；driver facade 和 response collection 长流程已拆成 runtime / collector helper。Document-refresh: needed，原因：Trae CDP / DOM driver 的共享 core 职责已从单文件拆成多个权威模块，已同步 README、TECH_DEBT、automation-gateway-core README 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @tingrudeng/automation-gateway-core build`、`CI=true pnpm --filter @tingrudeng/automation-gateway-core typecheck`、`CI=true pnpm --filter @tingrudeng/automation-gateway-core exec vitest run tests/report.test.ts tests/driver-factory.test.ts tests/gateway-handler.test.ts tests/session-store.test.ts tests/debug-log.test.ts --maxWorkers=1`、非沙箱 `CI=true pnpm --filter @tingrudeng/automation-gateway-core exec vitest run tests/gateway-http-server.test.ts --maxWorkers=1`、`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test`、`CI=true pnpm --filter @tingrudeng/trae-beta-runtime typecheck`、`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`env HOME=/private/tmp/forgeflow-trae-gateway-test-home CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts tests/modules/server/trae-automation-gateway.test.ts --maxWorkers=1`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。`CI=true pnpm --filter @tingrudeng/automation-gateway-core exec vitest run --maxWorkers=1` 在默认沙箱仅因 `tests/gateway-http-server.test.ts` 监听 `127.0.0.1` 被系统拒绝失败，非沙箱同测试已通过。一次全量 `HOME=/private/tmp/forgeflow-trae-gateway-test-home CI=true pnpm test` 的输出被截断，本轮不把该次作为通过证据。

剩余风险：Trae gateway route/session/chat handler、HTTP JSON IO、debug logger、driver 创建规则、持久化 session-store 和 DOM driver 本体已共享；后续仍需继续收敛 `packages/beta-runtime-core` 的独立 task processor / launch 路径，并补齐生产环境级 shadow cutover 外部演练证据。

## M55 Review 小结

已把 packaged runtime 中更完整的 Trae CDP / DOM driver、CDP discovery、CDP client 和 automation error 实现下沉到 `packages/automation-gateway-core`。`packages/trae-beta-runtime/src/runtime/trae-dom-driver.ts` 改为薄 re-export；`scripts/lib/trae-dom-driver.ts` 改为薄 wrapper，继续复用共享 core，同时显式保留脚本侧旧行为：默认 `activitySelectors=[]`，并允许 plain-text response 稳定后返回。新增 thin-adapter 测试锁定脚本侧和 packaged runtime 不再各自持有 `BROWSER_HELPERS_SOURCE` 大段实现。

Review Gate：needs-follow-up。Spec 符合度局部通过，本轮确实消除了脚本侧和 packaged runtime 的 Trae DOM driver 双实现；安全检查通过，未新增 secret、外部命令拼接、mock 成功路径或静默 fallback；测试与验证已覆盖共享 core、packaged runtime 和脚本侧 gateway 行为。复杂度检查不通过：新增共享 `packages/automation-gateway-core/src/trae-dom-driver.ts` 仍为 1292 行，虽然比双实现总量更少，但不符合单文件 300 行约束。Document-refresh: needed，原因：Trae DOM driver 权威边界从两侧实现迁移到 automation-gateway-core，已同步 README、TECH_DEBT、automation-gateway-core README 和 tasks。结论：不作为最终收尾，下一步必须继续拆分共享 core 文件。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts --maxWorkers=1` 先失败于缺少 `packages/automation-gateway-core/src/trae-dom-driver.ts`。GREEN 后 `CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 通过，6 个测试文件、19 个测试通过；`CI=true pnpm --filter @tingrudeng/automation-gateway-core typecheck` 通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime typecheck` 通过；`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json` 和 `CI=true pnpm exec tsc -p scripts/tsconfig.json` 通过；隔离 HOME 后 `env HOME=/private/tmp/forgeflow-trae-gateway-test-home CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts tests/modules/server/trae-automation-gateway.test.ts --maxWorkers=1` 通过，2 个测试文件、35 个测试通过；`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。一次非沙箱重跑申请因当前 Codex 使用额度限制被拒，随后改用 `/private/tmp` 隔离 HOME 完成同等行为验证。全量 `env HOME=/private/tmp/forgeflow-trae-gateway-test-home CI=true pnpm test` 只在并发下出现 `submit-review-decision.test.ts` 首个用例 15 秒超时；隔离复跑 `env HOME=/private/tmp/forgeflow-trae-gateway-test-home CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/submit-review-decision.test.ts --maxWorkers=1` 通过，4 个测试通过。

剩余风险：本轮只完成 DOM driver 双实现收敛；共享 core 文件拆分已在 M56 完成，后续仍需继续收敛 `packages/beta-runtime-core` 的独立 task processor / launch 路径，并补齐 production cutover 外部演练证据。

- [x] M54 串行：把 Trae gateway driver 创建规则下沉到 automation-gateway-core。
- [x] M54 串行：运行定向验证并补充 review 小结。

## M54 Review 小结

已在 `packages/automation-gateway-core` 新增共享 `resolveAutomationGatewayDriver`，统一处理已注入 driver 的直接复用、`automationOptions` 透传，以及 gateway `debug` / `automationOptions.debug` 到 driver debug 的归一化。`scripts/lib/trae-automation-gateway.ts` 与 `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts` 都改为调用该 helper；两侧只注入各自的具体 `createTraeAutomationDriver`，不再各自维护 `driverDebug` 拼装规则。

Review Gate：finished。Spec 符合度通过，本轮继续推进 Trae gateway 去重，把 driver 创建规则从脚本侧和 packaged runtime 下沉到 `@tingrudeng/automation-gateway-core`；没有改变 DOM driver 实现、gateway route、HTTP JSON IO、debug event、session-store 或 automation error envelope。安全检查通过，helper 只处理对象合并和布尔归一化，不新增 secret、外部网络调用、命令拼接、mock 成功路径或静默 fallback；已注入 driver 会直接复用，不会额外创建 driver。复杂度检查通过，新增 `driver-factory.ts` 低于 50 行，两个 gateway wrapper 不再持有 `driverDebug` 拼装逻辑。Document-refresh: needed，原因：Trae gateway driver 创建规则权威边界变化，已同步 README、TECH_DEBT、automation-gateway-core README 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 先失败于缺少 `resolveAutomationGatewayDriver`；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts --maxWorkers=1` 先失败于缺少 `packages/automation-gateway-core/src/driver-factory.ts`。GREEN 后 `CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 通过，6 个测试文件、19 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；非沙箱 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts tests/modules/server/trae-automation-gateway.test.ts --maxWorkers=1` 通过，2 个测试文件、34 个测试通过。

剩余风险：Trae gateway route/session/chat handler、HTTP JSON IO、debug logger、driver 创建规则和持久化 session-store 已共享；剩余风险主要在发布前 dist / workspace 依赖同步，以及具体 DOM driver 本体仍分别存在于脚本侧和 packaged runtime。

- [x] M53 串行：把 Trae gateway debug logger 下沉到 automation-gateway-core。
- [x] M53 串行：运行定向验证并补充 review 小结。

## M53 Review 小结

已在 `packages/automation-gateway-core` 新增共享 `createAutomationGatewayDebugLogger` 和 `isAutomationGatewayDebugEnabled`，统一 `TRAE_AUTOMATION_DEBUG` / `debug` 开关与 `[trae-gateway][debug]` 结构化日志格式。`packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts` 删除本地 `isDebugEnabled` / `createDebugLogger`；`scripts/lib/trae-automation-gateway.ts` 也接入同一 helper，并获得与 packaged runtime 一致的 gateway-level debug 开关。两侧 driver debug 都显式归一化为布尔值，保留 `automationOptions.debug=true` 或 `"1"` 的既有开启路径。

Review Gate：finished。Spec 符合度通过，本轮继续推进 Trae gateway 去重，把 debug logger 组装从 packaged runtime 下沉到 `@tingrudeng/automation-gateway-core`，并让脚本侧使用同一 helper；没有改变 gateway route、session-store、HTTP JSON IO、automation error envelope 或 debug event 名称。安全检查通过，helper 只写入调用方传入 logger，不新增 secret、外部网络调用、命令拼接、mock 成功路径或静默 fallback；JSON 序列化失败时仍只输出 event 名称，与原 packaged runtime 行为一致。复杂度检查通过，新增 `debug-log.ts` 低于 50 行，两个 gateway wrapper 不再持有本地 debug logger 实现。Document-refresh: needed，原因：Trae gateway debug logger 权威边界变化，已同步 README、TECH_DEBT、automation-gateway-core README 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 先失败于缺少 `isAutomationGatewayDebugEnabled` / `createAutomationGatewayDebugLogger`；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts --maxWorkers=1` 先失败于缺少 `packages/automation-gateway-core/src/debug-log.ts`。GREEN 后 `CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 通过，5 个测试文件、16 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；非沙箱 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts tests/modules/server/trae-automation-gateway.test.ts --maxWorkers=1` 通过，2 个测试文件、33 个测试通过。

剩余风险：Trae gateway route/session/chat handler、HTTP JSON IO、debug logger 和持久化 session-store 已共享；剩余 adapter 漂移主要在 driver 创建和发布前 dist / workspace 依赖同步。

- [x] M52 串行：把 Trae gateway 持久化 session-store 下沉到 automation-gateway-core。
- [x] M52 串行：运行最终验证并补充 review 小结。

## M52 Review 小结

已在 `packages/automation-gateway-core` 新增共享持久化 session-store：`createPersistentAutomationSessionStore` 统一处理 session 文件读写、重启后非终态 session 标记 interrupted、TTL 清理、request fingerprint / target 解析和 public shape 裁剪。`scripts/lib/trae-automation-session-store.ts` 与 `packages/trae-beta-runtime/src/runtime/trae-automation-session-store.ts` 都改成薄 wrapper；脚本侧只保留本地时间格式和默认目录，packaged runtime 只保留兼容导出和默认目录。同步生成 `scripts/lib/trae-automation-session-store.js`。

Review Gate：finished。Spec 符合度通过，本轮继续推进 Trae gateway 去重，把持久化 session-store 主体从脚本侧和 packaged runtime 下沉到 `@tingrudeng/automation-gateway-core`；没有改变 session 文件路径、重启中断语义、release / markReleased、cached response、request fingerprint、TTL 或 public responseText 裁剪行为。安全检查通过，仍只读写本地 JSON session 文件，未新增 secret、外部网络调用、命令拼接、mock 成功路径或静默 fallback；无法解析的 session 文件继续显式回到空 store，非终态 session 继续标记为 `interrupted`。复杂度检查通过，新增 `session-store.ts`、`session-store-records.ts`、`session-store-types.ts` 均低于 300 行，两个 wrapper 均低于 40 行。Document-refresh: needed，原因：Trae gateway session-store 权威边界变化，已同步 README、TECH_DEBT、automation-gateway-core README 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts --maxWorkers=1` 先失败于缺少 `packages/automation-gateway-core/src/session-store.ts`；`CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 先失败于缺少 `createPersistentAutomationSessionStore` / `AutomationSessionStatus`。GREEN 后 `CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 通过，4 个测试文件、14 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；非沙箱 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-session-store.test.ts tests/modules/server/trae-automation-gateway-thin-adapter.test.ts tests/modules/server/trae-automation-gateway.test.ts --maxWorkers=1` 通过，3 个测试文件、49 个测试通过；`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm --filter @tingrudeng/automation-gateway-core typecheck`、`CI=true pnpm --filter @tingrudeng/trae-beta-runtime typecheck`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check` 均通过。首次非沙箱 `CI=true pnpm test` 中 `trae-automation-worker.test.ts` 一个全仓并发慢测 20 秒超时；隔离非沙箱复跑同文件 13 项通过；第二次非沙箱 `CI=true pnpm test` 通过，dispatcher 48 个测试文件、498 个测试通过。

剩余风险：Trae gateway route/session/chat handler、HTTP JSON IO 和持久化 session-store 已共享；剩余 adapter 漂移主要在 debug logger 组装、driver 创建和发布前 dist / workspace 依赖同步。

- [x] M51 串行：把 Trae gateway HTTP JSON IO / server wiring 下沉到 automation-gateway-core。
- [x] M51 串行：运行最终验证并补充 review 小结。

## M51 Review 小结

已新增 `packages/automation-gateway-core/src/gateway-http-server.ts`，统一处理 Node HTTP server、JSON body 读取、错误响应、`handleAutomationGatewayRequest` 调用和 server close。`scripts/lib/trae-automation-gateway.ts` 与 `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts` 都改为调用 `startAutomationGatewayHttpServer`，两侧不再各自维护 `readJsonBody` / `writeJson` / `writeError` / `http.createServer`。脚本侧和 packaged runtime 仍分别保留 driver 创建、debug logger 和 session-store adapter。

Review Gate：finished。Spec 符合度通过，本轮继续推进 Trae gateway 去重，把 HTTP JSON IO / server wiring 从脚本侧和 packaged runtime 下沉到 `@tingrudeng/automation-gateway-core`；没有改变 gateway route、session 状态语义、automation error envelope、debug event 名称、driver 行为或 session-store 文件格式。安全检查通过，共享 helper 仍只处理本地 HTTP 请求体解析和 JSON 响应，未新增 secret、外部网络调用、命令拼接、mock 成功路径或静默 fallback；非法 JSON 继续显式返回 `INVALID_JSON`。复杂度检查通过，新增 `gateway-http-server.ts` 保持单一职责，两侧 Trae gateway adapter 删除重复 `readJsonBody` / `writeJson` / `writeError` / `http.createServer`。Document-refresh: needed，原因：Trae gateway adapter 边界变化，已同步 README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts --maxWorkers=1` 先失败于缺少 `packages/automation-gateway-core/src/gateway-http-server.ts`。GREEN 后 `CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 通过，3 个测试文件、11 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；非沙箱 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts tests/modules/server/trae-automation-gateway.test.ts --maxWorkers=1` 通过，2 个测试文件、31 个测试通过；`CI=true pnpm --filter @tingrudeng/automation-gateway-core typecheck`、`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm --filter @tingrudeng/trae-beta-runtime typecheck`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过；非沙箱 `CI=true pnpm test` 通过，dispatcher 48 个测试文件、497 个测试通过。

剩余风险：Trae gateway route/session/chat handler 和 HTTP JSON IO 已共享；剩余 adapter 漂移主要在 debug logger、driver 创建、session-store adapter 和发布前 dist / workspace 依赖同步。

- [x] M50 串行：补齐 shadow cutover rollback revocation marker。
- [x] M50 串行：运行最小充分验证并补充 review 小结。

## M50 Review 小结

已为 production cutover 增加显式 rollback / revoke 命令：`pnpm verify:shadow-cutover:revoke` 会读取 `.forgeflow-dispatcher/shadow-cutover-approval.json`，生成 `.forgeflow-dispatcher/shadow-cutover-revocation.json`，并把原 approval marker 归档为 `shadow-cutover-approval.revoked-*.json`。`RUNTIME_STATE_BACKEND=postgres` 的 async primary snapshot load/save 会在连接 Postgres 前检查 revocation marker；一旦存在 revocation marker，就拒绝继续使用 primary backend，直到重新完成 drill evidence 和 approval。backup / restore 文件清单也已包含 `shadow-cutover-revocation.json`，避免 DR 恢复后丢失回滚证据。

Review Gate：finished。Spec 符合度通过，本轮继续推进 shadow 自动 reconciliation / production cutover 收口，补齐 approval 后的撤销和回滚证据链；未改变 drift gate、reconcile、cutover drill、approval 生成、Postgres snapshot 表结构或 HTTP route async state path。安全检查通过，revoke 脚本只读取本地 approval marker，先准备 revocation 临时文件，再归档 approval marker，最后原子落正式 revocation marker；未新增 secret、外部网络调用、mock 成功路径或静默 fallback。复杂度检查通过，`scripts/revoke-shadow-cutover.mjs` 保持单一职责，新增 gate 只在连接 Postgres 前读取本地 marker。Document-refresh: needed，原因：production cutover rollback 操作契约、backup/restore 文件清单和 docs 入口发生变化，已同步 README、docs/README、runtime-state query contract、Stage 3 runbook、backup/restore runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-cutover-approval.test.ts --maxWorkers=1` 先失败于缺少 `scripts/revoke-shadow-cutover.mjs`；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-postgres.test.ts --maxWorkers=1` 先失败于 revocation marker 未阻止 Postgres primary；`CI=true pnpm --filter @tingrudeng/forgeflow-dispatcher test` 先失败于 backup 清单缺少 `shadow-cutover-revocation.json`。GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-cutover-approval.test.ts tests/modules/server/runtime-state-postgres.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，3 个测试文件、15 个测试通过；`CI=true pnpm --filter @tingrudeng/forgeflow-dispatcher test` 通过，4 个测试文件、4 个测试通过；`node --check scripts/revoke-shadow-cutover.mjs` 通过。

剩余风险：revocation marker 可以阻止本仓库 dispatcher runtime 继续使用 Postgres primary backend；真实生产 rollback 仍依赖外部 Postgres、queue、DNS / 进程切流和变更窗口执行。

- [x] M49 串行：拆分 `worker-daemon.ts` 剩余 dispatcher client / task executor / types adapter。
- [x] M49 串行：运行最小充分验证并补充 review 小结。

## M49 Review 小结

已把 `scripts/lib/worker-daemon.ts` 从 437 行压缩到 96 行：公开类型迁移到 `worker-daemon-types.ts`，dispatcher HTTP / state-dir lazy client adapter 迁移到 `worker-daemon-dispatcher-client.ts`，claimed task execution 与 failed result fallback adapter 迁移到 `worker-daemon-task-executor.ts`。主文件只保留 `runWorkerDaemonCycle` / `runWorkerDaemon` 编排、repoRoot 解析和公开导出，继续复用 runtime-glue 与 beta-runtime-core。

Review Gate：finished。Spec 符合度通过，本轮继续推进 runtime executor / launch 去重，把 `worker-daemon.ts` 的公开类型、dispatcher client lazy adapter、claimed task execution 和 failed result fallback adapter 拆入独立模块；主文件只保留 daemon cycle 编排、repoRoot 解析和公开导出，没有改变 claim/start/result、失败回写、PR/worktree 参数、state-dir client 或 runtime-glue 调用语义。安全检查通过，未新增 secret、外部网络调用、命令拼接输入、mock 成功路径或静默 fallback；固定 runtime script 路径、retry 环境变量和 dispatcher internal call 语义保持不变。复杂度检查通过，`worker-daemon.ts` 从 437 行降至 96 行，新增 `worker-daemon-dispatcher-client.ts` 99 行、`worker-daemon-task-executor.ts` 138 行、`worker-daemon-types.ts` 128 行，均低于 300 行。Document-refresh: needed，原因：worker daemon 薄适配层边界变化，已同步 TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts` 先失败于 `worker-daemon.ts` 仍为 438 行，超过 300 行预算；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/run-worker-assignment.test.ts --maxWorkers=1` 通过，3 个测试文件、14 个测试通过；`CI=true pnpm --filter @tingrudeng/beta-runtime-core test` 通过，3 个测试文件、17 个测试通过；`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。首次全量 `CI=true pnpm test` 在全仓并发下出现一次 `dispatcher-server.test.ts` 15 秒超时；按 Debug-First 隔离复跑同文件，非沙箱 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server.test.ts --maxWorkers=1` 通过，66 个测试通过；第二次非沙箱 `CI=true pnpm test` 通过，dispatcher 48 个测试文件、493 个测试通过。

剩余风险：runtime executor / launch 去重主体已经收敛；后续风险主要转向 Trae gateway adapter 层和生产运行观测，不再是 `worker-daemon.ts` 主文件体量。

- [x] M48 串行：把 `run-worker-assignment` dist bootstrap / freshness 检查下沉到 runtime-bootstrap。
- [x] M48 串行：运行最小充分验证并补充 review 小结。

## M48 Review 小结

已把 root `scripts/run-worker-assignment.ts` 中的 `execSync`、`pathToFileURL`、src/dist mtime freshness 和 runtime dist import 细节下沉到 `scripts/lib/runtime-bootstrap.ts`。`run-worker-assignment.ts` 现在只保留 `FORGEFLOW_CODEX_MODEL` / Gemini 默认 model / timeout 环境变量 wiring、`formatLocalTimestamp` 注入和 `runWorkerAssignmentCli` 调用；`runtime-bootstrap` 统一负责 beta-runtime-core assignment runtime、worker-daemon runtime、dispatcher runtime bridge、Codex/Gemini runtime factory 的 dist freshness 检查和动态 import。

Review Gate：finished。Spec 符合度通过，本轮继续推进 runtime executor / launch 去重，把 root assignment runner 的 dist build/import/freshness 逻辑从脚本入口下沉到共享 `runtime-bootstrap`，没有改变 Codex/Gemini launch argv、dry-run 输出、默认 Gemini model、`FORGEFLOW_CODEX_MODEL`、执行 timeout 或 verification timeout 语义。安全检查通过，build command 仍是固定仓库内命令，未新增 secret、外部输入命令拼接、mock 成功路径或静默 fallback；脚本入口不再直接持有 `execSync` 或 `pathToFileURL`。复杂度检查通过，`scripts/run-worker-assignment.ts` 降到 56 行，`scripts/lib/runtime-bootstrap.ts` 91 行，新增 helper 均保持单一职责；Document-refresh: needed，原因：runtime bootstrap 权威边界变化，已同步 TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts` 失败于 `scripts/run-worker-assignment.ts` 仍包含 `execSync`。GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts tests/modules/server/run-worker-assignment.test.ts tests/modules/server/run-worker-daemon.test.ts --maxWorkers=1` 通过，3 个测试文件、13 个测试通过；`CI=true pnpm --filter @tingrudeng/beta-runtime-core test` 通过，3 个测试文件、17 个测试通过；`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过；非沙箱 `CI=true pnpm test` 通过，dispatcher 48 个测试文件、492 个测试通过。

剩余风险：`scripts/lib/worker-daemon.ts` 仍超过 300 行，剩余主要是兼容导出、lazy client 和 run loop adapter；后续如果继续压缩，应拆这些 adapter 边界，而不是再扩写 root script。

- [x] M47 串行：补齐 shadow production cutover approval marker 硬门禁。
- [x] M47 串行：运行最小充分验证并补充 review 小结。

## M47 Review 小结

已为 production cutover 增加显式 approval marker：`pnpm verify:shadow-cutover:approve` 会读取 `.forgeflow-dispatcher/shadow-cutover-drill.json`，校验证据为 `cutover_preflight=cutover_ready` 后生成 `.forgeflow-dispatcher/shadow-cutover-approval.json`。`RUNTIME_STATE_BACKEND=postgres` 的 async primary snapshot load/save 会在连接 Postgres 前校验该 approval marker，缺失或非 cutover_ready 时直接拒绝。backup / restore 文件清单也已包含 `shadow-cutover-approval.json`，避免 DR 恢复后丢失 cutover 审批证据。

Review Gate：finished。Spec 符合度通过，本轮推进 shadow 自动 reconciliation / production cutover 的收口项：新增 approval marker 生成脚本，并把 Postgres primary backend load/save 变成 approval-gated 操作；未改变 shadow drift gate、reconcile、drill preflight、Postgres snapshot 表结构或 HTTP API 路由语义。安全检查通过，approval 脚本只读取 operator 指定的 drill evidence，校验 `ok=true` 和 `cutover_preflight=cutover_ready` 后原子写入 approval JSON；runtime 在连接 Postgres 前校验 marker，未新增 secret、网络副作用、mock 成功路径或静默 fallback。复杂度检查通过，`runtime-state-postgres.ts` 80 行，`approve-shadow-cutover.mjs` 97 行；新增测试拆出 `shadow-cutover-approval.test.ts`，`shadow-drift.test.ts` 回落到 281 行。Document-refresh: needed，原因：production cutover 操作契约、backup/restore 文件清单和 docs 入口均发生变化，已同步 README、docs/README、API endpoints、runtime-state query contract、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-postgres.test.ts` 先失败于缺少 approval gate，`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts --maxWorkers=1` 先失败于缺少 approval 脚本，`CI=true pnpm --filter @tingrudeng/forgeflow-dispatcher exec vitest run tests/backup.test.ts` 先失败于 backup 清单缺少 `shadow-cutover-approval.json`。GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/shadow-cutover-approval.test.ts tests/modules/execution/workflows.test.ts tests/modules/server/runtime-state-postgres.test.ts tests/modules/server/dispatcher-server-postgres.test.ts --maxWorkers=1` 通过，5 个测试文件、24 个测试通过；`CI=true pnpm --filter @tingrudeng/forgeflow-dispatcher test`、`CI=true pnpm --filter @forgeflow/dispatcher-store-postgres test`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`git diff --check` 均通过。沙箱内 `CI=true pnpm test` 因 live dispatcher 监听 `127.0.0.1` 和 Trae session store 用户目录写入权限失败；按权限规则非沙箱复跑最终 `CI=true pnpm test` 通过，dispatcher 48 个测试文件、492 个测试通过。

剩余风险：approval marker 只能证明本仓库 drill evidence 已归档并显式批准；真实生产切换仍依赖外部 Postgres、queue、变更窗口和回滚流程。

- [x] M46 串行：把 `run-worker-assignment` Codex/Gemini launch builder 下沉到 beta-runtime-core。
- [x] M46 串行：运行最小充分验证并补充 review 小结。

## M46 Review 小结

已新增 `buildDispatcherRuntimeLaunchCommand`，让共享 `@tingrudeng/beta-runtime-core` 负责根据 assignment pool 构建 Codex/Gemini launch command；`scripts/run-worker-assignment.ts` 只保留 beta-runtime-core dist 加载、dispatcher runtime factory 加载、环境变量注入和 CLI bootstrap。脚本侧 dist 检查也从“文件存在即可”改为比较 src/dist mtime，避免共享 core 或 dispatcher runtime 改动后继续加载陈旧 dist。

Review Gate：finished。Spec 符合度通过，本轮继续推进 runtime executor / launch 去重，把 Codex/Gemini launch builder 从 root 脚本侧下沉到共享 beta-runtime-core，没有改变 dry-run 输出、默认 Gemini model、`FORGEFLOW_CODEX_MODEL` 语义或 verification/result 写入语义；安全检查通过，未新增 secret、网络副作用、命令拼接输入或静默 fallback；复杂度检查通过，`scripts/run-worker-assignment.ts` 102 行，`packages/beta-runtime-core/src/runtime/run-worker-assignment.ts` 270 行，新增函数均保持单一职责；Document-refresh: needed，原因：runtime 去重边界变化，已同步 README、docs/README、TECH_DEBT、beta-runtime-core README 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/beta-runtime-core exec vitest run tests/run-worker-assignment.test.ts` 失败于 `buildDispatcherRuntimeLaunchCommand is not a function`；GREEN 后 `CI=true pnpm --filter @tingrudeng/beta-runtime-core test` 通过，3 个测试文件、17 个测试通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/run-worker-assignment.test.ts --maxWorkers=1` 通过，3 个测试通过；`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core typecheck`、`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test`、`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。非沙箱 `CI=true pnpm test` 通过，dispatcher 47 个测试文件、489 个测试通过。

剩余风险：root `scripts/run-worker-assignment.ts` 仍负责动态加载 beta-runtime-core 和 dispatcher runtime dist，这是源码仓 live bootstrap 职责；如果后续继续收敛，应把 dist freshness 检查抽成通用 bootstrap helper，而不是在脚本入口继续扩写业务逻辑。

- [x] M45 串行：补齐 Console trajectory step 前后回放交互。
- [x] M45 串行：运行最小充分验证并补充 review 小结。

## M45 Review 小结

已把 Console 任务详情 trajectory tab 从“逐条展开”推进到当前 bundle 内的 step 回放视图。审查者可以通过上一步 / 下一步或步骤选择器查看当前 step 的 phase、status、action、observation、command、exitCode 和 artifactRef，并继续从当前 step 展开或下载 manifest 登记的观察文件。

Review Gate：finished。Spec 符合度通过，本轮只推进 Console 内的 trajectory step 回放交互，没有改变 ArtifactBundle schema、artifact store manifest、dispatcher 写入语义或 worker result contract；安全检查通过，仍只读取 manifest 登记的 artifact 文件，未新增 secret、命令拼接、mock 成功路径或静默 fallback；复杂度检查通过，`ArtifactTrajectory.tsx` 204 行、`ArtifactSummary.tsx` 258 行，新增 helper 组件均保持单一职责；Document-refresh: needed，原因：Console trajectory 展示能力变化，已同步 docs/README、ARTIFACT_BUNDLE_V1、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 失败于找不到“步骤 1 / 2”；GREEN 后同命令通过，16 个测试通过。最终验证 `CI=true pnpm --filter console test`、`CI=true pnpm --filter console lint`、`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。沙箱内 `CI=true pnpm test` 因 live dispatcher 监听 `127.0.0.1` 和 Trae session home 写入权限失败；按权限规则非沙箱复跑 `CI=true pnpm test` 通过，dispatcher 47 个测试文件、489 个测试通过。

剩余风险：当前已支持当前 bundle 内的 step 前后回放和当前 step artifact 观察文件读取；跨 step 状态 diff、时间轴 scrubber 和原始 thought/action/observation 全量流仍需要 worker runtime 继续产出更细粒度 trajectory。

- [x] M44 串行：补齐 Console trajectory step artifactRef 可回放入口。
- [x] M44 串行：运行最小充分验证并补充 review 小结。

## M44 Review 小结

已把 Console 任务详情里的 trajectory tab 从“只展示 step 文本”推进到可回放入口：当 `trajectory.steps[]` 带 `artifactRef` 时，审查者可以直接在对应 step 展开或下载 manifest 登记的观察文件。实现复用现有 `/api/artifacts/:bundleId/files/:fileName` 文件 API，不新增后端协议；同时把 artifact 文件读取 helper 和 `ArtifactTrajectory` 拆成独立组件，`ArtifactSummary.tsx` 降到 300 行以内。运行 Console lint 时发现既有 `ReviewActions` 在 effect 内同步 setState，会触发 React hooks 规则；本轮改为 key remount 初始化表单状态，保持原提交 payload 语义。

Review Gate：finished。Spec 符合度通过，本轮推进可回放 trajectory 的 Console 操作入口，没有改变 ArtifactBundle schema、artifact store manifest 或 worker result 写入语义；安全检查通过，仍只允许读取 manifest 登记文件，前端复用既有 artifact 文件 API，未新增 secret、命令拼接、mock 成功路径或静默 fallback；复杂度检查通过，`ArtifactSummary.tsx` 258 行，新增 `ArtifactTrajectory.tsx` 105 行、`artifactFileAccess.ts` 46 行，`TaskReviewSections.tsx` 296 行；Document-refresh: needed，原因：Console trajectory 可回放能力变化，已同步 docs/README、ARTIFACT_BUNDLE_V1、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 失败于找不到“展开轨迹文件”按钮；GREEN 后同命令通过，16 个测试通过。最终验证 `CI=true pnpm --filter console lint`、`CI=true pnpm --filter console test`、`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check`、`CI=true pnpm test` 均通过。

剩余风险：当前补齐的是 trajectory step 到 artifact 文件的直接回放入口；完整逐步播放、跨 step 状态 diff 和 timeline scrubber 仍是后续产品化项。

- [x] M43 串行：把 Trae automation gateway route / session / chat handler 抽到共享 core。
- [x] M43 串行：运行最小充分验证并补充 review 小结。

## M43 Review 小结

已在 `packages/automation-gateway-core` 新增共享 gateway handler，把 `GET /ready`、session 查询 / release / prepare 和 `POST /v1/chat` 的 route、session conflict、request fingerprint、cached response、progress touch、timeout 归一化和 automation error envelope 集中到 `handleAutomationGatewayRequest`。`scripts/lib/trae-automation-gateway.ts` 与 `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts` 都改为薄 adapter，分别只保留 HTTP server/body/error writer、debug logger、Trae driver 创建和 session-store 注入。新增 thin-adapter 测试防止 `/v1/chat` handler 逻辑回流到脚本侧或 packaged runtime。

Review Gate：finished。Spec 符合度通过，本轮按 Trae gateway 去重计划推进共享 handler 抽取，没有改变 HTTP route 名称、session-store 文件格式、driver 行为或 timeout 语义；安全检查通过，未新增 secret、外部网络调用、命令拼接、mock 成功路径或静默 fallback，session 冲突仍显式返回 `SESSION_CONFLICT`；复杂度检查通过，新增共享文件均低于 300 行，`gateway-handler.ts` 296 行，新增 helper 函数均低于 50 行；Document-refresh: needed，原因：Trae gateway 重复实现边界变化，已同步 README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/automation-gateway-core exec vitest run tests/gateway-handler.test.ts` 先失败于缺少共享 handler 导出；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway-thin-adapter.test.ts` 先失败于缺少共享 handler 文件。GREEN 后 `CI=true pnpm --filter @tingrudeng/automation-gateway-core test` 通过，2 个测试文件、9 个测试通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway.test.ts tests/modules/server/trae-automation-gateway-helpers.test.ts tests/modules/server/trae-automation-gateway-thin-adapter.test.ts` 通过，33 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：route / session / chat handler 已去重；脚本侧和 packaged runtime 仍各自保留 HTTP server 启动、debug logger、driver adapter 与 session-store wrapper。后续如果继续收敛，应优先抽这些 adapter 小模块，而不是再复制 handler 逻辑。

- [x] M42 串行：把 packaged Trae automation gateway 补齐脚本侧 chat session 语义。
- [x] M42 串行：运行最小充分验证并补充 review 小结。

## M42 Review 小结

已把 `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts` 的 `POST /v1/chat` session 处理补齐到脚本侧既有语义：completed session 直接返回 cached response；running session 拒绝重复提交；`requestFingerprint` 不一致时拒绝复用；发送前把既有 session 标记为 `running`；driver `onProgress` 会回写 `responseDetected`。soft-timeout 仍不把 session 标记 failed，但会保持 `running`，便于后续轮询或恢复。

Review Gate：finished。Spec 符合度通过，本轮按 Trae gateway 去重计划推进 packaged runtime 行为收敛，补齐脚本侧已有的 chat session 保护语义，没有改变 HTTP route 名称、session store 文件格式或 release / prepare 语义；安全检查通过，未新增 secret、外部网络调用、命令拼接、mock 成功路径或静默 fallback，冲突场景会显式抛出 `SESSION_CONFLICT`；复杂度检查局部通过，新增逻辑集中在 `POST /v1/chat` 分支，新增测试覆盖关键差异，既有 gateway 源文件和测试文件仍超过 300 行但本轮未扩大职责边界；Document-refresh: needed，原因：Trae gateway 漂移边界变化，已同步 TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @tingrudeng/trae-beta-runtime exec vitest run tests/runtime/trae-automation-gateway.test.ts` 先失败于缺少 cached / conflict / fingerprint / progress / timeout-running 语义；GREEN 后同命令通过，15 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime test` 通过，19 个测试文件、174 个测试通过；`CI=true pnpm --filter @tingrudeng/trae-beta-runtime typecheck`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：本轮把 packaged runtime 行为向脚本侧对齐，继续降低漂移风险；源码脚本 gateway 与 packaged runtime 仍是两套实现，后续还应继续抽共享 handler 或让脚本侧委托 packaged runtime。

- [x] M41 串行：把 worker daemon 本地 logger / metrics hook 组装拆成独立 adapter。
- [x] M41 串行：运行最小充分验证并补充 review 小结。

## M41 Review 小结

已新增 `scripts/lib/worker-daemon-hooks.ts`，把 `worker-daemon` 的本地日志、metrics、失败 result fallback 事件回调和 cleanup 日志组装从主 adapter 中拆出；`scripts/lib/worker-daemon.ts` 现在只引用 hook adapter，并继续把 dispatcher client、daemon cycle、managed executor、live executor、失败回写和 dist bootstrap 委托给共享 runtime / bootstrap 模块。同步生成 `worker-daemon-hooks.js` 与更新后的 `worker-daemon.js`。

Review Gate：finished。Spec 符合度通过，本轮只处理已确认 runtime 去重尾项：把 `worker-daemon` 本地 logger / metrics hook 组装拆成独立 adapter，没有改变 dispatcher client、claim/start/result、managed executor、live executor、失败回写或 dist bootstrap 语义；安全检查通过，未新增 secret、外部网络调用、命令拼接、mock 成功路径或静默 fallback；复杂度检查基本通过，新增 `worker-daemon-hooks.ts` 128 行，新增 helper 均低于 50 行，`worker-daemon.ts` 从 437 行继续下降但仍超过 300 行；Document-refresh: needed，原因：worker daemon adapter 边界变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts` 先失败于缺少 `scripts/lib/worker-daemon-hooks.ts`；GREEN 后同命令通过，3 个测试通过；受影响套件 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/runtime-glue.test.ts` 通过，30 个测试通过；`CI=true pnpm --filter @tingrudeng/beta-runtime-core test` 通过，16 个测试通过；`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：本轮继续降低 `worker-daemon.ts` 职责，但它仍超过 300 行，主要来自兼容类型、lazy dispatcher client 和 run loop adapter；Trae automation gateway 双实现仍需要后续继续收敛。

- [x] M40 串行：为 shadow production cutover drill 增加可归档证据文件输出。
- [x] M40 串行：运行最小充分验证并补充 review 小结。

## M40 Review 小结

已为 `scripts/verify-shadow-cutover-drill.mjs` 增加 `--output <path>`，drill 的 stdout payload 会被原子写入指定 JSON 文件；新增 `pnpm verify:shadow-cutover:drill:evidence`，默认把证据写到 `.forgeflow-dispatcher/shadow-cutover-drill.json`。这让 production cutover 前的 drift gate、reconcile + alert、strict preflight 三阶段结果可以直接归档，而不是依赖终端复制。

Review Gate：finished。Spec 符合度通过，本轮补齐 production cutover drill 的证据文件输出，未改变 drift gate、reconcile、strict preflight 的判定语义，也没有隐式切换 primary store；安全检查通过，`--output` 只写 operator 显式指定路径或 `.forgeflow-dispatcher/shadow-cutover-drill.json`，未新增 secret、外部网络调用、mock 成功路径或静默 fallback；复杂度检查通过，`verify-shadow-cutover-drill.mjs` 127 行，新增函数低于 50 行，测试文件 280 行；Document-refresh: needed，原因：新增 cutover drill evidence 命令和 `--output` 操作契约，已同步 README、docs/README、API endpoints、runtime-state query 契约、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts` 先失败于 `--output` 不支持；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts` 通过，15 个测试通过；`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：该命令让 cutover 演练证据可归档，但真实 primary-store 生产切换仍需要外部 Postgres / queue 运维确认和变更窗口执行。

- [x] M39 串行：把 worker daemon dist bootstrap 收敛到显式 runtime-bootstrap adapter。
- [x] M39 串行：运行最小充分验证并补充 review 小结。

## M39 Review 小结

已新增 `scripts/lib/runtime-bootstrap.ts`，统一负责 dispatcher runtime bridge 和 beta runtime core dist 的构建检测与动态导入；`scripts/lib/worker-daemon.ts` 不再直接持有 `execSync`、`pathToFileURL` 或 beta runtime build 命令，`scripts/run-worker-daemon.ts` 也改为复用同一个 bootstrap adapter。同步生成 `runtime-bootstrap.js`、`worker-daemon.js` 和 `run-worker-daemon.js`，并用 thin-adapter 测试锁定 bootstrap 逻辑不回流。

Review Gate：finished。Spec 符合度通过，本轮只把 dist build/import 职责移入 `scripts/lib/runtime-bootstrap.ts`，没有改变 dispatcher client、worker claim、task execution、失败回写或本地 hook 行为；安全检查通过，未新增 secret、外部网络调用、命令拼接输入、mock 成功路径或静默 fallback，build 命令仍是固定仓库内命令；复杂度检查基本通过，新增 `runtime-bootstrap.ts` 45 行，新增 helper 均低于 50 行，`worker-daemon.ts` 从 586 行降至 544 行但仍超过 300 行，剩余主要是本地 logger / metrics hook 与兼容类型；Document-refresh: needed，原因：worker daemon bootstrap 边界变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/runtime-glue.test.ts` 通过，29 个测试通过；`CI=true pnpm --filter @tingrudeng/beta-runtime-core test` 通过，16 个测试通过；`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：脚本侧仍保留本地 logger / metrics hook 组装和兼容类型，`worker-daemon.ts` 仍超过 300 行；后续如果继续收敛，应拆 hook adapter，而不是再搬 runtime core 逻辑。

- [x] M38 串行：补齐 HITL resume schema 丰富字段、跨 worker prompt 约束和 Console 校验文案。
- [x] M38 串行：运行最小充分验证并补充 review 小结。

## M38 Review 小结

已把 HITL `resumePayloadSchema` 从基础 `string` / `number` / `boolean` 扩展为支持 `integer`、`array`、textarea、placeholder、数字范围、数组数量和 string item enum；dispatcher runtime 归一化、`@forgeflow/worker-protocol`、`@forgeflow/task-schema`、beta runtime 类型和 Console 表单已同步。Console 不再用弹窗吞掉结构化输入错误，而是在页面内展示“恢复输入校验失败”及字段级错误；Codex / Gemini worker prompt 和 worker prompt layering 契约已写入共享 schema 子集约束。

Review Gate：finished。Spec 符合度通过，本轮完成 HITL resume schema 丰富字段、Console 页面内校验文案和跨 worker prompt 约束；安全检查通过，仅扩展结构化 schema 和前端表单校验，未新增 secret、外部网络调用、命令拼接、mock 成功路径或静默 fallback；复杂度检查基本通过，`TaskHitlSection.tsx` 降至 188 行，新增 `taskHitlSchema.ts` 134 行，新增 helper 均低于 50 行，既有 `runtime-state.ts` 和 `worker-protocol/src/index.ts` 仍超过 300 行但本轮只做协议字段最小扩展；Document-refresh: needed，原因：HITL 协议、Console 恢复体验和 worker prompt 约束发生变化，已同步 README、docs/README、API endpoints、Worker Protocol、worker prompt layering、TECH_DEBT、prompts 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter @forgeflow/task-schema test`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts` 均先失败于缺少 richer schema / 校验支持；GREEN 后上述四组定向测试均通过；`CI=true pnpm --filter console test` 通过，30 个测试通过；`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。额外尝试 `CI=true pnpm test` 时，8 个 Trae gateway 测试因沙箱拒绝写 `/Users/dengtingru/.forgeflow-trae-beta/sessions/sessions.json.tmp` 失败，1 个历史慢测 `run-worker-daemon.test.ts` 在全仓并发下 15 秒超时；按规则申请非沙箱重跑被当前 Codex 使用额度拦截，未继续绕过。

剩余风险：当前 array 只支持字符串列表和 string item enum，尚未支持嵌套对象数组；这是有意保守的跨 worker 共享子集。全仓 `pnpm test` 未能在当前沙箱完成，相关 HITL / 协议 / Console / runtime 定向验证已通过。

- [x] M37 串行：补齐 Console Artifact Workbench 跨任务 artifact / review 并排详情。
- [x] M37 串行：运行最小充分验证并补充 review 小结。

## M37 Review 小结

已在 Artifact Workbench 的证据对比区域增加跨任务并排详情：筛选结果里的每个 bundle 都会展示任务标题、review reasonCode 和 risk level，帮助审查者在批量操作前直接对照 artifact 与 review 证据，不必逐个打开任务详情侧栏。

Review Gate：finished。Spec 符合度通过，本轮完成 Artifact Workbench 跨任务 artifact / review 并排详情，未改变 artifact / review 数据来源、任务选择、筛选或批量审查语义；安全检查通过，仅基于前端已有 dashboard snapshot 数据展示任务标题、reasonCode 和风险等级，未新增后端写路径、secret、外部网络调用、mock 成功路径或静默 fallback；复杂度检查通过，`ArtifactWorkbench.tsx` 224 行，新增渲染块保持在既有组件边界内，既有 `Lists.test.tsx` 和 `i18n.tsx` 已超过 300 行但本轮只做集中式测试与文案表的最小增量；Document-refresh: needed，原因：Console 审查工作台并排详情能力发生变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 先失败于缺少 `并排详情`；GREEN 后同命令通过，15 个测试通过；`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx src/__tests__/App.test.tsx` 通过，20 个测试通过；`CI=true pnpm --filter console test` 通过，29 个测试通过；`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：当前并排详情展示的是 artifact bundle 与 review evidence 的摘要级对照，不是完整 diff/log/test 文件的逐行并排比对。

- [x] M36 串行：补齐 Console Artifact Workbench 证据差异高亮。
- [x] M36 串行：运行最小充分验证并补充 review 小结。

## M36 Review 小结

已在 Artifact Workbench 的跨任务证据对比摘要中增加差异高亮：当筛选结果里存在多个 `reasonCode` 或多个 `riskAssessment.level` 时，工作台会显示“证据差异”，列出原因码 / 风险类别数，并用高亮样式标出对应计数 badge，帮助审查者在批量审查前先发现结果集内部风险分歧。

Review Gate：finished。Spec 符合度通过，本轮完成 Artifact Workbench 证据差异高亮，未改变 artifact / review 数据来源、任务选择或筛选语义；安全检查通过，仅基于前端已有 dashboard snapshot 数据渲染提示，未新增后端写路径、secret、外部网络调用、mock 成功路径或静默 fallback；复杂度检查通过，`ArtifactWorkbench.tsx` 209 行，新增 helper 低于 50 行，既有 `Lists.test.tsx` 和 `i18n.tsx` 已超过 300 行但本轮只做集中式测试与文案表的最小增量；Document-refresh: needed，原因：Console 审查工作台证据差异展示能力发生变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 先失败于缺少 `证据差异`；GREEN 后同命令通过，15 个测试通过；`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx src/__tests__/App.test.tsx` 通过，20 个测试通过；`CI=true pnpm --filter console test` 通过，29 个测试通过；`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：当前完成的是摘要级差异高亮，跨任务 artifact / review 并排详情仍是后续产品化项。

- [x] M35 串行：把 worker-daemon dispatcher client 和 managed executor lifecycle 下沉到共享 runtime core。
- [x] M35 串行：运行最小充分验证并补充 review 小结。

## M35 Review 小结

已继续收敛 `scripts/lib/worker-daemon.ts`：dispatcher HTTP client、state-dir client、auth header、reportEvent route 和 state-dir error 处理下沉到 `apps/dispatcher/src/modules/server/runtime-glue-dispatcher-client.ts`；执行期 heartbeat、完成/失败 callback 编排和失败 result 回写入口下沉到 `packages/beta-runtime-core/src/runtime/managed-task-processor.ts:executeManagedWorkerTask`。脚本侧现在通过 lazy wrapper 复用 runtime-glue client，并只负责 dist bootstrap、本地 logger / metrics hook 组装和兼容导出。

Review Gate：finished。Spec 符合度通过，本轮继续推进 runtime executor/launch 去重：脚本侧不再保留 dispatcher client plumbing 或执行期 heartbeat 定时器，主循环、client、managed executor、live executor 和失败回写均由共享 runtime core 承担；安全检查通过，HTTP auth header 逻辑从脚本侧移动到 runtime-glue，未新增 secret、外部命令拼接、mock 成功路径或静默 fallback，state-dir 400+ 响应继续显式抛错；复杂度检查基本通过，新增 `managed-task-processor.ts` 89 行、薄 adapter 测试 21 行，新增函数均低于 50 行，既有 `scripts/lib/worker-daemon.ts` 仍为 586 行但本轮净删除逻辑并用源码约束测试防止重复实现回流；Document-refresh: needed，原因：worker runtime 去重边界变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts` 先失败于 `function callWithRetry`，后续扩展断言后再次失败于 `setInterval`；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/worker-daemon-thin-adapter.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/runtime-glue.test.ts` 通过，28 个测试通过；`CI=true pnpm --filter @tingrudeng/beta-runtime-core test` 通过，16 个测试通过；`CI=true pnpm --filter @forgeflow/dispatcher build`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core build`、`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。`rg -n "setInterval|function callWithRetry|function callStateDirDispatcher|function readStateDirResponseJson" scripts/lib/worker-daemon.ts scripts/lib/worker-daemon.js` 无匹配。

剩余风险：脚本侧仍需保留 dist bootstrap 和本地 logger / metrics hook 组装，直到源码仓 live 入口完全改成发布包 adapter；`scripts/lib/worker-daemon.ts` 仍超过 300 行，主要来自兼容类型和本地 hook 组装，后续可继续拆成 adapter helper。

- [x] M34 串行：补齐 Console Artifact Workbench 跨任务证据对比摘要。
- [x] M34 串行：运行最小充分验证并补充 review 小结。

## M34 Review 小结

已把 Artifact Workbench 的 review evidence 联动继续推进为跨任务证据对比摘要：当筛选结果包含多个 artifact bundle 时，工作台会按最新 review 汇总 `reasonCode` 和 `riskAssessment.level` 的计数，帮助审查者先判断当前结果集的风险分布，再进入具体任务详情。该摘要只读取 dashboard snapshot 里已有的 `reviews` 和 `artifactBundles`，不新增后端写路径。

Review Gate：finished。Spec 符合度通过，本轮完成 Console Artifact Workbench 跨任务证据对比摘要，并保持点击任务、按 evidence 筛选和 review evidence badge 原行为；安全检查通过，仅读取前端已有 `reviews` / `artifactBundles` 数据，未新增 secret、后端写路径、外部网络调用、mock 成功路径或静默 fallback；复杂度检查通过，`ArtifactWorkbench.tsx` 190 行，新增 helper / component 均低于 50 行，既有 `Lists.test.tsx` 和 `i18n.tsx` 已超过 300 行但本轮只做最小增量，不在本次 UI 行为收口中拆分集中式测试和文案表；Document-refresh: needed，原因：Console 审查工作台证据对比能力发生变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 先失败于未展示 `证据对比`；GREEN 后 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 通过，15 个测试通过；修复断言歧义后 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 再次通过，15 个测试通过；`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx src/__tests__/App.test.tsx` 通过，20 个测试通过；`CI=true pnpm --filter console test` 通过，29 个测试通过；`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：当前补齐的是计数摘要，不是并排 diff 详情；跨任务 artifact / review 并排详情和证据差异高亮仍保留为后续产品化项。

- [x] M33 串行：把 Console Artifact Workbench 接上 review evidence 联动。
- [x] M33 串行：运行最小充分验证并补充 review 小结。

## M33 Review 小结

已把 Artifact Workbench 从单纯跨任务 artifact 筛选推进到 artifact / review 证据联动：卡片会展示对应任务最新 review 的 `reasonCode`、`riskAssessment.level`、`mustFix[]` 和首条 risk reason，搜索框也能按这些证据筛选 artifact；App 侧把 dashboard snapshot 的 `reviews` 传入工作台，避免用户在 artifact 与 review queue 之间来回切换才能判断风险。

Review Gate：finished。Spec 符合度通过，本轮完成 Console Artifact Workbench 的 review evidence 摘要和筛选联动；安全检查通过，仅读取 dashboard snapshot 中已有 `reviews` 数据，未新增后端写路径、secret、外部网络调用、mock 成功路径或静默 fallback；复杂度检查通过，`ArtifactWorkbench.tsx` 159 行、`App.tsx` 295 行，新增 helper 均低于 50 行；Document-refresh: needed，原因：Console 审查工作台 artifact / review 证据联动能力发生变化，已同步 README、docs/README、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 先失败于未展示 `test_gap`；GREEN 后 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx` 通过，15 个测试通过；`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx src/__tests__/App.test.tsx` 通过，20 个测试通过；`CI=true pnpm --filter console test` 通过，29 个测试通过；`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：当前补齐的是 evidence 摘要和筛选联动；跨任务 artifact / review 对比视图、证据差异高亮和批量审查前的并排比较仍是后续产品化项。

- [x] M32 串行：新增 shadow production cutover drill 编排入口。
- [x] M32 串行：运行最小充分验证并补充 review 小结。

## M32 Review 小结

已新增 `scripts/verify-shadow-cutover-drill.mjs` 和 `pnpm verify:shadow-cutover:drill`，把生产 cutover 演练收敛为三阶段结构化输出：drift gate、`--reconcile --record-alert` 对账、strict `--require-configured --require-primary-backend --max-mismatches 0 --max-delta 0` preflight。未配置 shadow / primary backend 时脚本会 fail-closed，并保留每个 phase 的 `statusCode` 和 payload，方便变更窗口前归档证据。

Review Gate：finished。Spec 符合度通过，本轮完成 shadow production cutover drill 的命令化编排，没有改变默认只读 drift gate 或隐式切主；安全检查通过，未新增 secret、外部网络副作用、mock 成功路径或静默 fallback，脚本在 shadow / primary 未配置时 fail-closed；复杂度检查通过，新增脚本 105 行，函数均低于 50 行，测试文件 254 行；Document-refresh: needed，原因：新增 production cutover drill 命令和 Stage 3 运行边界，已同步 README、docs/README、API endpoints、runtime-state query 契约、Stage 3 runbook、TECH_DEBT 和 tasks。结论：通过。

验证已通过：RED 阶段 `shadow-drift.test.ts` 先因缺少脚本失败；GREEN 后 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts` 通过，9 个测试通过；`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts` 通过，14 个测试通过；`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：该 drill 验证 drift / reconcile / strict preflight 编排，不替代真实生产 Postgres 连通性、外部备份恢复、DNS 切流、回滚和变更窗口人工确认。

- [x] M31 串行：把 HITL resume 升级为 schema 驱动表单并保留 JSON fallback。
- [x] M31 串行：运行最小充分验证并补充 review 小结。

## M31 Review 小结

已把 worker result / HTTP interrupt 的 `waitingForInput.resumePayloadSchema` 接入 dispatcher 状态、`@forgeflow/worker-protocol`、`@forgeflow/task-schema` 和 Console 任务详情。Console 在 schema 提供 `properties` 时渲染 string / number / boolean / enum 表单并构造 `resumePayload`；未提供 schema 时继续使用原 JSON textarea fallback，避免破坏既有 worker。

Review Gate：finished。Spec 符合度通过，本轮完成 HITL resume schema 从 worker result / HTTP interrupt 到 dispatcher snapshot 和 Console 表单的主链；安全检查通过，未新增 secret、外部网络调用、mock 成功路径或静默 fallback，HTTP 输入继续要求 `waitingForInput` 和 `resumePayloadSchema` 为对象并在 runtime-state 归一化字段；复杂度检查通过，`TaskHitlSection.tsx` 231 行，新增表单 helper 均低于 50 行，既有超大 `runtime-state.ts` / `worker-protocol` 文件只做最小字段扩展；Document-refresh: needed，原因：HITL 协议、Console 恢复体验和技术债状态发生变化，已同步 README、docs/README、API endpoints、Worker Protocol、TECH_DEBT 和 tasks。结论：通过。

验证已通过：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter console test`、`CI=true pnpm --filter console build`、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter @forgeflow/task-schema test`、`CI=true pnpm --filter @forgeflow/dispatcher build`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/dispatcher-server.test.ts`（默认沙箱因既有 auth middleware `listen EPERM 127.0.0.1` 超时后，按同命令非沙箱重跑通过，133 tests passed）、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`、非沙箱 `CI=true pnpm test`（24 个 workspace project，dispatcher 45 个测试文件 / 483 个测试全部通过）。

剩余风险：当前 schema 只覆盖 string / number / boolean / enum 的最小可用子集；复杂嵌套对象、数组和自定义校验文案仍需后续按真实 worker prompt 需求补齐。

- [x] M30 串行：把 Console 批量审查结果升级为页面内明细。
- [x] M30 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M30 Review 小结

已把 Console 批量审查提交结果从 `alert` 升级为审查队列内的结果面板：批量提交后展示成功数 / 总数，并按 taskId 展示失败原因。批量提交逻辑拆到 `apps/console/src/lib/bulkReviewDecision.ts`，`App.tsx` 只保留状态编排，避免继续推高入口组件复杂度。

Review Gate：finished。Spec 符合度通过，本轮完成 Console 审查工作台中批量处理结果的页面内明细；安全检查通过，仍只调用既有 review decision API，未新增后端写路径、secret、外部网络调用或静默 fallback；复杂度检查通过，`App.tsx` 294 行、`ReviewQueue.tsx` 256 行、`bulkReviewDecision.ts` 34 行，新增/修改生产文件均低于 300 行；Document-refresh: needed，原因：Console 批量审查结果展示行为变化，已同步 README、docs/README 和 TECH_DEBT。结论：通过。

验证已通过：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter console exec vitest run src/__tests__/App.test.tsx`、`CI=true pnpm --filter console test`、`CI=true pnpm --filter console build`。

剩余风险：Console 审查工作台仍可继续补跨任务对比和 artifact / review 证据联动。

- [x] M29 串行：下沉 worker-daemon 失败回写到 beta-runtime-core adapter。
- [x] M29 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M29 Review 小结

已把脚本侧 `worker-daemon` 的失败 fallback result 构建、落盘、`submitResult` retry 和失败 evidence 分类下沉到 `packages/beta-runtime-core` 的 `submitFailedWorkerResult`；`scripts/lib/worker-daemon.ts` 现在只负责动态加载 runtime core，并通过回调上报日志、metrics 和 dispatcher event。共享失败 result 会写出 `worker-result.json`、`worker-verification.json` 和 raw output，push / PR / dispatcher 回写失败继续保留显式 `delivery_failed` 证据。

Review Gate：finished。Spec 符合度通过，本轮完成 worker-daemon 失败回写下沉，未改变 dispatcher 状态机或 worker result 提交协议；安全检查通过，未新增 secret、外部输入拼接、mock 成功路径或静默 fallback；复杂度检查通过，脚本侧删除重复分类与落盘逻辑，runtime core helper 保持单职责；Document-refresh: needed，原因：runtime 去重状态和剩余技术债边界变化，已同步 README、docs/README、scripts/lib/README 和 TECH_DEBT。结论：通过。

验证已通过：`CI=true pnpm --filter @tingrudeng/beta-runtime-core build`、`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core exec vitest run tests/worker-daemon.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/run-worker-daemon.test.ts tests/modules/server/worker-daemon-helpers.test.ts`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core test`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。全量 `CI=true pnpm test` 在默认沙箱因 `listen EPERM 127.0.0.1` 和 `/Users/dengtingru/.forgeflow-trae-beta` 写权限失败；按同一命令非沙箱复跑通过，覆盖 24 个 workspace project，其中 dispatcher 45 个测试文件 / 483 个测试全部通过。

剩余风险：脚本侧仍保留 beta-runtime-core dist bootstrap 与日志 / metrics callback；后续可继续收敛成 runtime core 的显式 adapter，降低源码仓 live 入口对本地 dist 新鲜度的依赖。

- [x] M28 串行：补齐 Console 批量 merge 风险确认和失败明细。
- [x] M28 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M28 Review 小结

已把 Console 审查队列的批量动作扩展为 `merge` / `rework` / `block` 三类：批量 merge 会检查已选任务的 `riskAssessment.level`，只要存在非 `low` 风险任务，就必须先勾选批量风险确认；提交时会把 `acknowledgeRisk` 透传到 dispatcher 的 review decision API。App 批量提交失败时现在会展示逐项 `taskId: error` 明细，避免只看到失败数量。

Review Gate：finished。Spec 符合度通过，本轮完成 Console 批量 merge 风险确认和失败明细；安全检查通过，未新增后端写路径、secret、外部网络调用、mock 成功路径或静默 fallback，服务端 merge gate 仍是最终权威；复杂度检查通过，`App.tsx` 300 行、`ReviewQueue.tsx` 213 行、`ReviewBulkForm.tsx` 111 行、`ReviewTaskList.tsx` 74 行，新增/修改组件文件均低于 300 行；Document-refresh: needed，原因：Console 审查队列批量 merge 能力变化，已同步 README、docs/README 和 TECH_DEBT。结论：通过。

验证已通过：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx src/__tests__/App.test.tsx`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：该批次记录的 alert 明细已由 M30 升级为页面内结果列表；后续继续补跨任务证据对比和 artifact / review 证据联动。

- [x] M27 串行：在 Console 审查队列补 waiting-for-input 筛选入口。
- [x] M27 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M27 Review 小结

已在 Console 审查队列中增加 `waiting_for_input` 任务列表，展示请求方和暂停原因，并支持点击定位到任务详情；恢复动作仍保留在任务详情页的 JSON `resumePayload` 表单中，避免队列入口误触发恢复。同步把 `ReviewQueue` 渲染职责拆为 `ReviewTaskList`、`ReviewBulkForm` 和内部状态 hook，降低继续演进审查工作台时的组件复杂度。

Review Gate：finished。Spec 符合度通过，本轮完成 waiting-for-input 队列筛选入口；安全检查通过，未新增写 API、secret、外部网络调用、mock 成功路径或静默 fallback；复杂度检查通过，`ReviewQueue.tsx` 197 行、`ReviewTaskList.tsx` 74 行、`ReviewBulkForm.tsx` 96 行，新增组件文件均低于 300 行，主入口只做状态和组件编排；Document-refresh: needed，原因：Console 审查队列可见能力变化，已同步 README、docs/README 和 TECH_DEBT。结论：通过。

验证已通过：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx src/__tests__/App.test.tsx`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：该批次记录的 HITL schema 表单和批量 merge 能力已由 M31 / M28 / M30 补齐；后续主要剩余复杂 schema 字段类型和跨任务证据联动。

- [x] M26 串行：接通 worker 主动 HITL interrupt 与 resume payload 消费。
- [x] M26 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M26 Review 小结

已把 HITL 从控制面手动 interrupt/resume 扩展到 worker 主动暂停主链：通用 worker result 可携带 `waitingForInput`，dispatcher 会归一化请求者和原因，checkpoint active attempt，释放 worker / leases，并把任务推进到 `waiting_for_input`；worker result body 校验和 `@forgeflow/worker-protocol` schema 已同步。Console 任务详情在 `waiting_for_input` 状态展示请求来源、原因、时间，并可提交 JSON `resumePayload` 到既有 resume API；beta runtime 会把 resume payload 写入 `.orchestrator/assignments/<task>/assignment.json`，供下一轮 worker 进程消费。

Review Gate：finished。Spec 符合度通过，本轮完成 worker 主动 HITL interrupt、Console resume payload 操作和 runtime assignment package 消费；安全检查通过，未新增 secret、外部网络调用、mock 成功路径或静默 fallback，HTTP 输入继续做类型校验，Console resume payload 必须是 JSON object；复杂度检查通过，`App.tsx` 296 行、`TaskHitlSection.tsx` 74 行、`taskActions.ts` 38 行，新增函数均低于 50 行，既有超大 `runtime-state.ts` 未扩大职责边界；Document-refresh: needed，原因：worker result、HITL resume 和 Console 行为发生变化，已同步 README、docs/README、API endpoints、Worker Protocol 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server.test.ts tests/modules/server/runtime-state.test.ts`（默认沙箱因既有 auth middleware `listen EPERM 127.0.0.1` 超时后，按同命令非沙箱重跑通过，133 tests passed）、`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx src/__tests__/App.test.tsx`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core test`、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`、非沙箱 `CI=true pnpm test`。

剩余风险：该批次记录的 waiting-for-input 队列筛选和 schema 驱动表单已由 M27 / M31 补齐；后续主要剩余复杂 schema 字段类型和自定义校验文案。

- [x] M25 串行：下沉 worker-daemon live executor 到 beta-runtime-core。
- [x] M25 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M25 Review 小结

已新增 `packages/beta-runtime-core/src/runtime/task-processor.ts:executeLiveWorkerTask`，把 worktree prepare/reset、assignment package materialize、child worker execution、changed files collection、commit/push、显式 opt-in PR 创建和 cleanup lifecycle 收敛到共享 runtime core；`scripts/lib/worker-daemon.ts` 改为动态加载 beta-runtime-core dist 并委托该 executor。失败回写已在 M29 继续下沉，脚本侧当前只保留日志 / metrics callback 和本地 bootstrap。

Review Gate：finished。Spec 符合度通过，本轮完成 worker-daemon live executor 主体下沉，脚本侧不再保留 worktree / child worker / commit / push / PR / cleanup 重型实现；安全检查通过，未新增 secret、mock 成功路径或静默降级，PR 创建仍需显式 opt-in，分支安全校验迁移到共享 runtime core；复杂度检查通过，新增 runtime core 文件均低于 300 行，`executeLiveWorkerTask` 已拆分为 prepare / run / report / finalize / cleanup helper，脚本历史大文件从 1072 行降到 731 行但仍作为后续债务保留；Document-refresh: needed，原因：worker-daemon live executor 权威边界变化，已同步 README、docs/README 和 TECH_DEBT。结论：通过。

验证已通过：RED 阶段确认 `executeLiveWorkerTask` 缺失；GREEN 后通过 `CI=true pnpm --filter @tingrudeng/beta-runtime-core exec vitest run tests/worker-daemon.test.ts`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core test`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core typecheck`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core build`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/run-worker-daemon.test.ts tests/modules/server/worker-daemon-helpers.test.ts`、`CI=true pnpm exec tsc -p scripts/lib/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm docs:validate`、`git diff --check`、非沙箱 `CI=true pnpm test`。

剩余风险：该批次记录的失败 fallback result 已由 M29 下沉；脚本侧当前仍保留日志 / metrics callback 和 beta-runtime-core dist bootstrap。

- [x] M24 串行：补齐 Console 审查队列批量 rework / block。
- [x] M24 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M24 Review 小结

已新增 Console `ReviewQueue`，只聚合 `review` 状态任务，支持多选任务并批量提交共享 `reasonCode`、`mustFix[]`、`canRedrive` 和 `redriveStrategy` 的 `rework` / `block` 决策；App 侧复用单任务 review decision API 路径，避免批量提交和单任务提交语义漂移。已同步 README、docs/README 和 TECH_DEBT，将剩余 Console 产品化风险收窄为批量 merge 风险确认、跨任务对比和批量结果明细。

Review Gate：finished。Spec 符合度通过，本轮完成 Console 审查工作台产品化中的批量 `rework` / `block`；安全检查通过，未新增 secret、mock 成功路径或静默降级，批量提交继续调用既有 review decision API，taskId 使用 `encodeURIComponent`；复杂度检查通过，`App.tsx` 292 行、`ReviewQueue.tsx` 230 行，新 helper 文件均低于 50 行；Document-refresh: needed，原因：Console 批量审查能力和剩余技术债边界变化，已同步 README、docs/README 与 TECH_DEBT。结论：通过。

验证已通过：RED 阶段确认 `ReviewQueue` 缺失导致 Console 测试失败；GREEN 后通过 `CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter console test`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：该批次记录的批量 merge 与逐项失败明细已由 M28 / M30 补齐；后续继续补跨任务证据对比，避免高风险合并缺少上下文。

- [x] M23 串行：补齐 Console artifact 下载和跨任务筛选工作台。
- [x] M23 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M23 Review 小结

已把 Console artifact 体验从单任务 refs 展开推进到审查工作台：`ArtifactSummary` 支持读取真实 artifact file API 的 `content` 字段并下载 manifest 文件；新增 `ArtifactWorkbench`，支持按任务、仓库、摘要、文件和 ref 跨任务筛选 artifact bundle，并可点击跳转到对应任务详情。

Review Gate：finished。Spec 符合度通过，本轮补齐 Console 审查工作台产品化中的下载和跨任务筛选；安全检查通过，下载只读取既有 `/api/artifacts/:bundleId/files/:fileName` API，仍使用 `encodeURIComponent`，未新增外部网络或路径拼接入口；复杂度检查通过，新组件职责单一且低于 300 行；Document-refresh: needed，原因：Console artifact 能力和技术债状态变化，已同步 `docs/TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：Console 仍未提供跨任务批量审查动作、批量 reason code / must-fix 编辑和批量提交决策。

- [x] M22 串行：补齐 production cutover primary backend readiness gate。
- [x] M22 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M22 Review 小结

已把 `pnpm verify:shadow-cutover` 升级为生产 cutover 预检：除要求 shadow 已配置且零 drift 外，还要求 `RUNTIME_STATE_BACKEND=postgres` 与 `DISPATCHER_PRIMARY_POSTGRES_URL` 已配置；`check-shadow-drift.mjs` 新增 `--require-primary-backend` 和 `primaryBackend` 输出，`DISPATCHER_SHADOW_MODE=primary` 继续保留为明确拒绝的旧 shadow mode，避免误当主存储开关。

Review Gate：finished。Spec 符合度通过，本轮把 cutover gate 从 shadow-only 扩展为 shadow + primary backend 双门禁；安全检查通过，未新增 secret 或隐式切主；复杂度检查局部通过，新增逻辑集中在 `check-shadow-drift.mjs`，测试覆盖 primary backend 未选择与已配置两条路径；Document-refresh: needed，原因：production cutover 预检语义变化，已同步 README、API endpoints、runtime-state query 契约、Stage 3 runbook 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts`、`env CI=true RUNTIME_STATE_BACKEND=postgres DISPATCHER_PRIMARY_POSTGRES_URL=postgres://example.invalid/forgeflow DISPATCHER_SHADOW_MODE=disabled DISPATCHER_QUEUE_SHADOW_MODE=disabled DISPATCHER_POSTGRES_URL= node scripts/check-shadow-drift.mjs .forgeflow-dispatcher --require-primary-backend`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：该预检验证配置与 drift 条件，不替代真实生产 Postgres 连通性、备份恢复、RTO/RPO、DNS/进程切换和回滚演练。

- [x] M21 串行：补齐 `/api/query/*` Postgres primary snapshot reads。
- [x] M21 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M21 Review 小结

已补齐 `/api/query/*` 在 `RUNTIME_STATE_BACKEND=postgres` 下的读取路径：`runtime-state-query-store` 新增 async facade，SQLite backend 继续走现有 structured projection，Postgres backend 读取 primary snapshot；dispatcher 的 dashboard/context/metrics/slo/leases/query/projection-health 结构化读取路径统一 await async facade。

Review Gate：finished。Spec 符合度通过，本轮把剩余 query endpoint 从 SQLite-only 收敛为 backend-aware async path；安全检查通过，未新增 secret、隐式切主或静默 fallback，缺少 `DISPATCHER_PRIMARY_POSTGRES_URL` 仍由 Postgres state backend 显式失败；复杂度检查局部通过，新增逻辑集中在 query facade 和 dispatcher route await 调用，新增测试低于 300 行；Document-refresh: needed，原因：`/api/query/*` Postgres backend 能力和剩余 cutover 边界变化，已同步 README、runtime-state query 契约、Stage 3 runbook 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher build`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server-postgres.test.ts tests/modules/server/runtime-state-postgres.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server.test.ts`（默认沙箱因 `listen EPERM 127.0.0.1` 超时后，按同命令非沙箱重跑通过，65 tests passed）、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：完整 production primary-store cutover 还需要生产阈值演练、外部存储运维确认，并重新评估 `DISPATCHER_SHADOW_MODE=primary` 的硬拒绝门禁是否切换为正式开关。

- [x] M20 串行：补齐 dispatcher HTTP route 主链 async Postgres state path。
- [x] M20 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M20 Review 小结

已补齐 dispatcher HTTP route 主链 async Postgres state path：`handleDispatcherHttpRequest()` 升级为 async，`withStateAsync()` 使用 `loadRuntimeStateAsync()` / `saveRuntimeStateAsync()`；`startDispatcherServer()`、state-dir worker client、review decision client 和 runtime glue 都会 await handler，`--persistence-backend postgres` 可设置 `RUNTIME_STATE_BACKEND=postgres`。在 postgres backend 下，route mutation 会通过 `DISPATCHER_PRIMARY_POSTGRES_URL` 和 `@forgeflow/dispatcher-store-postgres` 的 primary snapshot 原语持久化；同步 `loadRuntimeState()` / `saveRuntimeState()` 仍显式失败，避免误用同步路径。

Review Gate：finished。Spec 符合度通过，本轮把 Postgres primary 从 runtime-state async API 推进到 dispatcher HTTP route 主链，并同步修复 async handler 对 state-dir 直连客户端的兼容问题；安全检查通过，未新增 secret、隐式切主或静默 fallback，缺少 `DISPATCHER_PRIMARY_POSTGRES_URL` 会显式失败；复杂度检查局部通过，新增 route-level Postgres 测试低于 300 行，`dispatcher-server.ts` 是既有超大文件，本轮只做必要桥接；Document-refresh: needed，原因：HTTP route 主链 Postgres backend 能力和剩余 structured query cutover 边界变化，已同步 README、runtime-state query 契约、Stage 3 runbook 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher build`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server-postgres.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-server.test.ts tests/modules/server/runtime-state-postgres.test.ts`（默认沙箱因 `listen EPERM 127.0.0.1` 超时后，按同命令非沙箱重跑通过，69 tests passed）、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/run-dispatcher-server.test.ts tests/modules/server/runtime-glue.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/submit-review-decision.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher-store-postgres test`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：`/api/query/*` structured read endpoints 仍绑定 SQLite structured projection；完整 production primary-store cutover 还需要 Postgres structured query projection 和生产阈值演练。

- [x] M19 串行：补齐 Postgres primary runtime-state snapshot 包级原语。
- [x] M19 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M19 Review 小结

已在 `@forgeflow/dispatcher-store-postgres` 增加 Postgres primary runtime-state snapshot 原语：`ensurePrimaryRuntimeStateTables()` 创建 `dispatcher_runtime_state` 单行 JSONB snapshot 表，`savePrimaryRuntimeStateSnapshot()` 支持 upsert 当前 runtime state，`loadPrimaryRuntimeStateSnapshot()` 支持读取最新 truth snapshot。该能力目前是包级原语，不改变 dispatcher 默认 SQLite 主链。

Review Gate：finished。Spec 符合度通过，本轮向真实 production cutover 推进了 Postgres primary store 底层读写能力；安全检查通过，未新增 secret、网络副作用或隐式切主，调用方必须显式传入 `PgClientLike`；复杂度检查通过，`packages/dispatcher-store-postgres/src/index.ts` 104 行、测试 74 行；Document-refresh: needed，原因：Postgres primary snapshot 原语状态和剩余 cutover 边界变化，已同步 runtime-state query 契约、Stage 3 runbook 和技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher-store-postgres test`、`CI=true pnpm --filter @forgeflow/dispatcher-store-postgres typecheck`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：dispatcher 主链仍是同步 `RuntimeStateStore` 接口，尚未接入异步 Postgres primary state path；真实 production cutover 仍未完成。

- [x] M18 串行：补齐 primary cutover 硬门禁，拒绝未实现的 `DISPATCHER_SHADOW_MODE=primary`。
- [x] M18 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M18 Review 小结

已补齐 primary cutover 硬门禁：`DISPATCHER_SHADOW_MODE=primary` 在当前没有 Postgres-backed primary `RuntimeStateStore` 时会被明确拒绝为 `primary_store_not_implemented`；shadow health / drift 会输出 `primary_unsupported`，`verify:shadow-cutover` 不会把 primary 模式误判为可切换。同步把 `runtime-state-shadow.ts` 拆分为 `runtime-state-shadow-drift.ts` 与 `runtime-state-shadow-snapshot.ts`，保留原模块导出路径，降低主文件职责和行数。

Review Gate：finished。Spec 符合度通过，本轮没有把 production cutover 伪装成已支持，而是补齐误启用 primary 的硬失败边界；安全检查通过，未新增 secret、外部写副作用或静默 fallback，primary 模式会显式失败；复杂度检查通过，`runtime-state-shadow.ts` 降至 213 行，新增 drift / snapshot 文件均低于 300 行；Document-refresh: needed，原因：primary 模式语义、cutover gate 失败原因和技术债边界发生变化，已同步 runtime-state query 契约、Stage 3 runbook、API 文档与技术债。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state-shadow-health.test.ts tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：真实 production primary-store cutover 仍未完成；下一步必须实现 Postgres-backed `RuntimeStateStore` 的 load/save truth source 或明确把目标收口为 shadow-only rollout。

- [x] M17 串行：补齐 shadow 自动 reconciliation cadence 入口和 production cutover 预检。
- [x] M17 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M17 Review 小结

已为 shadow drift gate 增加显式自动 reconciliation cadence 和生产 cutover 预检：`check-shadow-drift.mjs` 支持 `DISPATCHER_SHADOW_DRIFT_AUTO_RECONCILE=1`、`DISPATCHER_SHADOW_DRIFT_RECORD_ALERT=1`、`DISPATCHER_SHADOW_DRIFT_REQUIRE_CONFIGURED=1`，并新增 `cutover` 输出；`pnpm verify:shadow-drift:reconcile` 会显式执行 `--reconcile --record-alert`，`pnpm verify:shadow-cutover` 会要求 shadow 已配置且 `--max-mismatches 0 --max-delta 0` 通过。默认 `pnpm verify:shadow-drift` 仍保持只读 gate，不自动写运行时状态。

Review Gate：finished。Spec 符合度通过，补齐自动对账入口和 cutover 前置门禁；安全检查通过，默认路径无副作用，写入 runtime event 仍必须显式 `--record-alert` 或 env opt-in；复杂度检查通过，`check-shadow-drift.mjs` 191 行，新增 helper 均短函数；Document-refresh: needed，原因：operator 命令、环境变量、cutover 预检语义和技术债状态发生变化，已同步 `API_ENDPOINTS.md`、Stage 3 runbook、`README.md` 与 `TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/execution/workflows.test.ts`、`CI=true pnpm verify:shadow-drift`、`CI=true pnpm verify:shadow-drift:reconcile`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。`pnpm verify:shadow-cutover` 在当前未配置 shadow 的本地环境中按设计会失败，该失败语义已由 `fails cutover readiness when shadow is not configured` 测试覆盖。

剩余风险：本轮提供的是显式自动对账入口和 cutover 预检，不等于实际把 Postgres / queue 切为 primary；真正 primary-store 切换仍需要生产阈值演练、外部存储运维确认和回滚流程。

- [x] M16 串行：补齐 Console artifact refs 复制和按需文件展开。
- [x] M16 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M16 Review 小结

已把 Console artifact 展示从 `TaskTimeline.tsx` 拆分到 `ArtifactSummary.tsx`，让 `TaskTimeline.tsx` 保持 attempt timeline / runtime events 职责；refs tab 现在支持复制 `artifact://...` 引用，并通过 `/api/artifacts/:bundleId/files/:fileName` 按需展开 manifest 登记文件正文。同步补充 Console i18n、列表详情测试和 artifact 文档事实。

Review Gate：finished。Spec 符合度通过，完成本轮 Console artifact refs 复制和按需文件展开；安全检查通过，读取路径只使用既有 dispatcher artifact 文件 API，前端对 artifact ref 做 `artifact://<bundleId>/<fileName>` 解析并对路径片段使用 `encodeURIComponent`，未新增 secret、外部网络副作用或静默成功路径；复杂度检查通过，新增 `ArtifactSummary.tsx` 291 行、`TaskTimeline.tsx` 105 行，核心交互已拆成 `ArtifactRefRow`、`readArtifactRefFile` 等 helper；Document-refresh: needed，原因：Console artifact refs 行为从只展示变为可复制和按需展开，已同步 `README.md`、`ARTIFACT_BUNDLE_V1.md` 与 `TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：本轮补齐的是单 task 详情侧 refs 文件展开和复制；下载按钮、跨任务 artifact 筛选、批量审查仍是 Console 审查工作台后续产品化项。

- [x] M15 串行：补齐 dispatcher 级 HITL interrupt/resume 基础协议。
- [x] M15 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M15 Review 小结

已新增 dispatcher 级 HITL interrupt/resume 基础协议：`waiting_for_input` 成为非终态 task / assignment 状态；`interruptTaskForInput()` 会把 `ready` / `assigned` / `in_progress` / `blocked` 任务暂停为 `waiting_for_input`，释放 worker 与 task resource leases，并把 active attempt 标记为 `checkpointed`；`resumeTaskFromInput()` 会保存 `resumePayload`，把任务恢复到 `ready`，并让下一次 claim 能拿到 resume payload。HTTP 新增 `POST /api/tasks/:taskId/interrupt` 与 `POST /api/tasks/:taskId/resume`；SQLite projection 保存 `waiting_for_input_json` 与 `resume_payload_json`；Console 状态 badge 和 i18n 已支持 `waiting_for_input`。

Review Gate：finished。Spec 符合度通过，覆盖 dispatcher 状态函数、HTTP API、SQLite roundtrip、状态枚举和 Console 状态展示；安全检查通过，未新增 secret、外部网络调用、路径访问或静默 fallback；复杂度检查通过，HITL 核心函数已拆分 helper，导出函数保持短流程；Document-refresh: needed，原因：任务状态机、HTTP API、SQLite projection 和技术债状态发生变化，已同步 `STATE_MACHINE.md`、`API_ENDPOINTS.md`、`DATABASE_SCHEMA.md`、`README.md` 与 `TECH_DEBT.md`。结论：通过。

验证已通过：RED 阶段确认 `interruptTaskForInput` 缺失、HTTP interrupt 路由返回 404；GREEN 后通过 `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts`（默认沙箱因既有 auth middleware listener 用例 `listen EPERM 127.0.0.1` 失败后，按同命令非沙箱重跑通过，152 tests passed）、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter @forgeflow/task-schema test`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：本轮实现 dispatcher 级统一状态和 API；worker runtime 尚未主动发起 interrupt，也没有 Console 表单化输入 / resume payload 编辑体验，后续需要继续把 worker 主动暂停和 UI 操作接入这条主链。

- [x] M14 串行：补齐结构化可回放 trajectory schema、持久化和 Console 展示。
- [x] M14 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M14 Review 小结

已把 ArtifactBundle 的 trajectory 从可选 refs / retainedContent 字符串提升为结构化 `artifact-trajectory/v1` 字段，step 支持 `sequence`、`phase`、`action`、`observation`、`status`、`command`、`exitCode` 和 `artifactRef`。`packages/result-contracts` 与 `packages/worker-protocol` 已同步 schema；dispatcher 在 worker 未显式提交 trajectory 时，会根据 verification commands 生成默认可回放步骤；artifact store 会把结构化 trajectory 写入 `trajectory.json` 并更新 refs；SQLite projection 新增 `trajectory_json` roundtrip；Console 任务详情新增“轨迹 / Trajectory”tab，按步骤展示 action、observation、status 和命令证据。

Review Gate：finished。Spec 符合度通过，覆盖了结构化 schema、持久化、默认生成和 Console 展示；安全检查通过，未新增 secret、外部网络调用、路径穿越入口或静默 fallback；复杂度检查通过，`TaskTimeline.tsx` 仍低于 300 行，新增 schema / artifact store 改动保持局部；Document-refresh: needed，原因：ArtifactBundle 字段、SQLite projection、Console 展示和 API 描述发生变化，已同步 `ARTIFACT_BUNDLE_V1.md`、`API_ENDPOINTS.md`、`DATABASE_SCHEMA.md`、`README.md` 与 `TECH_DEBT.md`。结论：通过。

验证已通过：RED 阶段确认 `@forgeflow/result-contracts`、`@forgeflow/worker-protocol`、dispatcher artifact / SQLite、Console 测试均失败；GREEN 后通过 `CI=true pnpm --filter @forgeflow/result-contracts test`、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/artifact-store.test.ts`、`CI=true pnpm --filter console exec vitest run src/components/__tests__/Lists.test.tsx`、`CI=true pnpm --filter @forgeflow/result-contracts typecheck`、`CI=true pnpm --filter @forgeflow/worker-protocol typecheck`、`CI=true pnpm --filter @forgeflow/dispatcher typecheck`、`CI=true pnpm --filter console build`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`CI=true pnpm typecheck`、`git diff --check`。

剩余风险：本轮提供的是 attempt 级结构化可回放轨迹，默认生成来源是 verification commands；如果后续要达到完整 thought / action / observation 原始流，需要各 worker runtime 在执行过程中主动产出更细粒度 step。

- [x] M13 串行：下沉 `run-worker-assignment` 共享执行核心，减少 root / codex / gemini runtime 重复实现。
- [x] M13 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M13 Review 小结

已把 root `scripts/run-worker-assignment.ts`、`@tingrudeng/codex-beta-runtime` 和 `@tingrudeng/gemini-beta-runtime` 的 assignment 执行重复实现下沉到 `packages/beta-runtime-core/src/runtime/run-worker-assignment.ts`、`run-worker-assignment-cli.ts` 与 `run-worker-assignment-types.ts`。共享核心现在统一负责 prompt 拼接、assignment 读取、verification shell / nvm 包装、执行 timeout、workspace dependency symlink、worker-result / raw output / verification 文件写入；root 脚本只保留 dispatcher runtime factory bootstrap，Codex/Gemini 包只保留 provider CLI launch wrapper。新增共享 runner 测试覆盖 dry-run 与真实 launch / verification / result 写入，provider wrapper 测试锁定 Codex/Gemini launch argv。

Review Gate：finished。Spec 符合度通过，完成本轮 runtime executor / launch 去重的第一批可合并改动；安全检查通过，未新增 secret、凭据硬编码、网络副作用或无依据静默 fallback；复杂度检查通过，拆分后新增/修改的 runner 文件均低于 300 行；Document-refresh: needed，原因：worker runtime 去重状态发生变化，已同步 `docs/TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter @tingrudeng/beta-runtime-core test`、`CI=true pnpm --filter @tingrudeng/beta-runtime-core typecheck`、`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test`、`CI=true pnpm --filter @tingrudeng/codex-beta-runtime typecheck`、`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test`、`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime typecheck`、`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/run-worker-assignment.test.ts`、`CI=true pnpm exec tsc -p scripts/tsconfig.json`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`CI=true pnpm typecheck`、`git diff --check`。

剩余风险：该批次记录的是当时状态；后续 M25 已下沉 live executor，M29 已下沉失败回写。脚本侧当前仍保留日志 / metrics callback 和 beta-runtime-core dist bootstrap。

- [x] M12 串行：补齐 task-level terminationPolicy timeout 字段的运行时接入。
- [x] M12 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M12 Review 小结

已补齐 task-level `terminationPolicy` timeout 字段的运行时接入：`attemptLeaseTimeoutMs` 会决定 claim / reuse attempt 时的 `leaseExpiresAt`；`heartbeatTimeoutMs` 会在该 task 的 running attempt 过期恢复链路中覆盖 worker offline 判定；`assignmentTimeoutMs` 会在未 claim 的 assigned task 回收中覆盖全局 assignment timeout。未配置 task-level 字段时仍保留原有全局参数和默认值。

本轮按 TDD 执行：先新增 3 个 RED 测试并确认失败，失败分别指向默认 5 分钟 attempt lease、默认 heartbeat timeout 和未使用 task-level assignment timeout；再实现最小逻辑并确认 GREEN。Review Gate：finished。Spec 符合度通过；安全检查通过，未新增 secret、外部输入拼接、网络调用或静默 fallback；复杂度检查通过，改动集中在 timeout resolver 与调用点；Document-refresh: needed，原因：termination policy 的 timeout 字段从 schema-only 变为 runtime 生效，已同步 `TASK_ATTEMPT_MODEL.md` 和 `TECH_DEBT.md`。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts`、`CI=true pnpm --filter @forgeflow/dispatcher typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`git diff --check`。

剩余风险：本轮只补齐 dispatcher runtime-state 的 task-level timeout 主链；如果未来要把同一策略暴露到外部 SDK 文档或 Console 表单，还需要单独做 API / UI 层体验设计。

- [x] M11 串行：批次一，收敛 worker runtime 重复实现，优先统一 daemon cycle 与可发布 runtime 的核心行为。
- [x] M11 串行：批次二，补齐 trajectory artifact 协议、落盘与读取体验。
- [x] M11 串行：批次三，统一 HITL interrupt / resume 与 termination policy。
- [x] M11 串行：批次四，完善 shadow / DR 产品化门禁与 Console 审查工作台体验。
- [x] M11 串行：运行最小充分验证、Review Gate 并补充 review 小结。

## M11 Review 小结

已按四个批次完成本轮深度审查后的收敛优化：worker daemon 脚本侧主循环改为复用 dispatcher runtime-glue 的 `runWorkerDaemonCycle`，脚本侧只保留真实 worktree / worker 执行器与失败结果 fallback，并删除旧 `processTaskAssignment` 重复主循环；ArtifactBundle 协议、worker-protocol、artifact store、Console retained content 与文档已补齐 `trajectory` 引用和 retained 正文落盘；task schema、runtime-state 和 SQLite projection 已支持 task-level `terminationPolicy.maxAttempts`，并在 reconcile 过期 attempt 时优先使用任务级终止策略；shadow drift gate 已支持 `DISPATCHER_SHADOW_DRIFT_MAX_MISMATCHES` 与 `DISPATCHER_SHADOW_DRIFT_MAX_DELTA` 环境变量，runbook / API 文档同步到 release / rollout gate 用法。

Review Gate：finished。Spec 符合度通过，四个已确认批次均有代码、测试与文档落点；安全检查通过，未新增真实 secret、凭据硬编码或无依据静默降级，新增 shadow drift 环境变量会校验为非负数；复杂度检查通过，本轮未引入新的跨模块大重构，脚本侧还删除了旧重复函数；Document-refresh: needed，原因：协议、artifact、termination policy、shadow gate 行为发生变化，已同步对应契约、runbook 和技术债文档。结论：通过。

验证已通过：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-glue.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/artifact-store.test.ts tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/execution/shadow-drift.test.ts`、`CI=true pnpm --filter @forgeflow/result-contracts test`、`CI=true pnpm --filter @forgeflow/worker-protocol test`、`CI=true pnpm --filter @forgeflow/task-schema test`、`CI=true pnpm --filter console build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm docs:validate`、`python3 -m py_compile scripts/validate_docs.py`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check`。全量 `CI=true pnpm test` 在默认沙箱下先因 `listen EPERM 127.0.0.1` 与写入 `~/.forgeflow-trae-beta` 权限受限失败；按同一命令在非沙箱环境重跑后通过，覆盖 24 个 workspace project，其中 dispatcher 43 个测试文件 / 461 个测试全部通过。

剩余风险：task-level termination policy 当前只实际接入 `maxAttempts`，`attemptLeaseTimeoutMs`、`heartbeatTimeoutMs`、`assignmentTimeoutMs` 已进入 schema 但尚未接入对应超时调度逻辑；M83 已把 generic worker daemon 主循环进一步收敛为 beta-runtime-core shared cycle；shadow drift env gate 是 release / rollout 可配置阈值，不等于后台自动 reconciliation。

- [x] M10 串行：修复 `@tingrudeng/codex-beta-runtime` / `@tingrudeng/gemini-beta-runtime` 与 dispatcher v1 claim/envelope/token 协议漂移，并补协议测试。
- [x] M10 串行：修复 `runtime-glue-dispatcher-client` 的 worker cycle envelope 类型与测试，避免旧 payload 被测试固化。
- [x] M10 串行：收紧 release 自动发布门禁，避免 push 到 main 后绕过 CI 直接发布 npm 包。
- [x] M10 串行：补齐 Console 审查结构化表单、风险确认、错误反馈和 token 配置文档。
- [x] M10 串行：同步已过期文档事实，运行最小充分验证并补充 review 小结。

## M10 Review 小结

已修复远程 `@tingrudeng/codex-beta-runtime` / `@tingrudeng/gemini-beta-runtime` 与 dispatcher v1 worker 协议漂移：worker daemon 现在通过 `POST /api/workers/:workerId/claim-task` 领取任务，带 `DISPATCHER_API_TOKEN` 时发送 bearer token，并把 dispatcher 返回的 `attemptId`、`leaseToken`、`protocolVersion`、`traceId`、`idempotencyKey` 透传到 start/result mutation。同步修复 `runtime-glue-dispatcher-client` 的 worker cycle envelope，避免源码测试继续固化旧 payload。

已收紧 release 自动发布门禁：`.github/workflows/release.yml` 的 push 自动发布在 `npm publish` 前先执行 lint、文档校验、typecheck、测试和 shadow drift gate，并用 workflow 测试锁定顺序。Console 任务详情补齐结构化审查表单、风险确认、review decision 错误反馈和 token 配置文档；相关文档入口已同步到 `README.md`、`docs/README.md`、`docs/onboarding.md`、runtime 包 README、`TECH_DEBT.md`、`KNOWN_PITFALLS.md` 和 `ARTIFACT_BUNDLE_V1.md`。

验证已通过：`pnpm docs:validate`、`python3 scripts/validate_docs.py . --profile generic`、`git diff --check`、runtime / dispatcher 受影响 Vitest、Console 受影响 Vitest，以及 `tsc --noEmit` 覆盖 codex runtime、gemini runtime、dispatcher 和 Console。`pnpm docs:validate` 初次因 pnpm 依赖状态检查在受限网络下触发 registry 访问被中止；恢复依赖后已重新通过。

剩余风险：本轮未跑全量 `pnpm test` / `pnpm typecheck`，只跑了受影响测试和受影响包类型检查；release workflow 的全量门禁需要在 GitHub Actions 上由真实 CI 环境最终验证。

- [x] M9 串行：第 1 轮 Artifact store + retention，支持 artifact 文件落盘、索引、保留策略和按需读取。
- [x] M9 串行：第 2 轮 shadow reconciliation + alerting，定义 drift 阈值、告警事件和自动对账入口。
- [x] M9 串行：第 3 轮 Console review workflow，打通 artifact / attempt / review decision 的审查操作链路。
- [x] M9 串行：第 4 轮移除 v0 / 空 envelope 兼容路径，保留可审计迁移边界。
- [x] M9 串行：第 5 轮生产级 DR 多场景 drill，覆盖 host failure、磁盘损坏和多节点恢复验收。
- [x] M9 串行：第 6 轮 Worker SDK / 第三方准入，稳定 worker 接入 API、provider capability 和准入门禁。

## M9 第 1 轮 Review 小结

已新增 dispatcher 本地 artifact store：worker v1 result 与 Trae submit-result 成功记录 ArtifactBundle 后，会把 `retainedContent.diff`、`retainedContent.logs`、`retainedContent.testResults` 写入 `${stateDir}/artifacts/<bundle-dir>/`，生成 `manifest.json` 索引，并把 bundle refs 更新为 `artifact://<bundleId>/<fileName>`。新增 `/api/artifacts/:bundleId/files/:fileName` 按需读取 manifest 登记文件，拒绝路径穿越；CLI `artifact-get --file <name>` 支持 dispatcher URL 与本地 state-dir 两种读取模式。保留策略通过 `DISPATCHER_ARTIFACT_RETENTION_MAX_BUNDLES` 控制，默认保留 100 个 bundle。

验证已通过：Artifact store 单测先因模块缺失失败后通过；worker v1 artifact HTTP 集成测试先因 refs 未更新失败后通过；Trae submit-result artifact 测试先因 refs 未更新失败后通过；CLI `artifact-get --file` 注入测试先失败后通过；`tests/artifact.test.ts`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：artifact store 当前是 dispatcher stateDir 下的本地文件 store，不是远端对象存储；Console 仍展示 retainedContent tabs，按需文件展开 / 下载体验留到第 3 轮 Console review workflow 处理。

## M9 第 2 轮 Review 小结

已为 shadow drift 增加阈值化告警和 operator 对账入口：`evaluateRuntimeStateShadowDriftAlert` 会根据 mismatch 数量和绝对 delta 输出 `none` / `warning` / `critical`；`scripts/check-shadow-drift.mjs` 支持 `--max-mismatches`、`--max-delta`、`--reconcile` 和 `--record-alert`。默认 `pnpm verify:shadow-drift` / release gate 仍只读无副作用；operator 显式使用 `--reconcile` 时会把当前 SQLite truth 重放到 shadow projection / queue 后复查；显式使用 `--record-alert` 时会写入 `shadow_drift_detected` system event。

验证已通过：shadow alert RED 测试先因函数缺失失败后通过；shadow drift 脚本 RED 测试先因 usage 拒绝新参数失败后通过；`runtime-state-shadow-health.test.ts`、`shadow-drift.test.ts`、`workflows.test.ts`、`pnpm docs:validate`、`pnpm lint`、`pnpm typecheck`、`git diff --check` 均通过。

剩余风险：自动对账当前是 operator 显式命令，不是后台定时任务；`--record-alert` 是显式写事件入口，默认 release gate 不写 runtime-state，避免 CI/release gate 产生隐式状态副作用。

## M9 第 3 轮 Review 小结

已打通 Console review workflow 最小闭环：任务详情页保留 attempt timeline、runtime events、artifact summary / refs / retained content，并在任务处于 `review` 状态时提供 `merge` / `rework` / `block` 审查按钮。App 会将决策提交到 `/api/reviews/:taskId/decision`，写入 actor、notes、时间戳并刷新 dashboard snapshot。

验证已通过：Console RED 测试先因缺少合并按钮和 App 提交链路失败后通过；`pnpm --filter console exec vitest run`、`pnpm --filter console build`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：Console 当前提交固定 notes 和 actor，不提供 reason code / must-fix 表单；artifact 文件 API 已可按需读取，但 Console 侧 refs 仍以展示为主，文件展开 / 下载体验后续可继续细化。

## M9 第 4 轮 Review 小结

已移除 dispatcher worker mutation 的 v0 / 空 envelope 兼容路径：claim 后的通用 worker start/result、Trae start/result 都必须携带 `attemptId`、`leaseToken`、`protocolVersion`、`traceId` 和 `idempotencyKey`，缺字段、无 active attempt 或 stale attempt 写入都会被拒绝。同步把旧测试夹具改为先 claim/start 再提交 result，并把 Worker Protocol、Task Attempt、API 和技术债文档里的旧兼容表述改为当前事实。

验证已通过：新增/调整的 RED 测试先暴露空 envelope 仍可被旧夹具绕过，修复后 `pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts tests/modules/server/runtime-dispatcher-server.test.ts`、`pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/clients.test.ts tests/runtime/worker.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：独立 progress mutation 仍未升级为 attempt 级 v1 endpoint；Worker Protocol package 的目标 schema 仍未成为 dispatcher HTTP route 的唯一请求解析入口。

## M9 第 5 轮 Review 小结

已把 live dispatcher DR drill 扩展为多场景验收：`scripts/verify-live-dispatcher-dr.mjs` 现在会在 live HTTP 写入期间备份，恢复前主动破坏当前 SQLite runtime 文件，校验磁盘损坏后可从备份恢复；同时通过 `SIGKILL` 子进程模拟 host / 进程丢失并在替换 stateDir 拉起 dispatcher；还会把同一备份恢复到两个独立 stateDir，启动两个 dispatcher 并校验 task / event 计数一致。同步修正旧 dist/bridge 测试夹具，使其遵守第 4 轮完整 v1 envelope 主链。

验证已通过：RED 测试先失败于 `hostFailure` 输出缺失；修复后 `pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/stage3-live-dr.test.ts`、`node scripts/verify-live-dispatcher-dr.mjs`、`pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/dispatcher-state.test.ts tests/modules/server/submit-review-decision.test.ts`、`pnpm verify:stage3`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：当前多节点恢复是本地双 stateDir 一致性验收，不等同真实跨主机 quorum / fencing / DNS 切流演练；物理断电仍需生产环境 runbook 单独覆盖。

## M9 第 6 轮 Review 小结

已落地内部 Worker SDK / 第三方准入最小闭环：`@forgeflow/worker-protocol` 新增 `WorkerSdkStartPayloadSchema`、`WorkerSdkResultPayloadSchema`、`buildWorkerStartPayload` 和 `buildWorkerResultPayload`，用于 worker adapter 复用完整 v1 envelope 构造 start/result payload；`@forgeflow/provider-registry` 新增 `evaluateProviderAdmission`，已知 provider 按支持模式和权限键校验，未知第三方 provider 默认拒绝，只有白名单且声明 `worker-protocol-v1` 时才放行。同步更新 README、Worker Protocol、provider capability contract、Stage 3 runbook 和技术债文档。

验证已通过：RED 测试先失败于 helper / admission gate 缺失；修复后 `pnpm --filter @forgeflow/worker-protocol test`、`pnpm --filter @forgeflow/worker-protocol typecheck`、`pnpm --filter @forgeflow/provider-registry test`、`pnpm --filter @forgeflow/provider-registry typecheck`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 均通过。

剩余风险：当前 helper 是仓库内部 SDK 契约，不等于公网 npm SDK 长期兼容承诺；第三方 provider admission 仍是代码级白名单门禁，没有自助注册 / 撤销后台。

- [x] M8 串行：收尾 PR #112 后的本地分支和远端分支状态。
- [x] M8 串行：同步 read-only `/api` 写方法冻结的文档事实。
- [x] M8 串行：对齐 Trae automation gateway 双实现差异并补共享测试。
- [x] M8 串行：推进 repo / branch / session lease 强约束。
- [x] M8 串行：推进 v1 worker protocol 强制化和可配置 retry policy。
- [x] M8 串行：推进 ArtifactBundle retention 与 review workflow / Console artifact tabs。
- [x] M8 串行：把 shadow drift 巡检接入 release / rollout gate。
- [x] M8 串行：增强生产级 DR 演练覆盖。

## M8 Review 小结

已完成平台硬化 8 项：收尾旧 Trae 分支并建立新迭代分支；同步 read-only 文档事实；对齐 scripts/lib Trae gateway 的 metadata/debugLog/session 解析；把 task claim lease 扩展到 assignment / repo / branch / session；对 claim-backed start/result 强制完整 v1 envelope，并支持 `maxTaskAttempts` retry policy；ArtifactBundle 支持受限 retainedContent 并在 Console 提供摘要 / 引用 / 正文 tabs；`verify:stage3` 与 release workflow 接入 shadow drift gate；live DR drill 增加 SIGKILL crash/restart 恢复验证。

验证已通过：result-contracts、Console Lists、Trae gateway/session-store、runtime-state、runtime-state-sqlite、dispatcher-server、shadow-drift/workflows/stage3-live-dr、`pnpm test`、`pnpm verify:stage3`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check`。

剩余风险：read-only 仍只覆盖 dispatcher HTTP API 写方法；repo / branch / session lease 约束 dispatcher task 生命周期，不覆盖 dispatcher 外部直接操作；ArtifactBundle 仍没有完整 artifact store 与清理策略；shadow drift gate 不等于自动 reconciliation；DR drill 已覆盖 SIGKILL restart，但仍不是物理断电、磁盘损坏或多节点仲裁恢复演练。

- [x] M7 串行：对齐 scripts/lib Trae gateway 默认 session-store 路径到发布包路径。
- [x] M7 串行：补充路径契约测试并同步文档。
- [x] M7 串行：运行验证、Review Gate 并提交本地变更。

- [x] M6 串行：对齐 `scripts/lib` Trae gateway prepare-session 会话状态。
- [x] M6 串行：补充 source / packaged gateway parity 测试。
- [x] M6 串行：修正 Trae gateway 技术债事实并运行验证。
- [x] M6 串行：Review Gate 并提交本地变更。

- [x] M5 串行：手动发布 post-publish git record 失败时自动创建恢复 issue。
- [x] M5 串行：补充 workflow 测试和 release 文档。
- [x] M5 串行：运行验证、Review Gate 并提交本地变更。

- [x] M4 串行：新增 shadow drift operator check，比较 SQLite truth source 与 shadow projection / queue counts。
- [x] M4 串行：补充 drift summary 单测和 CLI 脚本测试。
- [x] M4 串行：同步 runbook、API / DB 文档和技术债边界。
- [x] M4 串行：运行验证、Review Gate 并提交本地变更。

- [x] M3 串行：新增 live dispatcher DR drill 脚本，覆盖真实 HTTP 写入期间的 SQLite/WAL 备份恢复。
- [x] M3 串行：补充脚本级测试和 `verify:stage3:live` 命令入口。
- [x] M3 串行：同步 DR runbook、技术债和 README 的演练边界。
- [x] M3 串行：运行验证、Review Gate 并提交本地变更。

- [x] 修复 dispatcher read-only 写冻结缺口，补齐真实写路由拦截，并避免只读 GET 在 read-only 下落盘。
- [x] 将 dispatcher POST 鉴权前置到 body 解析之前，并补充 worker register 结构化输入校验。
- [x] 让 shadow 写失败可观测，并把 shadow health 接入 DR 状态。
- [x] 将 DR drill 升级为真实 SQLite/WAL 备份恢复验证。
- [x] 将文档校验接入 CI，并修正手动发布版本不可追踪问题。
- [x] 运行最小充分验证并补充 review 小结。

## Review 小结

已修复 read-only 写冻结、POST 鉴权前置、worker register 输入校验、shadow 写失败可观测、真实 SQLite DR 演练、CI 文档门禁和手动发布版本落账问题。

验证已通过：`pnpm docs:validate`、`git diff --check`、受影响 dispatcher 测试、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm -r --if-present build`、`pnpm coverage:critical`。

剩余风险：非 assignment lease 仍只是结构与指标层能力，repo/branch/session 强约束需要后续单独设计；手动发布现在先 commit/tag/push 再 publish，若 npm publish 失败，git 历史中会保留未发布版本，需要按发布 runbook 人工处置。

# Goal 2：收窄 lease 为 assignment-only

- [x] 新增测试，锁定 dashboard active lease 指标只暴露 assignment 资源类型。
- [x] 将 lease 类型、聚合指标和 SQLite session 投影收窄到 assignment-only。
- [x] 同步更新 runtime-state query 契约、指标 runbook 和已知坑文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已将 dispatcher lease 模型收窄为 assignment-only：`LeaseResourceType` 只允许 `assignment`，dashboard `activeLeases.byResourceType` 只输出 assignment 计数，SQLite 结构化投影不再从 `session` lease 写入 `sessions` 表。已同步权威文档，明确 repo/branch/session 不是当前 lease 强约束能力。

验证已通过：新增测试先失败后通过，`pnpm --filter @forgeflow/dispatcher test tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm docs:validate`、`pnpm typecheck`、`pnpm lint`、`git diff --check`、`pnpm verify:stage3`。

剩余风险：历史 runtime snapshot 如果人工写入过非 assignment lease，当前变更不会为它们提供迁移语义；repo/branch/session 的真实强约束仍需后续按独立 Goal 设计。

# 成熟产品验收：read-only 硬冻结

- [x] 补充 RED 测试，证明 read-only 模式会拒绝未来新增或遗漏登记的 `/api` 写请求。
- [x] 将 read-only mutation 判断从手写路由列表收敛为默认拒绝 `/api` 写方法。
- [x] 同步 `API_ENDPOINTS`、Stage 3 runbook 和技术债文档，移除 read-only matcher 漂移风险。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已将 read-only 模式从手写写路由列表收敛为默认冻结 `/api` 下 `POST` / `PUT` / `PATCH` / `DELETE`，并新增未登记 `/api/future-write` 的回归测试，避免后续新增写路由遗漏 matcher 后绕过冻结。

验证已通过：RED 测试先返回 `404` 后修复为 `503 read_only_mode`；`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 全部通过。

剩余风险：read-only 只冻结 dispatcher HTTP API 写方法；直接修改运行时文件、外部数据库或操作系统层面的写入仍需由运维流程单独管控。

# 成熟产品验收：技术债事实同步

- [x] 对照真实代码核对 shadow status、Stage 3 DR drill 和 release workflow 的技术债描述。
- [x] 修正 `docs/TECH_DEBT.md` 中已过期或过度表述的债务项。
- [x] 修正 DR runbook 中对 `verify-stage3-dr` 的过期边界说明。
- [x] 运行文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已按真实代码修正技术债事实：shadow 写失败已经通过 `/api/dr/status` 暴露 in-memory 状态，但尚未持久化为运行时事件；`verify-stage3-dr` 已经创建真实 SQLite 并校验 integrity/checksum，但仍不是 live dispatcher WAL 压力演练；手动 release 已先 commit/tag/push 再 publish，剩余风险是 publish 失败后 git 版本领先 npm。

验证已通过：`pnpm docs:validate`、`git diff --check`。

剩余风险：本批只同步文档事实，不实现持久化 shadow failure event、live DR 压力演练或 release 失败自动恢复。

# 成熟产品验收：Trae attempt lease envelope

- [x] 补充 RED 测试，证明 Trae runtime start/result 会携带 dispatcher 返回的 `attempt_id` / `lease_token`。
- [x] 补充 RED 测试，证明 Trae dispatcher 路由会把 `attempt_id` / `lease_token` 传入状态机校验。
- [x] 修改 Trae runtime client 与 worker，传递 `attemptId` / `leaseToken`。
- [x] 修改 dispatcher Trae start/result 路由，透传 attempt lease 字段。
- [x] 同步 Worker Protocol / TaskAttempt / 技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已把 Trae 主链从“fetch 返回 attempt lease 但 runtime 不使用”推进到 start/result 回写携带并校验 `attempt_id` / `lease_token`。同时修复 `runtime-dispatcher-server.ts:overwriteRuntimeState` 漏复制 `taskAttempts` / `artifactBundles` 的状态覆盖缺口，以及 SQLite projection 重写时未清空 `artifact_bundles` 导致重复插入的缺口。

验证已通过：Trae runtime RED 测试先失败，dispatcher RED 测试先暴露 attempt 缺失与 stale lease 未校验；修复后 `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 全部通过。

剩余风险：Trae 仍使用 v0 兼容路由，尚未强制完整 v1 envelope 的 `protocolVersion`、`traceId` 和 `idempotencyKey`。

# 成熟产品验收：v1 worker envelope 最小闭环

- [x] 补充 RED 测试，证明 Trae runtime start/result 会携带 `protocol_version`、`trace_id` 和 `idempotency_key`。
- [x] 补充 RED 测试，证明 dispatcher Trae fetch-task 会返回完整 envelope，并拒绝 v1 envelope mismatch。
- [x] 实现 Trae runtime 与 dispatcher 之间的完整 envelope 透传和 active attempt 校验。
- [x] 同步 Worker Protocol / TaskAttempt / 技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成 Trae 主链 v1 envelope 最小闭环：`fetch-task` 返回 `protocol_version`、`trace_id`、`idempotency_key`，Trae runtime 在 start/result 回写时携带这些字段，dispatcher 对声明 v1 envelope 的 start/result 写入校验 active attempt 的协议版本、traceId 和 idempotencyKey。

验证已通过：RED 测试先失败于缺失完整 envelope 字段；修复后 `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 通过。

剩余风险：通用 v0 worker routes 仍保留空 envelope 兼容；跨请求 idempotency payload 冲突检测尚未实现。

# 成熟产品验收：shadow 写失败 durable health record

- [x] 补充 RED 测试，证明 shadow 写失败会落 `runtime-state-shadow-status.json`。
- [x] 实现 shadow 写状态文件持久化，并让 `/api/dr/status` 读取 stateDir 下的 durable record。
- [x] 保持 shadow 写失败不影响 SQLite 主链写入结果。
- [x] 同步 Stage 3 / DR runbook 和技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成 shadow 写状态 durable health record：shadow sync 成功、跳过或失败后写入 `runtime-state-shadow-status.json`，`/api/dr/status.shadowWrite` 合并读取 stateDir 下的记录，源码脚本与打包 dispatcher runtime 的 backup/restore 都会复制该文件。

验证已通过：RED 测试先失败于未生成 health record、DR status 未读取持久化记录，以及缺少 shadow health 选择逻辑；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/runtime-state-shadow-health.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm --filter @tingrudeng/forgeflow-dispatcher test -- tests/backup.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check`、`pnpm verify:stage3` 通过。

剩余风险：shadow failure 仍不是 `RuntimeState.events[]` 中的一等审计事件；shadow drift 自动对账和 primary cutover 仍需单独设计。

# 成熟产品验收：通用 worker v1 envelope 校验

- [x] 补 RED 测试，证明通用 worker start/result 声明 v1 envelope 时会校验 trace/idempotency mismatch。
- [x] 将通用 worker start/result 路由补齐 `protocolVersion`、`traceId`、`idempotencyKey` 传参。
- [x] 同步技术债和任务记录中该缺口状态。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成通用 worker v1 envelope 校验补齐：`/api/workers/:workerId/start-task` 和 `/api/workers/:workerId/result` 会把 `protocolVersion`、`traceId`、`idempotencyKey` 传入状态机，声明 v1 envelope 时必须与 active attempt 一致。空 envelope 的 v0 worker 兼容路径保持不变。

验证已通过：RED 测试先失败于错误 `traceId` 仍返回 200；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 通过。

剩余风险：跨请求 idempotency payload 指纹冲突检测尚未实现；空 envelope v0 worker 兼容路径仍保留，后续是否强制升级需要单独评估。

# 成熟产品验收：Stage 3 DR WAL 演练

- [x] 补 RED 测试，要求 DR 脚本输出 `walIncluded: true` 且恢复多条 snapshot。
- [x] 调整 DR 脚本，在打开的 WAL 连接上写入多轮 snapshot 后执行备份。
- [x] 同步 runbook 和技术债边界。
- [x] 运行受影响测试、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成 Stage 3 DR WAL 演练升级：`verify-stage3-dr` 会在打开的 WAL 连接上写入 4 条 snapshot，备份时确认包含 `runtime-state.db-wal`，恢复后校验 integrity、snapshot count、latest sequence 和 checksum。

验证已通过：RED 测试先失败于缺少 `walIncluded`；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/execution/stage3-dr.test.ts`、`node scripts/verify-stage3-dr.mjs`、`pnpm docs:validate`、`git diff --check`、`pnpm verify:stage3` 通过。

剩余风险：该脚本仍不是 live dispatcher 并发写入、锁竞争或崩溃恢复演练；生产级 DR drill 仍需单独设计。

# project-context-bootstrap 上下文文档升级

## 目标

使用 `project-context-bootstrap` 技能升级当前仓库上下文包，保留已有中文文档体系和 ForgeFlow 项目事实。

## 非目标

- 不生成 Android MVP profile 文档，因为仓库没有 Gradle 或 Android Manifest 信号。
- 不粗暴覆盖现有 `README.md`、架构、接口、数据库或 runbook 详情文档。
- 不新增工具专属适配文档。

## 当前事实

- 已存在 `AGENTS.md`、`docs/README.md`、`docs/AI_CONTEXT.md` 和 `scripts/validate_docs.py`，本次走 upgrade mode。
- 当前文档主体语言是中文，应继续使用简体中文。
- `package.json` 已提供 `docs:validate`、`test`、`typecheck`、`verify:stage2`、`verify:stage3`。
- 技能 canonical validator 要求 `--profile`、frontmatter `ai_summary`、`source_of_truth` 路径、具体 `verify_with` 命令和 legacy detail docs 边界。

## 决策日志

- 采用核心包原地升级方案，只升级上下文入口和校验器。
- 使用 `docs/README.md` 的 `## Legacy detail docs` 标记旧详情文档边界，避免把历史文档当作新契约文档强制改写。
- 校验器保持 canonical 行为，但跳过 `.git`、`node_modules`、`.worktrees` 等本地依赖或运行时目录，避免无关 Markdown 链接污染校验结果。

## 执行计划

- [x] 升级 `scripts/validate_docs.py`，支持 generic/android profile、frontmatter 摘要、legacy detail docs 和本地链接校验。
- [x] 升级 `docs/AI_CONTEXT.md` 为当前技能契约，同时保留 ForgeFlow 关键上下文。
- [x] 升级 `docs/README.md` 的元信息、阅读路径和 legacy detail docs 边界。
- [x] 升级 `AGENTS.md` 的上下文入口说明和验证命令。
- [x] 运行文档校验、Python 编译校验和 diff 检查，并修复发现的问题。
- [x] 使用 review-gate 做交付前审查并补充 Review 小结。

## 验证矩阵

- quick: `python3 -m py_compile scripts/validate_docs.py`
- quick: `python3 scripts/validate_docs.py . --profile generic`
- quick: `pnpm docs:validate`
- quick: `git diff --check`

## 进度记录

- [x] 已完成只读现状分析并获得用户确认。
- [x] 已完成核心包升级，未生成 Android MVP profile 文档。
- [x] 第一轮校验发现 legacy detail docs 解析误命中行内代码、历史 `docs/superpowers` 链接被扫描；已修复为按二级标题匹配 legacy 区域，并跳过历史目录。
- [x] 校验器文件已压缩到 300 行以内。

## 验证结果

- `python3 -m py_compile scripts/validate_docs.py` 通过。
- `python3 scripts/validate_docs.py . --profile generic` 通过。
- `pnpm docs:validate` 通过。
- `python3 scripts/validate_docs.py /Users/dengtingru/.agents/skills/project-context-bootstrap/examples/fixtures/android-client-context --profile android` 通过。
- `git diff --check` 通过。

## Review 小结

终态：finished。

Spec 符合度：通过。已升级核心上下文包：`AGENTS.md`、`docs/README.md`、`docs/AI_CONTEXT.md`、`scripts/validate_docs.py`。本次采用 upgrade mode，没有覆盖旧详情文档，而是在 `docs/README.md` 标明 legacy detail docs 边界，并用校验器保证核心上下文包、frontmatter、source_of_truth、verify_with 和本地链接可验证。

安全检查：通过。未新增 secret、凭据或网络调用；校验脚本只读取本地 Markdown 和路径。

测试与验证：通过。`python3 -m py_compile scripts/validate_docs.py`、`python3 scripts/validate_docs.py . --profile generic`、`pnpm docs:validate`、Android fixture profile 校验和 `git diff --check` 均通过。

复杂度检查：通过。`scripts/validate_docs.py` 为 299 行，所有函数均不超过 50 行；`docs/AI_CONTEXT.md` 为 107 行，未超过上下文预算。

Document-refresh: needed
原因：本次任务目标就是升级上下文文档体系，已同步 `AGENTS.md`、`docs/README.md` 和 `docs/AI_CONTEXT.md`。

## 二轮审查修复小结

- [x] 删除 `AGENTS.md` 内旧 fenced `ai_summary`，避免新 frontmatter 和旧摘要双头并存。
- [x] 将 `docs/README.md` 的 `Authority Map` 收敛为 `Detailed Doc Map`，明确 legacy detail docs 不能单独替代代码和验证命令。
- [x] 在 `docs/AI_CONTEXT.md` 增加非 Trae runtime / npm 包的读取路径，避免 Trae-first 被误读成只维护 Trae。
- [x] 升级 `scripts/validate_docs.py`，把 `AGENTS.md` 纳入 authority doc 校验，并拒绝重复 `ai_summary:`。

二轮验证已通过：`python3 scripts/validate_docs.py . --profile generic`、`pnpm docs:validate`、`python3 -m py_compile scripts/validate_docs.py`、`git diff --check`。

剩余风险：旧格式详情文档尚未逐份迁移到新 authority doc contract；本次通过 legacy 边界要求使用时回到代码和命令验证。

潜在技术债：后续如果要让所有稳定详情文档也进入新契约，需要逐份补 frontmatter、source_of_truth 和验证命令，不能批量套模板。

结论：通过。

# 2026-07-03 beta runtime 重复实现漂移门禁

## 目标

治理 Codex/Gemini packaged runtime 的重复实现风险。当前两个包的 `worker-daemon.ts` 和 `task-worktree.ts` 完全一致，`run-worker-assignment.ts` 因 Codex/Gemini CLI 参数不同不纳入一致性门禁。

## 执行计划

- [x] P1 串行：补 parity gate，要求两个 beta runtime 的共享 worker daemon / task worktree 源文件保持一致。
- [x] P2 串行：实现最小 parity 测试辅助函数。
- [x] P3 串行：运行 beta runtime 测试、typecheck、lint、docs 校验和 diff 检查。
- [x] P4 串行：执行 review-gate 并补充收尾小结。

## 并行说明

本轮不使用 subagent。改动集中在测试门禁与任务记录，串行处理可以避免误改发布结构。

## 验证结果

- `CI=true pnpm --filter @tingrudeng/codex-beta-runtime test`：通过，3 个测试文件 / 9 个测试。
- `CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test`：通过，2 个测试文件 / 8 个测试。
- `CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher test`：通过，43 个测试文件 / 456 个测试。
- `CI=true HOME=/private/tmp/forgeflow-test-home pnpm test`：通过，递归全量测试通过。
- `CI=true pnpm typecheck`：通过。
- `CI=true pnpm lint`：通过。
- `CI=true pnpm docs:validate`：通过。
- `git diff --check`：通过。

## Review-gate 小结

终态：finished

Spec 符合度：符合。新增 parity gate 覆盖 Codex/Gemini beta runtime 的共享 `worker-daemon.ts` 与 `task-worktree.ts`，没有把 provider CLI 差异文件纳入强一致。

安全检查：未新增 secret、外部输入处理或网络写入路径。

测试与验证：最小包测试、dispatcher 集成测试、全量测试、typecheck、lint、docs 校验和 diff 检查均已通过。

复杂度检查：新增测试辅助函数短小，dispatcher 测试脚本变更只显式绑定已有配置；未新增复杂分支。

Document-refresh: not-needed
原因：本轮只新增测试门禁和测试运行配置，不改变用户能力、协议或对外文档语义。

剩余风险：parity gate 阻止共享源文件单边漂移，但尚未把重复实现抽成真正共享发布模块。

潜在技术债：后续若要彻底去重，需要设计 beta runtime 共享包的发布、版本和回滚边界，不能只靠测试一致性长期替代抽象。

结论：通过。

# 2026-07-03 dispatcher 全量测试稳定性修复

## 目标

处理上一轮剩余风险：全量 `pnpm test` 中 dispatcher 环境敏感测试失败，尤其是 JSON stdout 污染、live DR child ready 解析和 dist build lock 连锁超时。

## 执行计划

- [x] P1 串行：定位 `shadow-drift` / `submit-review-decision` stdout JSON 污染根因。
- [x] P1 串行：定位 `stage3-live-dr` 中 `undefined/api/workers/register` 与 child ready 超时根因。
- [x] P2 串行：将 dispatcher dist 自动构建日志从 stdout 移到 stderr，保持 JSON CLI stdout 纯净。
- [x] P2 串行：增强 live DR child ready 解析，只接受包含 `status=listening` 和 `baseUrl` 的 JSON 对象。
- [x] P2 串行：live DR child 进程设置 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1`，避免 readiness 窗口内重复构建。
- [x] P3 串行：复跑失败子集、完整验证组合和全量测试。
- [x] P4 串行：执行 review-gate 并补充收尾小结。

## 验证结果

- RED：`CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/stage3-live-dr.test.ts --maxWorkers=1` 先失败于 child ready 超时；此前全量测试还失败于 stdout JSON 污染和 dist build lock 连锁超时。
- GREEN：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/server/submit-review-decision.test.ts --maxWorkers=1` 通过，2 个测试文件、6 个测试通过。
- GREEN：`CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/stage3-live-dr.test.ts --maxWorkers=1` 通过，1 个测试文件、1 个测试通过。
- GREEN：`CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/shadow-drift.test.ts tests/modules/server/submit-review-decision.test.ts tests/modules/execution/stage3-live-dr.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/trae-automation-worker.test.ts --maxWorkers=1` 通过，5 个测试文件、27 个测试通过。
- GREEN：`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test` 通过，2 个测试文件、7 个测试通过。
- GREEN：`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test` 通过，2 个测试文件、8 个测试通过。
- GREEN：`CI=true pnpm --filter @forgeflow/provider-registry test` 通过，1 个测试文件、7 个测试通过。
- GREEN：`CI=true pnpm --filter console build` 通过。
- GREEN：`CI=true pnpm typecheck` 通过。
- GREEN：`CI=true pnpm lint` 通过。
- GREEN：`CI=true pnpm docs:validate` 通过。
- GREEN：`git diff --check` 通过。
- GREEN：`CI=true HOME=/private/tmp/forgeflow-test-home pnpm test` 非沙箱通过；dispatcher 43 个测试文件、456 个测试通过。

## Review 小结

终态：finished。

Spec 符合度：通过。已处理全量测试剩余风险：JSON CLI stdout 不再混入 dispatcher dist 构建日志，live DR child ready 解析支持多行 ready JSON 且不会把普通日志误认为 ready，child 进程跳过重复 dist 构建。

安全检查：通过。未新增 secret、凭据或外部输入拼接；只调整测试/运维脚本输出通道和子进程构建环境标志。

测试与验证：通过。失败子集、完整影响范围、全量 `pnpm test`、typecheck、lint、docs 校验和 diff 检查均已通过。

复杂度检查：通过。`parseChildServerOutput` 保持单一职责，未引入超过 50 行函数；本轮脚本改动局部且未新增大文件。

Document-refresh: not-needed
原因：本轮修复测试稳定性和脚本输出通道，没有改变公开架构、接口或运行契约。

剩余风险：全量测试需要非沙箱环境运行，因为 live dispatcher 测试需要监听 `127.0.0.1`；在沙箱内仍会因权限限制失败。

潜在技术债：dispatcher dist 自动构建仍会在多个测试进程中重复触发，虽然当前锁与 stderr 输出已稳定，但后续可考虑测试启动前统一预构建并设置 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1`。

结论：通过。

# 2026-07-03 runtime 审查发现修复

## 目标

修复 6 月 30 日到 7 月 3 日变动审查中确认的交付可靠性、凭据隔离、能力声明和 Console 配置文档漂移问题。

## 执行计划

- [x] P1 串行：为 packaged Codex runtime 补充 push / PR 失败和子进程 env 隔离 RED 测试。
- [x] P1 串行：为 packaged Gemini runtime 补充同等 RED 测试。
- [x] P1 串行：修复 packaged Codex / Gemini runtime 的 push / PR 失败处理和 env allowlist。
- [x] P2 串行：修正 Gemini provider registry 的 review 能力声明，并补准入测试。
- [x] P2 串行：修正 Console 配置脚本与 README 漂移。
- [x] P3 串行：运行受影响测试、typecheck、docs 校验和 diff 检查。
- [x] P4 串行：执行 review-gate 并补充收尾小结。

## 并行说明

本轮不使用 subagent。两个 packaged runtime 文件结构高度重复，但改动函数同名且测试模式相同；主流程串行处理可以减少重复实现漂移。验证命令之间可并行执行，但最终由主流程统一汇总。

## 验证结果

- RED：`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test` 先失败，push / PR 失败路径错误返回 `completed`，env 测试暴露真实 GitHub fetch 路径。
- RED：`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test` 同样失败。
- RED：`CI=true pnpm --filter @forgeflow/provider-registry test` 先失败，Gemini `review` 被错误声明为支持。
- GREEN：`CI=true pnpm --filter @tingrudeng/codex-beta-runtime test` 通过，2 个测试文件、7 个测试通过。
- GREEN：`CI=true pnpm --filter @tingrudeng/gemini-beta-runtime test` 通过，2 个测试文件、8 个测试通过。
- GREEN：`CI=true pnpm --filter @forgeflow/provider-registry test` 通过，1 个测试文件、7 个测试通过。
- GREEN：`CI=true pnpm --filter console build` 通过。
- GREEN：`CI=true pnpm typecheck` 通过。
- GREEN：`CI=true pnpm lint` 通过。
- GREEN：`CI=true pnpm docs:validate` 通过。
- GREEN：`git diff --check` 通过。
- 全量：`CI=true pnpm test` 在 dispatcher 既有环境敏感测试失败；复跑非沙箱仍失败于 `stage3-live-dr` 的 `undefined/api/workers/register`、`shadow-drift` / `submit-review-decision` stdout JSON 混入构建日志，以及 dispatcher dist build lock 连锁超时。本轮直接相关套件均已单独通过。

## Review 小结

终态：finished。

Spec 符合度：通过。已修复 packaged Codex / Gemini runtime 的 push / PR 失败静默完成问题、子进程 env 凭据暴露问题、Gemini provider review 能力漂移，以及 Console 配置文档与实现不一致。

安全检查：通过。未新增 secret；assignment / 模型子进程改为 allowlist 环境变量，默认不再继承 `GITHUB_TOKEN`、`DISPATCHER_API_TOKEN` 或任意自定义 secret。

测试与验证：通过。新增 RED/GREEN 覆盖 packaged runtime 交付失败、PR 失败、env 隔离和 Gemini review 准入；受影响套件、typecheck、lint、docs 校验和 diff 检查均通过。

复杂度检查：通过。新增测试文件均为 279 行；新增 helper 函数未超过 50 行。两个 packaged runtime 生产文件仍超过 300 行，这是既有文件规模技术债，本轮未扩大职责边界。

Document-refresh: needed
原因：Console README 的配置命令与环境变量说明属于本轮修复对象，已同步更新。

剩余风险：全量 `pnpm test` 仍受 dispatcher 既有环境敏感测试影响，失败点不在本轮修改文件内；本轮直接相关验证已全部通过。

潜在技术债：Codex/Gemini packaged runtime 仍存在重复实现，后续应抽共享 helper 或生成模板，避免 env allowlist 与交付错误处理再次漂移。

结论：通过。

# Console 与运行入口质量修复

## 目标

收口当前审查发现的高价值问题：源码仓 Trae automation gateway JS/TS 漂移、Console 非 2xx 错误处理、任务分页缩短后的空页、终端日志强制滚动、Worker 启停反馈，以及未引用的 Vite 模板样式。

## 非目标

- 不做 Console 大规模视觉重设计。
- 不改变 dispatcher 状态机或 worker 协议语义。
- 不在本轮处理手动发布两阶段恢复方案，因为该项需要单独调整 release 策略和现有测试契约。

## 执行计划

- [x] 补 RED 测试，锁定源码仓 gateway release session、Console fetcher、分页收缩和终端滚动行为。
- [x] 同步 `scripts/lib/trae-automation-gateway.js` 与客户端 release session 能力。
- [x] 修复 Console fetcher、Worker 启停刷新、分页 clamp 和终端跟随滚动逻辑。
- [x] 清理未引用的 Vite 模板样式与资产，微调 Console 响应式布局。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 使用 review-gate 做交付前审查并补充 Review 小结。

## 验证结果

- RED：新增 gateway release session 测试先失败于 `ApiError: Not found`。
- RED：新增 Console 测试先失败于非 2xx 响应被当作数据、分页缩短后空页、终端日志强制滚动。
- GREEN：`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/trae-automation-gateway.test.ts` 通过，35 个测试文件、394 个测试通过。
- GREEN：`pnpm --filter console exec vitest run src/__tests__/App.test.tsx src/components/__tests__/Lists.test.tsx src/components/__tests__/TerminalPanel.test.tsx` 通过，3 个测试文件、16 个测试通过。
- GREEN：`pnpm --filter console lint` 通过。
- GREEN：`pnpm --filter console build` 通过。
- GREEN：`pnpm typecheck` 通过。
- GREEN：`pnpm docs:validate` 通过。
- GREEN：`git diff --check` 通过。

## Review 小结

终态：finished。

Spec 符合度：通过。已修复源码仓 Trae gateway JS release session 漂移、Console 非 2xx 错误处理、Worker 启停刷新、任务分页缩短空页和终端日志强制滚动；同时清理未引用 Vite 模板样式与资产，并拆分 `TaskDetailsPanel` 降低 `Lists.tsx` 复杂度。

安全检查：通过。未新增 secret、凭据或外部输入拼接；新增 fetcher 对非 2xx 响应显式抛错，不吞掉后端失败。

测试与验证：通过。受影响 dispatcher / Console 测试、Console lint/build、根 typecheck、文档校验和 diff 检查均已通过。

复杂度检查：通过。`Lists.tsx` 已降到 189 行，`TaskDetailsPanel.tsx` 为 261 行，新增组件均按职责拆分；未新增超过 300 行文件。

Document-refresh: not-needed
原因：本次为运行入口与 Console 行为修复，没有改变稳定文档描述的架构、接口或持久化契约。

剩余风险：手动发布两阶段恢复仍是单独技术债，本轮未改 `.github/workflows/release.yml`；任务详情的展示密度仍可在后续做进一步 UX 设计。

潜在技术债：`scripts/lib` 仍保留 checked-in JS 与 TS 双轨，后续应考虑统一构建产物刷新或减少源码仓 live entrypoint 对手工同步的依赖。

结论：通过。
