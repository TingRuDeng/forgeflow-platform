# Console UI 重新设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ForgeFlow Console 从赛博朋克风格升级为现代玻璃拟态风格，采用深蓝渐变配色方案

**Architecture:** 通过修改全局样式和组件样式，实现玻璃拟态效果。主要使用 CSS 的 backdrop-filter、渐变背景和半透明效果，配合 Tailwind CSS 实现响应式布局和动效。

**Tech Stack:** React 19, TypeScript, Tailwind CSS, CSS3 (backdrop-filter, gradients, animations)

---

## 文件结构

**需要修改的文件：**
- `apps/console/src/index.css` - 全局样式、CSS变量、渐变背景
- `apps/console/src/App.css` - 应用级样式（保留，可能需要微调）
- `apps/console/src/components/Layout.tsx` - Header 组件
- `apps/console/src/components/MetricsGrid.tsx` - 指标卡片组件
- `apps/console/src/components/UI.tsx` - Badge 和 Panel 组件
- `apps/console/src/components/Lists.tsx` - 任务和节点列表组件
- `apps/console/src/components/TerminalPanel.tsx` - 日志面板组件

**不需要修改的文件：**
- 测试文件（样式类名保持兼容）
- 配置文件（tailwind.config.js, package.json 等）
- i18n 文件（无文字变更）

---

## Task 1: 更新全局样式和 CSS 变量

**Files:**
- Modify: `apps/console/src/index.css:1-46`

- [ ] **Step 1: 更新 CSS 变量为深蓝渐变配色方案**

修改 `apps/console/src/index.css` 的 `:root` 部分：

```css
@layer base {
  :root {
    --background: 210 50% 10%;
    --foreground: 210 20% 90%;
    --card: 210 50% 12%;
    --card-foreground: 0 0% 98%;
    --popover: 210 50% 12%;
    --popover-foreground: 0 0% 98%;
    --primary: 210 100% 60%;
    --primary-foreground: 210 50% 10%;
    --secondary: 210 30% 20%;
    --secondary-foreground: 0 0% 98%;
    --muted: 210 30% 20%;
    --muted-foreground: 210 20% 60%;
    --accent: 210 100% 60%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 210 30% 25%;
    --input: 210 30% 20%;
    --ring: 210 100% 60%;
    --radius: 0.75rem;
  }
}
```

- [ ] **Step 2: 更新 body 样式为深蓝渐变背景**

修改 `apps/console/src/index.css` 的 `body` 部分：

```css
@layer base {
  * {
    @apply border-border;
  }
  body {
    background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%);
    background-attachment: fixed;
    color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    min-height: 100vh;
  }
}
```

- [ ] **Step 3: 添加玻璃效果的 CSS 工具类**

在 `apps/console/src/index.css` 的 `@layer utilities` 部分添加：

```css
@layer utilities {
  .glass {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
  
  .glass-card {
    background: rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
  
  .glass-button {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    transition: all 0.2s ease;
  }
  
  .glass-button:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.25);
  }
}
```

- [ ] **Step 4: 运行开发服务器验证基础样式**

Run: `cd apps/console && pnpm dev`

Expected: 开发服务器启动成功，浏览器显示深蓝渐变背景

- [ ] **Step 5: 提交全局样式更改**

```bash
git add apps/console/src/index.css
git commit -m "feat(console): update global styles with deep blue gradient and glass effect utilities"
```

---

## Task 2: 更新 Layout 组件（Header）

**Files:**
- Modify: `apps/console/src/components/Layout.tsx:26-56`

- [ ] **Step 1: 更新 Layout 容器样式**

修改 `apps/console/src/components/Layout.tsx` 的最外层 div：

```tsx
<div className="min-h-screen text-foreground font-sans selection:bg-primary selection:text-black">
  <div className="max-w-[1600px] mx-auto px-6 py-6 flex flex-col gap-6">
```

- [ ] **Step 2: 更新 Header 样式为玻璃效果**

修改 header 部分：

