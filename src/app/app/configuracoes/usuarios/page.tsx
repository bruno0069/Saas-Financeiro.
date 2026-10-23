import { Disclosure } from "@/components/forms";
import { Alert, Badge, Card } from "@/components/ui";
import { listMembers } from "@/domains/access/members";
import { ALL_PERMISSIONS, OWNER_ONLY, ROLE_LABELS, type Role } from "@/domains/access/permissions";
import { formatDateBR } from "@/lib/dates";
import { withTenantPage } from "@/server/web";
import { InviteForm, MemberEditor, RemoveMember, RevokeInvite, TransferOwnership } from "./forms";

export const metadata = { title: "Usuários" };

export default async function UsersPage() {
  const data = await withTenantPage(async (ctx) => ({
    ...(await listMembers(ctx)),
    me: ctx.user.id,
    isOwner: ctx.role === "owner",
    canInvite: ctx.entitlements.features.has("users.invite"),
    writable: ctx.access === "full" && !ctx.supportMode,
    // Só é possível conceder permissões que o próprio usuário possui; cobrança é exclusiva do proprietário.
    grantable: ALL_PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p) && (ctx.role === "owner" || ctx.permissions.has(p))),
    tenantName: ctx.tenant.trade_name,
  }));
  const active = data.members.filter((m) => m.status === "active");
  return (
    <div className="space-y-6">
      <Card title={`Usuários (${active.length}${data.maxUsers != null ? ` de ${data.maxUsers} no plano` : ""})`}>
        <ul className="divide-y divide-gray-100">
          {data.members.map((m) => (
            <li key={m.id} className={`py-3 ${m.status !== "active" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{m.name} {m.user_id === data.me && <span className="text-xs text-gray-500">(você)</span>}</div>
                  <div className="text-sm text-gray-500">{m.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={m.role === "owner" ? "green" : "blue"}>{ROLE_LABELS[m.role as Role]}</Badge>
                  {m.status !== "active" && <Badge>Removido</Badge>}
                </div>
              </div>
              {m.status === "active" && m.role !== "owner" && m.user_id !== data.me && data.writable && (
                <div className="mt-2 space-y-2">
                  <Disclosure summary="Editar função e permissões"><MemberEditor m={m} grantable={data.grantable} /></Disclosure>
                  <RemoveMember id={m.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {data.writable && (
        <Card title="Convidar usuário">
          {data.canInvite ? <InviteForm /> : <Alert>Convites não estão incluídos no plano atual.</Alert>}
          {data.invites.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Convites pendentes</h3>
              <ul className="divide-y divide-gray-100 text-sm">
                {data.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{i.email} · {ROLE_LABELS[i.role as Role]} · expira em {formatDateBR(new Date(i.expires_at).toISOString())}</span>
                    <RevokeInvite id={i.id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
      {data.isOwner && data.writable && active.length > 1 && (
        <Disclosure summary="Transferir a propriedade da empresa">
          <TransferOwnership members={active.filter((m) => m.role !== "owner").map((m) => ({ id: m.id, name: m.name }))} tenantName={data.tenantName} />
        </Disclosure>
      )}
    </div>
  );
}
