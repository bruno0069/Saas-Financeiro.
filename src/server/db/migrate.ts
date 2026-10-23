import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

/**
 * Aplica migrações SQL versionadas em ordem, uma transação por arquivo.
 * Migrações já aplicadas têm o checksum verificado: editar uma migração publicada é erro —
 * mudanças de esquema devem ser feitas sempre por um novo arquivo.
 */
export async function runMigrations(connectionString: string, log: (msg: string) => void = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(727001)");
    await client.query(`
      create table if not exists public.schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`);
    const applied = new Map<string, string>(
      (await client.query("select version, checksum from public.schema_migrations")).rows.map((r) => [r.version, r.checksum]),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    let count = 0;
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const known = applied.get(file);
      if (known) {
        if (known !== checksum) throw new Error(`Migração ${file} foi alterada após ser aplicada.`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public.schema_migrations (version, checksum) values ($1, $2)", [file, checksum]);
        await client.query("commit");
        log(`aplicada: ${file}`);
        count++;
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Falha na migração ${file}: ${(err as Error).message}`);
      }
    }
    log(count ? `${count} migração(ões) aplicada(s).` : "Banco já está atualizado.");
  } finally {
    await client.query("select pg_advisory_unlock(727001)").catch(() => {});
    await client.end();
  }
}
