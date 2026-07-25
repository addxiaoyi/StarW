import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DesktopApprovalManager,
  DesktopMutationJournal,
} from "../src/engine-security.js";

describe("desktop engine security", () => {
  it("resolves explicit dangerous-operation approvals", async () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const manager = new DesktopApprovalManager((event, payload) => events.push({ event, payload }), 1000);
    const pending = manager.request("session-1", {
      tool: "bash",
      action: "execute_command",
      risk: "high",
      summary: "test",
      command: "git reset --hard",
    });
    const approval = manager.list()[0];
    expect(approval?.sessionId).toBe("session-1");
    expect(manager.resolve(approval!.id, true)).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(events.map((item) => item.event)).toEqual(["approval.requested", "approval.resolved"]);
  });

  it("records diffs and performs conflict-safe rollback", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openstar-journal-"));
    const file = path.join(root, "file.txt");
    fs.writeFileSync(file, "after", "utf8");
    const journal = new DesktopMutationJournal(root, () => undefined);
    const { changeId } = journal.record("session-1", {
      tool: "edit",
      path: file,
      before: "before",
      after: "after",
    });
    expect(journal.list("session-1")[0]?.diff).toContain("- before");
    await journal.rollback(changeId);
    expect(fs.readFileSync(file, "utf8")).toBe("before");
    await expect(journal.rollback(changeId)).rejects.toThrow(/already rolled back/);
  });
});
