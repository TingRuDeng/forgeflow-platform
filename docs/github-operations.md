# GitHub 侧操作手册

## 1. 目标

这份文档只说明当前 v1 需要你在 GitHub 上做什么。

当前默认前提：

- 使用个人 GitHub 账号
- 使用单个源业务仓库
- 不使用 fork
- 不为每个 worker 单独创建 GitHub 账号
- 不优先解决复杂权限问题

当前 v1 目标只有 4 个：

- worker 能并行开发
- 每个任务有独立分支和独立 worktree
- 所有变更通过 PR 回到源仓库
- `main` 不被直接改坏

---

## 2. 当前推荐的最简 GitHub 模式

当前最简单的工作流是：

1. 所有 worker 都在同一个源仓库工作
2. 每个任务创建独立分支
3. 每个任务创建独立 worktree
4. worker 完成后直接 push 到源仓库自己的任务分支
5. 再从这些分支创建 PR
6. 通过 review 和 CI 后合并到 `main`

推荐分支命名：

- `codex/task-auth-api`
- `codex/task-user-model`
- `gemini/task-login-page`

对应 worktree 目录例如：

- `.worktrees/task-auth-api`
- `.worktrees/task-user-model`
- `.worktrees/task-login-page`

当前不建议做的事：

- 不给每个 worker 建一个 fork
- 不给每个 worker 建一个 GitHub 账号
- 不引入 GitHub App 作为 v1 前置条件
- 不让 worker 直接推 `main`

---

## 3. 你的仓库至少要配置什么

### 3.1 开启 Actions

进入：

`Repo -> Settings -> Actions -> General`

建议：

- 允许本仓库运行 Actions
- `Workflow permissions` 设为 `Read and write permissions`

如果 workflow 后面要创建 PR、写 comment 或更新状态，这一项必须打开写权限。

### 3.2 配置默认分支保护

进入：

`Repo -> Settings -> Branches`

给 `main` 配 branch protection rule。

当前 v1 至少建议打开：

- Require a pull request before merging
- Require approvals
- Require status checks to pass before merging
- Require branches to be up to date before merging

建议的 required checks：

- `ai-ci`
- `ai-verify-merge`

### 3.3 不允许直接往 `main` 工作

当前约定很简单：

- worker 只在任务分支工作
- `main` 只接受 PR 合并

也就是说，即使现在不深究权限模型，工作流层面也不要让 AI 直接在 `main` 上改。

---

## 4. 你需要准备哪些 Secrets

进入：

`Repo -> Settings -> Secrets and variables -> Actions`

当前 v1 最少准备：

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

如果后面需要 API 方式操作 GitHub，再加：

- `GH_PAT`

当前阶段如果只是本地开发、手工 push、手工开 PR，其实 `GH_PAT` 不是必须前置。

---

## 5. Self-hosted runner

### 5.1 为什么建议用它

当前 v1 建议至少有 1 台 self-hosted runner，因为：

- CLI worker 更适合跑在你自己的机器上
- worktree 管理更方便
- 本地认证和本地工具链更稳定

### 5.2 runner 机器至少要满足

- 能访问 GitHub
- 能访问 OpenAI / Gemini API
- 已安装 `git`
- 已安装 `node`
- 已安装 `pnpm`
- 已安装 `codex` CLI
- 已安装 `gemini` CLI
- 有可写的 `.worktrees` 目录

### 5.3 推荐 runner label

建议先统一用一个 label：

- `forgeflow`

这样 workflow 里写起来最简单。

---

## 6. 新业务仓接入步骤

当前最简接入就是下面这几步。

### 6.1 放入项目契约

在业务仓里加入：

- `.orchestrator/project.yaml`
- `AGENTS.md`
- `GEMINI.md`

### 6.2 放入 workflow 模板

加入：

- `.github/workflows/ai-dispatch.yml`
- `.github/workflows/ai-ci.yml`
- `.github/workflows/ai-verify-merge.yml`

### 6.3 配 `main` 的 branch protection

至少保证：

- 要 PR
- 要 review
- 要 checks

### 6.4 做一次 smoke test

最少验证一次：

1. 手工触发 `ai-dispatch`
2. 看 workflow 是否能读取配置
3. 看 worker 是否能创建任务分支
4. 看 PR 是否能正常创建
5. 看 `main` 是否真的只能通过 PR 合并

---

## 7. 你日常在 GitHub 上怎么操作

### 7.1 看任务进度

主要看：

- PR 列表
- Actions 运行记录
- required checks 状态
- review comments

### 7.2 合并代码

当前 v1 推荐流程：

1. worker 推任务分支
2. 开 PR
3. `codex-control` review
4. `ai-ci` 通过
5. `ai-verify-merge` 通过
6. 你手工 merge

### 7.3 回滚

如果某个 AI PR 合并后有问题，优先用 GitHub 原生方式：

- `Revert`
- 新开修复 PR

不要直接在 `main` 手工改。

---

## 8. 当前不需要先做的事情

为了先把系统跑通，这些暂时都不是前置条件：

- GitHub App
- 多 bot 账号
- 每个 worker 一个 fork
- 组织级权限治理
- 复杂 PAT 策略
- merge queue

这些都可以等 v1 跑顺以后再加。

---

## 9. 你现在最该先做的事情

如果你今天就要开始接业务仓，按这个顺序最稳：

1. 给仓库开启 Actions
2. 给 `main` 配 branch protection
3. 配好 `OPENAI_API_KEY` 和 `GEMINI_API_KEY`
4. 准备 self-hosted runner
5. 放入 `.orchestrator/project.yaml` 和 workflow 模板
6. 跑第一次 `workflow_dispatch`

这就够开始了。
