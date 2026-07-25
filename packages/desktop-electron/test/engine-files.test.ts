import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileEntry, safeRelativePath } from "../src/engine-files.js";

describe("desktop engine workspace file helpers", () => {
  it("resolves paths contained by the configured workspace", () => {
    const workspace = path.resolve(os.tmpdir(), "openstar-workspace");
    expect(safeRelativePath(workspace, ".")).toBe(workspace);
    expect(safeRelativePath(workspace, "nested/file.txt")).toBe(
      path.join(workspace, "nested", "file.txt"),
    );
    expect(safeRelativePath(workspace, "..cache/data.json")).toBe(
      path.join(workspace, "..cache", "data.json"),
    );
  });

  it("rejects relative and absolute paths outside the workspace", () => {
    const workspace = path.resolve(os.tmpdir(), "openstar-workspace");
    expect(() => safeRelativePath(workspace, "../outside.txt")).toThrow(
      /escapes the configured workspace/,
    );
    expect(() =>
      safeRelativePath(workspace, path.resolve(workspace, "..", "outside.txt")),
    ).toThrow(/escapes the configured workspace/);
  });

  it("reports normalized file and directory metadata", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "openstar-files-"));
    const directory = path.join(workspace, "nested");
    const file = path.join(directory, "data.txt");
    fs.mkdirSync(directory);
    fs.writeFileSync(file, "data", "utf8");

    expect(fileEntry(directory, workspace)).toMatchObject({
      name: "nested",
      path: "nested",
      type: "directory",
      symlink: false,
    });
    expect(fileEntry(file, workspace)).toMatchObject({
      name: "data.txt",
      path: "nested/data.txt",
      type: "file",
      size: 4,
      symlink: false,
    });
  });
});
