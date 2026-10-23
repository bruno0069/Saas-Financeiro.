import { NextResponse, type NextRequest } from "next/server";
import { handleAsaasWebhook } from "@/domains/billing/providers";

export const dynamic = "force-dynamic";

/** Webhook do Asaas. Autenticado por token; idempotente por id do evento. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const r = await handleAsaasWebhook(req.headers, body);
  return new NextResponse(r.body, { status: r.status });
}
