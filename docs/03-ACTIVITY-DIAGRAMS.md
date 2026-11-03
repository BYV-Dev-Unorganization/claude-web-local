# 03 — Activity Diagrams

These diagrams define the intended control flow. They are implementation guidance, not proof that each flow already exists.

## 1. Chat request and streaming

    flowchart TD
      A[User submits prompt] --> B[Validate conversation and attachments]
      B --> C[Build context]
      C --> D[Resolve model alias]
      D --> E{Provider capability available?}
      E -- No --> F[Return actionable capability error]
      E -- Yes --> G[Call provider adapter]
      G --> H[Stream normalized events]
      H --> I{Tool call requested?}
      I -- Yes --> J[Permission check]
      J --> K{Allowed or approved?}
      K -- No --> L[Record denied tool result]
      K -- Yes --> M[Execute registered tool]
      M --> N[Append tool result]
      N --> G
      I -- No --> O[Persist final message]
      O --> P[Complete turn]

Important behavior:
- Every event belongs to a conversation, turn, and message.
- A provider tool call is not executed until normalized and permission-checked.
- A client disconnect must not automatically imply task cancellation unless the request policy says so.

## 2. Project document ingestion

    flowchart TD
      A[Upload file] --> B[Validate type, size, and content]
      B --> C{Valid?}
      C -- No --> D[Reject with reason]
      C -- Yes --> E[Store original file]
      E --> F[Extract text and metadata]
      F --> G[Normalize and chunk]
      G --> H{Embedding provider configured?}
      H -- Yes --> I[Create embeddings]
      H -- No --> J[Use lexical retrieval index if enabled]
      I --> K[Persist chunks and index]
      J --> K
      K --> L[Mark ingestion complete]

## 3. Deep research workflow

    flowchart TD
      A[Research request] --> B[Create research job]
      B --> C[Generate plan]
      C --> D[Run bounded searches]
      D --> E[Fetch and extract permitted sources]
      E --> F[Deduplicate and evaluate]
      F --> G[Identify unanswered questions]
      G --> H{Gap remains and budget available?}
      H -- Yes --> D
      H -- No --> I[Synthesize with source map]
      I --> J[Validate citations]
      J --> K[Save report and sources]
      K --> L[Notify completion]

## 4. Agent execution lifecycle

    flowchart TD
      A[Create task] --> B[Persist task as queued]
      B --> C[Worker claims task]
      C --> D[Plan next step]
      D --> E[Evaluate permissions]
      E --> F{Approval required?}
      F -- Yes --> G[Persist waiting_approval]
      G --> H{Approved?}
      H -- No --> I[Reject, pause, or terminate]
      H -- Yes --> J[Execute tool]
      F -- No --> J
      J --> K[Persist tool result and event]
      K --> L[Observe result]
      L --> M{Goal complete?}
      M -- No --> N{Budget and iteration remain?}
      N -- Yes --> D
      N -- No --> O[Fail with budget reason]
      M -- Yes --> P[Persist completed output]

## 5. Pause and resume

    flowchart TD
      A[Running task] --> B[Pause requested]
      B --> C[Stop scheduling new steps]
      C --> D[Interrupt cancellable operation safely]
      D --> E[Persist checkpoint and paused state]
      E --> F[Resume requested]
      F --> G[Revalidate configuration and permissions]
      G --> H[Requeue from checkpoint]
      H --> I[Continue execution]

A paused task must not silently resume an operation that was already cancelled or whose external side effect is uncertain.

## 6. Scheduled task dispatch

    flowchart TD
      A[Scheduler tick] --> B[Find due schedules]
      B --> C[Acquire dispatch lock]
      C --> D[Check occurrence idempotency]
      D --> E{Already dispatched?}
      E -- Yes --> F[Skip duplicate]
      E -- No --> G[Persist occurrence]
      G --> H[Enqueue task]
      H --> I[Advance next_run_at]
      I --> J[Release lock]

## 7. Coding workflow

    flowchart TD
      A[Select workspace root] --> B[Create isolated workspace]
      B --> C[Inspect repository and status]
      C --> D[Generate code-change plan]
      D --> E[Read and search files]
      E --> F[Propose edits and commands]
      F --> G[Permission and path validation]
      G --> H{Sensitive action?}
      H -- Yes --> I[Request approval]
      I --> J{Approved?}
      J -- No --> K[Skip or stop action]
      J -- Yes --> L[Execute in sandbox]
      H -- No --> L
      L --> M[Collect diff and test results]
      M --> N{Tests pass and user accepts?}
      N -- No --> O[Revise or rollback]
      N -- Yes --> P[Persist accepted result]

## 8. Browser automation

    flowchart TD
      A[Create browser task] --> B[Create isolated browser context]
      B --> C[Apply URL and network policy]
      C --> D[Navigate]
      D --> E[Read DOM snapshot]
      E --> F[Choose browser tool]
      F --> G[Validate action and permission]
      G --> H{External side effect?}
      H -- Yes --> I[Request approval]
      I --> J{Approved?}
      J -- No --> K[Stop or choose safe alternative]
      J -- Yes --> L[Execute action]
      H -- No --> L
      L --> M[Record result and screenshot]
      M --> N{Task complete?}
      N -- No --> E
      N -- Yes --> O[Close or retain session by policy]

## 9. Memory review

    flowchart TD
      A[Conversation or task completes] --> B[Extract candidate facts]
      B --> C[Apply privacy and secret filters]
      C --> D[Assign scope and source]
      D --> E[Present review candidate]
      E --> F{Approved?}
      F -- Yes --> G[Persist memory]
      F -- No --> H[Discard candidate]
      G --> I[Index for scoped retrieval]

## 10. Error handling principles

- Persist an error event before presenting a terminal failure.
- Distinguish retryable provider/network errors from invalid requests and policy denials.
- Use idempotency keys for task creation and scheduled occurrences.
- Never retry non-idempotent external side effects without checking their outcome.
- A worker crash must leave the task in a recoverable state rather than falsely marking it completed.