import { NextResponse } from "next/server";
import { appPool } from "@/server/db/pool";

export const dynamic = "force-dynamic";

/** Verificação de disponibilidade (para monitoramento externo). Não expõe detalhes internos. */
export async function GET() {
  const started = Date.now();
  try {
    await appPool().query("select 1");
    return NextResponse.json({ status: "ok", db: "ok", latency_ms: Date.now() - started });
  } catch {
    return NextResponse.json({ status: "degraded", db: "error" }, { status: 503 });
  }
}
