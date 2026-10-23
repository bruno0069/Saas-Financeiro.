"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listMyCompanies } from "@/domains/tenants/service";
import { requireUser, setTenantCookie, SUPPORT_COOKIE } from "@/server/web";

export async function selectCompanyAction(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get("tenantId") ?? "");
  // Só aceita empresas das quais o usuário é membro (o banco também valida em cada requisição).
  const companies = await listMyCompanies(user.id);
  if (!companies.some((c) => c.id === id)) redirect("/empresas");
  (await cookies()).delete(SUPPORT_COOKIE);
  await setTenantCookie(id);
  redirect("/app");
}
