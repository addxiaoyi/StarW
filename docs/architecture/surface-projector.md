# Live Surface Projector

> 借鉴 HomeRail 的 Live Surface Projector 设计

## 问题

多 agent 系统需要向用户展示实时进度，但：
- Worker 不应直接生成 UI（安全风险：注入任意 HTML/JS）
- 用户交互需要单向数据流避免竞态
- 多个 Worker 并发更新同一 UI 需要协调

## 数据流：单向投影

```
Worker → Activity Journal → Projector → Surface Update
  (事实)     (只追加)        (排序+验证)   (A2UI Transaction)
```

### 三层平面

| 平面 | 写入者 | 内容 |
|------|--------|------|
| **Activity Plane** | Worker | 只追加的事实记录 |
| **Control Plane** | Manager/用户 | actor 身份和命令 |
| **Surface Plane** | Manager 独占 | UI 投影更新 |

### 关键原则

1. **Worker 只报告事实，不提交 UI 组件**
   - Worker 上报: `{ nodeId, status, evidence }`
   - Manager 验证身份、排序事实、生成 UI 更新

2. **单一写入者**
   - Surface Plane 只有 Manager 能写入
   - Worker 永远不能直接修改 UI 状态
   - 避免并发更新导致的闪烁/竞态

3. **安全边界**
   - Manager 验证所有证据来源
   - 拒绝未签名/未授权的事实
   - UI 组件使用声明式 schema，无任意代码执行

### OpenStar 实现

```typescript
// persistence.appendEvent() - Activity Journal
persistence.appendEvent({
  id: generateId(),
  session_id: sessionId,
  actor_id: actorId,
  event_type: "node_completed",
  payload: JSON.stringify({ nodeId, output }),
  timestamp: Date.now(),
  sequence: seq,
})

// canvas 渲染 - Surface Projection
const canvas = new WorkflowCanvas()
canvas.updateNodeStatus(nodeId, "completed")
const mermaid = canvas.exportMermaid()
```

## 生成式 UI（未来方向）

参考 HomeRail 的 A2UI 协议，OpenStar 未来支持：

```typescript
interface SurfaceUpdate {
  type: "patch" | "full"
  surfaceId: string
  components: Array<{
    id: string
    type: "HrGrid" | "HrMetric" | "HrTimeline" | "HrStatusBadge"
    props: Record<string, unknown>
  }>
  timestamp: number
}
```

安全约束：
- 无任意代码执行
- 无内联 HTML/CSS/JS
- 组件类型白名单
- 属性深度验证
