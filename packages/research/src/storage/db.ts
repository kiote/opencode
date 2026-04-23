import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { sql } from "drizzle-orm"
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import path from "path"
import fs from "fs"

// --- Schema ---

export const trajectories = sqliteTable("trajectories", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  projectDir: text("project_dir").notNull(),
  taskDescription: text("task_description"),
  status: text("status").notNull().default("running"), // running | completed | failed
  totalCost: real("total_cost").default(0),
  totalSteps: integer("total_steps").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
})

export const trajectorySteps = sqliteTable("trajectory_steps", {
  id: text("id").primaryKey(),
  trajectoryId: text("trajectory_id").notNull().references(() => trajectories.id),
  stepIndex: integer("step_index").notNull(),
  toolName: text("tool_name").notNull(),
  toolInput: text("tool_input").notNull(), // JSON
  toolOutput: text("tool_output"),         // JSON (nullable — pending)
  duration: integer("duration"),           // ms
  branchScore: real("branch_score"),       // 0-1, significance for replay branching
  snapshotHash: text("snapshot_hash"),     // OpenCode snapshot reference
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

export const toolPatterns = sqliteTable("tool_patterns", {
  id: text("id").primaryKey(),
  pattern: text("pattern").notNull(),      // JSON array of tool names
  frequency: integer("frequency").notNull().default(1),
  avgDuration: real("avg_duration"),
  metaToolId: text("meta_tool_id"),        // if bundled into a meta-tool
  lastSeen: integer("last_seen", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

export const experiencePatterns = sqliteTable("experience_patterns", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),            // "subagent" | "skill"
  name: text("name").notNull(),
  description: text("description").notNull(),
  content: text("content").notNull(),      // JSON: subagent template or skill snippet
  score: real("score").notNull().default(0.5),
  useCount: integer("use_count").notNull().default(0),
  projectDir: text("project_dir"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
})

export const lessons = sqliteTable("lessons", {
  id: text("id").primaryKey(),
  trajectoryId: text("trajectory_id").references(() => trajectories.id),
  failureType: text("failure_type").notNull(),
  failureContext: text("failure_context").notNull(), // JSON
  insight: text("insight").notNull(),
  useCount: integer("use_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

// --- Database initialization ---

let _db: ReturnType<typeof drizzle> | null = null

export function getDb(dataDir?: string): ReturnType<typeof drizzle> {
  if (_db) return _db

  const dir = dataDir ?? path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? ".",
    ".opencode"
  )
  fs.mkdirSync(dir, { recursive: true })

  const dbPath = path.join(dir, "research.db")
  const sqlite = new Database(dbPath)

  // WAL mode for concurrent reads
  sqlite.pragma("journal_mode = WAL")

  // Create tables
  sqlite.exec(`
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
    );

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
    );

    CREATE TABLE IF NOT EXISTS tool_patterns (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      frequency INTEGER NOT NULL DEFAULT 1,
      avg_duration REAL,
      meta_tool_id TEXT,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

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
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      trajectory_id TEXT REFERENCES trajectories(id),
      failure_type TEXT NOT NULL,
      failure_context TEXT NOT NULL,
      insight TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trajectory_steps_trajectory
      ON trajectory_steps(trajectory_id);
    CREATE INDEX IF NOT EXISTS idx_trajectory_steps_tool
      ON trajectory_steps(tool_name);
    CREATE INDEX IF NOT EXISTS idx_trajectories_project
      ON trajectories(project_dir);
    CREATE INDEX IF NOT EXISTS idx_trajectories_session
      ON trajectories(session_id);
    CREATE INDEX IF NOT EXISTS idx_experience_patterns_type
      ON experience_patterns(type);
    CREATE INDEX IF NOT EXISTS idx_lessons_failure_type
      ON lessons(failure_type);
  `)

  _db = drizzle(sqlite)
  return _db
}
