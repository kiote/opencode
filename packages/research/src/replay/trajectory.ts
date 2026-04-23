import { randomUUID } from "crypto"
import { getDb } from "../storage/db.js"

type StepRecord = {
  sessionId: string
  toolName: string
  toolInput: any
  toolOutput: any
  callId: string
}

type ActiveTrajectory = {
  id: string
  sessionId: string
  stepIndex: number
  startTime: number
  lastStepTime: number
}

/**
 * TrajectoryTracker — captures full execution traces from sessions.
 *
 * Each session maps to one trajectory. Steps are appended in order.
 * When the session goes idle, the trajectory is finalized.
 *
 * Foundation for SWE-Replay (Phase 2): trajectories are recycled
 * and branched from rather than re-run from scratch.
 */
export class TrajectoryTracker {
  private active = new Map<string, ActiveTrajectory>()
  private projectDir: string

  constructor(projectDir: string) {
    this.projectDir = projectDir
  }

  private getOrCreate(sessionId: string): ActiveTrajectory {
    let traj = this.active.get(sessionId)
    if (!traj) {
      const id = randomUUID()
      const now = Date.now()
      traj = { id, sessionId, stepIndex: 0, startTime: now, lastStepTime: now }
      this.active.set(sessionId, traj)

      const db = getDb()
      db.run(
        "INSERT INTO trajectories (id, session_id, project_dir, status, created_at) VALUES (?, ?, ?, 'running', ?)",
        [id, sessionId, this.projectDir, now]
      )
    }
    return traj
  }

  async recordStep(step: StepRecord): Promise<void> {
    const traj = this.getOrCreate(step.sessionId)
    const now = Date.now()
    const duration = now - traj.lastStepTime
    const stepId = randomUUID()
    const db = getDb()

    db.run(
      "INSERT INTO trajectory_steps (id, trajectory_id, step_index, tool_name, tool_input, tool_output, duration, branch_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [stepId, traj.id, traj.stepIndex, step.toolName, JSON.stringify(step.toolInput), JSON.stringify(step.toolOutput), duration, this.scoreBranchPoint(step), now]
    )

    traj.stepIndex++
    traj.lastStepTime = now
  }

  async finalize(sessionId: string): Promise<void> {
    const traj = this.active.get(sessionId)
    if (!traj) return

    const db = getDb()
    db.run(
      "UPDATE trajectories SET status = 'completed', total_steps = ?, completed_at = ? WHERE id = ?",
      [traj.stepIndex, Date.now(), traj.id]
    )
    this.active.delete(sessionId)
  }

  /**
   * Score a step as a potential branch point for SWE-Replay.
   * High = good place to branch from in future retries.
   */
  private scoreBranchPoint(step: StepRecord): number {
    const tool = step.toolName.toLowerCase()
    if (["grep", "codesearch", "glob", "read"].includes(tool)) return 0.8
    if (tool === "bash") {
      const input = typeof step.toolInput === "string" ? step.toolInput : JSON.stringify(step.toolInput)
      if (/\b(test|jest|vitest|pytest|cargo test|npm test|bun test)\b/i.test(input)) return 0.9
      if (/\b(ls|find|cat|head|tail|wc)\b/.test(input)) return 0.7
      return 0.5
    }
    if (["edit", "write", "apply_patch"].includes(tool)) return 0.4
    if (["webfetch", "websearch"].includes(tool)) return 0.2
    return 0.3
  }

  getActiveCount(): number {
    return this.active.size
  }
}
