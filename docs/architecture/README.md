# OpenStar 架构设计

本文档描述 OpenStar 的核心架构设计，参考了 HomeRail 和 Grok Build 的优秀实践。

## 1. 系统分层

```
┌─────────────────────────────────────────────────────────────┐
│                        UI 层                                  │
│  CLI (cac)  │  Web UI (Solid.js)  │  Electron  │  ACP        │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                    协议层 (protocol)                           │
│  消息契约  │  验证 Schema  │  事件  │  控制命令                  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                  核心层 (core)                                 │
│  StarCore  │  Persistence(SQLite)  │  Sandbox(Docker)  │  Plugins │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│              编排层 (swarm + mcp + relay)                      │
│  AgentOrchestrator  │  DagEngine  │  AgentRuntime  │  MCP      │
└─────────────────────────────────────────────────────────────┘
```

## 2. 三层分离架构（借鉴 HomeRail）

| 平面 | 职责 | OpenStar 实现 |
|------|------|--------------|
| **Activity Plane** | 只追加的事实记录 | `persistence.appendEvent()` 活动日志 |
| **Control Plane** | actor 身份和命令 | `protocol.ControlCommand` |
| **Surface Plane** | UI 投影 | Web UI + Canvas 渲染 |

## 3. DAG 工作流引擎

- 节点独立上下文，支持不同模型
- 显式边缘传递证据
- 拓扑排序并行执行
- 内置模式库：orchestrator-workers, double-check, pipeline, issue-diagnosis, heartbeat-monitor
- 循环检测保证 DAG 有效性

## 4. Agent Runtime

- 多 Provider 支持：OpenAI / Anthropic / Kimi
- 真实 Agent 循环（工具调用闭环）
- 可插拔工具执行器
- 流式输出支持

## 5. 持久化

- SQLite (better-sqlite3) 存储会话、任务、检查点、事件
- WAL 模式提升并发
- 活动日志只追加

## 6. 安全沙箱

- Docker 容器隔离（Worker 级别）
- 路径白名单 + 敏感文件拦截
- 命令黑名单
- 降级到进程级沙箱（无 Docker 环境）

## 7. 插件系统

- 声明式 PluginManifest
- HRP 包格式（tar.gz）
- 贡献点：DAG 模式、Agent 定义、技能、MCP 工具
- 权限代理

## 8. 包结构

| 包 | 职责 | 状态 |
|----|------|------|
| `@openstar/core` | StarCore + 持久化 + 沙箱 + 插件 | ✅ |
| `@openstar/protocol` | 消息契约 + 验证 | ✅ |
| `@openstar/swarm` | 编排 + DAG + Agent Runtime | ✅ |
| `@openstar/mcp` | MCP 服务器 + 工具 | ✅ |
| `@openstar/relay` | API 代理 + 消息中继 | ✅ |
| `@openstar/cli` | 命令行 | ✅ |
| `@openstar/ui-web` | Web UI | 🟡 |
| `@openstar/desktop-electron` | 桌面应用 | 🟡 |
| `@openstar/acp` | Agent Client Protocol | ✅ |
| `@openstar/browser` | 浏览器自动化 | ✅ |
| `@openstar/canvas` | 工作流画布 | ✅ |
| `@openstar/claw` | 功能解锁 | ✅ |
| `@openstar/marketplace` | 插件市场 | ✅ |
| `@openstar/pet` | 桌面宠物 | ✅ |
| `@openstar/templates` | 模板管理 | ✅ |
