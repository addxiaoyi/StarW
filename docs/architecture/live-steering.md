# Live DAG Actor Steering

> 借鉴 HomeRail 的 Live DAG Actor Steering 设计

## 问题

在 DAG 执行过程中，用户可能需要干预：暂停节点、重试失败节点、升级任务、取消运行。
传统做法是将命令直接发往物理 Worker 进程，但 Worker 可能重启、重连、迁移，
导致命令丢失或重复执行。

## 解决方案：面向 Actor 的命令

命令不直接面向物理 Worker，而是面向稳定的 **actor_id**（逻辑节点身份）。

```
用户/Manager → ControlCommand(actorId, action) → ControlPlane
                                              ↓
                                      单调命令序列
                                              ↓
                                      重连不重排
```

### 命令生命周期

```
queued → delivered → applied → completed / failed / superseded
```

| 状态 | 含义 |
|------|------|
| `queued` | 命令已创建，等待分发 |
| `delivered` | 命令已送达目标 actor |
| `applied` | actor 已应用命令 |
| `completed` | 命令执行完成 |
| `failed` | 命令执行失败 |
| `superseded` | 被后续命令替代（如 cancel 替代 retry） |

### 单调性保证

- 每个 actor 维护一个单调递增的命令序列号
- 重连时，Worker 上报最后应用的序列号
- Manager 只重发未确认命令，且保持顺序
- 新命令总是附加在序列末尾，不复用旧序号

### OpenStar 实现

```typescript
// protocol/validation.ts
export const ControlCommand = {
  id: string,
  actorId: string,        // 逻辑身份，非物理 Worker
  command: "pause" | "resume" | "cancel" | "retry" | "escalate",
  targetTaskId?: string,
  reason?: string,
  timestamp: number,
}
```

```typescript
// swarm 中通过 DagEngine.cancelRun() 实现 cancel 语义
const engine = new DagEngine()
await engine.execute(dag)
engine.cancelRun(runId)  // 显式干预
```

## 好处

1. **容错**：Worker 重启后命令不丢失
2. **可观测**：命令序列即为审计日志
3. **安全**：命令来自受控的 ControlPlane，非任意来源
4. **简单**：Worker 只需实现 apply(command) 接口
