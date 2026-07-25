/**
 * OpenStar Skills - 技能模块导出
 */

export { codeReviewSkill, executeCodeReview } from "./code-review";
export { gitOpsSkill, executeGitOps } from "./git-ops";
export { testGenSkill, executeTestGen } from "./test-gen";

// 技能列表
export const skillsList = [
  {
    id: "code-review",
    name: "Code Review",
    description: "Automated code review for quality and best practices",
    tags: ["code", "quality", "review", "linting", "static-analysis"],
  },
  {
    id: "git-ops",
    name: "Git Operations",
    description: "Automated Git operations - commit, push, pull, branch management",
    tags: ["git", "version-control", "automation", "ci-cd"],
  },
  {
    id: "test-generation",
    name: "Test Generation",
    description: "Automatically generate unit tests and integration tests",
    tags: ["testing", "tdd", "quality", "automation", "jest", "vitest"],
  },
];
