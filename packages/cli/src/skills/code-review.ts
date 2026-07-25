/**
 * OpenStar Skills - 代码审查技能
 * 自动代码审查和质量问题检测
 */

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface SkillContext {
  cwd?: string;
  fs: {
    readFile: (path: string, encoding: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
  };
  shell: {
    exec: (cmd: string, cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  };
}

export interface CodeReviewInput {
  files: string[];
  language?: string;
  strict?: boolean;
  includeTests?: boolean;
}

export interface CodeReviewOutput {
  success: boolean;
  findings: CodeReviewFinding[];
  summary: {
    totalFiles: number;
    totalIssues: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  };
}

export interface CodeReviewFinding {
  file: string;
  line?: number;
  severity: "error" | "warning" | "info" | "hint";
  category: string;
  message: string;
  rule?: string;
  suggestion?: string;
}

export const codeReviewSkill: SkillDefinition = {
  id: "code-review",
  name: "Code Review",
  description: "Automated code review for quality and best practices",
  version: "1.0.0",
  tags: ["code", "quality", "review", "linting", "static-analysis"],
  inputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: { type: "string" },
        description: "File paths to review",
      },
      language: {
        type: "string",
        enum: ["typescript", "javascript", "python", "rust", "go"],
        description: "Programming language",
      },
      strict: {
        type: "boolean",
        default: false,
        description: "Enable strict mode",
      },
      includeTests: {
        type: "boolean",
        default: true,
        description: "Include test files in review",
      },
    },
    required: ["files"],
  },
  outputSchema: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      findings: { type: "array" },
      summary: { type: "object" },
    },
  },
};

export async function executeCodeReview(
  input: CodeReviewInput,
  context: SkillContext
): Promise<CodeReviewOutput> {
  const findings: CodeReviewFinding[] = [];
  const bySeverity: Record<string, number> = { error: 0, warning: 0, info: 0, hint: 0 };
  const byCategory: Record<string, number> = {};

  for (const file of input.files) {
    const fileFindings = await reviewFile(file, input, context);
    findings.push(...fileFindings);

    for (const finding of fileFindings) {
      bySeverity[finding.severity]++;
      byCategory[finding.category] = (byCategory[finding.category] || 0) + 1;
    }
  }

  return {
    success: findings.filter((f) => f.severity === "error").length === 0,
    findings,
    summary: {
      totalFiles: input.files.length,
      totalIssues: findings.length,
      bySeverity,
      byCategory,
    },
  };
}

async function reviewFile(
  file: string,
  input: CodeReviewInput,
  context: SkillContext
): Promise<CodeReviewFinding[]> {
  const findings: CodeReviewFinding[] = [];
  const content = await context.fs.readFile(file, "utf8").catch(() => "");
  if (!content) return findings;

  const lines = content.split("\n");
  const ext = file.split(".").pop()?.toLowerCase();

  // 通用审查规则
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测 TODO/FIXME
    if (/TODO|FIXME|HACK|XXX/.test(line)) {
      findings.push({
        file,
        line: i + 1,
        severity: "info",
        category: "documentation",
        message: `Found marker: ${line.trim()}`,
        rule: "no-incomplete-tasks",
      });
    }

    // 检测长行
    if (line.length > 120) {
      findings.push({
        file,
        line: i + 1,
        severity: input.strict ? "warning" : "info",
        category: "formatting",
        message: `Line exceeds 120 characters (${line.length})`,
        rule: "max-line-length",
        suggestion: "Consider breaking this line",
      });
    }

    // 检测 console.log
    if (/console\.(log|debug|info)/.test(line) && !file.includes(".test.")) {
      findings.push({
        file,
        line: i + 1,
        severity: "warning",
        category: "best-practices",
        message: "Avoid leaving console statements in production code",
        rule: "no-console",
        suggestion: "Use a proper logging library",
      });
    }

    // 检测空 catch 块
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      findings.push({
        file,
        line: i + 1,
        severity: "error",
        category: "error-handling",
        message: "Empty catch block - errors are silently ignored",
        rule: "no-empty-catch",
        suggestion: "Add error logging or re-throw",
      });
    }
  }

  // TypeScript/JavaScript 特定规则
  if (["ts", "tsx", "js", "jsx"].includes(ext || "")) {
    // 检测 any 类型
    lines.forEach((line: string, i: number) => {
      if (/:\s*any\b/.test(line)) {
        findings.push({
          file,
          line: i + 1,
          severity: input.strict ? "error" : "warning",
          category: "type-safety",
          message: "Avoid using 'any' type",
          rule: "no-explicit-any",
          suggestion: "Use a specific type or unknown",
        });
      }
    });

    // 检测 == 而非 ===
    lines.forEach((line: string, i: number) => {
      if (/\b\d+\s*==\s*[^=]/.test(line) && !line.includes("===")) {
        findings.push({
          file,
          line: i + 1,
          severity: "error",
          category: "best-practices",
          message: "Use === instead of ==",
          rule: "eqeqeq",
        });
      }
    });
  }

  // Python 特定规则
  if (["py"].includes(ext || "")) {
    lines.forEach((line: string, i: number) => {
      if (/^\s*print\s*\(/.test(line) && !file.includes("test")) {
        findings.push({
          file,
          line: i + 1,
          severity: "warning",
          category: "best-practices",
          message: "Avoid print statements - use logging",
          rule: "no-print",
          suggestion: "Use Python's logging module",
        });
      }
    });
  }

  return findings;
}

export default codeReviewSkill;
