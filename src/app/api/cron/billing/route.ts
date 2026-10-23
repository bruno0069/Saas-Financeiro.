import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/server/auth/crypto";
import { runBillingCycle } from "@/domains/billing/subscriptions";
import { purgeRateLimits } from "@/server/system/rate-limit";

export const dynamic = "force-dynamic";

/** Ciclo de cobrança agendado (ex.: Vercel Cron diário). Exige `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 16 || !safeEqual(got, secret)) return new NextResponse("unauthorized", { status: 401 });
  const stats = await runBillingCycle();
  await purgeRateLimits();
  return NextResponse.json({ ok: true, stats });
}
