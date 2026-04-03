# Trae 试运行问题记录模板

每次远程 Trae 试运行结束后，都建议追加一条记录。成功任务也可以用这份模板，只是把“问题现象”改成“成功闭环摘要”。

```md
## <日期时间> <task_id>

- task_id:
- worker_id:
- repo:
- branch:
- dispatch_id:
- 结果:
  - success / review / failed
- 阶段:
  - launcher
  - gateway ready
  - fetch_task
  - start_task
  - prompt submit
  - response capture
  - submit_result
  - review
- 现象:
- 关键日志:
- Trae 最终实际回复:
- 是否可复现:
  - 是 / 否 / 未确认
- 根因判断:
- 临时绕过:
- 建议后续动作:
```

## 常用阶段说明

- `launcher`
  - Trae 启动、debug port、target 发现
- `gateway ready`
  - `/ready` 检测、selector 可用性
- `fetch_task`
  - dispatcher 分配与 worker 领取
- `start_task`
  - 任务进入执行态
- `prompt submit`
  - automation gateway 将任务真正发给 Trae
- `response capture`
  - gateway 抓取 Trae 最终回复
- `submit_result`
  - worker 回写 dispatcher
- `review`
  - dispatcher 最终落到 `review / failed / merged / blocked`

## 建议做法

- 一次任务最多只归类到一个主故障阶段，避免问题记录变得发散
- 如果出现多种症状，优先记录第一个真正阻断闭环的阶段
- 如果问题来自机器负载或环境条件，也要明确写进“根因判断”
