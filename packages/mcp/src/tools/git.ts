/**
 * OpenStar MCP Git 工具
 * 提供 Git 版本控制能力
 */

import { z } from 'zod'
import { execSync } from 'child_process'
import type { ToolDefinition } from '../core/types.js'

// 工具定义
export const gitTools: ToolDefinition[] = [
  {
    name: 'git_status',
    description: '获取 Git 状态',
    inputSchema: z.object({
      cwd: z.string().optional().describe('工作目录'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        const output = execSync('git status --porcelain', {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        const files = output.split('\n').filter(Boolean)
        return { hasChanges: output.length > 0, files, count: files.length }
      } catch {
        return { hasChanges: false, files: [], count: 0, error: 'Not a git repository' }
      }
    },
  },
  {
    name: 'git_log',
    description: '获取 Git 提交历史',
    inputSchema: z.object({
      cwd: z.string().optional().describe('工作目录'),
      limit: z.number().optional().describe('限制数量，默认 10'),
      format: z.string().optional().describe('输出格式'),
    }),
    handler: async (args: Record<string, unknown>) => {
      const limit = (args.limit as number) || 10
      const format = (args.format as string) || '%h %s %an %ad'
      try {
        const output = execSync(
          `git log --format="${format}" -n ${limit}`,
          { encoding: 'utf-8', cwd: (args.cwd as string) || '.' }
        )
        const commits = output.split('\n').filter(Boolean)
        return { commits, count: commits.length }
      } catch {
        return { commits: [], count: 0, error: 'Failed to get git log' }
      }
    },
  },
  {
    name: 'git_branch',
    description: '获取 Git 分支列表',
    inputSchema: z.object({
      cwd: z.string().optional().describe('工作目录'),
      all: z.boolean().optional().describe('显示所有分支'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        const flag = args.all ? '-a' : ''
        const output = execSync(`git branch ${flag}`, {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        const branches = output.split('\n').map((b: string) => ({
          name: b.replace(/^\*?\s*/, '').trim(),
          current: b.startsWith('*'),
        }))
        return { branches, count: branches.length }
      } catch {
        return { branches: [], count: 0, error: 'Failed to get branches' }
      }
    },
  },
  {
    name: 'git_diff',
    description: '获取文件差异',
    inputSchema: z.object({
      path: z.string().optional().describe('文件路径'),
      staged: z.boolean().optional().describe('是否仅显示暂存区'),
      cwd: z.string().optional().describe('工作目录'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        const staged = args.staged ? '--cached' : ''
        const file = (args.path as string) || ''
        const output = execSync(`git diff ${staged} ${file}`, {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        return { diff: output, hasChanges: output.length > 0 }
      } catch {
        return { diff: '', hasChanges: false }
      }
    },
  },
  {
    name: 'git_commit',
    description: '提交更改',
    inputSchema: z.object({
      message: z.string().describe('提交信息'),
      cwd: z.string().optional().describe('工作目录'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        execSync(`git commit -m "${args.message}"`, {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        return { success: true, message: args.message }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  },
  {
    name: 'git_add',
    description: '暂存文件',
    inputSchema: z.object({
      path: z.string().optional().describe('文件路径，. 表示全部'),
      cwd: z.string().optional().describe('工作目录'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        const file = (args.path as string) || '.'
        execSync(`git add ${file}`, {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        return { success: true, staged: file }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  },
  {
    name: 'git_checkout',
    description: '切换分支或还原文件',
    inputSchema: z.object({
      branch: z.string().describe('分支名或文件路径'),
      newBranch: z.boolean().optional().describe('是否创建新分支'),
      cwd: z.string().optional().describe('工作目录'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        const flag = args.newBranch ? '-b' : ''
        execSync(`git checkout ${flag} ${args.branch}`, {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        return { success: true, branch: args.branch }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  },
  {
    name: 'git_pull',
    description: '拉取远程更新',
    inputSchema: z.object({
      cwd: z.string().optional().describe('工作目录'),
      rebase: z.boolean().optional().describe('是否使用 rebase'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        const flag = args.rebase ? '--rebase' : ''
        const output = execSync(`git pull ${flag}`, {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        return { success: true, output }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  },
  {
    name: 'git_push',
    description: '推送到远程',
    inputSchema: z.object({
      cwd: z.string().optional().describe('工作目录'),
      setUpstream: z.boolean().optional().describe('是否设置上游'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        const flag = args.setUpstream ? '-u' : ''
        execSync(`git push ${flag}`, {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        return { success: true }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  },
  {
    name: 'git_remote',
    description: '获取远程仓库信息',
    inputSchema: z.object({
      cwd: z.string().optional().describe('工作目录'),
    }),
    handler: async (args: Record<string, unknown>) => {
      try {
        const output = execSync('git remote -v', {
          encoding: 'utf-8',
          cwd: (args.cwd as string) || '.',
        })
        const lines = output.split('\n').filter(Boolean)
        const remotes = lines.map((l: string) => {
          const [name, url] = l.split(/\s+/)
          return { name, url }
        })
        return { remotes }
      } catch {
        return { remotes: [], error: 'No remotes configured' }
      }
    },
  },
]
