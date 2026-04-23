# OpenCode Research Fork — Design Document v2

> **Fork:** `kiote/opencode` (from `anomalyco/opencode`)
> **Goal:** Layer research-backed enhancements onto OpenCode while maintaining upstream compatibility.
> **Date:** 2026-04-23 (v2 — revised after codebase analysis)

## 0. Key Codebase Findings

After studying the codebase, the integration story is much cleaner than initially planned:

**OpenCode already has a plugin system with rich hooks:**
- `chat.message` — intercept/modify incoming messages
- `chat.params` — modify LLM parameters (temperature, maxTokens, etc.)
- `tool.execute.before` — intercept tool calls before execution
- `tool.execute.after` — intercept tool results after execution
- `tool.definition` — modify tool descriptions/parameters sent to LLM
- `experimental.chat.system.transform` — modify system prompt
- `experimental.chat.messages.transform` — modify message history
- `experimental.session.compacting` — customize compaction
- `event` — receive all Bus events
- `tool` — register custom tools
- `permission.ask` — intercept permission checks

**Core architecture:**
- Effect (functional effect system) with layered services
- Bus: typed pub/sub (`BusEvent.define` + `bus.publish`/`subscribe`)
- Storage: Drizzle ORM + SQLite
- Session processor: `start-step → tool-call → tool-result → finish-step` loop
- Snapshots: file-system snapshots at step boundaries (already tracks diffs!)
- Package manager: Bun

## 1. Revised Architecture: Plugin-First + Minimal Core Patches

### Tier 1: Plugin (preferred — zero merge conflicts)

A research plugin: `packages/research/` as a proper OpenCode plugin package.
This covers ~70% of what we need:

```
packages/research/
├── package.json           # @opencode-ai/research-plugin
├── src/
│   ├── index.ts           # Plugin entry: exports server function
│   ├── hooks/             # Plugin hook implementations
│   │   ├── message.ts     # chat.message — inject experience context
│   │   ├── system.ts      # chat.system.transform — context optimization
│   │   ├── params.ts      # chat.params — model-tier-aware params
│   │   ├── tool-before.ts # tool.execute.before — meta-tool interception
│   │   ├── tool-after.ts  # tool.execute.after — trajectory capture
│   │   └── event.ts       # event — Bus event listener for all events
│   ├── tools/             # Custom tools registered via plugin
│   │   ├── replay.ts      # /replay command — replay from checkpoint
│   │   └── experience.ts  # /experience — query extracted patterns
│   ├── replay/            # SWE-Replay: trajectory recycling
│   │   ├── trajectory.ts  # Capture & serialize session trajectories
│   │   ├── branch.ts      # Branch-point detection & scoring
│   │   └── replay.ts      # Replay decision logic
│   ├── meta-tools/        # AWO: composite tool discovery
│   │   ├── miner.ts       # Pattern mining from tool-call traces
│   │   └── composite.ts   # Generated meta-tool definitions
│   ├── experience/        # AutoRefine: reusable expertise
│   │   ├── extractor.ts   # Dual-form pattern extraction
│   │   ├── skills.ts      # Skill pattern storage
│   │   └── maintenance.ts # Score, prune, merge
│   ├── tracing/           # TraceCoder: runtime trace analysis
│   │   ├── probe.ts       # Trace collection from bash tool
│   │   ├── causal.ts      # Root cause analysis
│   │   └── lessons.ts     # Historical lesson learning
│   ├── context/           # Context engineering
│   │   ├── format.ts      # Model-tier-aware format selection
│   │   └── optimizer.ts   # System prompt optimization
│   ├── psychometrics/     # Task difficulty prediction
│   │   ├── irt.ts         # IRT model
│   │   └── router.ts      # Route hard tasks differently
│   └── storage/           # Persistent storage for research data
│       ├── db.ts          # Separate SQLite DB (not OpenCode's)
│       └── schema.ts      # Drizzle schema for trajectories, patterns, etc.
```

### Tier 2: Core patches (only when plugin hooks are insufficient)

Some features need deeper integration:

| Feature | Why plugin isn't enough | Patch location |
|---|---|---|
| FLARE planning | Needs to intercept mid-generation, add lookahead steps | `session/processor.ts` |
| Trajectory branching | Needs to restore session to checkpoint & re-run | `session/session.ts` |
| Step-level snapshots | Already captured! (`start-step`/`finish-step` events) | Read-only |

**Branching strategy for patches:**
- `dev` branch: tracks upstream
- `research` branch: our patches + plugin
- Patches are minimal and wrapped in `// RESEARCH:` comments for easy identification
- Each patch gets a companion test that verifies the hook exists

### Tier 3: Upstream PRs (contribute back)

Some enhancements are generally useful and should be PR'd upstream:
- Additional Bus events (e.g., `session.complete` with full trajectory)
- Plugin hook for mid-generation interception (enables FLARE for everyone)
- Trajectory export/import API

## 2. Plugin Hook Mapping

How each research module maps to existing plugin hooks:

