# 组织级多仓多智能体协作控制平面设计

## 目标

为同一个 GitHub 组织下的多个独立仓库提供一套统一的多智能体协作开发体系，满足以下要求：

- 你只和一个总调度智能体交互
- GitHub 仍是任务、PR、CI、Review 和合并的唯一真相源
- 多个业务仓库共用同一套调度、MCP 工具总线和 worker 池
- 每个仓库只维护一层很薄的项目接入配置
- 第一版优先保证可预测、可审计、可回放，而不是完全自治

## 当前 v1 落地假设

虽然长期目标是多仓控制平面，但当前 v1 的默认落地方式先收敛为：

- 先在单个源仓库里跑通
- 所有 worker 直接使用源仓库任务分支
- 每个任务使用独立 `git worktree`
- 不使用每 worker 一个 fork 的模式
- 不把复杂权限治理作为当前开发前置条件

也就是说，当前代码实现优先服务“单仓跑通”，再平滑扩展到多仓。

## 推荐方案

采用“组织级控制平面 + 仓库级接入层”。

- 组织级控制平面仓库负责：
  - `codex-control` 的交互入口
  - dispatcher
  - worker 注册中心
  - MCP servers
  - 通用 task schema
  - 通用 prompts
  - GitHub 集成
- 每个业务仓库只提供：
  - `.orchestrator/project.yaml`
  - `AGENTS.md`
  - `GEMINI.md`
  - 少量 workflow 和项目命令配置

不采用“每仓一整套系统”，因为重复配置、升级和治理成本太高。

## 参考项目借鉴矩阵

### `iccc`

#### 吸收

- 强制 `git worktree` 隔离，每个任务在独立工作目录执行
- 增加任务分解器，由 `codex-control` 先生成结构化子任务再分发
- 把“执行 -> 验证 -> 审查”做成正式交叉校验链路，而不是临时人工习惯
- 引入事件流和状态面板，能追踪 worker、任务、PR 和失败重试
- 把质量门禁统一抽象为 review gate / verify gate

#### 不吸收

- 不引入 MongoDB 作为主状态存储
- 不引入 Redis 作为 v1 核心依赖
- 不采用 Claude-only 模型抽象
- 不让 worker 自主 dequeue 抢单

#### Phase 2 再做

- 更丰富的实时可视化 Dashboard
- 独立 reviewer worker 池
- 更重的 hook / automation 插件体系

### `mco`

#### 吸收

- 建立 provider adapter 抽象层，让 `codex`、`gemini` 以及后续 provider 以统一契约接入
- 增加 `doctor` 预检命令，提前检查 CLI 存在性、版本、认证和能力支持
- 冻结机器可读的结果契约，明确版本兼容规则，避免 control plane 与 worker 静默失配
- 区分 `run` 与 `review` 两类执行模式，让“开发执行”和“结构化审查”走不同契约
- 引入 provider 能力矩阵与权限映射，明确哪些 provider 支持哪些沙箱或权限键
- 在运行时状态里显式支持 `retry`、`partial_success`、`expired` 等中间态

#### 不吸收

- 不把 MCO 作为顶层总调度器替代 `codex-control + GitHub-first`
- 不把“同一任务 fan-out 给多个 provider”作为所有开发任务的默认模式
- 不把 provider-neutral CLI 作为用户主入口；你的主入口仍然是 `codex-control`
- 不把跨会话外部 memory bridge 作为 v1 核心依赖

#### Phase 2 再做

- 同题多 provider 并行 review 与 findings 去重
- synthesis 总结层，输出 consensus / divergence / next steps
- SARIF 导出与更完整的安全扫描接入
- 跨会话 memory、agent scoring 与历史 findings 注入
- provider benchmark / capability probe 基准套件

## 总体架构

```text
你
  ↓
codex-control (GPT-5.4)
  ↓
org/ai-dev-control-plane
  ├─ planner/integrator prompts
  ├─ task decomposer
  ├─ dispatcher service
  ├─ provider capability registry
  ├─ doctor preflight
  ├─ worker registry
  ├─ worktree manager
  ├─ MCP servers
  ├─ observability event bus
  ├─ task/plan store
  ├─ contract registry
  └─ GitHub integration
  ↓
worker pools
  ├─ codex-worker-*  (GPT-5.2-Codex)
  └─ gemini-worker-* (gemini-2.5-pro)
  ↓
target repositories
  ├─ org/repo-a
  ├─ org/repo-b
  └─ org/repo-c
```

