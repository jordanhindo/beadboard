## 🚧 The bb-pi orchestrator is under construction — [help us build it!](CONTRIBUTING.md) Use your own coding agent alongside BeadBoard for now. 🚧

# BeadBoard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/zenchantlive/beadboard?style=social)](https://github.com/zenchantlive/beadboard/stargazers)
[![Built on Beads](https://img.shields.io/badge/built%20on-Beads-blue)](https://github.com/steveyegge/beads)

**Multi-agent orchestration and communication system built on [Beads](https://github.com/steveyegge/beads).**

Agents claim tasks, send structured mail to each other, track dependencies, and close work with evidence. BeadBoard is the coordination layer — a dashboard that shows it all happening live, a CLI (`bb`) that hosts the orchestrator and manages agent communication, and a built-in execution runtime ([bb-pi](#-bb-pi-orchestrator)) that can spawn and manage agent workers directly.

Built on [Beads](https://github.com/steveyegge/beads) and inspired by [Gastown](https://github.com/steveyegge/gastown).

![BeadBoard Dashboard](docs/screenshots/image-9.png)

---
## 📦 Installation

### Prerequisites

- **Node.js** 18.18+ (Node 20 LTS recommended)
- **npm** 7.0+
- **[Dolt](https://github.com/dolthub/dolt)** (recommended — see [Dolt section](#-dolt))

### Install from Source

```bash
git clone https://github.com/zenchantlive/beadboard.git
cd beadboard
npm install
npm install -g .
```

This installs:
- `beadboard` / `bb` — BeadBoard CLI: dashboard, orchestrator host, agent communication commands
- `bd` — Beads CLI for task management (also available standalone: `npm install -g @beads/bd`)

```bash
beadboard --version
bd --version
```

**Alternative:** POSIX install script (Linux/macOS):
```bash
bash ./install/install.sh    # installs bb + beadboard shims to ~/.beadboard/bin
```
---
Or just tell your agent:

> Install  Beadboard, and the beadboard-driver skill from https://github.com/zenchantlive/beadboard and use it to coordinate your work. Run `npx skills add zenchantlive/beadboard --skill beadboard-driver` then follow the SKILL.md runbook.

Then add to your project's `AGENTS.md` or `CLAUDE.md`:

```markdown
## BeadBoard

You have access to the **beadboard-driver** skill.

- Always use beadboard-driver as your entrypoint for coordination work (tasks, context, status)
  instead of inventing your own workflow.
- Use it to read and update Beads via `bd`, keep work state consistent with the BeadBoard UI,
  and obey the verification rules described in the Beadboard-Driver Skill.
- When in doubt about what to do next or how to record progress, call beadboard-driver and
  follow its guidance rather than editing markdown ad hoc.
```


See [skills/beadboard-driver/SKILL.md](skills/beadboard-driver/SKILL.md) for the complete agent runbook.

---
## 🚀 Add BeadBoard Skill to Your Agent

```bash
npx skills add zenchantlive/beadboard --skill beadboard-driver
```

This installs the [beadboard-driver](skills/beadboard-driver/SKILL.md) skill — a 9-step operating contract that gives your agent:
- 📋 Task coordination through dependency-constrained graphs
- 💬 Structured agent-to-agent messaging (`HANDOFF`, `BLOCKED`, `DECISION`, `INFO`)
- 🔒 Scope-based work reservations with liveness-aware conflict resolution
- 📡 Realtime progress tracking via heartbeats and activity streams
- ✅ Evidence-required workflow — agents can't close work without verification gates
---

## ⚡ Quick Start

```bash
cd ~/my-project
bd init                        # initialize Beads in your project
beadboard start --dolt         # start the dashboard with Dolt (recommended)
```

To use another port, run `beadboard start --dolt --port 4000`. BeadBoard saves the port of the running server in `~/.beadboard/server.json`, so `beadboard status` and `beadboard open` find it without `--port`. Port priority: `--port` > `BB_PORT` > running server > `PORT` > `3000`.

Open [http://localhost:3000](http://localhost:3000).

```bash
bd create --title "My first task" --type task --priority 0
```
---

## 🗄️ Dolt

BeadBoard uses [Dolt](https://github.com/dolthub/dolt) — a version-controlled SQL database — as its primary backend. Dolt gives you:
- Full version history of every issue state change
- SQL queries across all your issues and projects
- `bd dolt pull` / `bd dolt push` for multi-agent sync across machines
- Branch-based workflows

```bash
# macOS
brew install dolt

# Linux / Windows
curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh | bash
```

Without Dolt, BeadBoard falls back to reading `.beads/issues.jsonl` directly. This is enough to poke around, but you'll want Dolt for real work.

---

## 🔧 What BeadBoard Does

BeadBoard is three things:

### The Dashboard
A live operations console with Social, Graph, and Activity views — updating in realtime via SSE as agents work.

### The CLI (`bb`)
A full agent command center — not just a dashboard launcher:

```bash
# Agent lifecycle
bb agent register --name <id> --role <role>
bb agent list
bb agent activity-lease --agent <id>

# Agent-to-agent communication
bb agent send --from <id> --to <id> --bead <id> --category HANDOFF --subject "..."
bb agent inbox --agent <id>
bb agent ack --agent <id> --message <msg-id>

# Work reservations
bb agent reserve --agent <id> --scope <scope> --bead <id>
bb agent release --agent <id> --scope <scope>

# Orchestrator runtime
bb daemon start
bb daemon tui                    # interactive orchestrator REPL
bb daemon bootstrap              # install Pi runtime
```

### The Orchestrator ([bb-pi](#-bb-pi-orchestrator))
A built-in execution runtime that spawns and manages typed worker agents.

---

## 🧩 Core Features

### 💬 Agent Communication System

Structured message lifecycle for inter-agent coordination:

- **Message categories**: `HANDOFF`, `BLOCKED`, `DECISION`, `INFO`
- **Required acknowledgment** for high-signal categories (`HANDOFF`, `BLOCKED`)
- **Broadcast & role-based routing** — send to all agents or by role (`role:tester`)
- **Per-task threads** combining activity events, agent mail, and local interactions
- **Message states**: `unread` → `read` → `acked`

```bash
bd mail inbox
bd mail send --to <agent> --bead <id> --category HANDOFF --subject "Ready for review"
bd mail ack <message-id>
```

### 🔒 Work Reservations

Agents can lock scopes (file paths, task regions) to prevent conflicting work:
- TTL-based reservations (default 120 min)
- Liveness-aware conflict resolution — stale agents (15min no heartbeat) can be taken over
- File-based mutex prevents race conditions

### 📊 DAG Graph Visualization

DAG-oriented workspace for execution decisions:

- Task and dependency tab modes for different planning lenses
- Blocked chains highlighted, assignees on nodes
- Cycle detection and blocked-chain identification

![Dependency Graph View](docs/screenshots/image-8.png)

### 👥 Swarm Coordination

Agent pool monitor with:

- **Archetypes** — typed agent roles (architect, engineer, reviewer, tester, investigator, shipper)
- **Templates** — preset team compositions (`feature-dev`, `bug-fix`, `full-squad`, `greenfield`, `research-and-discovery`)
- "Needs Agent" queue for unassigned work
- Pre-assigned queue and squad roster

![Swarm Coordination Panel](docs/screenshots/image-7.png)

### 📡 Realtime Operations

- Live updates via Chokidar file watchers + Server-Sent Events
- Activity stream with session/task context
- Agent heartbeat and liveness tracking (active → stale → evicted)

### 🌐 Multi-Project Scope

- Project registry with scanner-backed discovery
- Single-project and aggregate modes
- Runtime scope switching without leaving the workspace

---

## 🤖 bb-pi Orchestrator

> 🚧 **Under active construction.** The orchestrator works but has known issues being fixed. Use your own coding agent alongside BeadBoard for now, or help us improve it!

bb-pi is BeadBoard's embedded execution runtime, built on [Pi](https://github.com/badlogic/pi-mono) ([@mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)). It runs a long-lived orchestrator per project that spawns typed worker agents, tracks their bead claims, and streams a live transcript.

**Working today (Phases 1-3):**
- Embedded orchestrator with BeadBoard-aware tools (`bb_spawn_worker`, `bb_worker_status`, `bb_create`, `bb_close`, etc.)
- Worker spawning with numbered display names (Engineer 01, Engineer 02...)
- **Capability-gated agent types** — architects/reviewers get read-only tools, engineers/testers get full code edit/write/bash
- **Template-based team spawning** via `bb_spawn_team` — spin up a full squad from a preset
- Bead-required workflow — every worker claims a bead, posts progress, closes with evidence
- Async coordination — non-blocking spawn with status polling and result reads
- Chat-style orchestrator transcript with realtime telemetry
- Interactive orchestrator REPL via `bb daemon tui`

**Known issues being fixed:**
- Double-reply rendering in orchestrator chat
- Silent failures — errors not yet surfaced to UI
- Session race condition under rapid use

**Phases 4-7** (launch-anywhere UX, agent presence in views, hardening, full test coverage) are on the roadmap. See [docs/plans/2026-03-05-embedded-pi-roadmap.md](docs/plans/2026-03-05-embedded-pi-roadmap.md).

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      BeadBoard UI                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Social  │  │  Graph   │  │ Activity │  │  Swarm   │    │
│  │  View    │  │  View    │  │  View    │  │  Panel   │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
         │              │              │              │
    ┌────▼──────────────▼──────────────▼──────────────▼────┐
    │                  bb CLI / bb-pi runtime               │
    │  agent register · agent send · daemon tui · spawn     │
    └──────────────────────────┬───────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
        ┌─────▼─────┐  ┌──────▼──────┐  ┌──────▼──────┐
        │    SSE     │  │    Dolt     │  │  Chokidar   │
        │   Events   │  │  (SQL DB)   │  │  Watchers   │
        └───────────┘  └─────────────┘  └─────────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                        ┌──────▼──────┐
                        │     bd      │
                        │ (Beads CLI) │
                        └─────────────┘
```

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Next.js 15 (App Router), React 19, TypeScript (strict) |
| Styling | Tailwind CSS, Radix UI, Framer Motion |
| Graph | @xyflow/react, Dagre |
| Database | Dolt (version-controlled SQL) |
| Realtime | Chokidar watchers, Server-Sent Events |
| Agent Runtime | @mariozechner/pi-coding-agent (bb-pi) |

### Data Flow

1. **Write path**: `bd` commands write to `.beads/issues.jsonl` and Dolt DB
2. **Read path**: UI queries Dolt SQL (falls back to JSONL when Dolt is unavailable)
3. **Realtime**: `bd` touches `.beads/last-touched` → Chokidar fires → SSE event → UI update

### Key Concepts

| Component | Purpose |
|-----------|---------|
| `bd` | Beads CLI — task and dependency management |
| `bb` / `beadboard` | BeadBoard CLI — dashboard, orchestrator host, agent commands |
| `bb-pi` | Embedded Pi execution runtime (under construction) |
| `beadboard-driver` | Agent skill — operating contract for coordination |

---

## 🌍 Platform Support

Runs on macOS, Linux, and Windows.

- **macOS / Linux**: `bash ./install/install.sh` installs shims to `~/.beadboard/bin`
- **Windows**: Path handling canonicalizes drive letter casing and backslash normalization. Mixed WSL2 + Windows setups require mirrored networking.

---

## 📁 Project Structure

```text
beadboard/
├── src/
│   ├── app/                    # Next.js App Router pages + API routes
│   ├── components/             # UI: shared, graph, social, swarm, agents, sessions
│   ├── hooks/                  # React hooks (subscriptions, URL state, etc.)
│   ├── lib/                    # Core domain logic (parser, types, mail, registry, etc.)
│   └── tui/                    # Orchestrator TUI + agent tools
├── skills/
│   └── beadboard-driver/       # Agent skill package (runbook + scripts + tests)
├── install/                    # Platform install scripts
├── docs/                       # PRDs, roadmaps, ADRs, screenshots
└── tests/                      # Test suite (explicitly enumerated in package.json)
```

---

## 🛠️ Scripts

```bash
npm run dev          # Development server (localhost:3000)
npm run build        # Production build
npm run start        # Production server
npm run typecheck    # TypeScript validation (tsc --noEmit)
npm run lint         # ESLint
npm run test         # Full test suite
```

> New test files must be added to the `test` script in `package.json` — the suite is explicitly enumerated, not auto-discovered.

---

## 🤝 Contributing

We welcome contributions from humans and AI agents. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide.

Quick version:
1. Find work: check [GitHub Issues](https://github.com/zenchantlive/beadboard/issues) or run `bd list --label contrib:open`
2. Small PRs preferred (under ~100 lines). For larger changes, open an issue first.
3. Run the gates: `npm run typecheck && npm run lint && npm run test`
4. PR against `main`

**[Join the Discussion](https://github.com/zenchantlive/beadboard/discussions)** to coordinate on contributions, get help, or discuss ideas.

---

## 📄 License

[MIT](LICENSE)

---

## 🙏 Acknowledgments

Built on [Beads](https://github.com/steveyegge/beads) by [Steve Yegge](https://github.com/steveyegge), inspired by [Gastown](https://github.com/steveyegge/gastown). The bb-pi execution runtime uses [Pi](https://github.com/badlogic/pi-mono) by [@mariozechner](https://github.com/mariozechner).
