# Review Memory Contract v1

- Scope: `review-memory-v1`
- Compatibility: additive-only changes are allowed within v1.

## 概述

Review Memory Contract 定义了如何将 review findings / failed / rework 中值得复用的经验沉淀为结构化 lesson，并注入后续任务上下文。

**当前状态**：这是已接入主线的基础层实现，但仍不是完整知识库系统。

## 什么是 Lesson

Lesson 是从 review/failure/rework 事件中提取的结构化经验，具备以下特征：
- **可复用**：对后续类似任务有指导价值
- **可注入**：可以根据 repo/scope/category/worker_type 条件选择性注入
- **可追溯**：记录了 lesson 的来源和上下文

## Lesson Schema

```typescript
interface Lesson {
  id: string;                      // 唯一标识，格式: lesson-{timestamp}-{random}
  source_type: 'review' | 'failed' | 'rework';
  source_task_id: string;          // 来源任务 ID
  source_worker_type: string;       // 来源 worker 类型 (codex/gemini/trae)
  repo: string;                    // 仓库名
  scope: string;                   // 作用域 (file pattern 或功能模块)
  category: string;                // 分类 (security/performance/structure/behavior/other)
  rule: string;                   // 具体规则或模式
  rationale: string;               // 理由说明
  trigger_paths: string[];          // 触发路径模式
  trigger_tags: string[];          // 触发标签
  severity: 'critical' | 'warning' | 'info';
  created_at: string;              // ISO 时间戳
}
```

## Injection Criteria（注入条件）

调用方在筛选 lesson 时使用的输入结构：

```typescript
interface InjectionCriteria {
  repo: string;           // 仓库名 (必须匹配)
  scope: string;         // 任务作用域 (用于 path 匹配)
  category?: string;      // 可选：任务分类
  worker_type?: string;  // 可选：worker 类型
}
```

注入决策规则：
1. **必须满足**：`repo` 必须匹配（完全匹配或同一组织）
2. **至少满足一项**：
   - `scope` 与 lesson.trigger_paths 有交集
   - `category` 与 lesson.category 匹配
   - `worker_type` 与 lesson.source_worker_type 匹配
3. **优先级排序**：critical > warning > info

## Extraction Criteria（提取规则）

### 哪些事件会提炼为 Lesson

| 来源类型 | 条件 | 示例 |
|---------|------|------|
| `review` (blocked) | severity 为 critical/warning，且 recommendation 具有通用性 | "避免在 auth 模块使用 eval" |
| `review` (merge) | category 为 structure/behavior，且对后续任务有参考价值 | "API 路由统一使用 REST 风格" |
| `failed` | verification 失败原因可抽象为可避免的模式 | "测试未 mock 外部 API 导致 flaky" |
| `rework` | 同一个任务被 rework 2次以上，提取根本原因 | "需求理解偏差导致返工" |

### 哪些事件不会进入 Memory

| 类型 | 原因 |
|------|------|
| 一次性噪音 | 只针对特定文件的特定问题，无通用性 |
| 已过时的规则 | 技术栈变更后不再适用 |
| 不可操作的建议 | 仅有描述但无具体 action |
| 低频问题 | 出现概率极低，不值得为后续任务增加 prompt 负担 |

## 存储结构

### 最小存储格式

```typescript
interface MemoryStore {
  version: 1;
  lessons: Lesson[];
  updated_at: string;
}
```

### 存储位置

- **本地运行时**：`.forgeflow-dispatcher/memory.json`
- **dispatcher dispatch 时加载**：`scripts/lib/dispatcher-server.js`

## 与现有契约的关系

- **消费现有契约，不重写**：
  - 从 `review-findings-v1` 消费 review findings
  - 从 `run-result-v1` 消费 failed 状态和原因
  - 不修改 `trae-worker-v1` 契约
  - 不修改 `worker-prompt-layering-v1` 的分层语义

## 当前实现

当前主线已经具备：

1. **文件存储读取**：dispatcher 会从 `.forgeflow-dispatcher/memory.json` 加载 lesson
2. **dispatch 注入**：创建 dispatch 时，按 repo/scope/worker 条件筛选 lesson，并把命中结果注入 assignment context
3. **提取 helper**：提供从 review / failed / rework 结果提炼 lesson 的 helper

## 当前限制

1. **非完整知识库**：仅支持基础的 lesson 提取和注入，不支持向量检索
2. **落盘仍需外部调用方编排**：虽然 dispatcher 会读取 `memory.json`，但 lesson 的自动提取与写入并未内建为完整流水线
3. **分类与触发条件仍较轻量**：主要依赖 repo/scope/category/worker_type 命中
4. **无版本管理**：lesson 不支持版本更新机制

## 未来扩展方向

- 支持 lesson 有效期管理
- 支持 lesson 有效性反馈
- 支持跨仓库经验共享
- 支持基于 embedding 的语义检索
