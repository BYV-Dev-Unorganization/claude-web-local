# 08 — Agent Runtime and Tool Execution

## 1. Purpose

The Agent Runtime converts a user goal into bounded, observable, resumable work. It is shared by general agent tasks, deep research, coding tasks, and scheduled workflows.

## 2. Core components

- Task API: accepts, validates, and exposes task resources.
- Planner: produces a structured plan and acceptance conditions.
- Orchestrator: controls task state and selects the next step.
- Tool Registry: exposes typed tools and their metadata.
- Permission Engine: authorizes each invocation.
- Worker Pool: executes work outside HTTP handlers.
- Checkpoint Store: persists progress and recovery data.
- Event Store: records the execution timeline.
- Budget Manager: enforces time, token, iteration, and tool limits.
- Result Aggregator: produces a final summary and links to outputs.

## 3. Task state machine

Allowed states:
- queued
- planning
- running
- waiting_approval
- waiting_input
- paused
- completed
- failed
- cancelled

All state transitions must be validated server-side. Invalid transitions return a conflict error and do not mutate state.

Terminal states are completed, failed, and cancelled. A retry creates a new attempt or an explicitly linked retry record; it must not erase the prior execution history.

## 4. Normalized task model

    interface AgentTask {
      id: string;
      title: string;
      description: string;
      projectId?: string;
      conversationId?: string;
      parentTaskId?: string;
      taskType: "general" | "research" | "coding" | "browser" | "scheduled";
      modelAlias: "fable" | "opus" | "sonnet" | "haiku";
      status: TaskStatus;
      executionMode: "plan" | "approve-each" | "auto" | "restricted";
      iterationLimit: number;
      tokenBudget?: number;
      timeLimitSeconds: number;
      toolCallLimit: number;
      checkpoint?: unknown;
    }

## 5. Execution loop

1. Claim task using a durable lease.
2. Load task, project instructions, memory, permissions, and checkpoint.
3. Ask the planner for the next bounded plan/step.
4. Validate the plan shape and budgets.
5. Determine whether the next step needs approval.
6. Persist the approval request or queue the tool execution.
7. Execute the tool in its designated runtime.
8. Persist result, duration, and relevant output references.
9. Observe the result and decide whether to continue, replan, request input, or finish.
10. Persist the checkpoint before yielding the worker.
11. Aggregate the final answer and generated outputs.

A model response is not itself proof that a task is complete. Completion must satisfy the task's acceptance conditions or explicitly state what remains incomplete.

## 6. Checkpoint and crash recovery

A checkpoint should include:
- Current phase and step number.
- Plan version.
- Completed step IDs.
- Pending step IDs.
- Relevant references to tool outputs.
- Budget consumed and remaining.
- Last durable event sequence.
- Any unresolved approval/input request.

Do not serialize provider secrets, raw browser cookies, or unrestricted process environments into checkpoints.

On startup, a reconciler identifies expired worker leases. It may requeue only tasks with a safe checkpoint and no uncertain non-idempotent action. Uncertain side effects move to a recovery/attention state and require review.

## 7. Task budgets

Each task has independently configurable:
- Maximum iterations.
- Maximum tool calls.
- Maximum wall-clock runtime.
- Maximum concurrent child tasks.
- Optional input/output token budget.
- Maximum tool-result bytes.
- Maximum generated files/bytes.

A budget breach produces a visible terminal or waiting state with a reason. Never silently ignore limits.

## 8. Tool registry

Every tool definition contains:
- Stable tool name and version.
- Description.
- Input JSON Schema.
- Output schema or normalization rules.
- Source (built-in, MCP, plugin, connector).
- Required permissions.
- Execution target (API process, worker, sandbox).
- Timeout and result-size limit.
- Idempotency classification.

Example built-in tool groups:

### General
- web.search
- web.fetch
- files.read
- files.list
- files.create_document
- project.search

### Coding
- workspace.list
- workspace.read_file
- workspace.search
- workspace.write_file
- workspace.apply_patch
- workspace.git_status
- workspace.git_diff
- workspace.run_command
- workspace.run_tests
- workspace.snapshot
- workspace.rollback

### Browser
- browser.navigate
- browser.snapshot
- browser.click
- browser.fill
- browser.select
- browser.scroll
- browser.screenshot
- browser.download
- browser.close

Tools must not accept arbitrary filesystem roots or unconstrained host command execution.

## 9. Permission modes

- plan: inspect and plan; do not perform mutations.
- approve-each: pause for approval on every action classified as sensitive.
- auto: execute actions that match an explicit allow policy; ask for approval outside it.
- restricted: expose only a small configured read-only tool set.

