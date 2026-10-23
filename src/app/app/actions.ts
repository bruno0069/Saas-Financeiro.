"use server";

import { revalidatePath } from "next/cache";
import { completeOnboarding } from "@/domains/tenants/service";
import { tenantAction } from "@/server/web";

export async function completeOnboardingAction() {
  await tenantAction((ctx) => completeOnboarding(ctx));
  revalidatePath("/app");
}
