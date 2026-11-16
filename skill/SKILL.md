---
name: orca-dag
description: "Plan software work as an Orca orchestration task DAG. Use when the user wants to break a feature or project into an executable graph of tasks with dependencies and approval gates in Orca, then visualize and fire it. Teaches the exact `orca orchestration` CLI commands to build the DAG, the spec-writing conventions, and how to open the orca-dag viewer so the user can pick a harness per node and fire tasks."
---

# orca-dag

Refine a software requirement through conversation and land it as an **Orca orchestration task DAG** (directed acyclic graph). You own **building and reshaping the graph**; **execution is triggered by the user in the `orca-dag` viewer** — the viewer advances the whole graph automatically, in parallel, along its dependencies. It is not fired node by node.

Every planning result **must be written into Orca's orchestration state** (by running `orca orchestration` commands), not left as chat text — the viewer polls Orca live and draws whatever is there.

## Tools you may use
- **Bash** to run the `orca` CLI and read/write orchestration state.
- **Read / Write / Edit** to write planning docs in the working directory (`docs/PRD.md`, `docs/TECH_SPEC.md`).
- Do not run destructive commands unrelated to this task (`rm`, `git push`, deleting files, …).

## Preflight
```bash
orca status --json      # runtime.state should be "ready"; if not, ask the user to run `orca open` first
                        # runtime.appVersion must be >= 1.4.160 (the Run/Dispatch contract)
```

## Workflow (three phases, all in conversation)
1. **Requirement clarification (PRD)**: align on the goal, MVP scope, and explicit non-goals with short questions — one key question at a time. If MVP is enough, plan only P0; don't over-design. Once agreed, write `docs/PRD.md`.
2. **Technical design (TECH_SPEC)**: stack, data model (down to fields), module interfaces (pseudocode). Write `docs/TECH_SPEC.md`.
3. **Decompose into a task DAG**: split the design into parallel/serial subtasks and create the tasks and dependencies with the commands below. **This step is the required output.**

## Writing the DAG into Orca (the core)

### Step 0: create a Run first (required on Orca ≥ 1.4.160)

Tasks are **no longer global**: every task belongs to a Run, and `task-create` / `task-list` fail with `run_required` when no Run is bound. So **start every plan by opening a fresh Run** to hold this DAG:

```bash
orca orchestration run-create --objective "<one sentence on what this plan does>" --json
```

The response carries `result.run.id` (shaped like `run_xxxxxxxx`). `run-create` binds the **current terminal** as that Run's coordinator, so later `task-create` calls don't need `--run`.

> One Run holds one DAG. Orca itself doesn't enforce this (a Run is just a namespace), but the viewer renders "one Run = one graph". To replan, open a new Run — **never** use `reset`.

### Step 1: create tasks one by one

Dependencies between tasks are passed to `--deps` as a **JSON array** of the depended-on task ids.

A root task (no deps):
```bash
orca orchestration task-create \
  --task-title "Scaffold the project" \
  --spec "Initialize project structure and dependencies; produce package.json, src/, .gitignore. Acceptance: npm test runs." \
  --json
```
`result.task.id` in the response is the task id (shaped like `task_xxxxxxxx`).

Depending on an earlier task (put its id into `--deps`):
```bash
orca orchestration task-create \
  --task-title "Implement the data model" \
  --spec "Implement models and migrations per the TECH_SPEC data model. Acceptance: migrations run, unit tests included." \
  --deps '["task_c8df9d97"]' --json
```
Multiple deps: `--deps '["task_aaa","task_bbb"]'`.

**Remember every returned task id** — later tasks reference them in `--deps`, which is what builds the correct DAG. After creating a batch, self-check:
```bash
orca orchestration task-list --run <run_id> --json     # verify the dependencies are right
```
Deps may only point at tasks **within the same Run**.