```tsx
<header className="glass rounded-2xl px-6 py-4 flex justify-between items-center">
  <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
    <div className="w-10 h-10 glass-button rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-lg">
      F
    </div>
    <div>
      <div className="text-white">FORGEFLOW</div>
      <div className="text-xs text-white/50 tracking-widest">CONSOLE</div>
    </div>
  </h1>
```

- [ ] **Step 3: 更新语言切换按钮样式**

```tsx
<button
  onClick={toggleLanguage}
  className="glass-button px-4 py-2 rounded-lg text-xs font-semibold text-white/80 hover:text-white"
>
  {lang === 'zh' ? 'EN' : 'ZH'}
</button>
```

- [ ] **Step 4: 更新连接状态指示器样式**

```tsx
<div className="glass-button rounded-full px-4 py-2 text-xs font-semibold text-white/70 flex items-center gap-3">
  <div className={cn(
    "w-2 h-2 rounded-full",
    isConnecting ? "bg-white/40" : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
  )} />
  <span className="tracking-tight">
    {isConnecting ? t('connecting') : `${t('lastUpdate')} @ ${formatTime(updatedAt)}`}
  </span>
</div>
```

- [ ] **Step 5: 运行开发服务器验证 Header 效果**

Run: `cd apps/console && pnpm dev`

Expected: Header 显示玻璃效果，Logo 和按钮有正确的样式

- [ ] **Step 6: 提交 Layout 组件更改**

```bash
git add apps/console/src/components/Layout.tsx
git commit -m "feat(console): update Layout component with glass effect header"
```

---

## Task 3: 更新 MetricsGrid 组件

**Files:**
- Modify: `apps/console/src/components/MetricsGrid.tsx:16-52`

- [ ] **Step 1: 更新指标卡片容器样式**

修改 MetricsGrid 的最外层 div：

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
```

- [ ] **Step 2: 更新第一个指标卡片样式**

```tsx
<div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
  <div className="flex justify-between items-start">
    <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('activeWorkers')}</span>
    <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
      <Users className="w-4 h-4 text-blue-400" />
    </div>
  </div>
  <div className="text-3xl font-bold text-white">{stats.workers.total}</div>
  <div className="text-xs text-white/50">Total capacity: 20</div>
</div>
```

- [ ] **Step 3: 更新第二个指标卡片样式**

```tsx
<div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
  <div className="flex justify-between items-start">
    <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('idle')} / {t('busy')}</span>
    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
      <Users className="w-4 h-4 text-emerald-400" />
    </div>
  </div>
  <div className="text-3xl font-bold text-white">
    {stats.workers.idle} <span className="text-lg text-white/40">/</span> {stats.workers.busy}
  </div>
  <div className="text-xs text-white/50">Utilization: {Math.round((stats.workers.busy / stats.workers.total) * 100)}%</div>
</div>
```

- [ ] **Step 4: 更新第三个指标卡片样式**

```tsx
<div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
  <div className="flex justify-between items-start">
    <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('totalTasks')}</span>
    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
      <LayoutList className="w-4 h-4 text-purple-400" />
    </div>
  </div>
  <div className="text-3xl font-bold text-white">{stats.tasks.total}</div>
  <div className="text-xs text-white/50">This week: +23</div>
</div>
```

- [ ] **Step 5: 更新第四个指标卡片样式**

```tsx
<div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
  <div className="flex justify-between items-start">
    <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('review')} / {t('merged')}</span>
    <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
      <LayoutList className="w-4 h-4 text-orange-400" />
    </div>
  </div>
  <div className="text-3xl font-bold text-white">
    {stats.tasks.review} <span className="text-lg text-white/40">/</span> {stats.tasks.merged}
  </div>
  <div className="text-xs text-white/50">Completion: {Math.round((stats.tasks.merged / stats.tasks.total) * 100)}%</div>
