"use server";

import { redirect } from "next/navigation";
import { createCompany } from "@/domains/tenants/service";
import { formObject, requireUser, setTenantCookie, toActionError, type ActionState } from "@/server/web";

export async function createCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id: string;
  try {
    id = await createCompany(user, formObject(fd));
  } catch (err) {
    return toActionError(err);
  }
  await setTenantCookie(id);
  redirect("/app?bemvindo=1");
}
