import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { listWorkspaceFiles, resolveWorkspaceFile, type WorkspaceRecord } from "./workspace.js";

let root = "";
let outside = "";
let workspace: WorkspaceRecord;

beforeEach(async () => {
  const id = "test-" + randomUUID();
  root = path.join(config.workspacePath, id);
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "cwl-outside-"));
  await fs.mkdir(root, { recursive: false, mode: 0o700 });
  workspace = {
    id,
    name: "Security test",
    relative_path: id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
  if (outside) await fs.rm(outside, { recursive: true, force: true });
});

describe("workspace path isolation", () => {
  it("rejects parent traversal", async () => {
    await expect(resolveWorkspaceFile(workspace, "../outside.txt")).rejects.toThrow("Path escapes");
  });

  it("accepts a regular file under the selected workspace", async () => {
    await fs.writeFile(path.join(root, "readme.md"), "workspace content");
    const resolved = await resolveWorkspaceFile(workspace, "readme.md", true);
    expect(resolved).toBe(path.join(root, "readme.md"));
  });

  it("rejects a symlink that points outside the workspace", async () => {
    await fs.writeFile(path.join(outside, "secret.txt"), "not for this workspace");
    await fs.symlink(outside, path.join(root, "escape"), "dir");
    await expect(resolveWorkspaceFile(workspace, "escape/secret.txt", true)).rejects.toThrow("Symlink escape");
  });

  it("does not follow symlink directories during tree listing", async () => {
    await fs.writeFile(path.join(outside, "secret.txt"), "external");
    await fs.symlink(outside, path.join(root, "external"), "dir");
    const files = await listWorkspaceFiles(workspace);
    expect(files).toEqual([]);
  });
});
