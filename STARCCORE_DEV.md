# StarCore - 基于 Warp + OpenCode 的二次开发

## 项目定位

**StarCore** 是基于 warp-master 架构进行二次开发的终端管理智能体，集成了 opencode 的现代优化实践。

### 核心参考

- **warp-master/** - Warp 终端的完整架构
- **packages/opencode-dev/** - OpenCode 的优化方案

## 架构设计

### 基于 Warp 的模块化结构

```
starcore/
├── app/                    # 应用程序入口 (参考 warp/app/)
│   ├── src/
│   │   ├── lib.rs         # 主库入口
│   │   ├── main.rs        # 应用程序入口
│   │   ├── app_state.rs   # 应用状态管理
│   │   ├── root_view.rs   # 根视图
│   │   ├── tab.rs         # 标签页管理
│   │   ├── menu.rs        # 菜单系统
│   │   ├── terminal/      # 终端组件
│   │   ├── settings/      # 设置系统
│   │   ├── theme/         # 主题系统
│   │   ├── ai/            # AI 助手集成
│   │   └── platform/      # 平台特定代码
│   └── Cargo.toml
├── crates/                 # 核心库 (参考 warp/crates/)
│   ├── starcore_cli/      # CLI 工具
│   ├── starcore_tui/      # TUI 组件
│   ├── starcore_terminal/ # 终端模拟
│   ├── starcore_mcp/      # MCP 协议
│   ├── starcore_swarm/    # Agent Swarm
│   ├── starcore_ai/       # AI 集成
│   ├── starcore_ui/       # UI 组件库
│   └── ...
└── Cargo.toml             # Workspace 配置
```

## 核心功能模块

### 1. 终端管理 (Terminal)
- 多标签页终端
- 分屏管理
- 会话持久化
- 命令自动补全

### 2. AI 助手 (AI Assistant)
- 内置 AI 对话
- 命令建议
- 代码解释
- 自然语言转命令

### 3. MCP 集成 (MCP Protocol)
- MCP 服务器连接
- 工具调用
- 资源管理
- 提示模板

### 4. Agent Swarm
- 多代理协作
- 任务分解
- 代理调度
- 状态同步

### 5. 技能系统 (Skills)
- 技能市场
- 动态加载
- 技能编排
- 版本管理

## 开发进度

### Phase 1: 基础架构 ✅
- [x] 项目结构设计
- [x] Workspace 配置
- [x] 核心模块划分

### Phase 2: 应用程序框架 (当前)
- [ ] 应用入口
- [ ] 主窗口
- [ ] 状态管理
- [ ] 事件系统

### Phase 3: 终端核心
- [ ] PTY 管理
- [ ] Shell 集成
- [ ] 会话管理

### Phase 4: AI 集成
- [ ] AI 接口
- [ ] 对话系统
- [ ] 命令建议

### Phase 5: MCP & Swarm
- [ ] MCP 协议
- [ ] Agent 系统
- [ ] 任务编排

## 技术栈

- **语言**: Rust
- **构建**: Cargo
- **UI**: 基于 warp 的组件系统
- **协议**: MCP (Model Context Protocol)
- **AI**: 集成 OpenAI/Anthropic API

## 编译和运行

```bash
# 开发模式
cargo build --workspace

# 运行应用
cargo run --package starcore

# 运行 CLI
cargo run --package starcore_cli

# 运行测试
cargo test --workspace

# 代码检查
cargo clippy --workspace
```

## 参考文档

- [Warp 架构文档](./warp-master/AGENTS.md)
- [Warp 贡献指南](./warp-master/CONTRIBUTING.md)
- [Cargo 工作空间配置](./warp-master/Cargo.toml)