Permission evaluation includes:
- Tool name and source.
- Action and target.
- Project/workspace scope.
- Requested paths or domains.
- Side-effect classification.
- Current task mode.
- Operator policy.
- Approval record, if needed.

The UI is informative only. The backend makes the authorization decision.

## 10. Coding worker

The coding worker must:
- Bind to an explicitly selected workspace.
- Create an isolated working copy, container, or equivalent sandbox.
- Enforce filesystem root restrictions.
- Restrict command set and process privileges.
- Sanitize environment variables.
- Limit CPU, memory, process count, disk, and runtime.
- Collect stdout/stderr with output limits.
- Capture Git diff and test output.
- Support snapshot and rollback.

Never run model-proposed shell commands in the main API process.

## 11. Browser worker

Browser worker is browser automation, not Computer Use.

It may:
- Navigate within allowed network policy.
- Inspect DOM snapshots and accessible labels.
- Click, type, fill, select, scroll, wait, and capture screenshots.
- Download to a dedicated restricted directory.

It may not:
- Control the host desktop.
- Read arbitrary local files.
- access cloud metadata endpoints or internal services by default.
- Persist authentication cookies without an explicit operator policy.
- Submit purchases, messages, account changes, or other irreversible actions without configured approval.

## 12. Deep research worker

Research tasks use the shared task lifecycle but a specialized step graph:
- Clarify query scope from the prompt where possible.
- Produce research questions.
- Search multiple query variants.
- Fetch permitted pages.
- Normalize and deduplicate sources.
- Evaluate source quality and freshness.
- Identify unanswered questions.
- Repeat within research budgets.
- Synthesize claims with source references.
- Validate that citations point to retrieved sources.

## 13. Multi-agent delegation

A parent task may create child tasks with:
- Explicit role and objective.
- Assigned model alias.
- Restricted tool set.
- Independent context or scoped shared references.
- Budget and deadline.
- Dependency IDs.

Parallel execution rules:
- Enforce a global concurrency limit.
- Avoid concurrent writes to the same workspace unless using isolated branches/worktrees.
- Pass data by references rather than copying unbounded context.
- Record which agent produced each result.
- Aggregate conflicts and partial failures transparently.
- Propagate parent cancellation to children.

Multi-agent execution is an optimization, not a requirement for every task.

## 14. Scheduled tasks

Scheduler stores cron expression, timezone, next_run_at, and an occurrence key. Due occurrences are inserted transactionally and dispatched through the persistent queue.

Use an idempotency key derived from schedule ID and scheduled timestamp. A restart or duplicate scheduler tick must not create duplicate work for the same occurrence.

## 15. UI requirements

Task detail view must show:
- Goal and current status.
- Execution plan and progress.
- Current step and tool status.
- Approval/input requests.
- Event log with timestamps.
- Budget usage.
- Generated files and artifacts.
- Pause, resume, cancel, retry, and continue controls according to state.

## 16. Failure handling

- Provider transient errors: bounded retry.
- Invalid tool schema: fail the step and surface details.
- Permission denied: record denial; do not retry automatically.
- Worker crash: lease reconciliation and safe checkpoint recovery.
- Tool timeout: terminate worker process and mark step timed out.
- Uncertain external side effect: require human review; never blindly repeat.
- Budget exhaustion: stop with a clear explanation.

## Implementation in the current branch

The current implementation has a provider-neutral planner/execution loop backed by Anthropic Messages and OpenAI Chat Completions. The planner uses structured JSON output and Zod validation, stores ordered steps, and dispatches only registered tools. Assistant tool-call messages and tool results are preserved in the conversation checkpoint so the next model turn continues with the actual tool result.

Workers run as a bounded in-process pool started after the API server binds, when provider credentials and at least one model alias are configured. Each worker atomically claims a task, heartbeats its hashed lease, and releases the lease after completion or approval wait. Shutdown aborts active model calls and allows lease reconciliation after restart. Task API responses omit the private checkpoint payload.

The worker enforces iteration, runtime, tool-call, output-token, and tool-result size limits. Mutating workspace operations remain exact-payload approval-gated, and coding tasks require an explicit workspace ID. Expired tasks are requeued only when replay is safe; running or completed-after-checkpoint tool invocations pause the task for operator review.

Release gates still open: a separately deployed OS worker mode, multi-process concurrency/soak testing, live provider contract checks for each configured model, database upgrade matrix tests, and hard process-kill E2E recovery tests. This implementation should not be described as production-grade crash recovery until those gates pass.
