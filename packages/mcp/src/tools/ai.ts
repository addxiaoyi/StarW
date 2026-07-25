/**
 * OpenStar MCP AI 增强工具
 * 提供 AI 能力增强功能
 */

import { z } from 'zod'
import type { ToolDefinition } from '../core/types.js'

// 工具定义
export const aiTools: ToolDefinition[] = [
  {
    name: 'summarize_text',
    description: '文本摘要生成',
    inputSchema: z.object({
      text: z.string().describe('要摘要的文本'),
      maxLength: z.number().optional().describe('最大长度，默认 200'),
      format: z.enum(['short', 'bullet', 'paragraph']).optional().describe('输出格式'),
    }),
    handler: async (args: Record<string, unknown>) => {
      const text = args.text as string
      const sentences = text.split(/[.!?]+/).filter(Boolean)
      const maxLen = (args.maxLength as number) || 200
      const format = (args.format as string) || 'paragraph'

      if (sentences.length <= 3 || text.length <= maxLen) {
        return { summary: text, originalLength: text.length }
      }

      let summary = sentences.slice(0, 3).join('. ')
      if (summary.length > maxLen) summary = summary.slice(0, maxLen) + '...'

      return {
        summary: format === 'bullet' ? summary.split('. ').map((s) => `• ${s}`).join('\n') : summary,
        originalLength: text.length,
        summaryLength: summary.length,
        sentences: sentences.length,
      }
    },
  },
  {
    name: 'extract_keywords',
    description: '提取关键词',
    inputSchema: z.object({
      text: z.string().describe('要分析的文本'),
      limit: z.number().optional().describe('返回数量，默认 10'),
    }),
    handler: async (args: Record<string, unknown>) => {
      const text = args.text as string
      const words = text.toLowerCase().match(/\b[a-z一-龥]{2,}\b/g) || []
      const wordCount: Record<string, number> = {}
      const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by', 'this', 'that', '这些', '那些', '是', '在', '和', '的', '了', '有', '我', '你', '他', '她', '它'])

      words.forEach((word: string) => {
        if (!stopWords.has(word)) wordCount[word] = (wordCount[word] || 0) + 1
      })

      const keywords = Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, (args.limit as number) || 10)
        .map(([word, count]) => ({ word, count }))

      return { keywords, totalWords: words.length }
    },
  },
  {
    name: 'analyze_sentiment',
    description: '情感分析',
    inputSchema: z.object({
      text: z.string().describe('要分析的文本'),
    }),
    handler: async (args: Record<string, unknown>) => {
      const text = args.text as string
      const positive = ['好', '棒', '优秀', '完美', '喜欢', '感谢', '赞', 'good', 'great', 'excellent', 'perfect', 'love', 'thanks', 'nice', 'happy']
      const negative = ['差', '烂', '垃圾', '讨厌', '失望', '糟糕', 'bad', 'terrible', 'awful', 'hate', 'disappoint', 'sad', 'angry']

      let positiveCount = 0
      let negativeCount = 0
      const cleanText = text.toLowerCase()

      positive.forEach((word) => {
        if (cleanText.includes(word.toLowerCase())) positiveCount++
      })
      negative.forEach((word) => {
        if (cleanText.includes(word.toLowerCase())) negativeCount++
      })

      const score = positiveCount - negativeCount
      let sentiment: 'positive' | 'negative' | 'neutral'
      if (score > 0) sentiment = 'positive'
      else if (score < 0) sentiment = 'negative'
      else sentiment = 'neutral'

      return { sentiment, score, positiveCount, negativeCount }
    },
  },
  {
    name: 'code_review',
    description: '代码审查',
    inputSchema: z.object({
      code: z.string().describe('要审查的代码'),
      language: z.string().optional().describe('编程语言'),
    }),
    handler: async (args: Record<string, unknown>) => {
      const issues: Array<{ type: string; line: number; message: string; severity: 'warning' | 'error' | 'info' }> = []
      const lines = (args.code as string).split('\n')

      lines.forEach((line: string, i: number) => {
        if (line.includes('console.log') && !line.includes('//')) {
          issues.push({ type: 'debug', line: i + 1, message: 'Remove debug statement', severity: 'warning' })
        }
        if (line.includes('TODO') || line.includes('FIXME')) {
          issues.push({ type: 'todo', line: i + 1, message: 'TODO/FIXME comment found', severity: 'info' })
        }
        if (line.match(/magic|number|hardcoded/i)) {
          issues.push({ type: 'magic', line: i + 1, message: 'Possible hardcoded value', severity: 'warning' })
        }
      })

      return { issues, total: issues.length, language: args.language || 'unknown', lines: lines.length }
    },
  },
  {
    name: 'translate_text',
    description: '翻译文本（简中 ↔ 英文）',
    inputSchema: z.object({
      text: z.string().describe('要翻译的文本'),
      from: z.enum(['zh', 'en']).optional().describe('源语言'),
      to: z.enum(['zh', 'en']).describe('目标语言'),
    }),
    handler: async (args: Record<string, unknown>) => {
      const text = args.text as string
      const zhToEn: Record<string, string> = {
        '你好': 'Hello', '世界': 'World', '谢谢': 'Thanks', '再见': 'Goodbye',
        '是的': 'Yes', '不是': 'No', '好的': 'OK', '请': 'Please',
      }
      const enToZh = Object.fromEntries(Object.entries(zhToEn).map(([k, v]) => [v, k]))

      const map = args.to === 'en' ? zhToEn : enToZh
      let translated = text
      Object.entries(map).forEach(([src, tgt]) => {
        translated = translated.replace(new RegExp(src, 'gi'), tgt)
      })

      return {
        original: text,
        translated,
        from: args.from || ((text.match(/[一-龥]/) ? 'zh' : 'en') as 'zh' | 'en'),
        to: args.to as 'zh' | 'en',
      }
    },
  },
]
