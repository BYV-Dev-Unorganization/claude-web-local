import { z } from "zod";
import type { WorkspaceRecord } from "./workspace.js";
import {
  listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles,
  writeWorkspaceFile, runWorkspaceCommand
} from "./workspace.js";

export type ToolPermission = "workspace:read" | "workspace:write" | "workspace:execute";
export type RegisteredTool = {
  name: string;
  description: string;
  permission: ToolPermission;
  requiresApproval: boolean;
  timeoutMs: number;
  inputSchema: z.ZodType;
  execute: (input: unknown, workspace: WorkspaceRecord) => Promise<unknown>;
};

const listSchema = z.object({ limit: z.number().int().min(1).max(3000).default(500) });
const readSchema = z.object({ path: z.string().min(1).max(500) });
const searchSchema = z.object({ query: z.string().min(1).max(300), limit: z.number().int().min(1).max(100).default(30) });
const writeSchema = z.object({ path: z.string().min(1).max(500), content: z.string().max(1_000_000) });
const commandSchema = z.object({ command: z.string().min(1).max(4000) });

export const tools: RegisteredTool[] = [
  {
    name: "workspace.list",
    description: "List relative file paths in the selected workspace. Read-only.",
    permission: "workspace:read",
    requiresApproval: false,
    timeoutMs: 30000,
    inputSchema: listSchema,
    execute: async (input, workspace) => ({ files: (await listWorkspaceFiles(workspace)).slice(0, (input as z.infer<typeof listSchema>).limit) })
  },
  {
    name: "workspace.read_file",
    description: "Read a UTF-8 text file inside the selected workspace, up to 2 MB. Read-only.",
    permission: "workspace:read",
    requiresApproval: false,
    timeoutMs: 30000,
    inputSchema: readSchema,
    execute: async (input, workspace) => ({ path: (input as z.infer<typeof readSchema>).path, content: await readWorkspaceFile(workspace, (input as z.infer<typeof readSchema>).path) })
  },
  {
    name: "workspace.search",
    description: "Search text files in the selected workspace. Read-only.",
    permission: "workspace:read",
    requiresApproval: false,
    timeoutMs: 60000,
    inputSchema: searchSchema,
    execute: async (input, workspace) => {
      const args = input as z.infer<typeof searchSchema>;
      return { matches: await searchWorkspaceFiles(workspace, args.query, args.limit) };
    }
  },
  {
    name: "workspace.write_file",
    description: "Create or replace one UTF-8 file inside the selected workspace. Requires explicit approval.",
    permission: "workspace:write",
    requiresApproval: true,
    timeoutMs: 60000,
    inputSchema: writeSchema,
    execute: async (input, workspace) => {
      const args = writeSchema.parse(input);
      return { path: args.path, ...(await writeWorkspaceFile(workspace, args.path, args.content)) };
    }
  },
  {
    name: "workspace.run_command",
    description: "Run a command in the isolated coding container. Network is disabled and only the selected workspace is mounted. Requires explicit approval.",
    permission: "workspace:execute",
    requiresApproval: true,
    timeoutMs: 120000,
    inputSchema: commandSchema,
    execute: async (input, workspace) => {
      const args = commandSchema.parse(input);
      return await runWorkspaceCommand(workspace, args.command, 120000);
    }
  },
  {
    name: "workspace.git_status",
    description: "Run git status in the isolated coding container. Read-only.",
    permission: "workspace:read",
    requiresApproval: false,
    timeoutMs: 30000,
    inputSchema: z.object({}),
    execute: async (_input, workspace) => await runWorkspaceCommand(workspace, "git status --short --branch", 30000)
  },
  {
    name: "workspace.git_diff",
    description: "Read the Git diff in the isolated coding container. Read-only.",
    permission: "workspace:read",
    requiresApproval: false,
    timeoutMs: 30000,
    inputSchema: z.object({}),
    execute: async (_input, workspace) => await runWorkspaceCommand(workspace, "git diff --", 30000)
  }
];

export function publicToolManifest() {
  return tools.map(({ name, description, permission, requiresApproval, timeoutMs }) => ({
    name, description, permission, requiresApproval, timeoutMs
  }));
}

export function getTool(name: string): RegisteredTool | undefined {
  return tools.find((tool) => tool.name === name);
}

export async function executeTool(name: string, input: unknown, workspace: WorkspaceRecord): Promise<unknown> {
  const tool = getTool(name);
  if (!tool) throw new Error("Tool is not registered or enabled.");
  const validated = tool.inputSchema.parse(input);
  return await tool.execute(validated, workspace);
}

/** JSON Schema used by provider tool-calling adapters. */
export function agentToolDefinitions() {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown> }));
}
