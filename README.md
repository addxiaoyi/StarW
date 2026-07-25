# OpenStar - 终端智能体平台

> StarCore 🚀 MCP 🌐 Skills + Agent Swarm Platform

**版本**: v0.1.0 | **状态**: 预发布阶段 | **构建**: ✅ 通过

---

## 🌟 项目愿景

构建下一代终端智能体操作系统，将经典 CLI/GUI 的能力与 AI Agent、MCP 工具生态和集群协作结合，
为开发者和用户提供统一智能操作平台。

---

## ⚡ 技术特色

| 特性            | 描述                                                                |
| --------------- | ------------------------------------------------------------------- |
| **MCP 协议**    | 原生集成 [Model Context Protocol](https://modelcontextprotocol.io/) |
| **Agent Swarm** | 多智能体协作与任务分发                                              |
| **Skills 系统** | 插件化技能扩展机制                                                  |
| **终端UX**      | Warp 风格美观响应式界面                                             |
| **本地优先**    | 数据隐私安全，离线可用                                              |
| **多平台**      | Windows/Linux/macOS 全平台支持                                      |

---

## 🏗️ 架构设计

### 核心模块

```
OpenStar/
├── packages/
│   ├── core/          # StarCore 核心 + 持久化 + 沙箱 + 插件 + 配置
│   ├── protocol/      # 消息契约 + 验证 Schema
│   ├── cli/           # 命令行工具 (Warp 风格)
│   ├── swarm/         # Agent 编排 + DAG 引擎 + Agent Runtime
│   ├── mcp/           # MCP 服务器 + 工具生态
│   ├── relay/         # API 代理 + 消息中继
│   ├── acp/           # Agent Client Protocol (编辑器集成)
│   ├── browser/       # 浏览器自动化
│   ├── canvas/        # 工作流可视化引擎
│   ├── claw/          # 功能解锁 (Feature Flags)
│   ├── marketplace/   # 插件市场
│   ├── pet/           # 桌面宠物状态机
│   ├── templates/     # 模板管理
│   ├── ui-web/        # Web 管理界面
│   └── desktop-electron/ # Electron 桌面应用
```

### 三层分离架构

```
┌─────────────────────────────────────────┐
│  Activity Plane  │ 只追加的事实记录          │
├─────────────────────────────────────────┤
│  Control Plane   │ Actor 身份 + 命令        │
├─────────────────────────────────────────┤
│  Surface Plane   │ UI 投影 (单向数据流)      │
└─────────────────────────────────────────┘
```

### 工具生态 (MCP)

| 类别            | 工具               | 描述            |
| --------------- | ------------------ | --------------- |
| **文件系统**    | `read_file`        | 读取文件内容    |
|                 | `write_file`       | 写入文件内容    |
|                 | `list_directory`   | 列出目录内容    |
| **Git 版本**    | `git_status`       | 获取 Git 状态   |
|                 | `git_log`          | 查看提交历史    |
|                 | `git_commit`       | 提交更改        |
| **Web 自动化**  | `http_get`         | 发送 HTTP 请求  |
|                 | `http_post`        | POST 请求       |
|                 | `fetch_html`       | 获取 HTML       |
| **系统操作**    | `execute_command`  | 执行 Shell 命令 |
|                 | `get_system_info`  | 获取系统信息    |
| **AI 增强**     | `summarize_text`   | 文本摘要        |
|                 | `extract_keywords` | 关键词提取      |
|                 | `code_review`      | 代码审查        |
| **Skills 管理** | `list_skills`      | 列出技能        |
|                 | `enable_skill`     | 启用技能        |
| **Agent 集群**  | `list_agents`      | 列出 Agent      |
|                 | `create_task`      | 创建任务        |
|                 | `get_swarm_status` | 查看集群状态    |

---

## 📦 快速开始

### 1. 安装依赖

```bash
# 使用 Bun 包管理器 (推荐)
bun install

# 或者使用 npm/yarn
npm install
```

### 2. 配置

```bash
# 创建默认配置文件
bun run --cwd packages/cli start --help
openstar config init
```

设置 API 密钥（环境变量或配置文件）：

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-..."
```

### 3. 启动核心组件

```bash
# 启动 CLI
bun run dev:cli

# 启动 Web UI
bun run dev        # http://localhost:3002

# 启动 Electron 桌面应用
bun run dev:desktop

# 构建 Windows 免安装便携版
bun run --cwd packages/desktop-electron build:win
# 输出: packages/desktop-electron/dist/OpenStar-<version>-portable-win-x64.exe

# 运行测试
bun test

# 类型检查
bun run typecheck
```

### 4. 运行 DAG 工作流

```bash
# 查看内置 DAG 模式
openstar dag patterns

# 运行一个内置模式 (如 pipeline)
openstar dag run pipeline
```

### 4. 交互式 TUI（对标 grok-build）

```bash
openstar tui            # 启动全屏交互式 TUI (↑/↓ 历史, Tab 补全, Ctrl+L 清屏)
openstar start          # 同上, 默认进入 TUI
openstar start --theme nebula   # 指定主题 (midnight|nebula|matrix|mono)
```

TUI 内置斜杠命令：`/help /status /skills /agents /dag /config /plugins /stats /theme /clear /exit`。

### 5. 后端网关（供 Web UI / Electron 接入真实引擎）

```bash
openstar gateway                 # 启动 HTTP/WS 网关 (默认 127.0.0.1:3456)
openstar serve                   # 无头 stdio JSON-RPC 服务 (供 Electron / 编辑器嵌入)
```

- Web UI 默认连接 `http://127.0.0.1:3456/acp`（ACP 协议），无需额外配置即可驱动真实引擎。
- Electron 桌面端内置最小 StarCore 引擎，不依赖系统安装 Bun，也不会降级为伪造数据。Windows 便携版将持久数据保存在 EXE 同目录的 `OpenStar-Data`。

### 6. CLI 命令参考

```bash
# 基础命令
openstar status         # 系统状态
openstar skills         # 列出所有技能
openstar agents         # 列出全部 Agent

# DAG 工作流
openstar dag patterns   # 列出内置 DAG 模式
openstar dag run <id>   # 运行 DAG 模式 (配置 provider 时跑真实 Agent, 否则离线 local 模式)

# Agent 执行
openstar agent providers   # 显示已配置的 LLM provider
openstar agent run "<task>"  # 运行单个 Agent 任务 (需配置 provider)

# 配置与插件
openstar config show    # 查看配置
openstar config init    # 生成默认配置
openstar agent providers
openstar plugins list
openstar stats          # 持久化统计

# 后端 / 集成
openstar mcp            # 启动 OpenStar MCP 服务器
openstar gateway        # 启动 Web UI 后端网关 (127.0.0.1:3456)
openstar serve          # 无头 stdio JSON-RPC 服务 (Electron/编辑器嵌入)

# 开发
openstar build          # 真实构建 (tsc 校验每个包)
openstar test           # 运行测试套件
```

> DAG 与 Agent 运行时 (`DagExecutor` + `AgentRuntime`) 在检测到 `openai`/`anthropic`/`kimi` 的
> `apiKey` 时自动接入真实 LLM 与工具执行器；未配置时降级为离线 `local` 模式，工作流仍端到端可演示。

---

## 🤖 MCP 服务器开发

### 启动 MCP 服务器

```bash
cd packages/mcp

# 开发模式
bun run dev

# 构建测试
bun run build
```

### 调用 MCP 工具

以本地 MCP 服务器为中心，支持所有工具模块：

```typescript
// 文件操作
mcp> call read_file --path "README.md"

// Git 操作
mcp> call git_status
mcp> call git_commit --message "Update docs"

// Web 和 API
mcp> call http_get --url "https://api.github.com/users/openstar"

// AI 增强
mcp> call summarize_text --text "这是一段很长的文本..." --maxLength 200

// 技能管理
mcp> call list_skills --category development
mcp> call enable_skill --name git

// Agent 集群
mcp> call list_agents --status running
mcp> call create_task --description "Review PR #123" --priority high
```

---

## 📱 平台特性

### ✨ CLI 交互式 REPL

- **Warp 风格** 现代终端交互
- **Tab 自动补全** 支持命令补全
- **命令历史记录** 便捷回溯
- **实时进度** 可视化加载指示
- **主题系统** 深/浅色主题切换

### 🌐 Web UI 界面

- **Solid.js** 响应式前端框架
- **Tailwind CSS** 现代化CSS方案
- **Vite** 快速 HMR 开发
- **响应式布局** 适配各种屏幕

### 🖥️ Electron 桌面应用

- **Windows 免安装** 单文件 portable EXE，双击直接运行
- **数据可迁移** 配置和数据库保存在 EXE 同目录的 `OpenStar-Data`
- **独立窗口** 封装为桌面应用
- **系统集成** 菜单栏、通知中心
- **开发者工具** 集成调试工具
- **多窗口** 支持同时打开多个终端

### 🤖 Agent Swarm 集群

- **角色划分** Coordinator、Worker、Monitor、Analyzer
- **负载均衡** 智能任务分配
- **故障转移** 自动失败恢复
- **性能监控** 实时状态监控
- **集群管理** 拓扑可视化

### 🔌 Skills 插件系统

- **技能分类** VCS、DevOps、AI、系统、工具...
- **动态加载** 热插拔技能模块
- **能力隔离** 安全沙盒运行
- **扩展性** 第三方开发者可自定义

---

## 🛠️ 工具开发指南

### 1. 创建新工具集

```typescript
// packages/mcp/src/tools/new-toolset.ts
import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const newToolset = {
  name: "newtool",
  description: "新工具集描述",
  tools: [
    {
      name: "new_tool",
      description: "工具描述",
      inputSchema: z.object({
        param1: z.string().describe("参数1"),
        param2: z.number().optional().describe("可选参数"),
      }),
      handler: async (args: any) => {
        // 实现逻辑
        return { success: true, args };
      },
    } as Tool,
  ],
};
```

### 2. 在服务器注册

```typescript
// packages/mcp/src/index.ts
import { newToolset } from "./tools/new-toolset";

// 在 registerAllTools() 函数中添加
await mcpServer.registerToolSet(newToolset);
```

### 3. 工具约束

- ✅ 必须返回结构化 JSON
- ✅ 添加清晰的 zod 验证 schema
- ✅ 包含成功/失败状态
- ✅ 添加文档注释和例子
- ✅ 无状态设计 (避免全局变量污染)

---

## 🚀 开发路线图

### Phase 1: 基础框架 ✅

- [x] 项目基础结构搭建
- [x] MCP 协议集成
- [x] CLI 基础命令
- [x] Electron 桌面集成
- [x] Skills 系统定义
- [x] Agent 协作框架

### Phase 2: 核心功能 🔄

- [ ] Web UI 完整界面
- [ ] Skill 市场集成
- [ ] 完整安全沙箱
- [ ] 插件管理系统
- [ ] 用户系统集成
- [ ] 插件市场和分发

### Phase 3: 高级特性 🔧

- [ ] AI 原生集成增强
- [ ] 智能代码助手
- [ ] 自动化工作流
- [ ] 极致性能优化
- [ ] 多语言支持
- [ ] 跨平台发布包

### Phase 4: 发布 🎉

- [ ] v1.0.0 稳定版发布
- [ ] CLI 官方包发布
- [ ] 文档完善
- [ ] 社区生态建立
- [ ] 开发者计划启动

---

## 🎯 开发实践

### 技术选择

- **语言**: TypeScript + Bun
- **框架**: Solid.js (web), Electron (桌面)
- **协议**: MCP (Model Context Protocol)
- **状态管理**: Custom context/store
- **多线程**: Worker + Agent Swarm
- **配置**: Zod 运行时验证

### 代码规范

- ESLint + Prettier 代码格式化
- Commitizen + Conventional Commits 提交规范
- TypeScript 严格类型检查
- 包导出严格命名导出
- 单元测试 (Jest/Vitest)

### 安全原则

- 代码沙箱隔离
- 命令行黑名单过滤
- 文件系统权限控制
- 网络请求白名单
- Agent 通信加密

---

## 🤝 社区参与

> OpenStar 欢迎一切形式的贡献！

### 贡献方式

1. **Bug 报告** → 提交 Issue
2. **功能需求** → 提交 Issue 或 Pull Request
3. **文档完善** → 贡献 Wiki 或 Readme
4. **工具开发** → 自定义 Skill 插件
5. **设计建议** → UI/UX 改进建议

### 开源许可

MIT License

### 联系方式

- 📧 Email: openstar-project@googlegroups.com
- 💬 Discord: https://discord.gg/openstar
- 📖 Wiki: /wiki (待创建)

---

## 📖 项目文档

| 文档         | 链接                 |
| ------------ | -------------------- |
| **架构设计** | docs/ARCHITECTURE.md |
| **API 文档** | docs/API.md          |
| **工具指南** | docs/TOOLS.md        |
| **部署指南** | docs/DEPLOYMENT.md   |
| **贡献指南** | CONTRIBUTING.md      |
| **安全策略** | SECURITY.md          |
| **更新日志** | CHANGELOG.md         |

---

## 📊 统计信息

### 代码统计 (约估计)

- **TypeScript**: ~15,000+ 行
- **测试覆盖率**: 待添加
- **MCP 工具**: 30+ 工具
- **Skill 分类**: 5+ 大类
- **Agent 角色**: 4+ 扩展点

### 模块统计

```bash
packages/core     - StarCore 系统 (TypeScript)
packages/cli      - Warp 风格 REPL (TypeScript)
packages/mcp      - MCP 服务器 + 30+ 工具 (TypeScript)
packages/swarm    - Agent集群 (TypeScript)
packages/ui-web   - Web 管理界面 (Solid.js + Tailwind)
packages/desktop-electron - Electron桌面 (Warp UI)
packages/relay    - 中继服务 (代理转发)
```

MIT License

## Windows 便携版运行时

Windows 桌面版直接使用随应用打包的 StarCore Engine，不需要单独启动 `127.0.0.1:3456` ACP 服务。终端命令、文件操作、Skills、Agent/Swarm、MCP、配置和模型对话均通过 Electron IPC 连接内置 JSON-RPC Engine。

- **终端**：在配置的工作区内执行真实系统命令，支持实时 stdout/stderr 事件和取消；当前不是 PTY，交互式全屏 TUI 程序不在支持范围。
- **文件**：目录浏览、读取、编辑与保存均限制在配置工作区内，单文件预览和写入上限为 5 MiB。
- **模型**：在设置中配置 OpenAI、Anthropic 或 Kimi 的 API Key、Base URL 和模型。未配置凭据时会明确报错，不生成模拟回复。
- **Agent/Swarm**：提交真实模型任务或内置工具任务，并显示任务状态、结果和错误。
- **MCP**：设置页使用 JSON 配置 stdio MCP Server；连接、工具发现和调用由官方 MCP SDK 完成。
- **Browser**：对 HTTP/HTTPS URL 做安全校验后交给系统默认浏览器打开，不使用伪造网页或模拟 DOM。
- **便携数据**：配置、会话、日志和 Chromium 数据保存在 EXE 同目录的 `OpenStar-Data`。
