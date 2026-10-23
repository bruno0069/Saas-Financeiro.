import { ownerPool } from "../db/pool";
import { AppError } from "@/lib/errors";

/**
 * Limitação de requisições em janela fixa, persistida no banco (funciona com várias instâncias).
 * Lança erro quando o limite é excedido.
 */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<void> {
  const r = await ownerPool().query(
    `insert into saas.rate_limits (key, window_start, hits)
       values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set hits = saas.rate_limits.hits + 1
     returning hits`,
    [key, windowSeconds],
  );
  if (r.rows[0].hits > max) {
    throw new AppError("Muitas tentativas. Aguarde alguns minutos e tente novamente.", "rate_limited", 429);
  }
}

export async function purgeRateLimits(): Promise<number> {
  const r = await ownerPool().query("delete from saas.rate_limits where window_start < now() - interval '1 day'");
  return r.rowCount ?? 0;
}
