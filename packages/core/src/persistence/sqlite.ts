import { createRequire } from "node:module";

export interface SqliteRunResult {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface DatabaseConstructor {
  new (path: string): SqliteDatabase;
}

const runtimeRequire = createRequire(import.meta.url);

/**
 * Creates the built-in synchronous SQLite implementation for the active runtime.
 * Node 24+ provides node:sqlite; Bun provides the API-compatible bun:sqlite.
 */
export function createSqliteDatabase(databasePath: string): SqliteDatabase {
  const isBun = Boolean((process.versions as Record<string, string | undefined>).bun);

  if (isBun) {
    const module = runtimeRequire("bun:sqlite") as { Database: DatabaseConstructor };
    return new module.Database(databasePath);
  }

  const module = runtimeRequire("node:sqlite") as { DatabaseSync: DatabaseConstructor };
  return new module.DatabaseSync(databasePath);
}
