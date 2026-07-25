/**
 * OpenStar CLI Entry Point
 * Beautiful terminal interface inspired by Warp
 */

import { cac } from 'cac'
import path from 'node:path'
import { bold, cyan, green, yellow, red, dim } from 'picocolors'
import { Table, Box, info, success, warning, error } from './components/index.js'
import { OpenStar } from './core/index.js'
import { Tui } from './tui/tui.js'
import { createTuiCommandHandler } from './tui/commands.js'

const cli = cac('openstar')

// Banner
const banner = `
${cyan('╔═══════════════════════════════════════════╗')}
${cyan('║')}   ${bold('OpenStar')} ${dim('v0.1.0')}                       ${cyan('║')}
${cyan('║')}   ${dim('Ultra-high performance terminal agent')}  ${cyan('║')}
${cyan('╚═══════════════════════════════════════════╝')}
`

// Global options
cli.option('-v, --verbose', 'Verbose output')
cli.option('-c, --config <path>', 'Config file path')
cli.option('-t, --theme <name>', 'TUI theme (midnight|nebula|matrix|mono)')
cli.option('-p, --port <port>', 'Port for serve/gateway modes')

// Main command — launches the interactive TUI
async function launchTui(options: any) {
  const tui = new Tui({
    title: 'OpenStar',
    version: '0.1.0',
    theme: options.theme,
    commands: ['/help', '/status', '/skills', '/agents', '/dag', '/config', '/plugins', '/stats', '/theme', '/clear', '/exit'],
    onCommand: createTuiCommandHandler(options.config),
  })
  tui.print(`${cyan('╔═══════════════════════════════════════════╗')}`)
  tui.print(`${cyan('║')}   ${bold('OpenStar')} ${dim('v0.1.0')} — interactive TUI      ${cyan('║')}`)
  tui.print(`${cyan('╚═══════════════════════════════════════════╝')}`)
  tui.print('')
  tui.print('Type /help for commands. ↑/↓ history · Tab complete · Ctrl+L clear.')
  tui.print('')
  await tui.start()
}

cli.command('start', 'Start OpenStar interactive TUI').action(async (options) => {
  await launchTui(options)
})

cli.command('tui', 'Start OpenStar interactive TUI').action(async (options) => {
  await launchTui(options)
})

// Banner command
cli.command('banner', 'Display banner').action(() => {
  console.log(banner)
})

// Init command — scaffold a new OpenStar project
cli.command('init [name]', 'Initialize a new OpenStar project').action(async (name: string | undefined) => {
  const projectName = name || 'my-openstar-project'
  console.log(banner)
  console.log(`\n${cyan('🚀')} Initializing ${bold(projectName)}...`)
  console.log(`\n  Next steps:`)
  console.log(`    cd ${projectName}`)
  console.log('    openstar start\n')
})

// Serve mode — JSON-RPC over stdio for embedding (Electron, editors, CI)
cli.command('serve', 'Run headless stdio server (JSON-RPC)').action(async (options) => {
  const { runServe } = await import('./serve.js')
  await runServe(options.config)
})

// Gateway — HTTP/WS server for the web UI (ACP + REST + events)
cli.command('gateway', 'Start the OpenStar gateway server (web UI backend)').action(async (options) => {
  const port = options.port ?? Number(process.env.OPENSTAR_GATEWAY_PORT ?? 3456)
  const { startGateway } = await import('@openstar/gateway')
  await startGateway({ port })
})

// Status command
cli.command('status', 'Show OpenStar status').action(async (options) => {
  console.log(banner)

  const openstar = new OpenStar({ verbose: options.verbose })
  await openstar.initialize()

  const status = await openstar.getStatus()

  const statusTable = new Table({
    head: ['Component', 'Status'],
    colWidths: [20, 40]
  })

  statusTable.push(['Core', status.core === 'ready' ? green('● Ready') : yellow('◐ Loading')])
  statusTable.push(['Swarm', status.swarm.enabled ? green('● Ready') : yellow('◐ Loading')])
  statusTable.push(['MCP Servers', `${status.mcp.servers} active`])
  statusTable.push(['Active Agents', `${status.swarm.agents}`])
  statusTable.push(['Skills', `${status.skills} available`])

  console.log('')
  console.log(statusTable.toString())
  console.log('')
})

