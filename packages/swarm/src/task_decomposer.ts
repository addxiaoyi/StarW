import { z } from "zod";
import { generateTaskId } from "@openstar/core";
import type { Task, DecompositionPlan, TaskPriority } from "./types";

const DECOMPOSITION_RULES = [
  {
    pattern: /^(design|架构|设计).*/i,
    subtasks: ["分析需求", "制定方案", "输出设计文档", "评审设计"],
    capability: "architecture",
  },
  {
    pattern: /^(implement|开发|实现|编码).*/i,
    subtasks: ["理解需求", "编写代码", "单元测试", "代码审查"],
    capability: "coding",
  },
  {
    pattern: /^(test|测试|qa).*/i,
    subtasks: ["制定测试计划", "编写测试用例", "执行测试", "生成测试报告"],
    capability: "testing",
  },
  {
    pattern: /^(research|调研|研究).*/i,
    subtasks: ["明确研究目标", "收集资料", "分析对比", "输出研究报告"],
    capability: "research",
  },
  {
    pattern: /^(review|审查|代码审查).*/i,
    subtasks: ["静态分析", "安全检查", "性能评估", "输出审查报告"],
    capability: "code-review",
  },
  {
    pattern: /^(deploy|部署|发布).*/i,
    subtasks: ["环境准备", "构建打包", "部署执行", "验证上线"],
    capability: "deployment",
  },
  {
    pattern: /^(debug|修复|bug).*/i,
    subtasks: ["复现问题", "定位根因", "编写修复", "验证修复"],
    capability: "debugging",
  },
  {
    pattern: /^(doc|文档|文档编写).*/i,
    subtasks: ["梳理结构", "编写内容", "格式排版", "审查校对"],
    capability: "documentation",
  },
];

export interface DecomposeOptions {
  maxSubtasks?: number;
  priority?: TaskPriority;
  parentTaskId?: string;
  customRules?: typeof DECOMPOSITION_RULES;
}

export function decomposeTask(
  taskDescription: string,
  options: DecomposeOptions = {}
): DecompositionPlan {
  const {
    maxSubtasks = 8,
    priority = "normal",
    parentTaskId,
    customRules,
  } = options;

  const rules = customRules || DECOMPOSITION_RULES;
  const now = Date.now();

  let matchedRule = rules.find((r) => r.pattern.test(taskDescription));

  let subtaskTitles: string[];
  let strategy: string;
  let complexity: number;

  if (matchedRule) {
    subtaskTitles = matchedRule.subtasks.slice(0, maxSubtasks);
    strategy = `基于 ${matchedRule.capability} 模式的标准分解`;
    complexity = subtaskTitles.length;
  } else {
    subtaskTitles = generateGenericSubtasks(taskDescription, maxSubtasks);
    strategy = "通用任务分解策略";
    complexity = Math.min(Math.ceil(taskDescription.length / 50), maxSubtasks);
  }

  const subtasks: Task[] = subtaskTitles.map((title, index) => {
    const task: Task = {
      id: generateTaskId(),
      title,
      description: `${taskDescription} - 子任务: ${title}`,
      priority,
      status: "pending",
      parentTaskId,
      subtaskIds: [],
      requiredCapabilities: matchedRule ? [matchedRule.capability] : [],
      input: { index, total: subtaskTitles.length },
      output: {},
      createdAt: now,
      progress: 0,
      dependencies: index > 0 ? [`subtask_${index - 1}`] : [],
      metadata: {},
    };
    return task;
  });

  const subtaskIds = subtasks.map((t) => t.id);
  subtasks.forEach((task, index) => {
    if (index > 0) {
      task.dependencies = [subtaskIds[index - 1]];
    }
  });

  return {
    originalTask: taskDescription,
    subtasks,
    strategy,
    estimatedComplexity: complexity,
  };
}

function generateGenericSubtasks(description: string, maxCount: number): string[] {
  const baseTasks = [
    `分析: ${description.slice(0, 30)}`,
    "制定执行计划",
    "执行核心任务",
    "验证结果",
    "输出总结",
  ];

  if (description.length > 200) {
    baseTasks.splice(2, 0, "细化任务步骤");
  }

  return baseTasks.slice(0, maxCount);
}

export function canDecomposeFurther(task: Task, depth: number, maxDepth: number): boolean {
  if (depth >= maxDepth) return false;
  if (task.subtaskIds.length > 0) return false;
  if (task.completedAt) return false;

  const isAtomic =
    task.title.length < 15 &&
    task.requiredCapabilities.length <= 1 &&
    task.description.split("\n").length < 3;

  return !isAtomic;
}

export function calculateTaskComplexity(task: Task): number {
  let score = 1;

  score += task.requiredCapabilities.length * 0.5;
  score += task.description.length / 200;
  score += task.dependencies.length * 0.3;
  score += (task.subtaskIds.length || 0) * 0.2;

  if (task.priority === "high") score += 0.5;
  if (task.priority === "urgent") score += 1;

  return Math.min(Math.round(score * 10) / 10, 10);
}