```
┌─────────────────────┬────────────────────────────────────────────────┐
│ Research Module      │ Plugin Hooks Used                             │
├─────────────────────┼────────────────────────────────────────────────┤
│ Trajectory Capture  │ event (session.status → idle)                 │
│                     │ tool.execute.after (capture each tool result)  │
│                     │ finish-step events (via event hook)            │
├─────────────────────┼────────────────────────────────────────────────┤
│ SWE-Replay          │ chat.message (inject replay decision)         │
│                     │ tool (custom /replay command)                  │
│                     │ [PATCH: session restore from checkpoint]       │
├─────────────────────┼────────────────────────────────────────────────┤
│ Meta-tools          │ tool.execute.before (intercept known seqs)    │
│                     │ tool.execute.after (mine patterns)             │
│                     │ tool.definition (register composite tools)     │
├─────────────────────┼────────────────────────────────────────────────┤
│ Experience/AutoRef. │ event (session idle → extract experience)     │
│                     │ experimental.chat.system.transform (inject)    │
│                     │ chat.message (augment with relevant experience)│
├─────────────────────┼────────────────────────────────────────────────┤
│ TraceCoder          │ tool.execute.before (add trace probes to bash)│
│                     │ tool.execute.after (collect + analyze traces)  │
├─────────────────────┼────────────────────────────────────────────────┤
│ Context Engineering │ experimental.chat.system.transform             │
│                     │ chat.params (model-tier-aware settings)        │
│                     │ experimental.chat.messages.transform           │
├─────────────────────┼────────────────────────────────────────────────┤
│ Task Psychometrics  │ chat.message (analyze task difficulty)         │
│                     │ chat.params (adjust strategy per difficulty)   │
├─────────────────────┼────────────────────────────────────────────────┤
│ FLARE Planning      │ [PATCH: mid-generation lookahead hook]        │
│                     │ experimental.chat.system.transform             │
└─────────────────────┴────────────────────────────────────────────────┘
```

## 3. Storage Strategy

**Separate SQLite database** (`~/.opencode/research.db`) — not OpenCode's main DB.

Reasons:
- No schema migration conflicts with upstream
- Can nuke research data without affecting sessions
- Simpler to backup/restore independently

Tables:
- `trajectories` — full session execution traces (sessionID, steps, tool calls, results, timestamps)
- `branch_points` — scored checkpoints within trajectories
- `tool_patterns` — discovered recurring tool-call sequences
- `meta_tools` — generated composite tool definitions
- `experience_patterns` — extracted skills and subagent templates
- `lessons` — historical lesson learning entries (failures + insights)
- `task_features` — extracted task characteristics for IRT

## 4. Configuration

Plugin is configured in `opencode.json`:

```json
{
  "plugins": ["@opencode-ai/research"],
  "research": {
    "replay": {
      "enabled": true,
      "maxTrajectories": 100,
      "branchScoreThreshold": 0.7
    },
    "metaTools": {
      "enabled": false,
      "minFrequency": 3,
      "discoveryInterval": "daily"
    },
    "experience": {
      "enabled": false,
      "maxPatterns": 500,
      "pruneThreshold": 0.3
    },
    "tracing": {
      "enabled": false,
      "maxLessons": 200
    },
    "context": {
      "enabled": true,
      "modelTierDetection": true
    },
    "psychometrics": {
      "enabled": false
    },
    "planning": {
      "enabled": false,
      "lookaheadDepth": 3
    }
  }
}
```

## 5. Implementation Phases (Revised)

### Phase 0: Plugin Scaffold (Day 1)
- [ ] Create `packages/research/` with Bun + TypeScript
- [ ] Plugin entry point implementing `Hooks` interface
- [ ] Separate SQLite DB setup (`research.db`)
- [ ] Config schema for research options
- [ ] Register plugin in workspace `opencode.json`
- [ ] Verify: plugin loads, hooks fire, events received