## 角色与职责

### `codex-control`

- 唯一的人机交互入口
- 负责澄清需求、拆分任务、选择 worker 池、审查 PR、决定合并
- 第一版中同时承担 planner 和 integrator 两种逻辑角色
- 内置任务分解器输出结构化任务：
  - `title`
  - `pool`
  - `allowed_paths`
  - `acceptance`
  - `depends_on`
  - `verification_mode`

### `dispatcher`

- 不理解需求，只执行编排规则
- 保存 worker 状态、任务状态和调度结果
- 根据任务池类型为任务选择具体 worker
- 记录失败、重试和超时
- 调用 worktree manager 为每个任务准备独立工作目录
- 记录事件流供观测面消费
- 根据 provider capability registry 决定实际可下发的权限和运行参数
- 对 worker 返回值执行 contract 校验

### `codex-worker`

- 负责后端、重构、测试、脚本、CI、跨模块工程任务
- 默认模型为 `GPT-5.2-Codex`

### `gemini-worker`

- 负责 Vue 前端页面、组件、交互、前端测试
- 默认模型为 `gemini-2.5-pro`

## 协议分层

### MCP

作为主协议，负责共享工具总线。所有 CLI worker 和 `codex-control` 统一接入同一组 MCP servers：

- `scheduler`
- `github`
- `repo-policy`
- `review-gate`

### ACP / OpenClaw

不进入 v1 主执行链路。保留到第二阶段，用于：

- 会话控制
- ChatOps
- 人工接管
- 状态观察台

## 多仓复用方式

控制平面是组织级平台，不复制到每个仓库。每个目标仓库只暴露一份项目契约。

建议的仓库接入文件如下：

```text
target-repo/
├─ .orchestrator/
│  └─ project.yaml
├─ AGENTS.md
├─ GEMINI.md
└─ .github/workflows/
   ├─ ai-dispatch.yml
   ├─ ai-ci.yml
   └─ ai-verify-merge.yml
```

### `.orchestrator/project.yaml` 建议字段

- 仓库标识：`project.key`、`project.repo`、`default_branch`
- 路由规则：哪些路径交给 `gemini`，哪些路径交给 `codex`
- 项目命令：`lint`、`test`、`build`、`e2e`
- 治理规则：分支前缀、是否必须 review、是否必须 checks
- worktree 规则：工作树根目录、命名模板、同步策略
- 观测规则：是否上报事件、保留时长、是否启用 dashboard
- provider 规则：允许哪些 provider、每个 provider 的权限键和运行限制

示例：

```yaml
project:
  key: repo-a
  repo: org/repo-a
  default_branch: main

routing:
  gemini:
    - apps/web/**
  codex:
    - apps/api/**
    - packages/**
    - scripts/**

commands:
  lint: pnpm lint
  test: pnpm test
  build: pnpm build

governance:
  branch_prefix: ai
  require_review: true
  require_checks: true

worktree:
  root_dir: .worktrees
  branch_template: ai/{pool}/{task_id}-{slug}
  sync_from_default_branch: true

observability:
  enabled: true
  retain_days: 14

providers:
  enabled:
    - codex
    - gemini
  permissions:
    codex:
      sandbox: workspace-write
    gemini: {}
```

## 任务生命周期

1. 你向 `codex-control` 提需求，并指定目标仓库。
2. `codex-control` 读取目标仓库的项目契约。
3. `codex-control` 输出需求澄清结果和任务分解。
4. dispatcher 先运行 `doctor` 预检，并根据 provider 能力矩阵校验调度可行性。
5. dispatcher 为每个任务创建独立 worktree，并选出一个空闲 worker。
6. worker 在该 worktree 中执行修改、运行验证并提交 PR。
7. review gate 触发交叉校验：
   - 代码执行 agent 自检
   - 同池或控制面进行结构化审查
   - GitHub CI 作为最终自动校验
8. `codex-control` 根据 review、CI 和验收条件决定合并或退回。