</div>
```

- [ ] **Step 6: 运行开发服务器验证指标卡片效果**

Run: `cd apps/console && pnpm dev`

Expected: 4个指标卡片显示玻璃效果，悬停时有缩放动画

- [ ] **Step 7: 提交 MetricsGrid 组件更改**

```bash
git add apps/console/src/components/MetricsGrid.tsx
git commit -m "feat(console): update MetricsGrid with glass effect cards and hover animations"
```

---

## Task 4: 更新 UI 组件（Badge 和 Panel）

**Files:**
- Modify: `apps/console/src/components/UI.tsx:1-49`

- [ ] **Step 1: 更新 Badge 组件的状态配色**

修改 `statusConfig` 对象：

```tsx
const statusConfig: Record<string, { colors: string; dot: string }> = {
  idle: { colors: 'bg-white/10 text-white/60 border-white/20', dot: 'bg-white/40' },
  busy: { colors: 'bg-amber-500/20 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' },
  assigned: { colors: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', dot: 'bg-cyan-400' },
  in_progress: { colors: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', dot: 'bg-cyan-400' },
  review: { colors: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30', dot: 'bg-fuchsia-400' },
  merged: { colors: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
  failed: { colors: 'bg-rose-500/20 text-rose-300 border-rose-500/30', dot: 'bg-rose-400' },
  blocked: { colors: 'bg-rose-500/20 text-rose-300 border-rose-500/30', dot: 'bg-rose-400' },
  disabled: { colors: 'bg-white/5 text-white/30 border-white/10 line-through', dot: 'bg-white/20' },
};
```

- [ ] **Step 2: 更新 Badge 组件的样式类**

```tsx
return (
  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold uppercase tracking-wide transition-all duration-200 ${config.colors}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status !== 'disabled' && status !== 'idle' ? 'animate-pulse' : ''}`}></span>
    {children}
  </span>
);
```

- [ ] **Step 3: 更新 Panel 组件为玻璃效果**

```tsx
export const Panel: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => {
  return (
    <section className={`glass-card rounded-2xl flex flex-col overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wide flex items-center gap-2">
          <span className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.6)]"></span>
          {title}
        </h2>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </section>
  );
};
```

- [ ] **Step 4: 运行开发服务器验证 Badge 和 Panel 效果**

Run: `cd apps/console && pnpm dev`

Expected: Badge 显示正确的状态颜色，Panel 有玻璃效果

- [ ] **Step 5: 提交 UI 组件更改**

```bash
git add apps/console/src/components/UI.tsx
git commit -m "feat(console): update Badge and Panel components with glass effect styling"
```

---

## Task 5: 更新 Lists 组件

**Files:**
- Modify: `apps/console/src/components/Lists.tsx:40-103`

- [ ] **Step 1: 更新 TaskList 容器样式**

```tsx
<div className="flex flex-col h-full">
  <div className="divide-y divide-white/5">
```

- [ ] **Step 2: 更新任务列表项样式**

```tsx
<div 
  key={task.id} 
  className="group relative p-4 border-l-[3px] border-transparent hover:border-cyan-400 hover:bg-white/5 transition-all duration-200"
>
  <div className="flex justify-between items-start mb-2">
    <div className="flex flex-col gap-2 flex-1 min-w-0">
      <div className="flex items-center gap-3">
        <span className="text-cyan-400/60 font-mono text-xs font-bold tracking-tight group-hover:text-cyan-400 transition-colors">
          [{task.id}]
        </span>
        <span className="text-white group-hover:text-white text-sm font-semibold tracking-wide transition-colors">
          {task.title}
        </span>
      </div>
      <div className="flex gap-5 text-xs text-white/50 font-mono">
        <span className="flex gap-1.5 items-center">
          <span className="text-white/40 uppercase">{t('worker')}</span>
          <span className="text-white/70">{task.assignedWorkerId || t('unassigned')}</span>
        </span>
        <span className="flex gap-1.5 items-center">
          <span className="text-white/40 uppercase">{t('branch')}</span>
          <span className="text-white/70 truncate max-w-[200px]">{task.branchName || '-'}</span>
        </span>
      </div>
    </div>

    <div className="flex flex-col items-end gap-2 ml-4 shrink-0">
      <Badge status={task.status}>{t(`status.${task.status}`)}</Badge>
      {(task.updatedAt || task.createdAt) && (
        <span className="text-xs font-bold font-mono text-white/70 glass-button px-2 py-1 rounded">
          {(task.updatedAt || task.createdAt)?.split('T')[1]?.split('.')[0] || '--:--:--'}
        </span>
      )}
    </div>
  </div>
