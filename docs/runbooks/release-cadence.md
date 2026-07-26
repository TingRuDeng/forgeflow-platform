# Release Cadence

阶段一/二默认发布节奏：

- patch：按周
- hotfix：必要时随时
- minor：阶段收尾时集中

## 1. patch

适用：

- 风险修复
- 文档同步
- 非破坏性契约补强

## 2. hotfix

适用：

- P0 安全
- 数据一致性
- 主链路不可用

hotfix 要求：

- 附故障说明
- 附回滚步骤
- 附最小验证命令

## 3. 发布前检查

- CI 全绿
- 文档同步完成
- runbook 已更新
- release notes 已准备

## 4. 手动 npm 发布失败恢复

手动包发布入口是 `.github/workflows/release.yml`。

- 手动发布只允许从 `main` ref 触发；非 `main` ref 会在 checkout 和发布动作前显式失败，版本记录固定推回 `main`。
- `package` 只能从当前受支持的 runtime 包列表选择；workflow 还会复用 `scripts/lib/runtime-package-specs.mjs` 做二次校验。
- npm `dist-tag` 会在任何构建或发布命令前校验；除了字符安全外，预发布版本必须使用 `beta`，稳定版本必须使用 `latest`。
- workflow 输入只通过环境变量传给 shell，不应在 `run` 块中直接插入 `${{ inputs.* }}`。
- workflow 先执行 preflight、依赖安装、`pnpm audit --prod --audit-level high`、类型检查、测试、shadow drift gate 和版本 bump；bump 后会用 canonical preflight 查询精确新版本，只有 npm 对该版本返回 E404 才继续构建和 `npm publish`，已发布版本、权限错误、超时或其他 registry 错误都会阻断。
- 所有正式发布共用仓库级 concurrency group。workflow 固定 checkout 触发时的 commit SHA；自动发布会同时核对 detect 输出的 package version。远端 `main` 检查与 `npm publish` 位于同一步并紧邻执行，发布后还会再次检查；若不可消除的外部竞态窗口内 `main` 推进，workflow 会失败并写出发布后恢复证据。
- 构建后由 `scripts/prepare-release-tarball.mjs` 以 `npm pack --ignore-scripts` 生成唯一 tarball 和 manifest；该步骤会临时把 `workspace:` 依赖改写为精确 workspace 版本、校验发布文件与 bin，然后恢复源码 package.json。
- 发布命令只接受已准备好的 tarball，并使用 `--ignore-scripts` 防止上传前再次执行 lifecycle、重新打包或改变 payload。
- 发布后由 `scripts/verify-published-package-tarball.mjs` 读取 npm registry 的目标 dist-tag、`dist.tarball`、`dist.integrity` 和 `dist.shasum`，下载并核对与上传前 manifest 相同的精确产物，再验证包名、版本、完整文件集、文件边界、bin 和临时安装。registry 元数据或 dist-tag 短暂未可见时会有限重试，tag 指向错误、缺字段或摘要不一致都会失败关闭。
- registry tarball 验证成功后，workflow 才提交对应 `packages/<name>/package.json` 版本变更、创建 `release/<name>@<version>` tag 并推送。
- 如果 `npm publish` 失败，git commit / tag 不会提前推进；修复 npm 或 Trusted Publishing 配置后重新触发发布即可。
- 如果 `npm publish` 已成功但 git 记录失败，GitHub Actions summary 会标记 `手动发布需要恢复`，并自动创建一个恢复 issue。此时先确认 npm 上该版本存在，再在 `main` 上补交同一个 `package.json` 版本变更，并创建同名 release tag；完成后关闭该 issue。

## 5. 自动发布遇到全新 npm 包名

push 自动发布入口会先区分两类包：

- npm 上已经存在包名，但当前 `package.json` 版本尚未发布：进入自动发布矩阵。
- npm 上还不存在包名：不进入自动发布矩阵，Actions summary 标记为 `自动发布等待 npm 包名配置`。

自动发布进入矩阵后会在 publish 前再次查询精确版本。若该版本已存在，job 会显式失败并要求先递增 `package.json` 版本；不会跳过 build/publish 后仍返回绿色结果。

看到 `自动发布等待 npm 包名配置` 时，先处理外部前置条件：

1. 在 npm 确认或创建对应 `@tingrudeng/<name>` 包名。
2. 为仓库 `TingRuDeng/forgeflow-platform` 配置该包的 Trusted Publisher。
3. 保持仓库或组织变量 `NPM_TRUSTED_PUBLISHING_ENABLED=true`。
4. 配置完成后，用后续版本变更重新触发 push 自动发布。

当前已知属于这类外部前置缺口的包：

- `@tingrudeng/beta-runtime-core`
- `@tingrudeng/gemini-beta-runtime`

如果 `npm view <pkg> version dist-tags --json` 返回 E404，先按上述配置路径处理，不要把它当作代码测试失败。

如果检测 npm registry 时返回的不是 E404，workflow 会直接失败并暴露 registry 错误，不会把网络或权限异常误判成可跳过的首次配置问题。

## 6. 发布后精确 tarball 复核

对任意已经发布且源码版本一致的包执行只读复核：

```bash
node scripts/verify-published-package-tarball.mjs --package trae-beta-runtime --expected-dist-tag beta
```

该命令不发布、不改 registry；它验证 registry 返回的精确 tarball，而不是重新从本地源码 `npm pack` 一个近似产物。provider runtime 还应继续执行 `pnpm verify:runtime-packages:published-smoke`，补充 CLI `--version` / `--help` 行为证据。
