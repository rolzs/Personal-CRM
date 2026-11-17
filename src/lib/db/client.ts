// Database access. In the app this is SQLite through tauri-plugin-sql
// (file: ~/Library/Application Support/lv.personalcrm.desktop/crm.db, schema
// migrations run in Rust). In a plain browser during development an in-memory
// sql.js database with the same schema is used so the UI works without Tauri.

import { isTauri } from "../native";

export interface Db {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

export const DB_URL = "sqlite:crm.db";

export async function openDb(): Promise<Db> {
  if (isTauri) {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    const db = await Database.load(DB_URL);
    return {
      select: (sql, params = []) => db.select(sql, params),
      execute: async (sql, params = []) => {
        await db.execute(sql, params);
      },
      close: async () => {
        await db.close();
      },
    };
  }

  if (import.meta.env.DEV) {
    // Dev-only fallback; tree-shaken out of production builds.
    const [{ default: initSqlJs }, { default: wasmUrl }, { default: schema }, { default: schema2 }] = await Promise.all([
      import("sql.js"),
      import("sql.js/dist/sql-wasm.wasm?url"),
      import("../../../src-tauri/migrations/001_init.sql?raw"),
      import("../../../src-tauri/migrations/002_calendar_links.sql?raw"),
    ]);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const db = new SQL.Database();
    db.exec(schema);
    db.exec(schema2);
    return {
      select: async <T>(sql: string, params: unknown[] = []) => {
        const stmt = db.prepare(sql);
        stmt.bind(params as never);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        stmt.free();
        return rows;
      },
      execute: async (sql, params = []) => {
        db.run(sql, params as never);
      },
      close: async () => db.close(),
    };
  }

  throw new Error("No database available outside the Tauri shell");
}
