import type { Db } from "@/server/db/pool";

export type AuditEntry = {
  tenantId: string | null;
  actorUserId: string | null;
  actorType: "user" | "support" | "platform_admin" | "system" | "provider";
  action: string;
  entityType?: string;
  entityId?: string | null;
  result?: "success" | "denied" | "error";
  reason?: string | null;
  /** Somente identificadores e informações não sensíveis. */
  metadata?: Record<string, unknown>;
  requestId?: string | null;
};

export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    `insert into saas.audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, result, reason, metadata, request_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [e.tenantId, e.actorUserId, e.actorType, e.action, e.entityType ?? null, e.entityId ?? null,
     e.result ?? "success", e.reason ?? null, JSON.stringify(e.metadata ?? {}), e.requestId ?? null],
  );
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "Login",
  "auth.login_failed": "Falha de login",
  "auth.signup": "Cadastro de usuário",
  "auth.password_reset": "Redefinição de senha",
  "tenant.create": "Criação da empresa",
  "tenant.update": "Alteração da empresa",
  "account.create": "Conta financeira criada",
  "account.update": "Conta financeira alterada",
  "title.create": "Título lançado",
  "title.update": "Título alterado",
  "title.cancel": "Título cancelado",
  "title.settle": "Baixa (pagamento/recebimento)",
  "movement.reverse": "Estorno de movimentação",
  "movement.adjust": "Ajuste de saldo",
  "transfer.create": "Transferência entre contas",
  "transfer.reverse": "Estorno de transferência",
  "membership.update": "Permissões de usuário alteradas",
  "membership.remove": "Usuário removido",
  "ownership.transfer": "Propriedade transferida",
  "invite.create": "Convite enviado",
  "invite.accept": "Convite aceito",
  "invite.revoke": "Convite revogado",
  "module.toggle": "Módulo habilitado/desabilitado",
  "support.grant": "Acesso de suporte concedido",
  "support.revoke": "Acesso de suporte revogado",
  "support.enter": "Suporte acessou a empresa",
  "subscription.change": "Assinatura alterada",
  "export.csv": "Exportação CSV",
  "lgpd.export": "Exportação de dados (LGPD)",
  "padaria.closing.create": "Fechamento de caixa",
  "padaria.closing.reverse": "Estorno de fechamento de caixa",
  "padaria.card.settle": "Repasse de cartão confirmado",
  "access.denied": "Acesso negado",
};
