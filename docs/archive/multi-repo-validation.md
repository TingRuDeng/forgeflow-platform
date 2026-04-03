# 多仓复用验证

> Archived: 这份文档只保留历史上下文，不代表当前主线。当前入口请看 `../README.md` 与 `../../README.md`。

## 1. 验证目标

验证 forgeflow-platform 当前这套控制平面是否能在不同目录结构、不同命令集的仓库之间复用，而不是只适配单一仓库。

## 2. 已验证的复用能力

下面这些能力已经做成组织级或平台级复用：

- 统一 task schema
- 统一 result contracts
- 统一 dispatch state machine
- 统一 worktree manager
- 统一 provider registry
- 统一 MCP server 契约
- 统一 runtime adapter 结构
- 统一 workflow 模板

## 3. 仓库级需要覆盖的部分

下面这些必须由每个业务仓自己声明：

- `project.repo`
- 路由规则
- lint / test / build 命令
- 默认分支
- 业务目录边界

## 4. `repo-a` 与 `repo-b` 的差异验证

### `repo-a`

- 前端目录：`apps/web/**`
- 后端目录：`apps/api/**`
- 命令：`pnpm`

### `repo-b`

- 前端目录：`frontend/**`
- 后端目录：`backend/**`
- 命令：`npm`

## 5. 验证结论

结论是：

- 控制平面的复用边界是稳定的
- 仓库差异主要体现在项目契约
- 路由、命令和治理规则不会因为仓库不同而相互污染
- 当前 v1 已经具备“同一套平台，多个仓库薄接入”的基础条件