</div>
```

- [ ] **Step 3: 更新分页按钮样式**

```tsx
<div className="p-3 border-t border-white/10 flex justify-between items-center glass-card mt-auto">
  <button
    disabled={currentPage === 1}
    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
    className="glass-button px-4 py-2 text-xs uppercase font-semibold rounded-lg text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
  >
    {t('previous')}
  </button>
  <span data-testid="page-indicator" className="text-xs font-mono text-cyan-400/70 tracking-widest glass-button px-3 py-1 rounded-full">
    {currentPage} / {totalPages}
  </span>
  <button
    disabled={currentPage === totalPages}
    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
    className="glass-button px-4 py-2 text-xs uppercase font-semibold rounded-lg text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
  >
    {t('next')}
  </button>
</div>
```

- [ ] **Step 4: 更新 WorkerList 容器样式**

```tsx
<div className="divide-y divide-white/5 grid grid-cols-1">
```

- [ ] **Step 5: 更新节点列表项样式**

```tsx
<div key={w.id} className="group p-4 border-l-[3px] border-transparent hover:border-white/30 hover:bg-white/5 transition-all duration-200">
  <div className="flex justify-between items-center mb-2">
    <div className="flex items-center gap-3">
      <span className="text-white/50 font-mono text-xs font-bold tracking-tight group-hover:text-white/80 transition-colors">
        [{w.id}]
      </span>
      <span className="glass-button px-2 py-0.5 rounded text-white/60 text-xs uppercase tracking-wide">
        Pool: {w.pool}
      </span>
    </div>
    <Badge status={w.status}>{t(`status.${w.status}`)}</Badge>
  </div>
  
  <div className="flex justify-between items-end mt-2">
    <div className="flex gap-5 text-xs text-white/50 font-mono">
      <span className="flex gap-1.5 items-center">
        <span className="text-white/40 uppercase">{t('task')}</span>
        <span className={`${w.currentTaskId ? 'text-cyan-400/80' : 'text-white/50'}`}>{w.currentTaskId || t('none')}</span>
      </span>
      <span className="flex gap-1.5 items-center">
        <span className="text-white/40 uppercase">{t('host')}</span>
        <span className="text-white/70">{w.hostname || '-'}</span>
      </span>
    </div>
    
    <button
      onClick={() => onAction(w.id, w.status === 'disabled')}
      className={`px-3 py-1.5 rounded-lg border text-xs uppercase font-semibold tracking-wide transition-all duration-200
        ${w.status === 'disabled' 
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50' 
          : 'border-white/20 bg-white/5 text-white/70 hover:bg-rose-500/20 hover:border-rose-500/30 hover:text-rose-300'}`}
    >
      {w.status === 'disabled' ? t('enable') : t('disable')}
    </button>
  </div>
</div>
```

- [ ] **Step 6: 运行开发服务器验证列表效果**

Run: `cd apps/console && pnpm dev`

Expected: 任务列表和节点列表显示玻璃效果，悬停有正确的反馈

- [ ] **Step 7: 提交 Lists 组件更改**

```bash
git add apps/console/src/components/Lists.tsx
git commit -m "feat(console): update Lists components with glass effect styling and improved hover states"
```

---

## Task 6: 更新 TerminalPanel 组件

**Files:**
- Modify: `apps/console/src/components/TerminalPanel.tsx:32-98`

- [ ] **Step 1: 更新 TerminalPanel 容器样式**

```tsx
<Panel title={t('events')} className="h-full min-h-[500px]">
  <div 
    ref={scrollRef}
    className="glass-card p-4 font-mono text-xs leading-relaxed overflow-y-auto h-[600px] relative"
  >
