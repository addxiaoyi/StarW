# 开发计划：集成三大特性

## 🧩 1. 插件系统集成
```typescript
// 在 main.ts 中添加：
import { pluginManager } from './plugins/manager'
import { config } from './config/config'

// REPL 启动前初始化插件
async function startOpenStar() {
  await pluginManager.initialize()
  await pluginManager.loadAll()

  const skills = await pluginManager.getAllSkills()
  CLISkills.push(...skills)

  await openstar.startREPL()
}
```

## 🎨 2. 主题系统集成
```typescript
// 更新 terminal.ts：
import { getThemeByName } from '../themes/colors'

// 添加主题支持
class Terminal extends EventEmitter {
  private theme: Theme

  constructor(options: TerminalOptions = {}) {
    const theme = getThemeByName(config.theme.name)
    this.theme = theme

    // 使用主题颜色设置终端
    super()
    this.prompt = theme.colors.prompt
  }
}
```

## ⌨️ 3. 命令历史增强
```typescript
// 在 starcore.ts 中添加：
private setupReadline() {
  // ↑/↓ 历史导航
  this.rl?.on('keypress', (str, key) => {
    if (key.name === 'up' || key.name === 'pageup') {
      if (this.historyIndex > 0) {
        this.historyIndex--
        this.rl?.prompt()
        this.rl?.write(this.commandHistory[this.historyIndex])
      }
    } else if (key.name === 'down' || key.name === 'pagedown') {
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++
        this.rl?.write(null, { ctrl: true, name: 'u' })
        this.rl?.write(this.commandHistory[this.historyIndex])
      }
    }
  })
}
```

## 🔧 集成步骤

1. **定义新命令**
```bash
/theme       # 切换主题
/plugin      # 管理插件
/history     # 查看历史命令
```

2. **主题命令实现**
```typescript
private showThemes() {
  const themes = getAvailableThemes()
  const table = new Table({
    head: ['名称', '模式', '描述']
  })

  themes.forEach(t => {
    table.push([
      blue(t.name),
      t.mode === 'dark' ? '暗色' : '亮色',
      t.description
    ])
  })

  console.log(table.toString())
}
```

3. **插件管理命令**
```typescript
private showPlugins() {
  const plugins = pluginManager.getLoadedPlugins()
  const table = new Table({
    head: ['ID', '名称', '类型', '状态']
  })

  plugins.forEach(plugin => {
    table.push([
      plugin.id,
      plugin.name,
      plugin.type,
      plugin.enabled ? '已启用' : '已禁止'
    ])
  })

  console.log(table.toString())
}
```

4. **修改后的终端基类**
```typescript
export interface EnhancedTerminal {
  commandHistory: string[]
  getHistory(): string[]
  setTheme(themeName: string): void
  theme(): Theme
  loadPlugins(): Promise<void>
}
```
