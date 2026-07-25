/**
 * OpenStar Skills - Git 操作技能
 * 自动化 Git 工作流程
 */

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

export interface GitOperationInput {
  operation: "status" | "commit" | "push" | "pull" | "branch" | "log" | "diff" | "stash";
  message?: string;
  branch?: string;
  force?: boolean;
  all?: boolean;
}

export interface GitOperationOutput {
  success: boolean;
  operation: string;
  output: string;
  details?: Record<string, unknown>;
}

export const gitOpsSkill = {
  id: "git-ops",
  name: "Git Operations",
  description: "Automated Git operations - commit, push, pull, branch management",
  version: "1.0.0",
  tags: ["git", "version-control", "automation", "ci-cd"],
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["status", "commit", "push", "pull", "branch", "log", "diff", "stash"],
        description: "Git operation to perform",
      },
      message: {
        type: "string",
        description: "Commit message (required for commit operation)",
      },
      branch: {
        type: "string",
        description: "Branch name for branch/push operations",
      },
      force: {
        type: "boolean",
        default: false,
        description: "Force operation",
      },
      all: {
        type: "boolean",
        default: false,
        description: "Stage all files",
      },
    },
    required: ["operation"],
  },
  outputSchema: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      operation: { type: "string" },
      output: { type: "string" },
    },
  },
};

export async function executeGitOps(
  input: GitOperationInput,
  context: SkillContext
): Promise<GitOperationOutput> {
  const cwd = context.cwd || process.cwd();

  switch (input.operation) {
    case "status": {
      const result = await context.shell.exec("git status --short", cwd);
      return {
        success: result.code === 0,
        operation: "status",
        output: result.stdout || result.stderr,
      };
    }

    case "commit": {
      if (!input.message) {
        return {
          success: false,
          operation: "commit",
          output: "Commit message is required",
        };
      }
      if (input.all) {
        await context.shell.exec("git add -A", cwd);
      }
      const result = await context.shell.exec(`git commit -m "${input.message}"`, cwd);
      return {
        success: result.code === 0,
        operation: "commit",
        output: result.stdout || result.stderr,
        details: { message: input.message },
      };
    }

    case "push": {
      let cmd = "git push";
      if (input.branch) {
        cmd += ` origin ${input.branch}`;
      }
      if (input.force) {
        cmd += " --force";
      }
      const result = await context.shell.exec(cmd, cwd);
      return {
        success: result.code === 0,
        operation: "push",
        output: result.stdout || result.stderr,
        details: { branch: input.branch, force: input.force },
      };
    }

    case "pull": {
      let cmd = "git pull";
      if (input.branch) {
        cmd += ` origin ${input.branch}`;
      }
      const result = await context.shell.exec(cmd, cwd);
      return {
        success: result.code === 0,
        operation: "pull",
        output: result.stdout || result.stderr,
      };
    }

    case "branch": {
      if (input.branch) {
        const createResult = await context.shell.exec(`git checkout -b ${input.branch}`, cwd);
        return {
          success: createResult.code === 0,
          operation: "branch-create",
          output: createResult.stdout || createResult.stderr,
          details: { branch: input.branch },
        };
      } else {
        const listResult = await context.shell.exec("git branch -a", cwd);
        return {
          success: listResult.code === 0,
          operation: "branch-list",
          output: listResult.stdout,
        };
      }
    }

    case "log": {
      const result = await context.shell.exec("git log --oneline -20", cwd);
      return {
        success: result.code === 0,
        operation: "log",
        output: result.stdout,
      };
    }

    case "diff": {
      let cmd = "git diff --stat";
      if (input.branch) {
        cmd += ` ${input.branch}`;
      }
      const result = await context.shell.exec(cmd, cwd);
      return {
        success: result.code === 0,
        operation: "diff",
        output: result.stdout,
      };
    }

    case "stash": {
      const result = await context.shell.exec("git stash list", cwd);
      return {
        success: result.code === 0,
        operation: "stash",
        output: result.stdout,
      };
    }

    default:
      return {
        success: false,
        operation: input.operation,
        output: `Unknown operation: ${input.operation}`,
      };
  }
}

export default gitOpsSkill;