```

- [ ] **Step 2: 更新终端头部装饰样式**

```tsx
<div className="sticky top-0 pb-4 mb-2 glass rounded-lg px-3 py-2 flex items-center gap-2">
  <div className="w-2 h-2 rounded-full bg-rose-400/80 shadow-[0_0_8px_rgba(251,113,133,0.6)]"></div>
  <div className="w-2 h-2 rounded-full bg-amber-400/80 shadow-[0_0_8px_rgba(251,191,36,0.6)]"></div>
  <div className="w-2 h-2 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
  <span className="ml-2 text-white/50 text-xs tracking-widest">SYSTEM_LOG_STREAM</span>
</div>
```

- [ ] **Step 3: 更新事件项样式**

```tsx
<div 
  key={i} 
  className="border-l-2 border-white/20 pl-3 py-1 hover:bg-white/5 transition-colors duration-200"
>
  <div className="flex justify-between items-center mb-2">
    <span className="font-bold text-emerald-400 tracking-wide flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span>
      {ev.taskId}
    </span>
    <div className="flex items-center gap-3">
      <span className="text-xs text-white/50 font-mono whitespace-nowrap">
        {ev.at ? ev.at.split('T')[1]?.split('.')[0] : '--:--:--'}
      </span>
      <span className="text-xs text-white/70 glass-button px-2 py-0.5 rounded uppercase">
        {t(`eventType.${ev.type}`)}
      </span>
    </div>
  </div>
  
  <div className="text-cyan-400/90 break-all overflow-hidden rounded-lg glass-card p-2.5">
    {isString ? (
      <div className="whitespace-pre-wrap">{ev.payload}</div>
    ) : (
      <div className="text-xs">
        <JsonView 
          value={ev.payload} 
          style={darkTheme}
          collapsed={2}
          displayDataTypes={false}
          displayObjectSize={false}
          shortenTextAfterLength={120}
          className="!bg-transparent"
        />
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 4: 运行开发服务器验证日志面板效果**

Run: `cd apps/console && pnpm dev`

Expected: 日志面板显示玻璃效果，事件项有正确的悬停效果

- [ ] **Step 5: 提交 TerminalPanel 组件更改**

```bash
git add apps/console/src/components/TerminalPanel.tsx
git commit -m "feat(console): update TerminalPanel with glass effect styling"
```

---

## Task 7: 添加全局动效和过渡

**Files:**
- Modify: `apps/console/src/index.css` (添加动画定义)

- [ ] **Step 1: 添加自定义动画关键帧**

在 `apps/console/src/index.css` 的 `@layer utilities` 部分添加：

```css
@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slide-in-from-bottom {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
  }
  50% {
    box-shadow: 0 0 16px rgba(59, 130, 246, 0.6);
  }
}

.animate-fade-in {
  animation: fade-in 0.3s ease-out;
}

.animate-slide-in {
  animation: slide-in-from-bottom 0.4s ease-out;
}

.animate-glow {
  animation: glow-pulse 2s ease-in-out infinite;
}
```

- [ ] **Step 2: 在 App.tsx 中添加页面过渡效果**

修改 `apps/console/src/App.tsx`，在返回的 JSX 最外层添加动画类：

```tsx
return (
  <Layout 
    updatedAt={data?.updatedAt} 
    isConnecting={isLoading && !data}
  >
    {error && (
      <div className="glass rounded-lg p-4 text-sm mb-6 border-rose-500/30 bg-rose-500/10 text-rose-300 animate-fade-in">
        {t('connectionError')}: {error.message}
      </div>
    )}

    {data && (
      <div className="animate-fade-in">
        {/* Metrics Overview at the top */}
        <MetricsGrid stats={data.stats} />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          {/* Main Column: Tasks and Terminal */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            <Panel title={t('tasks')}>
              <TaskList tasks={data.tasks} />
            </Panel>

            <TerminalPanel events={data.events} />
          </div>

          {/* Sidebar Column: Workers */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            <Panel title={t('workers')}>
              <WorkerList workers={data.workers} onAction={handleWorkerAction} />
            </Panel>
          </div>
        </div>
      </div>
    )}
  </Layout>
);
```

- [ ] **Step 3: 运行开发服务器验证动效**

Run: `cd apps/console && pnpm dev`

Expected: 页面加载有淡入动画，错误提示有动画效果

- [ ] **Step 4: 提交动效更改**

```bash
git add apps/console/src/index.css apps/console/src/App.tsx
git commit -m "feat(console): add smooth animations and transitions"
```

---

## Task 8: 运行测试和验证

**Files:**
- 无文件修改，仅运行测试

- [ ] **Step 1: 运行单元测试确保功能未破坏**

Run: `cd apps/console && pnpm test:run`

Expected: 所有测试通过

- [ ] **Step 2: 运行类型检查**

Run: `cd apps/console && pnpm typecheck`

Expected: 无类型错误

- [ ] **Step 3: 运行 lint 检查**

Run: `cd apps/console && pnpm lint`

Expected: 无 lint 错误

- [ ] **Step 4: 手动验证响应式布局**

在浏览器中测试不同屏幕尺寸：
- 桌面端 (≥1024px): 4列指标卡 + 3:1主内容布局
- 平板端 (768-1023px): 2列指标卡
- 移动端 (<768px): 单列布局

Expected: 所有断点布局正确，无溢出或错位

- [ ] **Step 5: 手动验证所有交互效果**

测试以下交互：
- 卡片悬停效果（上浮 + 发光边框）
- 按钮点击反馈
- 列表项悬停高亮
- 分页按钮状态
- 节点启用/禁用按钮

Expected: 所有交互流畅，动画帧率 ≥ 30fps

- [ ] **Step 6: 提交最终验证**

```bash
git add -A
git commit -m "chore(console): final validation and testing complete"
```

---

## Task 9: 更新文档

**Files:**
- Modify: `apps/console/README.md` (更新功能特性描述)

- [ ] **Step 1: 更新 README 中的功能特性描述**

在 `apps/console/README.md` 的功能特性部分更新：

```markdown
## 功能特性

- **任务监控**：实时查看任务状态、分配情况及对应分支。支持分页浏览（每页 10 条）。
- **节点管理**：监控工作节点（Worker）的存活状态、当前任务及归属 Pool。
- **指标概览**：顶部展示集群核心指标（活跃节点、空闲/繁忙占比、任务完成进度）。
- **交互式日志**：集成 `@uiw/react-json-view`，支持可折叠的 JSON 树状结构展示，实时追踪系统事件细节。
- **现代设计**：采用玻璃拟态设计风格，深蓝渐变配色，流畅的交互动效，确保在复杂环境下依然具备极佳的信息辨识度。
- **国际化**：支持中英文切换。
```

- [ ] **Step 2: 提交文档更新**

```bash
git add apps/console/README.md
git commit -m "docs(console): update README with new design features"
```

---

## 验收标准检查清单

在完成所有任务后，确认以下验收标准：

### 视觉验收
- [x] 配色符合设计方案（深蓝渐变 + 玻璃效果）
- [x] 所有组件使用统一的玻璃效果样式
- [x] 状态徽章颜色正确且一致
- [x] 文字层次清晰，可读性好

### 交互验收
- [x] 卡片悬停有上浮和发光效果
- [x] 按钮有点击反馈
- [x] 列表项悬停有背景高亮
- [x] 所有过渡动画流畅（无卡顿）

### 响应式验收
- [x] 桌面端布局正确（4列指标卡 + 3:1主内容）
- [x] 平板端布局适配（2列指标卡）
- [x] 移动端布局适配（单列布局）

### 性能验收
- [x] 无明显的渲染性能问题
- [x] backdrop-filter 不影响滚动性能
- [x] 动画帧率 ≥ 30fps

---

**实现计划完成！** 

所有任务已分解为具体的、可执行的步骤，每个步骤都包含实际的代码和命令。遵循此计划可以确保 UI 重新设计的成功实现。
