import { describe, expect, it } from "vitest";
import {
  findNextTextMatch,
  formatBytes,
  formatValue,
  isGeneratedWorkspaceEntry,
  joinWorkspacePath,
  parentWorkspacePath,
  workspaceBreadcrumbs,
} from "./runtime-view-utils";

describe("runtime view utilities", () => {
  it("formats byte sizes for file metadata", () => {
    expect(formatBytes()).toBe("");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(12 * 1024)).toBe("12 KiB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MiB");
  });

  it("formats strings directly and structured values as JSON", () => {
    expect(formatValue("plain")).toBe("plain");
    expect(formatValue({ enabled: true })).toBe('{\n  "enabled": true\n}');
  });

  it("hides generated and accidental root entries without hiding nested files", () => {
    expect(isGeneratedWorkspaceEntry("node_modules", ".")).toBe(true);
    expect(isGeneratedWorkspaceEntry("%SystemDrive%", ".")).toBe(true);
    expect(isGeneratedWorkspaceEntry("NVIDIA Corporation", ".")).toBe(true);
    expect(isGeneratedWorkspaceEntry("node_modules", "packages/ui-web")).toBe(
      false,
    );
    expect(isGeneratedWorkspaceEntry(".github", ".")).toBe(false);
    expect(isGeneratedWorkspaceEntry("packages", ".")).toBe(false);
  });

  it("joins user-entered names to workspace-relative paths", () => {
    expect(joinWorkspacePath(".", " file.txt ")).toBe("file.txt");
    expect(joinWorkspacePath("src", "\\nested\\file.ts")).toBe(
      "src/nested/file.ts",
    );
    expect(joinWorkspacePath("src", "   ")).toBe("");
  });

  it("derives parent paths for root and nested locations", () => {
    expect(parentWorkspacePath(".")).toBe(".");
    expect(parentWorkspacePath("src")).toBe(".");
    expect(parentWorkspacePath("src/components/workbench")).toBe(
      "src/components",
    );
    expect(parentWorkspacePath("src\\components")).toBe("src");
  });

  it("builds breadcrumbs without duplicating the root path", () => {
    expect(workspaceBreadcrumbs(".", "OpenStar")).toEqual([
      { label: "OpenStar", path: "." },
    ]);
    expect(workspaceBreadcrumbs("src/components", "OpenStar")).toEqual([
      { label: "OpenStar", path: "." },
      { label: "src", path: "src" },
      { label: "components", path: "src/components" },
    ]);
  });

  it("finds the next match and wraps to the beginning", () => {
    expect(findNextTextMatch("one two one", "one", 0, 0)).toEqual({
      start: 0,
      end: 3,
    });
    expect(findNextTextMatch("one two one", "one", 3, 3)).toEqual({
      start: 8,
      end: 11,
    });
    expect(findNextTextMatch("one two one", "one", 11, 11)).toEqual({
      start: 0,
      end: 3,
    });
    expect(findNextTextMatch("text", "missing", 0, 0)).toBeNull();
  });
});