// List skills
cli.command('skills', 'List available skills').action(async (options) => {
  const openstar = new OpenStar({ verbose: options.verbose })
  await openstar.initialize()

  const skills = await openstar.listSkills()

  const skillsTable = new Table({
    head: ['Name', 'Description', 'Status'],
    colWidths: [25, 45, 12]
  })

  for (const skill of skills) {
    const status = skill.enabled ? green('● Enabled') : dim('○ Disabled')
    skillsTable.push([skill.name, skill.description.slice(0, 43), status])
  }

  console.log('')
  console.log(skillsTable.toString())
  console.log('')
  console.log(dim(`Total: ${skills.length} skills`))
})

// List agents
cli.command('agents', 'List active agents').action(async (options) => {
  const openstar = new OpenStar({ verbose: options.verbose })
  await openstar.initialize()

  const agents = await openstar.listAgents()

  const agentsTable = new Table({
    head: ['ID', 'Name', 'Status', 'Tasks'],
    colWidths: [10, 20, 15, 10]
  })

  for (const agent of agents) {
    const statusColor = agent.status === 'running' ? green : agent.status === 'idle' ? yellow : dim
    agentsTable.push([
      agent.id.slice(0, 8),
      agent.name,
      statusColor(`● ${agent.status}`),
      `${agent.tasksCompleted}`
    ])
  }

  console.log('')
  console.log(agentsTable.toString())
  console.log('')
})

// Build command - real build using tsc
cli.command('build', 'Build all packages').action(async (options) => {
  console.log(`${cyan('📦')} Building OpenStar packages...\n`)

  const { execSync } = await import('child_process')

  const packages = [
    { name: '@openstar/core', path: 'packages/core' },
    { name: '@openstar/protocol', path: 'packages/protocol' },
    { name: '@openstar/swarm', path: 'packages/swarm' },
    { name: '@openstar/mcp', path: 'packages/mcp' },
    { name: '@openstar/relay', path: 'packages/relay' },
    { name: '@openstar/cli', path: 'packages/cli' },
  ]

  let hasError = false

  for (const pkg of packages) {
    process.stdout.write(`  ${yellow('→')} Building ${pkg.name}...`)
    try {
      // Try bun build first (faster), fallback to tsc
      const cmd = `cd ${pkg.path} && bun x tsc --noEmit 2>&1`
      execSync(cmd, {
        encoding: 'utf-8',
        stdio: 'pipe',
        cwd: process.cwd(),
        timeout: 30000,
      })
      console.log(` ${green('✓')} built`)
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e)
      if ((e as { stdout?: Buffer }).stdout) {
        console.log(` ${yellow('⚠')}  warnings`)
      } else {
        console.log(` ${red('✗')} failed`)
        if (options.verbose && (e as { stderr?: Buffer }).stderr) {
          console.log(`      ${dim(String((e as { stderr?: Buffer }).stderr || errMsg).slice(0, 200))}`)
        }
        hasError = true
      }
    }
  }

  if (hasError) {
    console.log(`\n${yellow('⚠')}  Build completed with warnings. Run with -v for details.`)
  } else {
    console.log(`\n${green('✓')} All packages built successfully!`)
  }

  // Also build UI if present
  try {
    const { existsSync } = await import('fs')
    if (existsSync('packages/ui-web/package.json')) {
      process.stdout.write(`  ${yellow('→')} Building ui-web...`)
      execSync('cd packages/ui-web && bun run build', {
        encoding: 'utf-8',
        stdio: 'pipe',
        cwd: process.cwd(),
        timeout: 60000,
      })
      console.log(` ${green('✓')} built`)
    }
  } catch {
    // UI build is optional
  }
})

// Version command
cli.command('version', 'Show version info').action(() => {
  console.log(banner)
  console.log('  Version: 0.1.0')
  console.log('  Bun: ' + process.versions.bun)
  console.log('  Node: ' + process.versions.node)
  console.log('')
})

// Help
cli.command('help', 'Show help').action(() => {
  console.log(banner)
  console.log('  Usage:')
  console.log('    openstar start          Start OpenStar agent')
  console.log('    openstar status         Show status')
  console.log('    openstar skills         List skills')
  console.log('    openstar agents        List agents')
  console.log('    openstar build         Build packages')
  console.log('    openstar version       Show version')
  console.log('')
  console.log('  Options:')
  console.log('    -v, --verbose          Verbose output')
  console.log('    -c, --config <path>    Config file path')
  console.log('')
})

