/**
 * Inicia TUDO no computador local com um único comando (`npm run local`) — pensado para quem só quer
 * abrir o programa para conhecer/testar:
 *   1. sobe um PostgreSQL embutido (baixado automaticamente pelo npm, sem instalar nada à parte);
 *   2. cria o banco, aplica as migrações e cadastra dados FICTÍCIOS de demonstração (só na 1ª vez);
 *   3. compila a aplicação (só na 1ª vez ou após atualização) e a inicia;
 *   4. abre o navegador.
 * Os dados ficam na pasta `.local-db/` (apague-a para recomeçar do zero). Não use para produção.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { runMigrations } from "../src/server/db/migrate";

const ROOT = process.cwd();
const DATA_DIR = process.env.LOCAL_DB_DIR ?? path.join(ROOT, ".local-db");
const DB_PORT = Number(process.env.LOCAL_DB_PORT ?? 54329);
const DB_NAME = "saas_local";
// Senhas fixas apenas para este banco local, que só aceita conexões do próprio computador.
const SUPER_PW = "local-super-senha";
const OWNER_PW = "local-dono-senha";
const APP_PW = "local-app-senha-123";

const log = (msg: string) => console.log(`\n▶ ${msg}`);

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} terminou com código ${code}`))));
  });
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
    process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function main() {
  const firstTime = !existsSync(path.join(DATA_DIR, "PG_VERSION"));
  const db = new EmbeddedPostgres({
    databaseDir: DATA_DIR, user: "postgres", password: SUPER_PW, port: DB_PORT, persistent: true,
    onLog: () => {}, onError: (e) => console.error(String(e)),
  });

  if (firstTime) {
    log("Preparando o banco de dados local (somente na primeira vez)…");
    await db.initialise();
  }
  log("Iniciando o banco de dados…");
  await db.start();

  let app: ChildProcess | null = null;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("Encerrando… (aguarde)");
    app?.kill();
    await db.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    const superUrl = `postgres://postgres:${SUPER_PW}@127.0.0.1:${DB_PORT}/postgres`;
    const c = new pg.Client({ connectionString: superUrl });
    await c.connect();
    if (!(await c.query("select 1 from pg_roles where rolname = 'saas_owner'")).rowCount) {
      await c.query(`create role saas_owner login createdb createrole password '${OWNER_PW}'`);
    }
    if (!(await c.query("select 1 from pg_database where datname = $1", [DB_NAME])).rowCount) {
      await c.query(`create database ${DB_NAME} owner saas_owner`);
    }
    await c.end();

    const ownerUrl = `postgres://saas_owner:${OWNER_PW}@127.0.0.1:${DB_PORT}/${DB_NAME}`;
    const appUrlDb = `postgres://saas_app:${APP_PW}@127.0.0.1:${DB_PORT}/${DB_NAME}`;
    log("Atualizando a estrutura do banco…");
    await runMigrations(ownerUrl, (m) => console.log(`  ${m}`));
    const o = new pg.Client({ connectionString: ownerUrl });
    await o.connect();
    await o.query(`alter role saas_app login password '${APP_PW}'`);
    const hasUsers = (await o.query("select count(*)::int as n from saas.users")).rows[0].n > 0;
    await o.end();

    let port = 3000;
    while (!(await portFree(port))) port++;
    const url = `http://localhost:${port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: appUrlDb,
      DATABASE_URL_OWNER: ownerUrl,
      APP_URL: url,
      MAIL_PROVIDER: "console",
      LOCAL_DEMO: "1",
      // Uso local de demonstração: dispensa a confirmação de e-mail (em produção ela é obrigatória).
      REQUIRE_EMAIL_VERIFICATION: "false",
      CRON_SECRET: "local-cron-secret-0123456789",
      LOG_LEVEL: "warn",
    };

    if (!hasUsers) {
      log("Criando dados fictícios de demonstração…");
      await run(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/seed.ts"], env);
    }

    const nextBin = path.join(ROOT, "node_modules/next/dist/bin/next");
    const stamp = path.join(ROOT, ".next", "local-build-stamp");
    const version = readFileSync(path.join(ROOT, "package.json"), "utf8") + (existsSync(path.join(ROOT, ".git/HEAD")) ? readFileSync(path.join(ROOT, ".git/HEAD"), "utf8") : "");
    if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== version) {
      log("Compilando o programa (leva 1–3 minutos na primeira vez)…");
      await run(process.execPath, [nextBin, "build"], { ...env, NODE_ENV: "production" });
      writeFileSync(stamp, version);
    }

    log("Abrindo o programa…");
    app = spawn(process.execPath, [nextBin, "start", "-p", String(port)], { stdio: ["ignore", "ignore", "inherit"], env });
    app.on("exit", () => { if (!stopping) shutdown(); });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${url}/api/health`)).ok) break;
      } catch { /* ainda iniciando */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    openBrowser(`${url}/login`);
    console.log(`
════════════════════════════════════════════════════════════
  Programa no ar:  ${url}

  Entrar como cliente (Padaria Demonstração):
     e-mail: dono@demo.local      senha: demonstracao123
  Entrar como administrador da plataforma:
     e-mail: admin@demo.local     senha: demonstracao123

  Os e-mails do sistema (convites etc.) aparecem nesta janela.
  Para FECHAR o programa: feche esta janela ou pressione Ctrl+C.
════════════════════════════════════════════════════════════`);
  } catch (err) {
    console.error(`\n✖ Não foi possível iniciar: ${(err as Error).message}`);
    await db.stop().catch(() => {});
    process.exit(1);
  }
}

main();