### Spec-writing rules (important)
Every subtask's `--spec` must be **self-contained and independently executable**, so the future executing agent **never has to ask questions or enter plan mode**:
- **Inputs**: what it depends on, which files/interfaces to read.
- **Outputs**: which files to create/modify, what the deliverable is.
- **Acceptance criteria**: what "done" means, phrased as a command plus its expected result (runnable tests, observable behavior) — not "verify it works". A worker that has to invent the check will report a check it did not run.
- **No interactive prompts**: say so in the spec. The worker must not use an interactive question tool (`AskUserQuestion`, plan mode) — nothing it renders in its own terminal ever reaches Orca, so the node just sits `dispatched` forever. If it truly needs a decision it must call `orca orchestration ask` (that lands in the Run's inbox and the viewer surfaces it), or take the pre-agreed branch and record the choice in its result.
- Use imperative sentences; avoid vague phrasing like "investigate" or "as appropriate".

## When human approval is needed
At key points (e.g. "approve the design before execution"), create a decision gate. It blocks its task, and the viewer surfaces approve/reject buttons:
```bash
orca orchestration gate-create \
  --task <task_id> \
  --question "Approve the TECH_SPEC and move to execution?" \
  --options '["approved","rejected"]' --json
```

Rules that matter more than the example:
- **`approved` must be one of the options.** The viewer releases the gated task only on the literal resolution `approved` (`coordinator.ts`); any other value leaves the task `blocked`, and with nothing else runnable the Run **stops**. So `rejected` means "abandon this Run", never "retry with changes".
- **Attach the gate to the task it blocks** — the downstream one — not to the task whose output you want reviewed. A gate on a completed task blocks nothing.
- **Write the question as a decision card**: what to read (file path), what `approved` means, and what happens otherwise. The user judges from a card on the canvas, without your conversation in front of them.
- **Model retries inside the node, not as a second gate.** A repair node re-runs the relevant checks itself and reports what is still open; a `rejected` gate cannot reopen anything.

## Worker mail: questions and escalations
The viewer reads the Run's inbox (`inbox --terminal run:<id>`, read-only), so two situations that used to stall silently now surface on the canvas and can be answered from it:
- **`question`** — a worker called `orca orchestration ask` and is waiting for an answer. The viewer shows the text and a reply box (`reply`).
- **`escalation`** — a worker ended its turn without `worker_done`. The viewer shows it and can `send` guidance to its Dispatch.

Only `orca orchestration ask` reaches that inbox. A worker that opens its **own** interactive prompt (Claude Code's `AskUserQuestion`, a shell prompt, an editor) blocks its terminal and emits nothing — that is exactly why the spec rule above forbids it: the user would have to answer inside the worker's terminal while the DAG merely looks stuck.

## After the DAG is built: open the viewer and let Orca execute
Once the DAG has taken shape, ask the user to open the viewer, and **tell them the Run id** (they pick it in the viewer's top bar):
```bash
npx orca-dag    # run in the current project directory; serves http://localhost:8787 and opens the browser
```
(If they already have it running — likely, since that command is also what installed this skill — they just need to reselect the Run.)
In the viewer the user will: **pick your new Run in the top bar** → **watch the DAG live** → **choose a harness per node** (claude / codex / opencode / grok …, or a default fallback) → click **"▶ Run with Orca"** → **the viewer uses `worker-start` to spin up workers in dependency-parallel, waits for `worker_done`, and advances the whole graph** → **resolve approval gates** → **answer any worker mail**. Settled tasks and pending gates raise desktop notifications once the user allows them (asked on the first Run click).

In other words: **execution is the viewer's job, not yours.** Your responsibility ends at "the DAG is correct".

⚠️ **You will get fenced — this is normal.** When the user starts execution, the viewer binds the Run's coordinator to its own terminal. From then on **your** mutations against that Run (`task-create` / `gate-resolve` / `dispatch`) fail with `consumer_fenced`. To take it back:

```bash
orca orchestration run-use --id <run_id> --json     # re-bind yourself as coordinator
```

Reads are unaffected — `task-list --run <id>` / `gate-list --run <id>` always work. So **`run-use` to reclaim the binding before adjusting the DAG**, then let the user hit Run again.

The binding is reversible in **both** directions — `run-use` takes it back, and the viewer's ▶ Run takes it back from you. That makes a hand-off worthwhile: let the viewer drive the stretch that needs no human, reclaim with `run-use` when a gate needs the user (you can show them the evidence in chat), resolve it, and — if the gated task stayed `blocked` — release it yourself with `task-update --id <task> --status ready`, then tell the user to press Run again. Two independent Runs can even be driven in parallel this way: the viewer owns one, this session owns the other.

You and the user can **keep adjusting the DAG in conversation** (add/remove tasks, change deps, add gates) and the viewer reflects it live. **By default, do not run `orca orchestration dispatch` / `worker-start` yourself** — that's the viewer's loop — unless the user explicitly asks you to drive from the command line.

## Boundaries and known constraints
- Focus on **planning + graph building**. Execution belongs to the viewer (the coordinator).
- **Created tasks cannot be edited**: `orca orchestration task-update` only changes `--status` / `--result`. **There is no interface to edit spec/title/deps**, and no command to delete a single task. Get the graph right on the first pass where possible.
- **To redraw the DAG, open a new Run — never `reset`.** `orca orchestration reset --tasks` has **no `--run` scope**: it clears the entire local orchestration database, deleting other Runs' tasks too. The correct move is `run-create` a new Run and rebuild; the old Run stays as history.
- **Decision gates are Run-scoped, but the flags differ by direction**: `gate-list` (read) takes `--run <id>`; `gate-resolve` (mutation) takes **no `--run`** — it locates the gate via `--from <handle>` (a coordinator terminal bound to the Run) plus the globally unique `--id`. That's why the viewer first binds a coordinator with `run-use`, then resolves via `--from`.
- **`orca orchestration run` / `run-stop` / `coordinator-start` / `coordinator-stop` are retired.** Calling them has no effect; they only return a "go read the orchestration skill" notice. Don't use them.
- Don't run destructive or off-task system commands.

## Communication style
- Follow the user's language. Concise and direct.
- After each batch of task creation/changes, summarize the DAG's current shape in one sentence (what runs in parallel, what is serial) — the user is watching it appear in the viewer.