第一版不允许 worker 自动抢单，也不允许直接推送主分支。

## 核心执行流

### 1. 任务分解

`codex-control` 在派工前必须先把需求分解成可调度任务，而不是直接给 worker 一段自由文本。

最小任务结构：

- `task_id`
- `repo`
- `pool`
- `allowed_paths`
- `worktree_name`
- `acceptance`
- `depends_on`
- `verification`

### 1.5 执行模式分流

控制平面明确区分两类任务模式：

- `run`：面向开发、实现、重构、脚本和修复
- `review`：面向结构化审查、风险汇总和 review gate

二者必须使用不同的返回契约和不同的验收逻辑。

### 2. Worktree 隔离

每个任务必须在独立 `git worktree` 中执行。原因：

- 降低并发改动互踩概率
- 让失败任务可以直接丢弃，不污染主工作目录
- 便于把 worker 与任务一一映射

### 3. 交叉验证

第一版采用轻量交叉验证链路：

- 执行 worker 完成任务并自测
- `codex-control` 或指定 reviewer 对 PR 做结构化复审
- GitHub CI 作为 merge 前硬门禁

不要求一开始就引入独立 reviewer pool，但接口上要预留。

### 4. 观测面

控制平面要有最小可用观测能力，至少能查看：

- worker 当前状态
- 最近任务流转
- 最近 PR/CI 状态
- 失败重试和超时记录

v1 可以先用 SQLite 事件表和简单 Web 面板，不必先上复杂事件基础设施。

### 5. Provider 能力与契约冻结

控制平面必须维护两类显式契约：

- provider capability registry：
  - 哪些 provider 可用
  - 支持哪些权限键
  - 默认运行参数
  - 支持哪些任务模式
- result contract：
  - `run` 结果的 JSON 结构
  - `review` findings 的 JSON 结构
  - 兼容性规则采用“只允许 additive 变更”

这样可以避免不同 worker / provider 升级后 silently break 掉 dispatcher。

## 组织级目录建议

```text
ai-dev-control-plane/
├─ apps/
│  └─ dispatcher/
├─ packages/
│  ├─ task-schema/
│  ├─ task-decomposer/
│  ├─ provider-registry/
│  ├─ result-contracts/
│  ├─ mcp-scheduler/
│  ├─ mcp-github/
│  ├─ mcp-repo-policy/
│  └─ mcp-review-gate/
├─ services/
│  ├─ worktree-manager/
│  └─ observability/
├─ docs/
│  └─ contracts/
├─ prompts/
│  ├─ codex-control.md
│  ├─ codex-worker.md
│  └─ gemini-worker.md
├─ templates/
│  ├─ project.yaml
│  ├─ AGENTS.md
│  ├─ GEMINI.md
│  └─ workflows/
└─ docs/
```

## 治理与安全

- 所有业务改动必须通过 PR 合并
- 主分支必须开启 branch protection
- worker 只能修改任务允许路径
- worker 只能在自己的 worktree 中工作
- secrets、CI、infra 改动必须显式授权
- 控制平面对目标仓库应使用最小必要权限
- 所有合并前必须通过 verify gate
- provider 不支持的权限键必须明确 fail closed 或 best effort drop，不能隐式忽略

## 分阶段推进

### Phase 1

- 建立组织级 control plane 仓库
- 接入 `codex-control`、`codex-worker`、`gemini-worker`
- 打通 GitHub 真相源、worker 调度、PR 审查与合并

### Phase 2

- 引入 OpenClaw 作为控制面增强层
- 通过 ACP 增加会话控制和人工接管能力
- 根据运行数据决定是否加入更多 worker 类型

## 设计确认结果

本设计冻结以下关键决策：

- 采用组织级控制平面，而不是每仓复制一整套系统
- `codex-control` 在 v1 中合并 planner 与 integrator
- 主协议采用 MCP
- `codex-worker` 与 `gemini-worker` 由 dispatcher 分发，不自动抢单
- GitHub 是唯一真相源
- 每个任务必须使用独立 worktree
- v1 加入任务分解器、交叉验证和最小观测面
- v1 加入 provider capability registry、doctor 预检和版本化结果契约