### Phase 1: Trajectory Capture (Day 2-3)
- [ ] `event` hook: listen for session lifecycle events
- [ ] `tool.execute.after` hook: capture tool name, input, output, timing
- [ ] Serialize full session trajectory to `research.db`
- [ ] Record step-level snapshots (piggyback on OpenCode's existing `start-step`/`finish-step`)
- [ ] Branch-point scoring: heuristic based on repo exploration significance

**Deliverable:** Every `opencode run` automatically builds a trajectory DB.

### Phase 2: SWE-Replay (Week 1-2)
- [ ] Replay decision engine: given a task, find relevant prior trajectories
- [ ] Branch-or-restart logic based on branch-point scores
- [ ] Custom `/replay` tool: user can manually trigger replay from checkpoint
- [ ] [PATCH] Session restore from mid-trajectory checkpoint
- [ ] Integration with `opencode run` retry mode

**Deliverable:** Multi-attempt tasks cost 15-20% less.

### Phase 3: Meta-tools / AWO (Week 2-3)
- [ ] `tool.execute.after`: accumulate tool-call sequences across sessions
- [ ] Pattern miner: identify recurring N-grams in tool-call traces
- [ ] Meta-tool generator: create composite tool definitions
- [ ] `tool`: register discovered meta-tools as available tools
- [ ] `tool.execute.before`: intercept and run meta-tool sequences deterministically

**Deliverable:** Repetitive workflows auto-compress into single tool calls.

### Phase 4: Experience Extraction (Week 3-4)
- [ ] Post-session analysis: extract procedural patterns (→ subagent templates) and declarative patterns (→ skill snippets)
- [ ] `experimental.chat.system.transform`: inject relevant experience into system prompt
- [ ] Maintenance loop: score patterns by reuse frequency, prune low-scorers, merge similar
- [ ] Custom `/experience` tool: query and manage extracted patterns

### Phase 5: Context Engineering (Week 4)
- [ ] Model tier detection from provider/model info in `chat.params`
- [ ] Format selection based on Structured CE findings (frontier: file-based; OSS: inline)
- [ ] `experimental.chat.system.transform`: optimize system prompt structure
- [ ] `experimental.chat.messages.transform`: optimize context format per model

### Phase 6: TraceCoder (Week 5)
- [ ] `tool.execute.before` on bash: inject trace probes (set -x, diagnostic prints)
- [ ] `tool.execute.after` on bash: parse traces, run causal analysis
- [ ] Historical lesson DB: store failure→insight pairs
- [ ] `experimental.chat.system.transform`: inject relevant lessons for current task

### Phase 7: FLARE Planning (Week 6+)
- [ ] [PATCH] Add mid-generation hook to processor (PR upstream)
- [ ] Lookahead reward estimation: evaluate N candidate next-steps
- [ ] Value propagation: score early choices by downstream outcomes
- [ ] Limited commitment: buffer choices, rollback bad ones
- [ ] Integration with `plan` agent

### Phase 8: Task Psychometrics (Week 7+)
- [ ] Task feature extraction from issue/PR text
- [ ] IRT model training on trajectory outcomes
- [ ] `chat.message`: predict difficulty, annotate for downstream hooks
- [ ] `chat.params`: adjust strategy (more retries, planning-first, etc.)

## 6. Upstream Compatibility

### Merge workflow
```bash
# Weekly sync
git checkout dev
git fetch origin dev
git rebase origin/dev        # fast-forward or merge
git checkout research
git rebase dev               # replay our patches on latest upstream
```

### Patch inventory (to be tracked)
| File | Change | Phase | PR candidate? |
|---|---|---|---|
| `session/processor.ts` | Mid-generation hook | Phase 7 | Yes |
| `session/session.ts` | Checkpoint restore | Phase 2 | Yes |

All other changes are plugin-only → zero merge conflicts.

### Degradation
If upstream breaks a hook, the plugin catches the error and disables that module.
Research features never crash the main application.

## 7. Success Metrics

| Module | Metric | Target | Measurement |
|---|---|---|---|
| Trajectory capture | Data completeness | 100% tool calls captured | Compare DB vs session history |
| SWE-Replay | Cost reduction | >15% on multi-attempt | $/task with vs without |
| Meta-tools | LLM calls saved | >10% | Count before/after |
| Experience | Step reduction | >20% on repeated types | Steps with vs without |
| Context CE | Token efficiency | Measurable | Tokens used per task |
| TraceCoder | Debug success | >30% improvement | Pass rate on test failures |
| FLARE | Complex task completion | Measurable | Success rate on long-horizon |

## 8. Tech Decisions

### Why a plugin package, not `src/research/`?
The plugin hook system covers ~70% of our needs without touching upstream code at all.
A plugin is the most upstream-compatible approach — it survives major refactors as long
as the hook interface remains stable (which it will, since other plugins depend on it).

### Why a separate SQLite DB?
Research data is experimental and potentially large (full trajectories). Keeping it out
of OpenCode's main DB means zero schema migration conflicts and easy cleanup.

### Why Bun?
OpenCode uses Bun. Our plugin must match the runtime.

### Why not contribute everything upstream?
We will — but research features need iteration first. Ship in our fork, validate,
then PR the stable ones upstream. The plugin architecture makes this easy: once mature,
the plugin can be published to npm for anyone to use.

## 9. References

All underlying papers documented in `wikis/agentic-development/`:
- [[swe-replay]] — trajectory recycling (Jan 2026)
- [[meta-tools]] — composite tool discovery (Jan 2026)
- [[autorefine]] — experience extraction (Jan 2026)
- [[flare]] — future-aware lookahead (Jan 2026)
- [[tracecoder]] — trace-driven debugging (Feb 2026)
- [[structured-context-engineering]] — format vs model capability (Feb 2026)
- [[meta-context-engineering]] — automated CE (Jan 2026)
- [[agent-psychometrics]] — IRT task prediction (Apr 2026)
- [[arena-framework-bench]] — framework comparison (Apr 2026)
- [[susvibes]] — security benchmark (Dec 2025)
