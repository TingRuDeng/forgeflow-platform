# ForgeFlow Console

ForgeFlow Multi-Agent Control Plane 的可视化控制台。

## 功能特性

- **任务监控**：实时查看任务状态、分配情况及对应分支。支持分页浏览（每页 10 条）。
- **节点管理**：监控工作节点（Worker）的存活状态、当前任务及归属 Pool。
- **指标概览**：顶部展示集群核心指标（活跃节点、空闲/繁忙占比、任务完成进度）。
- **实时事件**：流式展示系统历史事件日志。
- **国际化**：支持中英文切换。

## 技术栈

- **框架**: React 19 + TypeScript
- **构建**: Vite 8
- **样式**: Tailwind CSS
- **状态/请求**: SWR (用于实时轮询渲染)
- **图标**: Lucide React
- **测试**: Vitest + React Testing Library

## 快速开始

### 开发运行

```bash
# 在项目根目录运行
pnpm --filter console dev
```

默认访问地址: [http://localhost:8788](http://localhost:8788) (需配合 `dispatcher` 后端运行)。

### 生产构建

```bash
pnpm --filter console build
```

## 测试

本项目使用 Vitest 进行单元测试和交互测试。

```bash
# 运行所有测试并进入监听模式
pnpm --filter console test

# 运行单次测试 (CI 环境)
pnpm --filter console test:run

# 查看测试覆盖率
pnpm --filter console test:coverage
```

测试用例位于 `src/components/__tests__` 目录下。目前已覆盖 `TaskList` 的分页逻辑和边界情况。

## 目录结构

- `src/components`: UI 组件库
  - `Lists.tsx`: 任务与节点列表实现（含分页逻辑）
  - `MetricsGrid.tsx`: 顶部指标卡片
  - `TerminalPanel.tsx`: 事件日志面板
- `src/lib`: 通用库（i18n, utils）
- `src/test`: 测试配置文件
