import { Database } from "bun:sqlite"
import path from "path"
import fs from "fs"

// --- Database initialization ---

let _db: Database | null = null

export function getDb(dataDir?: string): Database {
  if (_db) return _db

  const dir = dataDir ?? path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? ".",
    ".opencode"
  )
  fs.mkdirSync(dir, { recursive: true })

  const dbPath = path.join(dir, "research.db")
  _db = new Database(dbPath)

  // WAL mode for concurrent reads
  _db.run("PRAGMA journal_mode = WAL")

  // Create tables
  _db.run(`
    CREATE TABLE IF NOT EXISTS trajectories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_dir TEXT NOT NULL,
      task_description TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      total_cost REAL DEFAULT 0,
      total_steps INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `)

  _db.run(`
    CREATE TABLE IF NOT EXISTS trajectory_steps (
      id TEXT PRIMARY KEY,
      trajectory_id TEXT NOT NULL REFERENCES trajectories(id),
      step_index INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      tool_input TEXT NOT NULL,
      tool_output TEXT,
      duration INTEGER,
      branch_score REAL,
      snapshot_hash TEXT,
      created_at INTEGER NOT NULL
    )
  `)

  _db.run(`
    CREATE TABLE IF NOT EXISTS tool_patterns (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      frequency INTEGER NOT NULL DEFAULT 1,
      avg_duration REAL,
      meta_tool_id TEXT,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  _db.run(`
    CREATE TABLE IF NOT EXISTS experience_patterns (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.5,
      use_count INTEGER NOT NULL DEFAULT 0,
      project_dir TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  _db.run(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      trajectory_id TEXT REFERENCES trajectories(id),
      failure_type TEXT NOT NULL,
      failure_context TEXT NOT NULL,
      insight TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)

  // Indexes
  _db.run("CREATE INDEX IF NOT EXISTS idx_trajectory_steps_trajectory ON trajectory_steps(trajectory_id)")
  _db.run("CREATE INDEX IF NOT EXISTS idx_trajectory_steps_tool ON trajectory_steps(tool_name)")
  _db.run("CREATE INDEX IF NOT EXISTS idx_trajectories_project ON trajectories(project_dir)")
  _db.run("CREATE INDEX IF NOT EXISTS idx_trajectories_session ON trajectories(session_id)")
  _db.run("CREATE INDEX IF NOT EXISTS idx_experience_patterns_type ON experience_patterns(type)")
  _db.run("CREATE INDEX IF NOT EXISTS idx_lessons_failure_type ON lessons(failure_type)")

  return _db
}