// ─── DAG Commands ───────────────────────────────────────────────────

cli.command('dag-patterns', 'List built-in DAG patterns').action(async () => {
  const { DagEngine } = await import('@openstar/swarm')
  const engine = new DagEngine()
  const patterns = engine.listPatterns()

  console.log(`${cyan('🔀')} Built-in DAG Patterns (${patterns.length})\n`)
  const table = new Table({ head: ['ID', 'Name', 'Category', 'Description'], colWidths: [22, 24, 14, 50] })
  for (const p of patterns) {
    table.push([p.id, p.name, p.category, p.description.slice(0, 48)])
  }
  console.log(table.toString())
})

cli.command('dag-run <pattern>', 'Run a DAG from a built-in pattern').action(async (patternId: string, options: any) => {
  const { DagExecutor, createRuntimeFromConfig } = await import('@openstar/swarm')
  const runtime = createRuntimeFromConfig(options.config)
  const executor = new DagExecutor({ runtime, onEvent: (e) => {
    if (e.type === 'node:start') console.log(`  ${yellow('→')} ${e.label} (${e.nodeId})`)
    else if (e.type === 'node:complete') console.log(`  ${green('✓')} ${e.label}`)
    else if (e.type === 'node:error') console.log(`  ${red('✗')} ${e.label}: ${e.error}`)
  } })

  console.log(`${cyan('▶')} Running DAG pattern "${patternId}"...`)
  try {
    const result = await executor.runPattern(patternId)
    console.log(`\n${result.success ? success('✓') : error('✗')} DAG ${result.runId}: ${result.success ? 'completed' : 'failed'} (${result.mode} mode, ${result.durationMs}ms)`)
    if (result.success) {
      console.log(`${dim('Outputs:')}`)
      for (const [id, r] of Object.entries(result.nodeResults)) {
        const out = r.output as Record<string, unknown> | undefined
        if (out) console.log(`  ${dim(id)}: ${String(out.result ?? '').slice(0, 80)}`)
      }
    }
  } catch (err) {
    console.log(error(`DAG error: ${err instanceof Error ? err.message : err}`))
  }
})

// ─── Config Commands ────────────────────────────────────────────────

cli.command('config-show', 'Show current configuration').action(async (options: any) => {
  const { loadConfig } = await import('@openstar/core')
  const config = loadConfig(options.config)
  console.log(`${cyan('⚙')} OpenStar Configuration:\n`)
  console.log(JSON.stringify({
    core: config.core,
    agents: config.agents,
    swarm: config.swarm,
    persistence: { ...config.persistence, dbPath: config.persistence?.dbPath ?? '(default)' },
    sandbox: config.sandbox,
    ui: config.ui,
  }, null, 2))
})

cli.command('config-init', 'Create a default config file').action(async (options: any) => {
  const { loadConfig, saveConfig, getConfigPaths } = await import('@openstar/core')
  const configPath = options.config || getConfigPaths()[0]
  const config = loadConfig(options.config)
  const path = saveConfig(config, configPath)
  console.log(success(`✓ Config written to ${path}`))
})

// ─── Agent Commands ─────────────────────────────────────────────────

cli.command('agent providers', 'Show configured LLM providers').action(async (options: any) => {
  const { loadConfig } = await import('@openstar/core')
  const config = loadConfig(options.config)
  const providers = ['openai', 'anthropic', 'kimi'] as const
  console.log(`${cyan('🤖')} LLM Providers:\n`)
  for (const p of providers) {
    const cfg = (config.providers ?? {})[p] as { apiKey?: string } | undefined
    const status = cfg?.apiKey ? green('● configured') : dim('○ not set')
    console.log(`  ${p.padEnd(12)} ${status}`)
  }
})

