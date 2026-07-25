# CLAUDE.md - OpenStar

**OpenStar** - 终端智能体平台，集成 Skill + MCP 生态和 Agent Swarm

## 项目架构

### 核心组件
- **core/** - StarCore 核心引擎
- **cli/** - 命令行界面 (基于 cac)
- **ui-web/** - Web UI (Solid.js + Vite)
- **desktop-electron/** - Electron 桌面应用
- **swarm/** - Agent Swarm 编排器
- **mcp/** - MCP 服务器 (51 工具)
- **pet/** - 桌面宠物引擎
- **canvas/** - 画布引擎

### 架构参考
- **warp-master/** - Warp 终端架构模式
- **opencode-dev/** - OpenCode 优化实践

## 开发命令

```bash
# MCP 服务器
bun run --cwd packages/mcp dev

# Web UI
bun run dev              # http://localhost:3000

# CLI
bun run dev:cli

# Electron 桌面
cd packages/desktop-electron && bunx electron .

# 类型检查
bun run typecheck

# 测试
bun test
```

## MCP 工具 (51 工具)

| 工具集 | 数量 | 类别 |
|--------|------|------|
| filesystem | 10 | 文件系统 |
| git | 10 | 版本控制 |
| web | 5 | Web 自动化 |
| system | 7 | 系统操作 |
| ai | 5 | AI 增强 |
| skills | 5 | 技能管理 |
| agents | 9 | Agent 集群 |

## 代码风格

- TypeScript 严格模式
- `effect` 库进行函数式编程
- `zod` 进行运行时验证
- `picocolors` 终端着色
- `cac` CLI 参数解析
- 优先使用 Bun
