import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth/service";
import { exportMyData } from "@/domains/lgpd/service";
import { SESSION_COOKIE } from "@/server/web";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return new NextResponse("Não autenticado", { status: 401 });
  const data = await exportMyData(user);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="meus-dados.json"', "Cache-Control": "no-store" },
  });
}
