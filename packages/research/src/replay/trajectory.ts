import { randomUUID } from "crypto"
import { getDb, trajectories, trajectorySteps } from "../storage/index.js"
import { eq, sql } from "drizzle-orm"

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
 * This is the foundation for SWE-Replay (Phase 2): trajectories are
 * recycled and branched from rather than re-run from scratch.
 */
export class TrajectoryTracker {
  private active = new Map<string, ActiveTrajectory>()
  private projectDir: string

  constructor(projectDir: string) {
    this.projectDir = projectDir
  }

  /**
   * Ensure a trajectory exists for this session. Creates one if needed.
   */
  private getOrCreate(sessionId: string): ActiveTrajectory {
    let traj = this.active.get(sessionId)
    if (!traj) {
      const id = randomUUID()
      const now = Date.now()
      traj = { id, sessionId, stepIndex: 0, startTime: now, lastStepTime: now }
      this.active.set(sessionId, traj)

      // Insert trajectory row
      const db = getDb()
      db.insert(trajectories).values({
        id,
        sessionId,
        projectDir: this.projectDir,
        status: "running",
        createdAt: new Date(now),
      }).run()
    }
    return traj
  }

  /**
   * Record a tool execution step within the current trajectory.
   */
  async recordStep(step: StepRecord): Promise<void> {
    const traj = this.getOrCreate(step.sessionId)
    const now = Date.now()
    const duration = now - traj.lastStepTime

    const stepId = randomUUID()
    const db = getDb()

    db.insert(trajectorySteps).values({
      id: stepId,
      trajectoryId: traj.id,
      stepIndex: traj.stepIndex,
      toolName: step.toolName,
      toolInput: JSON.stringify(step.toolInput),
      toolOutput: JSON.stringify(step.toolOutput),
      duration,
      branchScore: this.scoreBranchPoint(step),
      createdAt: new Date(now),
    }).run()

    traj.stepIndex++
    traj.lastStepTime = now
  }

  /**
   * Finalize a trajectory when the session goes idle.
   */
  async finalize(sessionId: string): Promise<void> {
    const traj = this.active.get(sessionId)
    if (!traj) return

    const db = getDb()
    const now = Date.now()

    db.update(trajectories)
      .set({
        status: "completed",
        totalSteps: traj.stepIndex,
        completedAt: new Date(now),
      })
      .where(eq(trajectories.id, traj.id))
      .run()

    this.active.delete(sessionId)
  }

  /**
   * Score a step as a potential branch point for SWE-Replay.
   *
   * High scores = good places to branch from in future retries.
   * Based on the SWE-Replay paper's heuristic: repo exploration
   * significance matters more than LLM-estimated quality.
   *
   * Heuristics:
   * - grep/codesearch/read = high (repo exploration)
   * - bash with test commands = high (verification points)
   * - edit/write = medium (state-changing)
   * - other = low
   */
  private scoreBranchPoint(step: StepRecord): number {
    const tool = step.toolName.toLowerCase()

    // Repo exploration tools — best branch points
    if (["grep", "codesearch", "glob", "read"].includes(tool)) {
      return 0.8
    }

    // Bash commands that look like tests/verification
    if (tool === "bash") {
      const input = typeof step.toolInput === "string"
        ? step.toolInput
        : JSON.stringify(step.toolInput)
      if (/\b(test|jest|vitest|pytest|cargo test|npm test|bun test)\b/i.test(input)) {
        return 0.9 // Post-test is an excellent branch point
      }
      if (/\b(ls|find|cat|head|tail|wc)\b/.test(input)) {
        return 0.7 // Exploration
      }
      return 0.5
    }

    // State-changing tools — ok branch points
    if (["edit", "write", "apply_patch"].includes(tool)) {
      return 0.4
    }

    // Web/external — generally not good branch points
    if (["webfetch", "websearch"].includes(tool)) {
      return 0.2
    }

    return 0.3
  }

  /**
   * Get stats for debugging/monitoring.
   */
  getActiveCount(): number {
    return this.active.size
  }
}
