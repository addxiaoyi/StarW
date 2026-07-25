/**
 * OpenStar MCP 服务器入口
 * 基于 @modelcontextprotocol/sdk 实现
 */

import { MCPServer } from './core/server.js'
import { filesystemTools } from './tools/filesystem.js'
import { gitTools } from './tools/git.js'
import { webTools } from './tools/web.js'
import { systemTools } from './tools/system.js'
import { aiTools } from './tools/ai.js'
import { skillTools } from './tools/skills.js'
import { agentTools } from './tools/agents.js'

async function main() {
  console.log('🚀 Starting OpenStar MCP Server...')
  console.log(`   Node: ${process.version}`)
  console.log(`   MCP: v1.29.0\n`)

  try {
    const server = new MCPServer()

    // 注册所有工具集
    server.registerToolSet({ name: 'filesystem', tools: filesystemTools })
    server.registerToolSet({ name: 'git', tools: gitTools })
    server.registerToolSet({ name: 'web', tools: webTools })
    server.registerToolSet({ name: 'system', tools: systemTools })
    server.registerToolSet({ name: 'ai', tools: aiTools })
    server.registerToolSet({ name: 'skills', tools: skillTools })
    server.registerToolSet({ name: 'agents', tools: agentTools })

    console.log('\n✅ OpenStar MCP Server 已启动!')
    console.log('   • 文件系统工具 ✅')
    console.log('   • Git 版本控制 ✅')
    console.log('   • Web 自动化 ✅')
    console.log('   • 系统操作 ✅')
    console.log('   • AI 增强 ✅')
    console.log('   • 技能管理 ✅')
    console.log('   • Agent 集群 ✅')

    // 启动服务器
    await server.start()

  } catch (error) {
    console.error('\n❌ MCP 服务器出错:', error)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
