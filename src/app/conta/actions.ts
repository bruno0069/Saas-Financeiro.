"use server";

import { redirect } from "next/navigation";
import { deleteMyAccount } from "@/domains/lgpd/service";
import { clearAuthCookies, requireUser, toActionError, type ActionState } from "@/server/web";

export async function deleteAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await deleteMyAccount(user, String(fd.get("password") ?? ""));
  } catch (err) {
    return toActionError(err);
  }
  await clearAuthCookies();
  redirect("/login");
}
