import { getDb } from "../storage/db.js"

/**
 * Find relevant prior trajectories for a given task.
 *
 * Searches completed trajectories in the same project directory,
 * ranked by recency and step count.
 */
export function findRelevantTrajectories(
  projectDir: string,
  limit: number = 10,
): TrajectoryInfo[] {
  const db = getDb()
  const rows = db.query(`
    SELECT t.id, t.session_id, t.project_dir, t.task_description,
           t.status, t.total_steps, t.total_cost, t.created_at, t.completed_at
    FROM trajectories t
    WHERE t.project_dir = ? AND t.status = 'completed' AND t.total_steps > 0
    ORDER BY t.created_at DESC
    LIMIT ?
  `).all(projectDir, limit) as any[]

  return rows.map(r => ({
    id: r.id,
    sessionId: r.session_id,
    projectDir: r.project_dir,
    taskDescription: r.task_description,
    status: r.status,
    totalSteps: r.total_steps,
    totalCost: r.total_cost,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }))
}

/**
 * Get the best branch points from a trajectory.
 *
 * Returns steps with branch_score above the threshold, sorted by score.
 * These are the points where replaying from would be most valuable
 * (per SWE-Replay paper: repo exploration > LLM quality estimates).
 */
export function getBranchPoints(
  trajectoryId: string,
  threshold: number = 0.7,
): BranchPoint[] {
  const db = getDb()
  const rows = db.query(`
    SELECT s.id, s.trajectory_id, s.step_index, s.tool_name,
           s.tool_input, s.branch_score, s.snapshot_hash, s.created_at
    FROM trajectory_steps s
    WHERE s.trajectory_id = ? AND s.branch_score >= ?
    ORDER BY s.branch_score DESC, s.step_index ASC
  `).all(trajectoryId, threshold) as any[]

  return rows.map(r => ({
    id: r.id,
    trajectoryId: r.trajectory_id,
    stepIndex: r.step_index,
    toolName: r.tool_name,
    toolInput: JSON.parse(r.tool_input),
    branchScore: r.branch_score,
    snapshotHash: r.snapshot_hash,
    createdAt: r.created_at,
  }))
}

/**
 * Get the full step sequence of a trajectory up to a given step index.
 *
 * Used when replaying: we replay the context (tool calls + results) up to
 * the branch point, then let the agent continue from there.
 */
export function getTrajectorySteps(
  trajectoryId: string,
  upToStep?: number,
): StepInfo[] {
  const db = getDb()
  const query = upToStep !== undefined
    ? "SELECT * FROM trajectory_steps WHERE trajectory_id = ? AND step_index <= ? ORDER BY step_index"
    : "SELECT * FROM trajectory_steps WHERE trajectory_id = ? ORDER BY step_index"
  const params = upToStep !== undefined ? [trajectoryId, upToStep] : [trajectoryId]
  const rows = db.query(query).all(...params) as any[]

  return rows.map(r => ({
    id: r.id,
    trajectoryId: r.trajectory_id,
    stepIndex: r.step_index,
    toolName: r.tool_name,
    toolInput: JSON.parse(r.tool_input),
    toolOutput: r.tool_output ? JSON.parse(r.tool_output) : null,
    duration: r.duration,
    branchScore: r.branch_score,
    snapshotHash: r.snapshot_hash,
    createdAt: r.created_at,
  }))
}

/**
 * Decide whether to replay from a branch point or start fresh.
 *
 * SWE-Replay heuristic: if we have a prior trajectory with high-scoring
 * branch points, it's cheaper to branch than to start from scratch.
 * The decision considers:
 * 1. Branch point quality (score)
 * 2. How many steps we save by branching
 * 3. Whether the prior trajectory reached the same failure area
 */
export function shouldReplay(
  trajectories: TrajectoryInfo[],
  threshold: number = 0.7,
): ReplayDecision {
  if (trajectories.length === 0) {
    return { action: "explore", reason: "No prior trajectories found" }
  }

  // Check the most recent trajectory for good branch points
  const latest = trajectories[0]
  const branchPoints = getBranchPoints(latest.id, threshold)

  if (branchPoints.length === 0) {
    return { action: "explore", reason: "No high-quality branch points in prior trajectory" }
  }

  // Pick the best branch point
  const best = branchPoints[0]

  // Only worth replaying if we save meaningful steps
  const stepsSkipped = best.stepIndex
  if (stepsSkipped < 2) {
    return { action: "explore", reason: "Branch point too early — not enough steps saved" }
  }

  return {
    action: "replay",
    reason: `Branch from step ${best.stepIndex} (${best.toolName}, score ${best.branchScore})`,
    trajectoryId: latest.id,
    branchPoint: best,
    stepsSkipped,
  }
}

/**
 * Format a trajectory's steps as context for injection into a session.
 *
 * When replaying, we inject the prior trajectory as context so the agent
 * knows what was already tried and can branch from a known state.
 */
export function formatTrajectoryAsContext(steps: StepInfo[]): string {
  if (steps.length === 0) return ""

  const lines: string[] = [
    "## Prior Trajectory (from SWE-Replay)",
    `The following ${steps.length} steps were executed in a previous attempt on this task.`,
    "You are branching from the last step — continue from here rather than repeating these actions.",
    ""
  ]

  for (const step of steps) {
    lines.push(`### Step ${step.stepIndex}: ${step.toolName}`)
    lines.push(`Input: ${JSON.stringify(step.toolInput, null, 2)}`)
    if (step.toolOutput) {
      const output = typeof step.toolOutput === "object" && step.toolOutput.output
        ? step.toolOutput.output
        : JSON.stringify(step.toolOutput)
      // Truncate long outputs
      const truncated = output.length > 500 ? output.slice(0, 500) + "... [truncated]" : output
      lines.push(`Output: ${truncated}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// --- Types ---

export interface TrajectoryInfo {
  id: string
  sessionId: string
  projectDir: string
  taskDescription: string | null
  status: string
  totalSteps: number
  totalCost: number
  createdAt: number
  completedAt: number | null
}

export interface BranchPoint {
  id: string
  trajectoryId: string
  stepIndex: number
  toolName: string
  toolInput: any
  branchScore: number
  snapshotHash: string | null
  createdAt: number
}

export interface StepInfo {
  id: string
  trajectoryId: string
  stepIndex: number
  toolName: string
  toolInput: any
  toolOutput: any
  duration: number
  branchScore: number
  snapshotHash: string | null
  createdAt: number
}

export type ReplayDecision =
  | { action: "explore"; reason: string }
  | {
      action: "replay"
      reason: string
      trajectoryId: string
      branchPoint: BranchPoint
      stepsSkipped: number
    }
