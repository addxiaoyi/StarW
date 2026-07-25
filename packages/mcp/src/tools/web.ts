import { z } from 'zod'
import https from 'https'
import http from 'http'
import type { ToolDefinition } from '../core/types.js'

// 工具定义
export const webTools: ToolDefinition[] = [
  {
    name: 'http_get',
    description: '发送 HTTP GET 请求',
    inputSchema: z.object({
      url: z.string().url().describe('请求 URL'),
      headers: z.record(z.string(), z.string()).optional().describe('请求头'),
      timeout: z.number().optional().describe('超时时间(毫秒)'),
    }),
    handler: async (args: Record<string, unknown>) => {
      return new Promise<Record<string, unknown>>((resolve) => {
        const options: { headers: Record<string, string>; timeout: number } = {
          headers: (args.headers as Record<string, string>) || {},
          timeout: (args.timeout as number) || 30000,
        }
        const protocol = (args.url as string).startsWith('https') ? https : http
        const req = (protocol as any).request(args.url as string, options, (res: any) => {
          let data = ''
          res.on('data', (chunk: any) => (data += chunk))
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: res.headers,
              body: data.slice(0, 10000),
              size: data.length,
            })
          })
        })
        req.on('error', (e: any) => resolve({ error: e.message }))
        req.on('timeout', () => {
          req.destroy()
          resolve({ error: 'Request timeout' })
        })
      })
    },
  },
  {
    name: 'http_post',
    description: '发送 HTTP POST 请求',
    inputSchema: z.object({
      url: z.string().url().describe('请求 URL'),
      body: z.union([z.string(), z.record(z.string(), z.unknown())]).describe('请求体'),
      headers: z.record(z.string(), z.string()).optional().describe('请求头'),
      contentType: z.string().optional().describe('Content-Type'),
      timeout: z.number().optional().describe('超时时间(毫秒)'),
    }),
    handler: async (args: Record<string, unknown>) => {
      return new Promise<Record<string, unknown>>((resolve) => {
        const body = typeof args.body === 'string' ? args.body as string : JSON.stringify(args.body)
        const bodyLen = Buffer.byteLength(body, 'utf-8')
        const options: { method: string; headers: Record<string, string>; timeout: number } = {
          method: 'POST',
          headers: {
            'Content-Type': (args.contentType as string) || 'application/json',
            'Content-Length': bodyLen.toString(),
            ...((args.headers as Record<string, string>) || {}),
          },
          timeout: (args.timeout as number) || 30000,
        }

        const req = http.request(args.url as string, options, (res: any) => {
          let data = ''
          res.on('data', (chunk: any) => (data += chunk))
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: res.headers,
              body: data.slice(0, 10000),
              size: data.length,
            })
          })
        })

        req.on('error', (e: any) => resolve({ error: e.message }))
        req.on('timeout', () => {
          req.destroy()
          resolve({ error: 'Request timeout' })
        })

        req.write(body)
        req.end()
      })
    },
  },
  {
    name: 'fetch_html',
    description: '获取 HTML 页面内容',
    inputSchema: z.object({
      url: z.string().url().describe('页面 URL'),
      selector: z.string().optional().describe('CSS 选择器'),
    }),
    handler: async (args: Record<string, unknown>) => {
      return new Promise<Record<string, unknown>>((resolve) => {
        const req = http.get(args.url as string, { headers: { 'User-Agent': 'OpenStar/1.0' } } as any, (res: any) => {
          let data = ''
          res.on('data', (chunk: any) => (data += chunk))
          res.on('end', () => {
            resolve({ url: args.url, html: data.slice(0, 50000), size: data.length })
          })
        })
        req.on('error', (e: any) => resolve({ error: e.message }))
      })
    },
  },
  {
    name: 'check_url',
    description: '检查 URL 是否可访问',
    inputSchema: z.object({
      url: z.string().url().describe('要检查的 URL'),
      method: z.enum(['GET', 'HEAD']).optional().describe('请求方法'),
    }),
    handler: async (args: Record<string, unknown>) => {
      return new Promise<Record<string, unknown>>((resolve) => {
        const protocol = (args.url as string).startsWith('https') ? https : http
        const req = protocol.request(
          args.url as string,
          {
            method: (args.method as string) || 'HEAD',
            timeout: 10000,
          },
          (res: any) => {
            resolve({
              url: args.url,
              accessible: true,
              status: res.statusCode,
              statusText: res.statusMessage,
            })
          }
        )
        req.on('error', (e: any) => resolve({ url: args.url, accessible: false, error: e.message }))
        req.on('timeout', () => {
          req.destroy()
          resolve({ url: args.url, accessible: false, error: 'Timeout' })
        })
        req.end()
      })
    },
  },
  {
    name: 'extract_links',
    description: '从 HTML 中提取链接',
    inputSchema: z.object({
      html: z.string().describe('HTML 内容'),
      baseUrl: z.string().optional().describe('基础 URL'),
    }),
    handler: async (args: Record<string, unknown>) => {
      const linkRegex = /href=["']([^"']+)["']/g
      const links: string[] = []
      let match
      const html = args.html as string
      while ((match = linkRegex.exec(html)) !== null) {
        links.push(match[1])
      }
      return {
        links: links.slice(0, 100),
        count: links.length,
        baseUrl: args.baseUrl || null,
      }
    },
  },
]
