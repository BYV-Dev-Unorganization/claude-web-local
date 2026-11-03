import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { sqlite, nowIso } from "./db.js";

export type WorkspaceRecord = { id: string; name: string; relative_path: string; created_at: string; updated_at: string };

export function listWorkspaces(): WorkspaceRecord[] {
  return sqlite.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC").all() as WorkspaceRecord[];
}

export async function createWorkspace(name: string): Promise<WorkspaceRecord> {
  const workspaceId = randomUUID();
  const relativePath = workspaceId;
  const root = path.join(config.workspacePath, relativePath);
  await fs.mkdir(root, { recursive: false, mode: 0o700 });
  const timestamp = nowIso();
  sqlite.prepare("INSERT INTO workspaces (id, name, relative_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(workspaceId, name, relativePath, timestamp, timestamp);
  return sqlite.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as WorkspaceRecord;
}

export function getWorkspace(workspaceId: string): WorkspaceRecord | undefined {
  return sqlite.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as WorkspaceRecord | undefined;
}

async function workspaceRoot(workspace: WorkspaceRecord): Promise<string> {
  const candidate = path.resolve(config.workspacePath, workspace.relative_path);
  const root = await fs.realpath(candidate);
  const base = await fs.realpath(config.workspacePath);
  const relative = path.relative(base, root);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Workspace path is outside the configured workspace root.");
  }
  return root;
}

export async function resolveWorkspaceFile(workspace: WorkspaceRecord, relativePath: string, mustExist = false): Promise<string> {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("A non-empty relative workspace path is required.");
  }
  const root = await workspaceRoot(workspace);
  const candidate = path.resolve(root, relativePath);
  const rel = path.relative(root, candidate);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Path escapes the selected workspace.");
  if (mustExist) {
    const real = await fs.realpath(candidate);
    const actualRel = path.relative(root, real);
    if (actualRel.startsWith("..") || path.isAbsolute(actualRel)) throw new Error("Symlink escape is not allowed.");
    return real;
  }
  let existing = candidate;
  while (true) {
    try { await fs.access(existing); break; }
    catch {
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error("Unable to resolve a safe workspace parent.");
      existing = parent;
    }
  }
  const realExisting = await fs.realpath(existing);
  const existingRel = path.relative(root, realExisting);
  if (existingRel.startsWith("..") || path.isAbsolute(existingRel)) throw new Error("Symlink escape is not allowed.");
  return candidate;
}

export async function listWorkspaceFiles(workspace: WorkspaceRecord): Promise<string[]> {
  const root = await workspaceRoot(workspace);
  const results: string[] = [];
  const ignored = new Set([".git", "node_modules", "dist", "coverage", ".next", ".cache"]);
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > 5 || results.length >= 3000) return;
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (ignored.has(entry.name)) continue;
      const full = path.join(folder, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile()) results.push(relative);
      if (results.length >= 3000) return;
    }
  };
  await walk(root, 0);
  return results.sort();
}

export async function readWorkspaceFile(workspace: WorkspaceRecord, relativePath: string): Promise<string> {
  const filePath = await resolveWorkspaceFile(workspace, relativePath, true);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > 2_000_000) throw new Error("Only regular text files up to 2 MB can be read.");
  const data = await fs.readFile(filePath);
  if (data.includes(0)) throw new Error("Binary files are not exposed to the agent read tool.");
  return data.toString("utf8");
}

export async function searchWorkspaceFiles(workspace: WorkspaceRecord, query: string, limit = 30): Promise<Array<{ path: string; line: number; excerpt: string }>> {
  const needle = query.toLowerCase();
  const paths = await listWorkspaceFiles(workspace);
  const results: Array<{ path: string; line: number; excerpt: string }> = [];
  let scannedBytes = 0;
  for (const relativePath of paths.slice(0, 500)) {
    if (results.length >= limit || scannedBytes >= 25 * 1024 * 1024) break;
    try {
      const content = await readWorkspaceFile(workspace, relativePath);
      scannedBytes += Buffer.byteLength(content, "utf8");
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && results.length < limit; index++) {
        if (lines[index]!.toLowerCase().includes(needle)) {
          results.push({ path: relativePath, line: index + 1, excerpt: lines[index]!.slice(0, 500) });
        }
      }
    } catch {
      // Binary, oversized, or unreadable files are deliberately skipped.
    }
  }
  return results;
}

function sandboxArgs(workspace: WorkspaceRecord, args: string[]): string[] {
  const root = path.resolve(config.workspacePath, workspace.relative_path);
  const uid = typeof process.getuid === "function" ? process.getuid() : 10001;
  const gid = typeof process.getgid === "function" ? process.getgid() : 10001;
  return [
    "run", "--rm", "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "128", "--memory", "512m", "--cpus", "1",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    "--user", uid + ":" + gid,
    "--mount", "type=bind,src=" + root + ",dst=/workspace",
    "--workdir", "/workspace",
    "cwl-coding-sandbox:local",
    ...args
  ];
}

export async function runWorkspaceCommand(workspace: WorkspaceRecord, command: string, timeoutMs = 120000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!command.trim() || command.length > 4000) throw new Error("Command must contain 1–4000 characters.");
  const child = spawn("docker", sandboxArgs(workspace, ["sh", "-lc", command]), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("Sandbox command timed out.")));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout = (stdout + chunk).slice(-100000); });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-100000); });
    child.on("error", (error) => finish(() => reject(new Error("Coding sandbox unavailable: " + error.message))));
    child.on("close", (code) => finish(() => resolve({ exitCode: code ?? 1, stdout, stderr })));
  });
}

export async function writeWorkspaceFile(workspace: WorkspaceRecord, relativePath: string, content: string): Promise<{ bytes: number }> {
  if (content.length > 1_000_000) throw new Error("Workspace file writes are limited to 1 MB.");
  await resolveWorkspaceFile(workspace, relativePath, false);
  const script = [
    'const fs=require("node:fs");',
    'const path=require("node:path");',
    'const root="/workspace";',
    'const target=path.resolve(root,process.argv[1]);',
    'const rel=path.relative(root,target);',
    'if(!rel||rel.startsWith("..")||path.isAbsolute(rel))process.exit(21);',
    'fs.mkdirSync(path.dirname(target),{recursive:true});',
    'const parent=fs.realpathSync(path.dirname(target));',
    'const parentRel=path.relative(root,parent);',
    'if(parentRel.startsWith("..")||path.isAbsolute(parentRel))process.exit(22);',
    'if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())process.exit(23);',
    'fs.writeFileSync(target,Buffer.from(process.argv[2],"base64"),{mode:0o600});'
  ].join("");
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const result = await runSandboxArgs(workspace, ["node", "-e", script, relativePath, encoded], 30000);
  if (result.exitCode !== 0) throw new Error("Sandbox rejected the requested file write: " + result.stderr.slice(0, 300));
  return { bytes: Buffer.byteLength(content, "utf8") };
}

async function runSandboxArgs(workspace: WorkspaceRecord, command: string[], timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawn("docker", sandboxArgs(workspace, command), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(() => reject(new Error("Sandbox operation timed out."))); }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout = (stdout + chunk).slice(-100000); });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-100000); });
    child.on("error", (error) => finish(() => reject(new Error("Coding sandbox unavailable: " + error.message))));
    child.on("close", (code) => finish(() => resolve({ exitCode: code ?? 1, stdout, stderr })));
  });
}
