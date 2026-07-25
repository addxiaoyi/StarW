# AGENTS.md - OpenStar Agent Swarm

**OpenStar** - 终端智能体平台，基于 Warp + OpenCode 架构设计

## Agent 角色

### 1. Coordinator (协调者)
- **职责**: 任务分解与分配
- **技能**: 任务规划、优先级判断、状态追踪
- **协作**: 与 Worker、Monitor 通信

### 2. Worker (工作者)
- **职责**: 执行具体任务
- **技能**: 代码编写、调试、测试
- **协作**: 接收 Coordinator 指令，报告进度

### 3. Monitor (监控者)
- **职责**: 系统状态监控
- **技能**: 性能分析、日志分析、告警
- **协作**: 定期报告系统健康状态

### 4. Analyzer (分析者)
- **职责**: 深度分析与决策支持
- **技能**: 代码审查、性能分析、安全审计
- **协作**: 提供分析报告供决策参考

## 通信协议

### 消息格式
```json
{
  "type": "task|status|result|error",
  "from": "agent-id",
  "to": "agent-id|all",
  "payload": {},
  "timestamp": 1234567890
}
```

### 任务状态
- `pending` - 等待处理
- `running` - 执行中
- `completed` - 已完成
- `failed` - 失败
- `cancelled` - 已取消

## Swarm 配置

### 并行度
- 最大并发任务: 5
- Agent 池大小: 3-10
- 任务队列长度: 100

### 负载均衡
- 基于技能匹配
- 基于当前负载
- 基于历史表现

## MCP 工具集成

每个 Agent 可通过 MCP 协议调用工具:

```bash
# 文件操作
mcp> call read_file --path "README.md"

# Git 操作
mcp> call git_status

# Web 请求
mcp> call http_get --url "https://api.github.com"

# AI 增强
mcp> call summarize_text --text "..." --maxLength 200
```

## 项目架构

```
packages/
├── core/              # StarCore 核心 + 持久化 + 沙箱 + 插件 + 配置
├── protocol/          # 消息契约 + 验证 Schema
├── cli/               # 命令行界面
├── ui-web/            # Web UI (Solid.js + Vite)
├── desktop-electron/  # Electron 桌面应用
├── swarm/             # Agent Swarm 编排器 + DAG 引擎 + Agent Runtime
├── mcp/               # MCP 服务器管理 (51 工具)
├── relay/             # API 代理 + 消息中继
├── acp/               # Agent Client Protocol (编辑器集成)
├── browser/           # 浏览器自动化 (Playwright)
├── canvas/            # 工作流画布引擎
├── claw/              # 功能解锁 (Feature Flags)
├── marketplace/       # 插件市场
├── pet/               # 桌面宠物状态机
├── templates/         # 模板管理
└── canvas/            # 画布引擎
```

## 核心设计模式

1. **Entity-Handle System** - 视图通过 handle 引用
2. **Modular Structure** - 模块化包结构
3. **Cross-Platform** - 跨平台支持
4. **AI Integration** - 内置 AI 助手集成
5. **Skill + MCP Ecosystem** - 技能和 MCP 生态

## 代码风格

- TypeScript 严格模式
- `effect` 库进行函数式编程
- `zod` 进行运行时验证
- `picocolors` 终端着色
- `cac` CLI 参数解析
- 优先使用 Bun

## Pull Request 工作流

1. 运行 `bun run typecheck` 确保类型检查通过
2. 运行 `bun test` 确保测试通过
3. 创建 PR 时使用 PR 模板
4. 添加 changelog 条目：
   - `CHANGELOG-NEW-FEATURE:` 新功能
   - `CHANGELOG-IMPROVEMENT:` 改进
   - `CHANGELOG-BUG-FIX:` 修复

## MCP 服务器工具

项目集成了多个 MCP 工具集：

| 工具集 | 工具数 | 描述 |
|--------|--------|------|
| filesystem | 10 | 文件系统操作 |
| git | 10 | Git 版本控制 |
| web | 5 | Web 自动化 |
| system | 7 | 系统操作 |
| ai | 5 | AI 增强 |
| skills | 5 | 技能管理 |
| agents | 9 | Agent 集群 |

**总计: 51 个工具**
