# OpenCode Research Fork — Design Document

> **Fork:** `kiote/opencode` (from `anomalyco/opencode`)
> **Goal:** Layer research-backed enhancements onto OpenCode while maintaining upstream compatibility.
> **Date:** 2026-04-23

## 1. Architecture Principle: The Research Layer

All our additions live in a single directory: `packages/opencode/src/research/`.
This minimizes merge conflicts with upstream. We touch upstream files only through
**thin integration points** — hooks, event listeners, and module augmentation.

```
packages/opencode/src/research/
├── index.ts              # Research layer initialization & registration
├── replay/               # SWE-Replay: trajectory recycling & branching
│   ├── trajectory.ts     # Trajectory capture, storage, serialization
│   ├── branch.ts         # Branch-point detection & replay logic
│   └── index.ts
├── meta-tools/           # AWO: auto-discovered composite tools
│   ├── pattern-miner.ts  # Analyze tool-call traces for recurring sequences
│   ├── composite.ts      # Meta-tool definition & deterministic execution
│   └── index.ts
├── planning/             # FLARE: future-aware lookahead
│   ├── lookahead.ts      # Reward estimation & value propagation
│   ├── commitment.ts     # Limited commitment with rollback
│   └── index.ts
├── experience/           # AutoRefine: reusable expertise extraction
│   ├── extractor.ts      # Dual-form pattern extraction from trajectories
│   ├── subagent.ts       # Spawned procedural subagents
│   ├── skills.ts         # Extracted skill patterns (guidelines/snippets)
│   ├── maintenance.ts    # Score, prune, merge patterns
│   └── index.ts
├── tracing/              # TraceCoder: runtime trace collection
│   ├── probe.ts          # Code instrumentation & diagnostic probes
│   ├── causal.ts         # Causal analysis on traces
│   ├── lessons.ts        # Historical lesson learning mechanism
│   └── index.ts
├── context/              # Structured CE + MCE: context optimization
│   ├── format.ts         # Model-tier-aware format selection
│   ├── evolution.ts      # MCE: meta-agent context skill evolution
│   └── index.ts
├── psychometrics/        # Agent Psychometrics: task difficulty prediction
│   ├── irt.ts            # Item Response Theory model
│   ├── features.ts       # Task feature extraction
│   └── index.ts
└── storage/              # Research-specific persistence
    ├── trajectories.sql.ts
    ├── patterns.sql.ts
    ├── lessons.sql.ts
    └── index.ts
```

## 2. Integration Points with Upstream

OpenCode uses Effect (functional effect system) with layered services. We integrate
through the existing extension mechanisms:

### 2.1 Session Processor Hooks
The processor (`session/processor.ts`) handles the core LLM loop. We need:
- **Pre-process hook** — inject context optimization, task difficulty prediction
- **Post-step hook** — capture trajectory steps, mine tool-call patterns
- **Post-session hook** — extract experience patterns, store trajectories

**Implementation:** Wrap the existing `SessionProcessor.Service` layer with our
research layer that intercepts events via the `Bus` (event system).

### 2.2 Tool Registry Extension
Tools are registered in `tool/registry.ts`. Meta-tools register as regular tools
but execute deterministically (no LLM reasoning for bundled sub-steps).

### 2.3 Agent Augmentation
Agents are defined in `agent/agent.ts`. The `plan` agent is the natural place
for FLARE integration — it already does read-only analysis.

### 2.4 Storage Extension
OpenCode uses Drizzle ORM with SQLite. We add research-specific tables via
migration files, keeping them namespaced (`research_trajectories`, etc.).

## 3. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Research layer scaffold (`src/research/` with index, storage)
- [ ] Bus event listeners for trajectory capture
- [ ] Research-specific Drizzle tables & migrations
- [ ] Config extension: `research` section in `opencode.json`
- [ ] Feature flags for each research module (off by default)

### Phase 2: SWE-Replay (Week 2)
- [ ] Trajectory serialization (capture full session execution trace)
- [ ] Branch-point significance scoring (repo exploration heuristic)
- [ ] Replay-or-explore decision logic
- [ ] Integration with `run` mode (headless sessions)
- [ ] Storage: trajectory DB with indexed branch points

**Why first:** Directly improves `opencode run` which we use daily via SSH.
Medium complexity, high impact on multi-attempt tasks.

### Phase 3: Meta-tools / AWO (Week 3)
- [ ] Trace analysis: identify recurring tool-call sequences across sessions
- [ ] Meta-tool generation: bundle sequences into composite tools
- [ ] Registration in tool registry as regular tools
- [ ] Automatic pattern discovery (configurable frequency threshold)

