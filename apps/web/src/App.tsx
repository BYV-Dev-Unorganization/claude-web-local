import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import CodingWorkspace from "./CodingWorkspace";

type Alias = "fable" | "opus" | "sonnet" | "haiku";
type Page = "chat" | "projects" | "artifacts" | "memory" | "tasks" | "coding" | "settings";
type TaskStatus = "queued" | "planning" | "running" | "waiting_approval" | "waiting_input" | "paused" | "completed" | "failed" | "cancelled";
type TaskRecord = { id: string; title: string; description: string; status: TaskStatus; task_type: string; model_alias: Alias; execution_mode: string; created_at: string; updated_at: string };
type ApprovalRecord = { id: string; task_id: string; action_name: string; target_json: string; status: string; requested_at: string; expires_at: string };
type WorkspaceOption = { id: string; name: string; relative_path: string };
type ToolOption = { name: string; description: string; permission: string; requiresApproval: boolean; timeoutMs: number };
type Conversation = { id: string; title: string; model_alias: Alias; project_id?: string | null; updated_at: string };
type Message = { id: string; role: "user" | "assistant"; content: string; status: string; created_at?: string };
type Project = { id: string; name: string; description?: string; instructions?: string };
type Artifact = { id: string; title: string; artifact_type: string; current_version: number; updated_at: string };
type Memory = { id: string; content: string; scope: string; memory_type: string; project_id?: string | null };
type ModelInfo = { alias: Alias; configured: boolean; isDefault: boolean };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }), ...init?.headers }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? "Request failed (" + response.status + ").");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{children}</ReactMarkdown>;
}

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [modelAlias, setModelAlias] = useState<Alias>("sonnet");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [availableTools, setAvailableTools] = useState<ToolOption[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedToolName, setSelectedToolName] = useState("workspace.list");
  const [toolInputJson, setToolInputJson] = useState("{}");
  const [toolOutput, setToolOutput] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<{ title: string; artifact_type: string; content: string; id: string } | null>(null);
  const [search, setSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ fileName: string; text: string; chunkIndex: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<Record<string, unknown> | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, { available: boolean; reason?: string }> | null>(null);
  const [newProject, setNewProject] = useState({ name: "", description: "", instructions: "" });
  const [newArtifact, setNewArtifact] = useState({ title: "", artifactType: "html", content: "" });
  const [newMemory, setNewMemory] = useState({ content: "", scope: "global", projectId: "" });
  const [newTask, setNewTask] = useState({ title: "", description: "", taskType: "general", modelAlias: "sonnet" as Alias, executionMode: "approve-each" });
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    const result = await api<{ items: Conversation[] }>("/api/v1/conversations");
    setConversations(result.items);
  }, []);
  const refreshProjects = useCallback(async () => {
    const result = await api<{ items: Project[] }>("/api/v1/projects");
    setProjects(result.items);
  }, []);
  const refreshArtifacts = useCallback(async () => {
    const result = await api<{ items: Artifact[] }>("/api/v1/artifacts");
    setArtifacts(result.items);
  }, []);
  const refreshMemories = useCallback(async () => {
    const result = await api<{ items: Memory[] }>("/api/v1/memories");
    setMemories(result.items);
  }, []);
  const refreshTasks = useCallback(async () => {
    const result = await api<{ items: TaskRecord[] }>("/api/v1/tasks?limit=50");
    setTasks(result.items);
    setSelectedTaskId((current) => current && result.items.some((task) => task.id === current) ? current : result.items[0]?.id ?? "");
  }, []);
  const refreshWorkspaces = useCallback(async () => {
    const result = await api<{ items: WorkspaceOption[] }>("/api/v1/workspaces");
    setWorkspaces(result.items);
    setSelectedWorkspaceId((current) => current && result.items.some((workspace) => workspace.id === current) ? current : result.items[0]?.id ?? "");
  }, []);
  const refreshToolManifest = useCallback(async () => {
    const result = await api<{ items: ToolOption[] }>("/api/v1/tools/manifest");
    setAvailableTools(result.items);
    setSelectedToolName((current) => result.items.some((tool) => tool.name === current) ? current : result.items[0]?.name ?? "");
  }, []);
  const refreshApprovals = useCallback(async () => {
    const result = await api<{ items: ApprovalRecord[] }>("/api/v1/approvals?status=pending");
    setApprovals(result.items);
  }, []);

  useEffect(() => {
    Promise.all([
      refreshConversations(), refreshProjects(), refreshArtifacts(), refreshMemories(),
      api<{ provider: string | null; models: ModelInfo[] }>("/api/v1/models"),
      api<Record<string, { available: boolean; reason?: string }>>("/api/v1/capabilities"),
      api<Record<string, unknown>>("/api/v1/runtime/status"),
      refreshTasks(), refreshApprovals(), refreshWorkspaces(), refreshToolManifest()
    ]).then(([, , , , modelData, caps, status]) => {
      setModels(modelData.models);
      setProvider(modelData.provider);
      setCapabilities(caps);
      setRuntime(status);
      const defaultModel = modelData.models.find((item) => item.isDefault && item.configured);
      if (defaultModel) setModelAlias(defaultModel.alias);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Failed to load application state."));
  }, [refreshConversations, refreshProjects, refreshArtifacts, refreshMemories, refreshTasks, refreshApprovals, refreshWorkspaces, refreshToolManifest]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isStreaming]);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversation) ?? null,
    [conversations, activeConversation]
  );

  const openConversation = async (conversationId: string) => {
    setError(null);
    setActiveConversation(conversationId);
    try {
      const result = await api<{ items: Message[] }>("/api/v1/conversations/" + conversationId + "/messages");
      setMessages(result.items as Message[]);
      const conversation = conversations.find((item) => item.id === conversationId);
      if (conversation) setModelAlias(conversation.model_alias);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open conversation.");
    }
  };

  const createConversation = async () => {
    setError(null);
    try {
      const result = await api<{ id: string }>("/api/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "New conversation", modelAlias, ...(selectedProject ? { projectId: selectedProject } : {}) })
      });
      await refreshConversations();
      setActiveConversation(result.id);
      setMessages([]);
      setPage("chat");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create conversation.");
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isStreaming) return;
    let conversationId = activeConversation;
    if (!conversationId) {
      try {
        const created = await api<{ id: string }>("/api/v1/conversations", {
          method: "POST",
          body: JSON.stringify({ title: prompt.slice(0, 52), modelAlias, ...(selectedProject ? { projectId: selectedProject } : {}) })
        });
        conversationId = created.id;
        setActiveConversation(created.id);
        setMessages([]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to create conversation.");
        return;
      }
    }
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: prompt, status: "completed" };
    const assistantMessage: Message = { id: crypto.randomUUID(), role: "assistant", content: "", status: "streaming" };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
    setError(null);
    setIsStreaming(true);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/v1/conversations/" + conversationId + "/turns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, modelAlias }),
        signal: controller.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "Generation failed (" + response.status + ").");
      }
      if (!response.body) throw new Error("The server did not return a stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let thinking = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
          const eventName = frame.split(/\r?\n/).find((line) => line.startsWith("event: "))?.slice(7);
          if (eventName === "text.delta" && typeof payload.text === "string") {
            answer += payload.text;
            setMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, content: answer } : message));
          } else if (eventName === "thinking.start") {
            thinking = true;
            setNotice("The provider reported a thinking phase. Private reasoning is not displayed.");
          } else if (eventName === "message.complete") {
            answer = typeof payload.content === "string" ? payload.content : answer;
          } else if (eventName === "message.error") {
            throw new Error(String(payload.message ?? "Provider error."));
          } else if (eventName === "message.cancelled") {
            setNotice("Generation stopped.");
          }
        }
      }
      setMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, content: answer, status: controller.signal.aborted ? "cancelled" : "completed" } : message));
      if (!thinking) setNotice(null);
      await refreshConversations();
    } catch (cause) {
      if (controller.signal.aborted) {
        setNotice("Generation stopped.");
        setMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, status: "cancelled" } : message));
      } else {
        setError(cause instanceof Error ? cause.message : "Generation failed.");
        setMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, status: "error" } : message));
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setBusy(false);
    }
  };

  const stopGeneration = () => abortRef.current?.abort();

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/v1/projects", { method: "POST", body: JSON.stringify(newProject) });
      setNewProject({ name: "", description: "", instructions: "" });
      await refreshProjects();
      setNotice("Project created.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project creation failed."); }
  };

  const uploadProjectFile = async (file: File) => {
    if (!selectedProject) { setError("Select a project before uploading a file."); return; }
    const form = new FormData();
    form.append("file", file);
    try {
      await api("/api/v1/projects/" + selectedProject + "/files", { method: "POST", body: form });
      setNotice("File indexed successfully.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "File upload failed."); }
  };

  const searchProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject || !projectSearch.trim()) return;
    try {
      const result = await api<{ items: Array<{ fileName: string; text: string; chunkIndex: number }> }>("/api/v1/projects/" + selectedProject + "/search", {
        method: "POST", body: JSON.stringify({ query: projectSearch, limit: 10 })
      });
      setSearchResults(result.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project search failed."); }
  };

  const createArtifact = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/v1/artifacts", {
        method: "POST",
        body: JSON.stringify({ ...newArtifact, ...(selectedProject ? { projectId: selectedProject } : {}) })
      });
      setNewArtifact({ title: "", artifactType: "html", content: "" });
      await refreshArtifacts();
      setNotice("Artifact saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Artifact save failed."); }
  };

  const openArtifact = async (artifactId: string) => {
    try {
      const result = await api<{ id: string; title: string; artifact_type: string; version: { content: string } }>("/api/v1/artifacts/" + artifactId);
      setSelectedArtifact({ id: result.id, title: result.title, artifact_type: result.artifact_type, content: result.version.content });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open artifact."); }
  };

  const startManualTask = async () => {
    if (!selectedTaskId) return;
    try {
      await api("/api/v1/tasks/" + selectedTaskId + "/start", { method: "POST", body: JSON.stringify({}) });
      await refreshTasks();
      setNotice("Task is running. Tool execution remains operator-driven.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start task."); }
  };

  const runManualTool = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTaskId || !selectedWorkspaceId || !selectedToolName) return;
    try {
      const input = JSON.parse(toolInputJson) as unknown;
      const result = await api<{ status: string; approvalId?: string; actionName?: string; output?: unknown }>(
        "/api/v1/tasks/" + selectedTaskId + "/workspaces/" + selectedWorkspaceId + "/tools/" + encodeURIComponent(selectedToolName),
        { method: "POST", body: JSON.stringify({ input }) }
      );
      setToolOutput(JSON.stringify(result, null, 2));
      await Promise.all([refreshTasks(), refreshApprovals()]);
      setNotice(result.status === "waiting_approval" ? "Sensitive action queued for approval. Nothing was executed yet." : "Tool invocation completed.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Tool invocation failed. Check that the input is valid JSON."); }
  };

  const createAgentTask = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<TaskRecord>("/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: newTask.title, description: newTask.description, taskType: newTask.taskType,
          modelAlias: newTask.modelAlias, executionMode: newTask.executionMode,
          ...(selectedProject ? { projectId: selectedProject } : {})
        })
      });
      setNewTask({ title: "", description: "", taskType: "general", modelAlias, executionMode: "approve-each" });
      await refreshTasks();
      setNotice("Task saved in the durable queue. It will not execute until an agent worker is installed.");
      setPage("tasks");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Task creation failed."); }
  };

  const operateTask = async (taskId: string, action: "pause" | "resume" | "cancel" | "retry") => {
    try {
      await api("/api/v1/tasks/" + taskId + "/" + action, { method: "POST", body: JSON.stringify({}) });
      await refreshTasks();
      setNotice("Task " + action + " request saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Task operation failed."); }
  };

  const decideTaskApproval = async (approvalId: string, decision: "approve" | "reject") => {
    try {
      await api("/api/v1/approvals/" + approvalId + "/" + decision, { method: "POST", body: JSON.stringify({}) });
      await Promise.all([refreshTasks(), refreshApprovals()]);
      setNotice("Approval " + decision + "d.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Approval decision failed."); }
  };

  const saveMemory = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/v1/memories", {
        method: "POST",
        body: JSON.stringify({ content: newMemory.content, scope: newMemory.scope, ...(newMemory.projectId ? { projectId: newMemory.projectId } : {}) })
      });
      setNewMemory({ content: "", scope: "global", projectId: "" });
      await refreshMemories();
      setNotice("Memory saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Memory save failed."); }
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      await api("/api/v1/conversations/" + conversationId, { method: "DELETE" });
      if (activeConversation === conversationId) { setActiveConversation(null); setMessages([]); }
      await refreshConversations();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Delete failed."); }
  };

  const filteredConversations = conversations.filter((conversation) => conversation.title.toLowerCase().includes(search.toLowerCase()));
  const currentPageTitle = { chat: "Chat", projects: "Projects", artifacts: "Artifacts", memory: "Memory", tasks: "Tasks", coding: "Coding workspace", settings: "Settings" }[page];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">✳</span><div><strong>Claude Web Local</strong><small>Private AI workspace</small></div></div>
        <button className="new-chat" onClick={() => void createConversation()}><span>＋</span> New chat</button>
        <nav className="primary-nav" aria-label="Main navigation">
          {(["chat", "projects", "artifacts", "memory", "tasks", "coding", "settings"] as Page[]).map((item) => (
            <button key={item} className={page === item ? "nav-item active" : "nav-item"} onClick={() => setPage(item)}>
              <span className="nav-icon">{({ chat: "◫", projects: "▤", artifacts: "◇", memory: "⌁", tasks: "⇢", coding: "⌘", settings: "⚙" } as Record<Page, string>)[item]}</span>
              {({ chat: "Chats", projects: "Projects", artifacts: "Artifacts", memory: "Memory", tasks: "Tasks", coding: "Coding", settings: "Settings" } as Record<Page, string>)[item]}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-section-title">Recent conversations</div>
        <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        <div className="conversation-list">
          {filteredConversations.map((conversation) => (
            <div key={conversation.id} className={activeConversation === conversation.id ? "conversation-row selected" : "conversation-row"}>
              <button onClick={() => { setPage("chat"); void openConversation(conversation.id); }} title={conversation.title}>{conversation.title}</button>
              <button className="icon-button delete-small" onClick={() => void deleteConversation(conversation.id)} aria-label={"Delete " + conversation.title}>×</button>
            </div>
          ))}
          {filteredConversations.length === 0 && <p className="muted small-pad">No conversations yet.</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="connection-dot"><span className={models.some((model) => model.configured) ? "dot on" : "dot"} />{models.some((model) => model.configured) ? "Provider configured" : "Provider not configured"}</div>
          <small>Local-first · No app account</small>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div><span className="crumb">Workspace</span><span className="crumb-sep">/</span><strong>{currentPageTitle}</strong></div>
          <div className="topbar-right">
            <span className="provider-label">{provider ?? "No provider"}</span>
            <div className="avatar">L</div>
          </div>
        </header>

        {(error || notice) && <div className={error ? "toast error-toast" : "toast"} role="status">
          <span>{error ?? notice}</span><button onClick={() => { setError(null); setNotice(null); }}>Dismiss</button>
        </div>}

        {page === "chat" && (
          <section className="chat-page">
            <div className="chat-scroll">
              {messages.length === 0 ? (
                <div className="welcome">
                  <div className="welcome-symbol">✳</div>
                  <p className="eyebrow">YOUR LOCAL AI WORKSPACE</p>
                  <h1>What would you like<br />to work on?</h1>
                  <p className="welcome-subtitle">A focused space for conversations, projects, and making things.</p>
                  <div className="suggestion-grid">
                    <button onClick={() => setDraft("Help me plan a software project from requirements to deployment.")}><strong>Plan a project</strong><span>Turn an idea into a clear roadmap</span></button>
                    <button onClick={() => setDraft("Explain a complex topic with a practical example.")}><strong>Learn something</strong><span>Explore a topic step by step</span></button>
                    <button onClick={() => setDraft("Review this code for bugs, security issues, and maintainability:") }><strong>Review code</strong><span>Inspect code and reason about trade-offs</span></button>
                    <button onClick={() => setDraft("Help me draft and refine a document.")}><strong>Write a draft</strong><span>Start a document or outline</span></button>
                  </div>
                </div>
              ) : (
                <div className="message-list">
                  {messages.map((message) => (
                    <article key={message.id} className={"message " + message.role}>
                      <div className="message-avatar">{message.role === "user" ? "You" : "✳"}</div>
                      <div className="message-content">
                        <div className="message-meta"><strong>{message.role === "user" ? "You" : "Assistant"}</strong>{message.status !== "completed" && <span className="message-status">{message.status}</span>}</div>
                        {message.content ? <Markdown>{message.content}</Markdown> : message.role === "assistant" ? <div className="typing"><i /><i /><i /></div> : null}
                      </div>
                    </article>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
            <form className="composer-wrap" onSubmit={(event) => void sendMessage(event)}>
              {selectedProject && <div className="context-chip">Project context: {projects.find((project) => project.id === selectedProject)?.name ?? "Selected project"} <button type="button" onClick={() => setSelectedProject("")}>×</button></div>}
              <div className="composer">
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(event as unknown as FormEvent); } }} placeholder="Message your assistant..." rows={3} />
                <div className="composer-actions">
                  <div className="composer-left">
                    <label className="model-select-label">Model
                      <select value={modelAlias} onChange={(event) => setModelAlias(event.target.value as Alias)}>
                        {models.map((model) => <option key={model.alias} value={model.alias} disabled={!model.configured}>{model.alias}{model.isDefault ? " · default" : ""}{!model.configured ? " · not configured" : ""}</option>)}
                      </select>
                    </label>
                    <select aria-label="Project context" value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>
                      <option value="">No project</option>
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                  </div>
                  {isStreaming ? <button className="stop-button" type="button" onClick={stopGeneration}>■ Stop</button> : <button className="send-button" type="submit" disabled={!draft.trim() || !models.some((model) => model.alias === modelAlias && model.configured)}>Send <span>↗</span></button>}
                </div>
              </div>
              <p className="composer-footnote">AI can make mistakes. Verify important information. Provider credentials stay on this server.</p>
            </form>
          </section>
        )}

        {page === "projects" && (
          <section className="content-page">
            <div className="page-heading"><div><p className="eyebrow">KNOWLEDGE AND CONTEXT</p><h1>Projects</h1><p>Keep related conversations and reference files together.</p></div></div>
            <div className="two-column">
              <div className="panel">
                <h2>Create a project</h2>
                <form className="stack-form" onSubmit={(event) => void createProject(event)}>
                  <label>Project name<input required value={newProject.name} onChange={(event) => setNewProject({ ...newProject, name: event.target.value })} placeholder="e.g. Research workspace" /></label>
                  <label>Description<textarea value={newProject.description} onChange={(event) => setNewProject({ ...newProject, description: event.target.value })} rows={2} /></label>
                  <label>Project instructions<textarea value={newProject.instructions} onChange={(event) => setNewProject({ ...newProject, instructions: event.target.value })} rows={3} placeholder="Optional context for conversations in this project" /></label>
                  <button className="primary-button" type="submit">Create project</button>
                </form>
              </div>
              <div className="panel">
                <h2>Your projects <span className="count">{projects.length}</span></h2>
                {projects.length === 0 ? <p className="empty-copy">Projects you create will appear here.</p> : <div className="project-list">
                  {projects.map((project) => <button className={selectedProject === project.id ? "project-card chosen" : "project-card"} key={project.id} onClick={() => setSelectedProject(project.id)}>
                    <span className="project-card-icon">▤</span><span><strong>{project.name}</strong><small>{project.description || "No description"}</small></span><span className="arrow">→</span>
                  </button>)}
                </div>}
              </div>
            </div>
            <div className="panel file-panel">
              <div className="panel-heading"><div><h2>Project knowledge</h2><p>Text, Markdown, CSV, JSON, and source-code indexing with lexical retrieval.</p></div>
                <label className="upload-button">＋ Upload file<input type="file" hidden accept=".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.html,.css,.xml,.yaml,.yml,.toml,.sql" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadProjectFile(file); event.currentTarget.value = ""; }} /></label>
              </div>
              <div className="inline-search"><input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Search indexed project files" /><button className="secondary-button" disabled={!selectedProject || !projectSearch.trim()} onClick={(event) => { event.preventDefault(); void searchProject(event as unknown as FormEvent); }}>Search</button></div>
              {searchResults.length > 0 && <div className="search-results">{searchResults.map((item, index) => <div className="search-result" key={item.fileName + index}><strong>{item.fileName} · chunk {item.chunkIndex + 1}</strong><p>{item.text}</p></div>)}</div>}
              {!selectedProject && <p className="empty-copy">Select a project above to upload files or search its knowledge base.</p>}
            </div>
          </section>
        )}

        {page === "artifacts" && (
          <section className="content-page">
            <div className="page-heading"><div><p className="eyebrow">CREATION AND VERSIONING</p><h1>Artifacts</h1><p>Save editable source outputs and preview HTML in an isolated frame.</p></div></div>
            <div className="two-column artifact-layout">
              <div className="panel">
                <h2>Create an artifact</h2>
                <form className="stack-form" onSubmit={(event) => void createArtifact(event)}>
                  <label>Title<input required value={newArtifact.title} onChange={(event) => setNewArtifact({ ...newArtifact, title: event.target.value })} /></label>
                  <label>Type<select value={newArtifact.artifactType} onChange={(event) => setNewArtifact({ ...newArtifact, artifactType: event.target.value })}>{["html", "css", "javascript", "svg", "markdown", "json"].map((type) => <option key={type}>{type}</option>)}</select></label>
                  <label>Source<textarea className="code-input" required value={newArtifact.content} onChange={(event) => setNewArtifact({ ...newArtifact, content: event.target.value })} rows={9} placeholder="Paste the artifact source here..." /></label>
                  <button className="primary-button" type="submit">Save artifact</button>
                </form>
              </div>
              <div className="panel">
                <h2>Saved artifacts <span className="count">{artifacts.length}</span></h2>
                {artifacts.length === 0 ? <p className="empty-copy">Saved artifacts will be listed here.</p> : <div className="project-list">
                  {artifacts.map((artifact) => <button className="project-card" key={artifact.id} onClick={() => void openArtifact(artifact.id)}>
                    <span className="project-card-icon">◇</span><span><strong>{artifact.title}</strong><small>{artifact.artifact_type} · version {artifact.current_version}</small></span><span className="arrow">→</span>
                  </button>)}
                </div>}
              </div>
            </div>
            {selectedArtifact && <div className="panel preview-panel">
              <div className="panel-heading"><div><h2>{selectedArtifact.title}</h2><p>{selectedArtifact.artifact_type} source</p></div><button className="secondary-button" onClick={() => setSelectedArtifact(null)}>Close</button></div>
              <pre className="artifact-source"><code>{selectedArtifact.content}</code></pre>
              {selectedArtifact.artifact_type === "html" && <iframe title={selectedArtifact.title + " preview"} className="artifact-preview" sandbox="" srcDoc={selectedArtifact.content} />}
            </div>}
          </section>
        )}

        {page === "memory" && (
          <section className="content-page narrow-page">
            <div className="page-heading"><div><p className="eyebrow">PERSISTENT CONTEXT</p><h1>Memory</h1><p>Save explicit notes for later retrieval. Untrusted documents are never promoted automatically.</p></div></div>
            <div className="panel">
              <h2>Add a memory</h2>
              <form className="stack-form" onSubmit={(event) => void saveMemory(event)}>
                <label>Memory<textarea required rows={3} value={newMemory.content} onChange={(event) => setNewMemory({ ...newMemory, content: event.target.value })} placeholder="A preference, project fact, or useful note..." /></label>
                <label>Scope<select value={newMemory.scope} onChange={(event) => setNewMemory({ ...newMemory, scope: event.target.value })}><option value="global">Global</option><option value="project">Project</option></select></label>
                {newMemory.scope === "project" && <label>Project<select required value={newMemory.projectId} onChange={(event) => setNewMemory({ ...newMemory, projectId: event.target.value })}><option value="">Choose a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
                <button className="primary-button" type="submit">Save memory</button>
              </form>
            </div>
            <div className="memory-list">
              {memories.map((memory) => <article className="memory-card" key={memory.id}><div><span className="eyebrow">{memory.scope} · {memory.memory_type}</span><p>{memory.content}</p></div><button className="icon-button" onClick={() => void api("/api/v1/memories/" + memory.id, { method: "DELETE" }).then(refreshMemories).catch((cause) => setError(cause instanceof Error ? cause.message : "Delete failed."))}>Delete</button></article>)}
              {memories.length === 0 && <p className="empty-copy">No memories have been saved.</p>}
            </div>
          </section>
        )}

        {page === "tasks" && (
          <section className="content-page">
            <div className="page-heading"><div><p className="eyebrow">DURABLE EXECUTION HISTORY</p><h1>Tasks</h1><p>Create and manage persisted agent task records and sensitive-action approvals.</p></div></div>
            <div className="toast" role="status"><span>Agent execution is not enabled yet. Tasks are stored and state transitions are available, but no planner/worker is installed to execute queued tasks automatically.</span></div>
            <div className="two-column">
              <div className="panel">
                <h2>Create task</h2>
                <form className="stack-form" onSubmit={(event) => void createAgentTask(event)}>
                  <label>Task title<input required maxLength={160} value={newTask.title} onChange={(event) => setNewTask({ ...newTask, title: event.target.value })} placeholder="e.g. Review the API security model" /></label>
                  <label>Goal and acceptance notes<textarea required rows={5} maxLength={20000} value={newTask.description} onChange={(event) => setNewTask({ ...newTask, description: event.target.value })} placeholder="Describe the outcome and what counts as complete..." /></label>
                  <label>Task type<select value={newTask.taskType} onChange={(event) => setNewTask({ ...newTask, taskType: event.target.value })}>{["general", "research", "coding", "browser", "scheduled"].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                  <label>Model alias<select value={newTask.modelAlias} onChange={(event) => setNewTask({ ...newTask, modelAlias: event.target.value as Alias })}>{models.map((model) => <option key={model.alias} value={model.alias} disabled={!model.configured}>{model.alias}{!model.configured ? " · not configured" : ""}</option>)}</select></label>
                  <label>Execution policy<select value={newTask.executionMode} onChange={(event) => setNewTask({ ...newTask, executionMode: event.target.value })}><option value="approve-each">Approve sensitive actions</option><option value="plan">Plan only</option><option value="restricted">Restricted tools</option><option value="auto">Configured allow policy</option></select></label>
                  <button className="primary-button" type="submit" disabled={!models.some((model) => model.alias === newTask.modelAlias && model.configured)}>Save task to queue</button>
                </form>
              </div>
              <div className="panel">
                <div className="panel-heading"><h2>Task history <span className="count">{tasks.length}</span></h2><button className="secondary-button" onClick={() => void refreshTasks()}>Refresh</button></div>
                {tasks.length === 0 ? <p className="empty-copy">No tasks have been created.</p> : <div className="project-list">
                  {tasks.map((task) => <article className="memory-card" key={task.id}>
                    <div><span className="eyebrow">{task.task_type} · {task.model_alias} · {task.execution_mode}</span><p><strong>{task.title}</strong></p><small>{task.status.replace("_", " ")} · {new Date(task.created_at).toLocaleString()}</small><p className="muted small-pad">{task.description}</p>
                      <div className="workspace-actions">
                        {["queued", "planning", "running", "waiting_approval", "waiting_input"].includes(task.status) && <button className="secondary-button" onClick={() => void operateTask(task.id, "pause")}>Pause</button>}
                        {task.status === "paused" && <button className="secondary-button" onClick={() => void operateTask(task.id, "resume")}>Resume</button>}
                        {!["completed", "failed", "cancelled"].includes(task.status) && <button className="secondary-button" onClick={() => void operateTask(task.id, "cancel")}>Cancel</button>}
                        {["failed", "cancelled"].includes(task.status) && <button className="secondary-button" onClick={() => void operateTask(task.id, "retry")}>Retry</button>}
                      </div>
                    </div>
                  </article>)}
                </div>}
              </div>
            </div>
            <div className="panel">
              <div className="panel-heading"><div><h2>Manual tool execution</h2><p>Start a queued task, choose an explicit workspace and invoke one validated tool at a time. Mutating tools pause for approval.</p></div><button className="secondary-button" onClick={() => void Promise.all([refreshWorkspaces(), refreshToolManifest()])}>Refresh resources</button></div>
              <form className="stack-form" onSubmit={(event) => void runManualTool(event)}>
                <div className="two-column">
                  <label>Task<select required value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)}><option value="">Choose task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {task.status}</option>)}</select></label>
                  <label>Workspace<select required value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)}><option value="">Choose workspace</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
                </div>
                <div className="two-column">
                  <label>Tool<select required value={selectedToolName} onChange={(event) => setSelectedToolName(event.target.value)}>{availableTools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}{tool.requiresApproval ? " · approval required" : " · read only"}</option>)}</select></label>
                  <div className="field-hint">{availableTools.find((tool) => tool.name === selectedToolName)?.description ?? "Choose a registered tool."}</div>
                </div>
                <label>Tool input (JSON)<textarea rows={5} spellCheck={false} value={toolInputJson} onChange={(event) => setToolInputJson(event.target.value)} /></label>
                <div className="workspace-actions">
                  <button className="secondary-button" type="button" disabled={!tasks.some((task) => task.id === selectedTaskId && task.status === "queued")} onClick={() => void startManualTask()}>Start selected task</button>
                  <button className="primary-button" type="submit" disabled={!tasks.some((task) => task.id === selectedTaskId && task.status === "running") || !selectedWorkspaceId || !selectedToolName}>Invoke tool</button>
                </div>
              </form>
              {!workspaces.length && <p className="empty-copy">No workspace exists yet. Create one in Coding workspace before invoking tools.</p>}
              {toolOutput && <pre className="status-json">{toolOutput}</pre>}
            </div>
            <div className="panel">
              <div className="panel-heading"><div><h2>Pending approvals <span className="count">{approvals.length}</span></h2><p>Decisions are bound to the exact stored action payload and expire automatically.</p></div><button className="secondary-button" onClick={() => void refreshApprovals()}>Refresh</button></div>
              {approvals.length === 0 ? <p className="empty-copy">No pending approvals.</p> : <div className="project-list">
                {approvals.map((approval) => <article className="memory-card" key={approval.id}>
                  <div><span className="eyebrow">Task {approval.task_id.slice(0, 8)} · expires {new Date(approval.expires_at).toLocaleString()}</span><p><strong>{approval.action_name}</strong></p><pre className="status-json">{approval.target_json}</pre>
                    <div className="workspace-actions"><button className="primary-button" onClick={() => void decideTaskApproval(approval.id, "approve")}>Approve exact action</button><button className="secondary-button" onClick={() => void decideTaskApproval(approval.id, "reject")}>Reject</button></div>
                  </div>
                </article>)}
              </div>}
            </div>
          </section>
        )}
        {page === "coding" && <CodingWorkspace />}

        {page === "settings" && (
          <section className="content-page narrow-page">
            <div className="page-heading"><div><p className="eyebrow">LOCAL RUNTIME</p><h1>Settings</h1><p>Provider and runtime status. Secrets are intentionally never returned to the browser.</p></div></div>
            <div className="panel settings-panel">
              <h2>Model aliases</h2>
              <p className="muted">Provider: {provider ?? "Not configured"} · Protocol is environment-controlled.</p>
              <div className="model-status-list">{models.map((model) => <div key={model.alias}><strong>{model.alias}</strong><span>{model.isDefault ? "Default" : ""}</span><span className={model.configured ? "status-good" : "status-muted"}>{model.configured ? "Configured" : "Missing environment variable"}</span></div>)}</div>
            </div>
            <div className="panel settings-panel">
              <h2>Runtime status</h2>
              <pre className="status-json">{JSON.stringify(runtime, null, 2)}</pre>
            </div>
            <div className="panel settings-panel">
              <h2>Feature availability</h2>
              <div className="capability-list">{Object.entries(capabilities ?? {}).map(([name, capability]) => <div key={name}><span>{name}</span><span className={capability.available ? "status-good" : "status-muted"}>{capability.available ? "Available" : capability.reason ?? "Unavailable"}</span></div>)}</div>
            </div>
          </section>
        )}
        <footer className="footer-note">Local-first workspace · No application login · Browser automation and desktop control are separate capabilities.</footer>
      </main>
    </div>
  );
}
