# OpenStar MCP 工具使用指南

> StarCore 平台集成了强大的 MCP 工具生态，提供文件系统、Git 版本控制、Web 自动化、系统操作、AI 增强、技能管理和 Agent 集群等功能。

## 📚 目录

- [快速开始](#快速开始)
- [工具分类](#工具分类)
  - [文件系统工具](#文件系统工具)
  - [Git 工具](#git-工具)
  - [Web 工具](#web-工具)
  - [系统工具](#系统工具)
  - [AI 工具](#ai-工具)
  - [技能工具](#技能工具)
  - [Agent 工具](#agent-工具)
- [使用示例](#使用示例)
- [最佳实践](#最佳实践)

---

## 🚀 快速开始

### 启动 MCP 服务器

```bash
cd packages/mcp
bun run dev
```

### 基本调用格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {
      "param1": "value1",
      "param2": "value2"
    }
  }
}
```

---

## 🛠️ 工具分类

### 文件系统工具 (`filesystem`)

| 工具 | 描述 | 参数 |
|------|------|------|
| `read_file` | 读取文件内容 | `path`, `encoding`? |
| `write_file` | 写入文件 | `path`, `content`, `encoding`? |
| `append_file` | 追加内容 | `path`, `content` |
| `list_directory` | 列出目录 | `path`?, `recursive`? |
| `create_directory` | 创建目录 | `path`, `recursive`? |
| `delete_file` | 删除文件 | `path`, `force`? |
| `copy_file` | 复制文件 | `source`, `destination` |
| `move_file` | 移动文件 | `source`, `destination` |
| `get_file_info` | 获取文件信息 | `path` |
| `search_files` | 搜索文件 | `pattern`, `directory`? |

#### 示例

```json
// 读取文件
{
  "name": "read_file",
  "arguments": { "path": "README.md" }
}

// 写入文件
{
  "name": "write_file",
  "arguments": {
    "path": "test.txt",
    "content": "Hello OpenStar!"
  }
}

// 搜索文件
{
  "name": "search_files",
  "arguments": {
    "pattern": "*.ts",
    "directory": "src"
  }
}
```

---

### Git 工具 (`git`)

| 工具 | 描述 | 参数 |
|------|------|------|
| `git_status` | 获取状态 | `cwd`? |
| `git_log` | 提交历史 | `cwd`?, `limit`?, `format`? |
| `git_branch` | 分支列表 | `cwd`?, `all`? |
| `git_diff` | 文件差异 | `path`?, `staged`?, `cwd`? |
| `git_commit` | 提交更改 | `message`, `cwd`? |
| `git_add` | 暂存文件 | `path`, `cwd`? |
| `git_checkout` | 切换分支 | `branch`, `newBranch`?, `cwd`? |
| `git_pull` | 拉取更新 | `cwd`?, `rebase`? |
| `git_push` | 推送提交 | `cwd`?, `setUpstream`? |
| `git_remote` | 远程信息 | `cwd`? |

#### 示例

```json
// 查看状态
{
  "name": "git_status",
  "arguments": { "cwd": "/path/to/repo" }
}

// 提交代码
{
  "name": "git_commit",
  "arguments": {
    "message": "feat: add new MCP tool",
    "cwd": "."
  }
}

// 查看提交历史
{
  "name": "git_log",
  "arguments": {
    "limit": 20,
    "format": "%h %s %an"
  }
}
```

---

### Web 工具 (`web`)

| 工具 | 描述 | 参数 |
|------|------|------|
| `http_get` | GET 请求 | `url`, `headers`?, `timeout`? |
| `http_post` | POST 请求 | `url`, `body`, `headers`?, `contentType`? |
| `fetch_html` | 获取 HTML | `url`, `selector`? |
| `check_url` | 检查 URL | `url`, `method`? |
| `extract_links` | 提取链接 | `html`, `baseUrl`? |

#### 示例

```json
// GET 请求
{
  "name": "http_get",
  "arguments": {
    "url": "https://api.github.com/repos/openstar/core",
    "headers": { "User-Agent": "OpenStar/1.0" }
  }
}

// POST 请求
{
  "name": "http_post",
  "arguments": {
    "url": "https://api.example.com/data",
    "body": { "key": "value" },
    "contentType": "application/json"
  }
}

// 检查网站可访问性
{
  "name": "check_url",
  "arguments": {
    "url": "https://example.com",
    "method": "HEAD"
  }
}
```

---

### 系统工具 (`system`)

| 工具 | 描述 | 参数 |
|------|------|------|
| `execute_command` | 执行命令 | `command`, `cwd`?, `timeout`?, `shell`? |
| `get_system_info` | 系统信息 | - |
| `get_process_list` | 进程列表 | `filter`?, `limit`? |
| `kill_process` | 终止进程 | `pid`, `force`? |
| `get_env` | 获取环境变量 | `name`? |
| `set_env` | 设置环境变量 | `name`, `value` |
| `get_disk_usage` | 磁盘使用 | `path`? |

#### 示例

```json
// 执行命令
{
  "name": "execute_command",
  "arguments": {
    "command": "ls -la",
    "cwd": "/home/user",
    "timeout": 5000
  }
}

// 获取系统信息
{
  "name": "get_system_info",
  "arguments": {}
}

// 查看进程
{
  "name": "get_process_list",
  "arguments": {
    "filter": "node",
    "limit": 20
  }
}
```

---

### AI 工具 (`ai`)

| 工具 | 描述 | 参数 |
|------|------|------|
| `summarize_text` | 文本摘要 | `text`, `maxLength`?, `format`? |
| `extract_keywords` | 关键词提取 | `text`, `limit`? |
| `analyze_sentiment` | 情感分析 | `text` |
| `code_review` | 代码审查 | `code`, `language`? |
| `translate_text` | 翻译文本 | `text`, `from`?, `to` |

#### 示例

```json
// 文本摘要
{
  "name": "summarize_text",
  "arguments": {
    "text": "这是一段很长的文本内容...",
    "maxLength": 200,
    "format": "bullet"
  }
}

// 代码审查
{
  "name": "code_review",
  "arguments": {
    "code": "function example() {\n  console.log('debug')\n  // TODO: fix later\n  return true\n}",
    "language": "javascript"
  }
}

// 情感分析
{
  "name": "analyze_sentiment",
  "arguments": {
    "text": "这个项目太棒了！我非常喜欢它的设计。"
  }
}

// 翻译
{
  "name": "translate_text",
  "arguments": {
    "text": "你好世界",
    "to": "en"
  }
}
```

---

### 技能工具 (`skills`)

| 工具 | 描述 | 参数 |
|------|------|------|
| `list_skills` | 列出技能 | `category`?, `enabled`? |
| `get_skill_info` | 技能详情 | `name` |
| `enable_skill` | 启用技能 | `name` |
| `disable_skill` | 禁用技能 | `name` |
| `execute_skill` | 执行技能 | `name`, `command`, `args`? |
| `search_skills` | 搜索技能 | `query` |

#### 示例

```json
// 列出所有技能
{
  "name": "list_skills",
  "arguments": { "category": "development" }
}

// 执行技能
{
  "name": "execute_skill",
  "arguments": {
    "name": "git",
    "command": "status",
    "args": { "cwd": "." }
  }
}

// 搜索技能
{
  "name": "search_skills",
  "arguments": { "query": "docker" }
}
```

---

### Agent 工具 (`agents`)

| 工具 | 描述 | 参数 |
|------|------|------|
| `list_agents` | 列出 Agent | `status`? |
| `get_agent_info` | Agent 详情 | `id` |
| `create_task` | 创建任务 | `description`, `priority`?, `agentId`?, `tags`? |
| `assign_task` | 分配任务 | `taskId`, `agentId` |
| `get_task_status` | 任务状态 | `taskId` |
| `cancel_task` | 取消任务 | `taskId`, `reason`? |
| `get_swarm_status` | 集群状态 | - |
| `spawn_agent` | 启动 Agent | `name`, `role`, `skills`? |
| `stop_agent` | 停止 Agent | `agentId`, `force`? |

#### 示例

```json
// 查看运行中的 Agent
{
  "name": "list_agents",
  "arguments": { "status": "running" }
}

// 创建任务
{
  "name": "create_task",
  "arguments": {
    "description": "分析代码库并生成报告",
    "priority": "high",
    "tags": ["analysis", "report"]
  }
}

// 分配任务
{
  "name": "assign_task",
  "arguments": {
    "taskId": "task-123",
    "agentId": "executor-001"
  }
}

// 获取集群状态
{
  "name": "get_swarm_status",
  "arguments": {}
}

// 启动新 Agent
{
  "name": "spawn_agent",
  "arguments": {
    "name": "CodeReviewer",
    "role": "analyzer",
    "skills": ["code-review", "git"]
  }
}
```

---

## 📋 使用示例

### 完整工作流示例

```json
// 1. 创建代码审查任务
{
  "name": "create_task",
  "arguments": {
    "description": "Review PR #456: Add user authentication",
    "priority": "high",
    "tags": ["review", "security"]
  }
}

// 响应:
{
  "success": true,
  "taskId": "task-1709900000000-abc123",
  "status": "pending",
  "createdAt": "2026-07-15T10:00:00.000Z"
}

// 2. 分配给分析 Agent
{
  "name": "assign_task",
  "arguments": {
    "taskId": "task-1709900000000-abc123",
    "agentId": "analyzer-001"
  }
}

// 3. 使用代码审查工具
{
  "name": "code_review",
  "arguments": {
    "code": "function auth(user, pass) {\n  if(user === 'admin' && pass === '123') return true\n  return false\n}",
    "language": "javascript"
  }
}

// 4. 获取任务状态
{
  "name": "get_task_status",
  "arguments": {
    "taskId": "task-1709900000000-abc123"
  }
}
```

---

## ✅ 最佳实践

### 1. 错误处理

```json
// 响应可能包含错误
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Error: File not found"
    }
  ]
}
```

### 2. 参数验证

使用 `?` 标记可选参数，确保提供必需参数。

### 3. 路径处理

- 使用绝对路径避免歧义
- Windows 使用 `\\` 或 `/`
- 考虑跨平台兼容性

### 4. 超时设置

对于长时间运行的命令，设置合理的 `timeout`：

```json
{
  "name": "execute_command",
  "arguments": {
    "command": "npm install",
    "timeout": 120000
  }
}
```

### 5. 批量操作

对于批量文件操作，使用 `list_directory` + 循环处理。

---

## 🔗 相关资源

- [MCP 协议规范](https://modelcontextprotocol.io/)
- [StarCore 核心文档](../core/README.md)
- [Agent Swarm 指南](../swarm/README.md)
- [Skills 系统文档](../skills/README.md)

---

**版本**: v0.1.0
**更新**: 2026-07-15