**Why second:** Builds on the trajectory capture from Phase 2.
Reduces token cost and failure rate for repetitive workflows.

### Phase 4: Experience / AutoRefine (Week 4)
- [ ] Post-session experience extraction (procedural → subagent, declarative → skill)
- [ ] Experience pattern storage with scoring
- [ ] Maintenance loop: prune low-score, merge similar patterns
- [ ] Inject relevant experience into session context

### Phase 5: FLARE Planning (Week 5+)
- [ ] Lookahead reward estimation for plan agent
- [ ] Value propagation from future states to current decisions
- [ ] Limited commitment with rollback mechanism
- [ ] Integration with plan agent's read-only analysis

### Phase 6: TraceCoder (Week 6+)
- [ ] Runtime trace collection for bash tool executions
- [ ] Causal analysis on test failures
- [ ] Historical lesson mechanism: learn from prior failed repairs
- [ ] Rollback mechanism (leverage existing snapshot system)

### Phase 7: Context Engineering (Ongoing)
- [ ] Model-tier detection (frontier vs open-source)
- [ ] Format selection based on Structured CE findings
- [ ] MCE skill evolution (longer-term, more experimental)

### Phase 8: Task Psychometrics (Ongoing)
- [ ] Task feature extraction from issue/PR descriptions
- [ ] IRT-based difficulty prediction
- [ ] Route hard tasks to different strategies (more retries, planning-first, etc.)

## 4. Upstream Compatibility Strategy

### Merge Policy
- `dev` branch: always tracks upstream `anomalyco/opencode:dev`
- `research` branch: our additions on top of `dev`
- Weekly upstream sync: `git fetch origin dev && git rebase origin/dev`
- All research code in `src/research/` — merge conflicts only at integration points

### Minimal Upstream Patches
When we must modify upstream files, use:
1. **Module augmentation** (extend interfaces/types without changing source)
2. **Event-driven hooks** (subscribe to Bus events, don't modify emitters)
3. **Layer composition** (wrap Effect services, don't replace them)
4. **Plugin system** (if OpenCode's plugin architecture supports our needs)

If upstream changes break an integration point, the research layer should
degrade gracefully (disable that feature, log a warning).

### Config Namespace
```json
{
  "research": {
    "enabled": true,
    "replay": { "enabled": true, "maxTrajectories": 100 },
    "metaTools": { "enabled": false, "minFrequency": 3 },
    "planning": { "enabled": false },
    "experience": { "enabled": false },
    "tracing": { "enabled": false }
  }
}
```

## 5. Tech Stack Notes

- **Runtime:** Bun (packageManager: bun@1.3.13)
- **Language:** TypeScript (strict)
- **Effect system:** Effect (functional effects, layers, services)
- **Storage:** Drizzle ORM + SQLite
- **AI SDK:** Vercel AI SDK (`ai` package)
- **Event system:** Custom Bus (pub/sub for session events)
- **Testing:** Vitest (existing test infrastructure)

## 6. Key Design Decisions

### Why `src/research/` not a separate package?
The research enhancements need deep access to session internals (processor,
tool registry, agent definitions). A separate package would require exposing
too many internal APIs. A directory within the main package keeps access simple
while maintaining clear separation.

### Why feature flags?
Each research module should be independently toggleable. Some are experimental,
some may conflict, and we want to A/B test impact. Default: all off except
trajectory capture (Phase 1).

### Why Bus events over direct hooks?
OpenCode's Bus is already used for session lifecycle events. Subscribing to
events is non-invasive and survives upstream refactors. We only need direct
patches for the few cases where Bus events don't carry enough context.

## 7. Success Metrics

| Module | Metric | Target |
|---|---|---|
| SWE-Replay | Cost reduction on multi-attempt tasks | >15% (per paper) |
| Meta-tools | LLM calls reduction | >10% |
| FLARE | Task completion on complex refactors | Measurable improvement |
| AutoRefine | Step count reduction on repeated task types | >20% |
| TraceCoder | Debug success rate on test failures | >30% improvement |

## 8. References (Wiki)

All papers are documented in the `agentic-development` wiki:
- [[swe-replay]], [[meta-tools]], [[flare]], [[autorefine]], [[tracecoder]]
- [[structured-context-engineering]], [[meta-context-engineering]]
- [[agent-psychometrics]], [[arena-framework-bench]], [[susvibes]]
