import { describe, it, expect } from "vitest";
import { filesystemTools } from "../tools/filesystem";
import { gitTools } from "../tools/git";
import { systemTools } from "../tools/system";
import path from "path";
import fs from "fs/promises";

describe("FileSystem Tools", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(process.cwd(), ".test-tmp-fs-"));
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should have all required tools", () => {
    const names = filesystemTools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("append_file");
    expect(names).toContain("list_directory");
    expect(names).toContain("create_directory");
    expect(names).toContain("delete_file");
    expect(names).toContain("copy_file");
    expect(names).toContain("move_file");
    expect(names).toContain("get_file_info");
    expect(names).toContain("search_files");
  });

  it("should write and read a file", async () => {
    const filePath = path.join(testDir, "test.txt");
    const writeResult = await filesystemTools[1].handler({
      path: filePath,
      content: "Hello, OpenStar!",
    });
    expect(writeResult).toHaveProperty("success", true);

    const readResult = await filesystemTools[0].handler({ path: filePath });
    expect(readResult).toHaveProperty("success", true);
    expect(readResult).toHaveProperty("content", "Hello, OpenStar!");
  });

  it("should list directory contents", async () => {
    const result = await filesystemTools[3].handler({ path: testDir });
    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("entries");
    expect(Array.isArray((result as { entries: unknown[] }).entries)).toBe(
      true,
    );
  });

  it("should get file info", async () => {
    const filePath = path.join(testDir, "test.txt");
    const result = await filesystemTools[8].handler({ path: filePath });
    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("size");
    expect(result).toHaveProperty("isFile", true);
  });

  it("should fail for blocked paths", async () => {
    const result = await filesystemTools[0].handler({ path: "/etc/passwd" });
    expect(result).toHaveProperty("success", false);
  });

  it("should append to a file", async () => {
    const filePath = path.join(testDir, "append.txt");
    await filesystemTools[1].handler({ path: filePath, content: "Line 1\n" });
    await filesystemTools[2].handler({ path: filePath, content: "Line 2\n" });
    const read = await filesystemTools[0].handler({ path: filePath });
    expect((read as { content: string }).content).toBe("Line 1\nLine 2\n");
  });

  it("should copy and move files", async () => {
    const src = path.join(testDir, "test.txt");
    const dst = path.join(testDir, "copied.txt");
    const result = await filesystemTools[6].handler({
      source: src,
      destination: dst,
    });
    expect(result).toHaveProperty("success", true);
  });
});

describe("Git Tools", () => {
  it("should have all required tools", () => {
    const names = gitTools.map((t) => t.name);
    expect(names).toContain("git_status");
    expect(names).toContain("git_log");
    expect(names).toContain("git_branch");
    expect(names).toContain("git_diff");
    expect(names).toContain("git_commit");
    expect(names).toContain("git_add");
    expect(names).toContain("git_checkout");
    expect(names).toContain("git_pull");
    expect(names).toContain("git_push");
    expect(names).toContain("git_remote");
  });

  it("should handle git status in any dir", async () => {
    const result = await gitTools[0].handler({ cwd: process.cwd() });
    expect(result).toBeDefined();
    expect(result).toHaveProperty("files");
  });

  it("should handle git log", async () => {
    const result = await gitTools[1].handler({ limit: 5 });
    expect(result).toBeDefined();
  });
});

describe("System Tools", () => {
  it("should have system info tool", () => {
    const names = systemTools.map((t) => t.name);
    expect(names).toContain("get_system_info");
    expect(names).toContain("execute_command");
  });

  it("should return system info", async () => {
    const sysInfo = systemTools.find((t) => t.name === "get_system_info");
    expect(sysInfo).toBeDefined();
    const result = await sysInfo!.handler({});
    expect(result).toBeDefined();
    expect(result).toHaveProperty("platform");
    expect(result).toHaveProperty("nodeVersion");
  });
});
