import pg from "pg";

// bigint (int8) => number com verificação de segurança; date => "YYYY-MM-DD"; numeric => string.
pg.types.setTypeParser(20, (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error("Valor inteiro fora do intervalo seguro");
  return n;
});
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1700, (v: string) => v);

type Pools = { app?: pg.Pool; owner?: pg.Pool };
const g = globalThis as unknown as { __saasPools?: Pools };
const pools: Pools = (g.__saasPools ??= {});

function make(url: string | undefined, name: string): pg.Pool {
  if (!url) throw new Error(`Conexão ${name} não configurada`);
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    options: "-c search_path=saas,public",
    application_name: `saas-financeiro:${name}`,
  });
  pool.on("error", (err) => console.error(JSON.stringify({ level: "error", msg: "db pool error", pool: name, err: err.message })));
  return pool;
}

/** Pool do papel saas_app (sujeito a RLS). Usado em toda requisição de usuário. */
export function appPool(): pg.Pool {
  return (pools.app ??= make(process.env.DATABASE_URL, "app"));
}

/**
 * Pool do dono das tabelas (ignora RLS). Uso restrito a src/server/system/* :
 * cadastro, autenticação, webhooks e jobs. Nunca usar em leitura de dados de tenant a pedido do usuário.
 */
export function ownerPool(): pg.Pool {
  return (pools.owner ??= make(process.env.DATABASE_URL_OWNER, "owner"));
}

export async function closePools() {
  await Promise.all([pools.app?.end(), pools.owner?.end()]);
  pools.app = undefined;
  pools.owner = undefined;
}

export type Db = pg.PoolClient;

export async function rows<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params);
  return (r.rows[0] as T) ?? null;
}

async function inTx<T>(pool: pg.Pool, setup: ((db: Db) => Promise<void>) | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    if (setup) await setup(db);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export type AppTxSettings = { sessionToken: string | null; tenantId?: string | null; supportMode?: boolean };

/** Transação no papel da aplicação com a identidade definida por variáveis locais da transação. */
export function withAppTx<T>(s: AppTxSettings, fn: (db: Db) => Promise<T>): Promise<T> {
  return inTx(
    appPool(),
    async (db) => {
      await db.query(
        "select set_config('app.session_token', $1, true), set_config('app.tenant_id', $2, true), set_config('app.support_mode', $3, true)",
        [s.sessionToken ?? "", s.tenantId ?? "", s.supportMode ? "on" : "off"],
      );
    },
    fn,
  );
}

/** Transação de sistema (dono das tabelas). Ver restrições em ownerPool(). */
export function withSystemTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return inTx(ownerPool(), null, fn);
}
