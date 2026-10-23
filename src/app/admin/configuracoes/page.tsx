import { Card, PageHeader } from "@/components/ui";
import { getSettings, runAsAdmin } from "@/domains/admin/service";
import { MODULES } from "@/domains/modules/registry";
import { sessionToken } from "@/server/web";
import { SettingsForm } from "../forms";

export const metadata = { title: "Configurações globais" };

export default async function AdminSettings() {
  const { s, role } = await runAsAdmin(await sessionToken(), null, async (a) => ({ s: await getSettings(a), role: a.role }));
  return (
    <>
      <PageHeader title="Configurações globais" />
      <Card>{role === "superadmin" ? <SettingsForm s={s} modules={Object.values(MODULES).map((m) => ({ key: m.key, name: m.name }))} /> : <pre className="text-sm">{JSON.stringify(s, null, 2)}</pre>}</Card>
    </>
  );
}