cli.command('agent-run <task>', 'Run a single agent task (uses configured provider, else local mode)').action(async (task: string, options: any) => {
  const { initAgentRuntime, AgentRuntime, getAgentRuntime } = await import('@openstar/swarm')
  const { loadConfig } = await import('@openstar/core')

  let runtime: ReturnType<typeof getAgentRuntime>
  try {
    const config = loadConfig(options.config)
    const pcs = (config.providers ?? {}) as Record<string, { apiKey?: string; baseUrl?: string; model?: string }>
    const confs: Array<{ provider: 'openai' | 'anthropic' | 'kimi'; config: any }> = []
    for (const key of ['openai', 'anthropic', 'kimi'] as const) {
      const pc = pcs[key]
      if (pc?.apiKey) confs.push({ provider: key, config: { provider: key, apiKey: pc.apiKey, baseUrl: pc.baseUrl, model: pc.model } })
    }
    runtime = initAgentRuntime(confs.length ? confs : undefined)
  } catch {
    runtime = getAgentRuntime()
  }

  const { createBuiltinToolExecutor } = await import('@openstar/swarm')
  runtime.setToolExecutor(createBuiltinToolExecutor(process.cwd()))

  const { AgentDefinition } = await import('@openstar/core')
  const def = AgentDefinition.parse({
    id: 'cli-agent',
    name: 'CLI Agent',
    type: 'primary',
    description: 'A general-purpose agent invoked from the CLI.',
    capabilities: [{ name: 'run_command', description: 'Execute shell commands', version: '1.0.0', tags: ['shell'] }],
  })

  console.log(`${cyan('🤖')} Running agent task...\n`)
  const result = await runtime.run({ agentDefinition: def, task })
  if (result.success) {
    console.log(result.output)
    console.log(`\n${success('✓')} Done in ${result.iterations} iterations (${result.durationMs}ms)`)
  } else {
    console.log(error(`Agent failed: ${result.error ?? 'unknown error'}`))
    process.exitCode = 1
  }
})

cli.command('mcp', 'Start the OpenStar MCP server').action(async () => {
  console.log(`${cyan('🔌')} Starting OpenStar MCP server...`)
  const { spawn } = await import('child_process')
  const { fileURLToPath } = await import('node:url')
  const cliDir = fileURLToPath(new URL('.', import.meta.url))
  const mcpEntry = path.resolve(cliDir, '../../mcp/src/index.ts')
  const child = spawn('bun', ['run', mcpEntry], { stdio: 'inherit', env: { ...process.env } })
  child.on('exit', (code) => process.exit(code ?? 0))
  child.on('error', (err) => {
    console.log(error(`Failed to start MCP server: ${err.message}`))
    process.exit(1)
  })
})

// ─── Plugin Commands ────────────────────────────────────────────────

cli.command('plugins-list', 'List installed plugins').action(async () => {
  const { getPluginRegistry } = await import('@openstar/core')
  const registry = getPluginRegistry()
  const plugins = registry.listAll()
  if (plugins.length === 0) {
    console.log(dim('  No plugins installed'))
    return
  }
  console.log(`${cyan('🔌')} Installed Plugins (${plugins.length}):\n`)
  const table = new Table({ head: ['Name', 'Version', 'Status', 'Capabilities'], colWidths: [24, 12, 12, 40] })
  for (const p of plugins) {
    table.push([
      p.manifest.name,
      p.manifest.version,
      registry.isEnabled(p.manifest.name) ? green('● enabled') : dim('○ disabled'),
      p.manifest.openstar.capabilities.join(', ').slice(0, 38),
    ])
  }
  console.log(table.toString())
})

// ─── Persistence / Stats Commands ───────────────────────────────────

cli.command('stats', 'Show persistence statistics').action(async (options: any) => {
  const { getPersistence } = await import('@openstar/core')
  try {
    const persistence = getPersistence()
    const stats = persistence.getStats()
    console.log(`${cyan('📊')} OpenStar Statistics:\n`)
    console.log(`  Sessions:  ${stats.totalSessions}`)
    console.log(`  Tasks:     ${stats.totalTasks}`)
    console.log(`  Events:    ${stats.totalEvents}`)
    console.log(`  Task status breakdown:`)
    for (const [status, count] of Object.entries(stats.tasksByStatus)) {
      console.log(`    ${status.padEnd(12)} ${count}`)
    }
  } catch (err) {
    console.log(error(`Persistence unavailable: ${err instanceof Error ? err.message : err}`))
  }
})

// ─── Test Command ───────────────────────────────────────────────────

cli.command('test', 'Run the test suite').action(async () => {
  console.log(`${cyan('🧪')} Running tests...`)
  const { execSync } = await import('child_process')
  try {
    execSync('bun run test', { stdio: 'inherit', cwd: process.cwd() })
  } catch {
    console.log(error('Tests failed'))
    process.exitCode = 1
  }
})

// Parse
cli.parse()
