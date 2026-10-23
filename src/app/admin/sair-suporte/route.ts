import { NextResponse, type NextRequest } from "next/server";
import { SUPPORT_COOKIE } from "@/server/web";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/admin", req.url));
  res.cookies.delete(SUPPORT_COOKIE);
  return res;
}
