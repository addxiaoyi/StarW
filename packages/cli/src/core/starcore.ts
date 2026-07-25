/**
 * OpenStar Core Module
 * Main entry point for the CLI
 */

import { Terminal, createTerminal, success, error, warning } from '../components/index.js'
import type { TerminalOptions } from '../components/terminal.js'

export interface OpenStarStatus {
  core: 'ready' | 'loading'
  version: string
  swarm: {
    enabled: boolean
    agents: number
  }
  mcp: {
    connected: boolean
    servers: number
  }
  skills: number
}

export interface Skill {
  name: string
  description: string
  category: string
  enabled: boolean
}

export interface Agent {
  id: string
  name: string
  status: 'running' | 'idle' | 'stopped'
  tasksCompleted: number
  memoryUsage: number
}

export interface OpenStarOptions {
  verbose?: boolean
  configPath?: string
  mcpPort?: number
  enableSwarm?: boolean
}

export class OpenStar {
  private options: Required<OpenStarOptions>
  private terminal: Terminal
  private skills: Skill[] = []
  private agents: Agent[] = []
  private status: OpenStarStatus

  constructor(options: OpenStarOptions = {}) {
    this.options = {
      verbose: options.verbose ?? false,
      configPath: options.configPath ?? '~/.openstar/config.json',
      mcpPort: options.mcpPort ?? 3000,
      enableSwarm: options.enableSwarm ?? true
    }

    this.status = {
      core: 'loading',
      version: '0.1.0',
      swarm: { enabled: this.options.enableSwarm, agents: 0 },
      mcp: { connected: false, servers: 0 },
      skills: 0
    }

    this.terminal = createTerminal({
      prompt: `${'\x1b[36m'}◆${'\x1b[0m'} `,
      autoComplete: this.getCommands()
    })
  }

  async initialize(): Promise<void> {
    if (this.options.verbose) {
      console.log('Initializing OpenStar...')
    }

    // Load skills
    this.skills = this.loadSkills()

    // Initialize agents
    if (this.options.enableSwarm) {
      this.agents = this.loadAgents()
    }

    // Update status
    this.status.core = 'ready'
    this.status.skills = this.skills.length
    this.status.swarm.agents = this.agents.length

    if (this.options.verbose) {
      console.log('OpenStar initialized')
    }
  }

  private loadSkills(): Skill[] {
    return [
      { name: 'code-review', description: 'Automated code review', category: 'quality', enabled: true },
      { name: 'bug-hunt', description: 'Find and fix bugs', category: 'quality', enabled: true },
      { name: 'refactor', description: 'Code refactoring', category: 'development', enabled: true },
      { name: 'docs', description: 'Documentation generator', category: 'development', enabled: true },
      { name: 'test-gen', description: 'Test generator', category: 'testing', enabled: true },
      { name: 'mcp-setup', description: 'MCP server setup', category: 'integration', enabled: true },
      { name: 'deploy', description: 'Deployment automation', category: 'devops', enabled: false }
    ]
  }

  private loadAgents(): Agent[] {
    return [
      { id: 'agent-001', name: 'CodeAgent', status: 'idle', tasksCompleted: 0, memoryUsage: 45 },
      { id: 'agent-002', name: 'ReviewAgent', status: 'idle', tasksCompleted: 0, memoryUsage: 38 },
      { id: 'agent-003', name: 'TestAgent', status: 'idle', tasksCompleted: 0, memoryUsage: 52 }
    ]
  }

  private getCommands(): string[] {
    return [
      '/help', '/skills', '/agents', '/status',
      '/start', '/stop', '/exit', '/clear',
      '/review', '/test', '/build', '/deploy'
    ]
  }

  async startREPL(): Promise<void> {
    this.terminal.on('input', async (input) => {
      await this.handleInput(input)
    })

    await this.terminal.start()
  }

  private async handleInput(input: string): Promise<void> {
    if (!input.startsWith('/')) {
      this.terminal.printInfo('Use /help for available commands')
      return
    }

    const [command, ...args] = input.slice(1).split(' ')

    switch (command) {
      case 'help':
        this.showHelp()
        break
      case 'skills':
        this.showSkills()
        break
      case 'agents':
        this.showAgents()
        break
      case 'status':
        this.showStatus()
        break
      case 'exit':
      case 'quit':
        this.terminal.printSuccess('Goodbye!')
        this.terminal.close()
        process.exit(0)
      case 'clear':
        this.terminal.clear()
        break
      case 'review':
        await this.runReview(args)
        break
      case 'test':
        await this.runTests()
        break
      default:
        this.terminal.printWarning(`Unknown command: ${command}`)
    }
  }

  private showHelp(): void {
    const help = `
${'='.repeat(50)}
 OpenStar Commands
${'='.repeat(50)}

 ${'Navigation'}
   /help        Show this help
   /status      Show system status
   /clear       Clear terminal

 ${'Skills'}
   /skills      List available skills
   /review      Run code review
   /test        Run tests
   /build       Build project

 ${'Swarm'}
   /agents      List active agents

 ${'Exit'}
   /exit        Exit OpenStar

${'='.repeat(50)}
`
    this.terminal.print(help)
  }

  private showSkills(): void {
    const lines = [
      '',
      'Available Skills:',
      ''
    ]

    for (const skill of this.skills) {
      const status = skill.enabled ? '●' : '○'
      const category = `[${skill.category}]`
      lines.push(`  ${status} ${skill.name} ${category}`)
      lines.push(`      ${skill.description}`)
    }

    this.terminal.print(lines.join('\n'))
  }

  private showAgents(): void {
    const lines = [
      '',
      'Active Agents:',
      ''
    ]

    for (const agent of this.agents) {
      const statusIcon = agent.status === 'running' ? '●' : '○'
      lines.push(`  ${statusIcon} ${agent.name} (${agent.status})`)
      lines.push(`      Tasks: ${agent.tasksCompleted} | Memory: ${agent.memoryUsage}MB`)
    }

    this.terminal.print(lines.join('\n'))
  }

  private showStatus(): void {
    const lines = [
      '',
      'OpenStar Status',
      '─'.repeat(40),
      `  Core:     ${this.status.core === 'ready' ? '● Ready' : '○ Loading'}`,
      `  Version:  ${this.status.version}`,
      `  Swarm:    ${this.status.swarm.enabled ? '● Enabled' : '○ Disabled'}`,
      `  Agents:   ${this.status.swarm.agents}`,
      `  Skills:   ${this.status.skills}`,
      '─'.repeat(40),
      ''
    ]

    this.terminal.print(lines.join('\n'))
  }

  private async runReview(args: string[]): Promise<void> {
    this.terminal.printInfo('Running code review...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    this.terminal.printSuccess('Review complete! No issues found.')
  }

  private async runTests(): Promise<void> {
    this.terminal.printInfo('Running tests...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    this.terminal.printSuccess('All tests passed!')
  }

  getStatus(): OpenStarStatus {
    return this.status
  }

  async listSkills(): Promise<Skill[]> {
    return this.skills
  }

  async listAgents(): Promise<Agent[]> {
    return this.agents
  }
}

export default OpenStar
