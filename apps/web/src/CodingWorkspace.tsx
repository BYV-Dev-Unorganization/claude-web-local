import "./coding.css";
import { useEffect, useState, type FormEvent } from "react";

type Workspace = { id: string; name: string; relative_path: string; created_at: string; updated_at: string };
type CommandResult = { exitCode: number; stdout: string; stderr: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message ?? "Request failed (" + response.status + ").");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export default function CodingWorkspace() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [newFilePath, setNewFilePath] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [command, setCommand] = useState("npm test");
  const [output, setOutput] = useState<CommandResult | null>(null);
  const [gitOutput, setGitOutput] = useState("");
  const [diffOutput, setDiffOutput] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [sandboxReady, setSandboxReady] = useState(false);

  const refreshWorkspaces = async () => {
    const result = await api<{ items: Workspace[] }>("/api/v1/workspaces");
    setWorkspaces(result.items);
    if (!selectedId && result.items[0]) setSelectedId(result.items[0].id);
  };

  const refreshTree = async (workspaceId: string) => {
    const result = await api<{ files: string[] }>("/api/v1/workspaces/" + workspaceId + "/tree");
    setFiles(result.files);
  };

  useEffect(() => {
    void refreshWorkspaces().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load workspaces."));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setFiles([]);
      setSelectedPath("");
      setContent("");
      setSavedContent("");
      return;
    }
    void refreshTree(selectedId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load workspace files."));
  }, [selectedId]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const workspace = await api<Workspace>("/api/v1/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: newName })
      });
      setNewName("");
      await refreshWorkspaces();
      setSelectedId(workspace.id);
      setNotice("Workspace created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create workspace.");
    } finally { setLoading(false); }
  };

  const openFile = async (relativePath: string) => {
    if (!selectedId) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ content: string }>("/api/v1/workspaces/" + selectedId + "/file?path=" + encodeURIComponent(relativePath));
      setSelectedPath(relativePath);
      setContent(result.content);
      setSavedContent(result.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read file.");
    } finally { setLoading(false); }
  };

  const saveFile = async () => {
    if (!selectedId || !selectedPath || content === savedContent) return;
    const accepted = window.confirm("Write the edited file '" + selectedPath + "' into this workspace?");
    if (!accepted) return;
    setLoading(true);
    setError("");
    try {
      await api("/api/v1/workspaces/" + selectedId + "/file", {
        method: "PUT",
        body: JSON.stringify({ path: selectedPath, content, confirmed: true })
      });
      setSavedContent(content);
      await refreshTree(selectedId);
      setNotice("File saved in the workspace.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File save failed.");
    } finally { setLoading(false); }
  };

  const runCommand = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId || !command.trim()) return;
    const accepted = window.confirm(
      "Run this command inside the isolated coding container with network access disabled?\n\n" + command
    );
    if (!accepted) return;
    setLoading(true);
    setError("");
    setOutput(null);
    try {
      const result = await api<CommandResult>("/api/v1/workspaces/" + selectedId + "/commands", {
        method: "POST",
        body: JSON.stringify({ command, confirmed: true, timeoutMs: 120000 })
      });
      setOutput(result);
      if (result.exitCode !== 0) setNotice("Command finished with exit code " + result.exitCode + ".");
      else setNotice("Command completed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Command execution failed.");
    } finally { setLoading(false); }
  };

  const loadGit = async (kind: "status" | "diff") => {
    if (!selectedId) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<CommandResult>("/api/v1/workspaces/" + selectedId + "/git/" + kind);
      if (kind === "status") setGitOutput(result.stdout || result.stderr || "(clean)");
      else setDiffOutput(result.stdout || result.stderr || "No diff.");
      setSandboxReady(true);
    } catch (cause) {
      setSandboxReady(false);
      setError(cause instanceof Error ? cause.message : "Git operation failed.");
    } finally { setLoading(false); }
  };

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedId);
  const changed = content !== savedContent;

  return (
    <section className="content-page coding-page">
      <div className="page-heading">
        <div><p className="eyebrow">ISOLATED DEVELOPMENT</p><h1>Coding workspace</h1><p>Operate only inside a workspace you select. Shell execution runs in a network-disabled Docker container.</p></div>
      </div>
      {(error || notice) && <div className={error ? "toast error-toast" : "toast"} role="status"><span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); }}>Dismiss</button></div>}
      <div className="coding-layout">
        <aside className="panel workspace-sidebar">
          <h2>Workspaces</h2>
          <form className="workspace-create" onSubmit={(event) => void create(event)}>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Workspace name" aria-label="Workspace name" />
            <button className="primary-button" disabled={loading || !newName.trim()}>Create</button>
          </form>
          <div className="workspace-list">
            {workspaces.map((workspace) => <button key={workspace.id} className={selectedId === workspace.id ? "workspace-choice active" : "workspace-choice"} onClick={() => setSelectedId(workspace.id)}>
              <strong>{workspace.name}</strong><small>{workspace.relative_path}</small>
            </button>)}
            {workspaces.length === 0 && <p className="empty-copy">Create a workspace to start.</p>}
          </div>
        </aside>
        <div className="coding-main">
          <div className="panel">
            <div className="panel-heading">
              <div><h2>{selectedWorkspace?.name ?? "Select a workspace"}</h2><p>{files.length} files indexed in the selected workspace</p></div>
              <div className="workspace-actions">
                <button className="secondary-button" disabled={!selectedId || loading} onClick={() => void loadGit("status")}>Git status</button>
                <button className="secondary-button" disabled={!selectedId || loading} onClick={() => void loadGit("diff")}>Git diff</button>
              </div>
            </div>
            {selectedWorkspace ? (
              <div className="file-browser">
                <div className="file-list">
                  <div className="file-list-title">Files</div>
                  <form className="new-file-form" onSubmit={(event) => { event.preventDefault(); if (!newFilePath.trim()) return; setSelectedPath(newFilePath.trim()); setContent(""); setSavedContent(""); setNewFilePath(""); }}><input value={newFilePath} onChange={(event) => setNewFilePath(event.target.value)} placeholder="new-file.ts" aria-label="New file path" /><button className="secondary-button" disabled={!newFilePath.trim()}>New</button></form>
                  {files.map((file) => <button key={file} className={selectedPath === file ? "file-choice active" : "file-choice"} onClick={() => void openFile(file)} title={file}><span>▤</span>{file}</button>)}
                  {files.length === 0 && <p className="empty-copy">This workspace is empty.</p>}
                </div>
                <div className="editor-pane">
                  <div className="editor-toolbar"><span>{selectedPath || "Choose a file"}</span>{selectedPath && <button className="primary-button" disabled={loading || !changed} onClick={() => void saveFile()}>{changed ? "Save changes" : "Saved"}</button>}</div>
                  {selectedPath ? <textarea className="workspace-editor" spellCheck={false} value={content} onChange={(event) => setContent(event.target.value)} disabled={loading} /> : <div className="editor-empty">Select a text file from the left to inspect or edit it.</div>}
                </div>
              </div>
            ) : <p className="empty-copy">The file browser is scoped to one registered workspace. Create or select a workspace to continue.</p>}
          </div>
          <div className="panel command-panel">
            <div className="panel-heading"><div><h2>Command runner</h2><p>Commands run in the restricted image, not in the API process. Network is disabled.</p></div><span className={sandboxReady ? "status-good" : "status-muted"}>{sandboxReady ? "Sandbox responding" : "Sandbox not verified"}</span></div>
            <form className="command-form" onSubmit={(event) => void runCommand(event)}>
              <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Enter command, e.g. npm test" />
              <button className="primary-button" disabled={!selectedId || loading || !command.trim()}>Run with approval</button>
            </form>
            {output && <div className="command-output"><div className="output-heading">Exit code: {output.exitCode}</div>{output.stdout && <pre>{output.stdout}</pre>}{output.stderr && <pre className="stderr">{output.stderr}</pre>}</div>}
          </div>
          {(gitOutput || diffOutput) && <div className="panel">
            <h2>Git inspection</h2>
            {gitOutput && <><h3 className="output-heading">Status</h3><pre className="command-output">{gitOutput}</pre></>}
            {diffOutput && <><h3 className="output-heading">Diff</h3><pre className="command-output">{diffOutput}</pre></>}
          </div>}
        </div>
      </div>
      <p className="composer-footnote">Before first use, build the worker image: docker build -t cwl-coding-sandbox:local -f workers/coding/Dockerfile workers/coding. Full autonomous coding-agent integration, Git branch/commit operations, snapshots and rollback are not enabled yet.</p>
    </section>
  );
}
