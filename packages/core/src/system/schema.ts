/**
 * StarCore Schema - Zod Schema 工具
 * 提供 Zod 类型到 JSON Schema 的转换
 */

import { z } from "zod"

/**
 * 将 Zod schema 转换为 JSON Schema
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): object {
  return convertZodToJson(schema)
}

function convertZodToJson(schema: z.ZodType<unknown>): object {
  const def = (schema as any)._def

  if (!def) {
    return { type: "string" }
  }

  switch (def.typeName) {
    case "ZodString":
      return {
        type: "string",
        ...(def.checks?.length > 0 && {
          minLength: def.checks.find((c: any) => c.kind === "min")?.value,
          maxLength: def.checks.find((c: any) => c.kind === "max")?.value,
          pattern: def.checks.find((c: any) => c.kind === "regex")?.regex?.source,
        }),
      }

    case "ZodNumber":
      return {
        type: "number",
        ...(def.checks?.length > 0 && {
          minimum: def.checks.find((c: any) => c.kind === "min")?.value,
          maximum: def.checks.find((c: any) => c.kind === "max")?.value,
        }),
      }

    case "ZodBoolean":
      return { type: "boolean" }

    case "ZodNull":
      return { type: "null" }

    case "ZodUndefined":
      return { type: "undefined" }

    case "ZodArray": {
      const itemSchema = convertZodToJson(def.type as z.ZodType<unknown>)
      return {
        type: "array",
        items: itemSchema,
      }
    }

    case "ZodObject": {
      const shape = def.shape()
      const properties: Record<string, object> = {}
      const required: string[] = []

      for (const [key, value] of Object.entries(shape || {})) {
        const propDef = (value as any)._def
        properties[key] = convertZodToJson(value as z.ZodType<unknown>)

        // 检查是否为 required
        if (!propDef?.isOptional && !propDef?.defaultValue) {
          required.push(key)
        }
      }

      return {
        type: "object",
        properties,
        ...(required.length > 0 && { required }),
      }
    }

    case "ZodEnum": {
      return {
        type: "string",
        enum: def.values,
      }
    }

    case "ZodOptional": {
      return convertZodToJson(def.innerType as z.ZodType<unknown>)
    }

    case "ZodNullable": {
      const base = convertZodToJson(def.innerType as z.ZodType<unknown>)
      return {
        ...(base as object),
        type: [((base as any).type || "string"), "null"],
      }
    }

    case "ZodDefault": {
      const base = convertZodToJson(def.innerType as z.ZodType<unknown>)
      return {
        ...(base as object),
        default: def.defaultValue(),
      }
    }

    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const types = def.options.map((option: z.ZodType<unknown>) =>
        convertZodToJson(option)
      )
      return {
        oneOf: types,
      }
    }

    case "ZodIntersection": {
      return {
        allOf: [
          convertZodToJson(def.left as z.ZodType<unknown>),
          convertZodToJson(def.right as z.ZodType<unknown>),
        ],
      }
    }

    case "ZodRecord": {
      return {
        type: "object",
        additionalProperties: convertZodToJson(def.valueType as z.ZodType<unknown>),
      }
    }

    case "ZodTuple": {
      const items = def.items.map((item: z.ZodType<unknown>) =>
        convertZodToJson(item)
      )
      return {
        type: "array",
        items,
        minItems: items.length,
        maxItems: items.length,
      }
    }

    case "ZodLazy": {
      return convertZodToJson(def.getter() as z.ZodType<unknown>)
    }

    case "ZodLiteral": {
      return {
        type: typeof def.value,
        const: def.value,
      }
    }

    case "ZodAny":
      return {}

    case "ZodUnknown":
      return {}

    case "ZodNever":
      return { not: {} }

    default:
      return { type: "string" }
  }
}

/**
 * 创建 JSON Schema 格式的工具输入定义
 */
export function createToolSchema<T extends z.ZodRawShape>(
  shape: T
): z.ZodObject<T> {
  return z.object(shape)
}

/**
 * 常见 Schema 预设
 */
export const Schemas = {
  path: z.object({
    path: z.string().describe("File or directory path"),
  }),

  readFile: z.object({
    path: z.string().describe("Path to the file to read"),
    encoding: z.string().optional().default("utf-8"),
  }),

  writeFile: z.object({
    path: z.string().describe("Path to the file to write"),
    content: z.string().describe("Content to write"),
    encoding: z.string().optional().default("utf-8"),
  }),

  glob: z.object({
    pattern: z.string().describe("Glob pattern to match"),
    cwd: z.string().optional().describe("Current working directory"),
  }),

  command: z.object({
    command: z.string().describe("Command to execute"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
    cwd: z.string().optional().describe("Working directory"),
  }),
}
