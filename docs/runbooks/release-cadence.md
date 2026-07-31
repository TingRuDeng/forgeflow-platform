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

## 4. 版本 PR 与自动 npm 发布

受保护 `main` 不接受 workflow 直推。发布必须先把版本变化作为普通 PR 合入，再由 `.github/workflows/release.yml` 对 `main` 的 package manifest push 执行唯一 npm 写入。

1. 从最新 `origin/main` 创建发布分支。
2. 只读预览版本：

   ```bash
   node scripts/release-package.js --package <name> --bump <major|minor|patch|prerelease>
   ```

3. 显式准备版本 PR：

   ```bash
   node scripts/release-package.js --package <name> --bump <major|minor|patch|prerelease> --prepare
   ```

   `--prepare` 只修改目标 `packages/<name>/package.json` 的版本字段，不执行 npm、Git、PR 或 merge。不要给版本提交添加 `[skip actions]`。
4. 检查 diff、运行包级和仓库级门禁，提交、推送并通过 PR 合入 `main`。
5. 等待 `Release` workflow 完成 publish、registry tarball 验证、provider smoke 和 `record-release-tags`。

发布链硬约束：

- detect 只把 npm 上已存在包名、但当前源码精确版本尚未发布的包放入矩阵；已发布版本不会重复上传。
- 每次 `main` merge 最多允许一个待发布精确版本。detect 同时发现多个版本时会在 npm 写入前失败；按 shared core 在前、provider 在后的顺序拆成独立版本 PR。
- preflight 会确认 Trusted Publisher 门禁、目标包名、精确版本可用性和已发布 workspace 依赖。只有精确版本 E404 表示可发布，权限、超时或其他 registry 错误都会失败关闭。
- 所有发布共用仓库级 concurrency group。publish 固定绑定 detect 输出的 commit SHA 和 package version，并在 npm 写入前后核对远端 `main` 未漂移。
- 构建后由 `scripts/prepare-release-tarball.mjs` 以 `npm pack --ignore-scripts` 生成唯一 tarball 和 manifest；它临时把 `workspace:` 依赖改写为精确 workspace 版本、校验发布文件与 bin，然后恢复源码 manifest。
- npm 只接收该已准备 tarball，并使用 Trusted Publishing、OIDC、provenance 和 `--ignore-scripts`；预发布版本只推进权威 `beta`，稳定版本才推进 `latest`，不执行发布后的人工 tag 镜像。
- `scripts/verify-published-package-tarball.mjs` 从 registry 下载精确 `dist.tarball`，核对 dist-tag、integrity、shasum、manifest、完整文件集、bin 与安装结果。
- npm publish job 只有 `contents: read` 与 `id-token: write`。全部发布验证成功后，独立 `record-release-tags` job 才以 `contents: write` 在已合入 SHA 上创建 `release/<name>@<version>`，不会向 `main` 直接推送。

失败恢复：

- npm 写入前失败：修复根因后重新运行失败 job；精确版本仍未发布时可以安全重试。
- npm 已写入但 registry / smoke 后验失败：先用本节第 6 节的只读命令确认真实 registry 状态，不要再次递增或重复发布同一版本。
- `record-release-tags` 失败：直接重新运行失败 job。tag 记录逻辑会验证已有 tag 指向的 commit，并保持幂等。
- `main` 在 publish 窗口推进：workflow 失败关闭。确认 npm 是否已经写入后，再决定重跑验证或只恢复 tag，不要猜测发布结果。

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

`@tingrudeng/beta-runtime-core` 与 `@tingrudeng/gemini-beta-runtime` 的包名和 Trusted Publisher 已完成配置。后续新增包若 `npm view <pkg> version dist-tags --json` 对包名返回 E404，先按上述配置路径处理，不要把它当作代码测试失败。

如果检测 npm registry 时返回的不是 E404，workflow 会直接失败并暴露 registry 错误，不会把网络或权限异常误判成可跳过的首次配置问题。

## 6. 发布后精确 tarball 复核

对任意已经发布且源码版本一致的包执行只读复核：

```bash
node scripts/verify-published-package-tarball.mjs --package trae-beta-runtime --expected-dist-tag beta
```

该命令不发布、不改 registry；它验证 registry 返回的精确 tarball，而不是重新从本地源码 `npm pack` 一个近似产物。provider runtime 还应继续执行 `pnpm verify:runtime-packages:published-smoke`，补充 CLI `--version` / `--help` 行为证据。
