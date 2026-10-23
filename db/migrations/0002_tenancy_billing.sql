-- 0002 — Empresas (tenants), vínculos, convites, planos, assinaturas, cobranças e auditoria.

-- ---------------------------------------------------------------------------------------
-- Catálogo comercial (planos). Preços e limites são dados, não código.
-- ---------------------------------------------------------------------------------------
create table saas.plans (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  name        text not null,
  description text not null default '',
  is_active   boolean not null default true,
  is_public   boolean not null default true,
  is_default  boolean not null default false,
  trial_days  integer not null default 14 check (trial_days between 0 and 90),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index plans_single_default on saas.plans ((true)) where is_default;
create trigger plans_touch before update on saas.plans for each row execute function saas.touch_updated_at();

create table saas.plan_prices (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references saas.plans (id) on delete cascade,
  billing_interval text not null check (billing_interval in ('monthly', 'yearly')),
  price_cents      bigint not null check (price_cents >= 0),
  currency         text not null default 'BRL',
  is_active        boolean not null default true,
  unique (plan_id, billing_interval)
);

create table saas.plan_features (
  plan_id     uuid not null references saas.plans (id) on delete cascade,
  feature_key text not null,
  primary key (plan_id, feature_key)
);

create table saas.plan_limits (
  plan_id     uuid not null references saas.plans (id) on delete cascade,
  limit_key   text not null,
  limit_value integer check (limit_value is null or limit_value >= 0), -- null = ilimitado
  primary key (plan_id, limit_key)
);

-- ---------------------------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------------------------
create table saas.tenants (
  id                      uuid primary key default gen_random_uuid(),
  trade_name              text not null check (length(trade_name) between 2 and 120),
  legal_name              text,
  tax_id                  text check (tax_id is null or tax_id ~ '^[0-9]{11}$|^[0-9]{14}$'),
  segment                 text not null,
  currency                text not null default 'BRL',
  locale                  text not null default 'pt-BR',
  timezone                text not null default 'America/Sao_Paulo',
  notify_due_days         integer not null default 3 check (notify_due_days between 0 and 30),
  notify_email            boolean not null default true,
  preferred_kpis          text[] not null default '{}',
  status                  text not null default 'active' check (status in ('active', 'closed')),
  onboarding_steps        jsonb not null default '{}',
  onboarding_completed_at timestamptz,
  created_by              uuid references saas.users (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  closed_at               timestamptz
);
create trigger tenants_touch before update on saas.tenants for each row execute function saas.touch_updated_at();

create table saas.memberships (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references saas.tenants (id),
  user_id             uuid not null references saas.users (id),
  role                text not null check (role in ('owner', 'manager', 'finance', 'operator')),
  extra_permissions   text[] not null default '{}',
  revoked_permissions text[] not null default '{}',
  -- Permissões efetivas, calculadas pelo servidor a partir do papel + ajustes.
  permissions         text[] not null default '{}',
  status              text not null default 'active' check (status in ('active', 'removed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  removed_at          timestamptz,
  removed_by          uuid references saas.users (id),
  unique (tenant_id, user_id)
);
create unique index memberships_one_owner on saas.memberships (tenant_id) where role = 'owner' and status = 'active';
create index memberships_user_idx on saas.memberships (user_id) where status = 'active';
create trigger memberships_touch before update on saas.memberships for each row execute function saas.touch_updated_at();

create table saas.invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references saas.tenants (id),
  email       text not null check (email = lower(email)),
  role        text not null check (role in ('manager', 'finance', 'operator')),
  token_hash  bytea not null unique,
  invited_by  uuid not null references saas.users (id),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references saas.users (id),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index invitations_pending_email on saas.invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;

-- Acesso de suporte: concedido pelo proprietário, temporário, somente leitura e auditado.
create table saas.support_access_grants (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references saas.tenants (id),
  granted_by uuid not null references saas.users (id),
  reason     text not null check (length(reason) >= 10),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index support_grants_tenant_idx on saas.support_access_grants (tenant_id);

-- ---------------------------------------------------------------------------------------
-- Assinaturas e cobrança
-- ---------------------------------------------------------------------------------------
create table saas.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references saas.tenants (id),
  plan_id                  uuid not null references saas.plans (id),
  billing_interval         text not null check (billing_interval in ('monthly', 'yearly')),
  price_cents              bigint not null check (price_cents >= 0),
  currency                 text not null default 'BRL',
  status                   text not null check (status in
                             ('trialing', 'pending_payment', 'active', 'past_due', 'suspended', 'canceled', 'ended')),
  started_at               timestamptz not null default now(),
  trial_ends_at            timestamptz,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  next_billing_at          timestamptz,
  past_due_since           timestamptz,
  canceled_at              timestamptz,
  cancel_reason            text,
  ended_at                 timestamptz,
  provider                 text not null default 'manual',
  provider_customer_id     text,
  provider_subscription_id text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index subscriptions_one_current on saas.subscriptions (tenant_id) where status <> 'ended';
create unique index subscriptions_provider_ref on saas.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;
create trigger subscriptions_touch before update on saas.subscriptions for each row execute function saas.touch_updated_at();

create table saas.subscription_events (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references saas.subscriptions (id),
  tenant_id       uuid not null references saas.tenants (id),
  event_type      text not null,
  from_status     text,
  to_status       text,
  from_plan_id    uuid references saas.plans (id),
  to_plan_id      uuid references saas.plans (id),
  actor_type      text not null check (actor_type in ('user', 'platform_admin', 'system', 'provider')),
  actor_user_id   uuid references saas.users (id),
  reason          text,
  created_at      timestamptz not null default now()
);
create index subscription_events_sub_idx on saas.subscription_events (subscription_id, created_at);

create table saas.invoices (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references saas.tenants (id),
  subscription_id    uuid not null references saas.subscriptions (id),
  amount_cents       bigint not null check (amount_cents >= 0),
  currency           text not null default 'BRL',
  status             text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'canceled', 'refunded')),
  period_start       timestamptz not null,
  period_end         timestamptz not null,
  due_date           date not null,
  issued_at          timestamptz not null default now(),
  paid_at            timestamptz,
  paid_amount_cents  bigint,
  payment_method     text,
  provider           text not null default 'manual',
  provider_charge_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (subscription_id, period_start)
);
create unique index invoices_provider_charge on saas.invoices (provider, provider_charge_id) where provider_charge_id is not null;
create trigger invoices_touch before update on saas.invoices for each row execute function saas.touch_updated_at();

-- Eventos recebidos de provedores (webhooks). A unicidade garante idempotência.
create table saas.billing_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,
  payload           jsonb not null,
  status            text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error             text,
  tenant_id         uuid references saas.tenants (id),
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, provider_event_id)
);

create table saas.tenant_feature_overrides (
  tenant_id   uuid not null references saas.tenants (id),
  feature_key text not null,
  enabled     boolean not null,
  reason      text not null,
  created_by  uuid references saas.users (id),
  created_at  timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

create table saas.tenant_limit_overrides (
  tenant_id   uuid not null references saas.tenants (id),
  limit_key   text not null,
  limit_value integer check (limit_value is null or limit_value >= 0),
  reason      text not null,
  created_by  uuid references saas.users (id),
  created_at  timestamptz not null default now(),
  primary key (tenant_id, limit_key)
);

create table saas.tenant_modules (
  tenant_id  uuid not null references saas.tenants (id),
  module_key text not null,
  enabled    boolean not null default true,
  updated_by uuid references saas.users (id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module_key)
);

-- ---------------------------------------------------------------------------------------
-- Auditoria (somente inclusão)
-- ---------------------------------------------------------------------------------------
create table saas.audit_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references saas.tenants (id),
  actor_user_id uuid references saas.users (id),
  actor_type    text not null check (actor_type in ('user', 'support', 'platform_admin', 'system', 'provider')),
  action        text not null,
  entity_type   text,
  entity_id     text,
  result        text not null default 'success' check (result in ('success', 'denied', 'error')),
  reason        text,
  metadata      jsonb not null default '{}',
  request_id    text,
  created_at    timestamptz not null default now()
);
create index audit_tenant_idx on saas.audit_log (tenant_id, created_at desc);
create index audit_platform_idx on saas.audit_log (created_at desc) where tenant_id is null;

create or replace function saas.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Registros de % são imutáveis (operação % bloqueada)', tg_table_name, tg_op
    using errcode = 'P0001';
end $$;

create trigger audit_log_immutable before update or delete on saas.audit_log
  for each row execute function saas.forbid_mutation();

-- ---------------------------------------------------------------------------------------
-- Funções de contexto do tenant
-- ---------------------------------------------------------------------------------------

-- Vínculo ativo do usuário atual com o tenant solicitado (null se não houver).
create or replace function saas.current_membership_role() returns text
language sql stable security definer set search_path = saas, pg_temp as $$
  select m.role from saas.memberships m
   where m.tenant_id = saas.requested_tenant_id()
     and m.user_id = saas.current_user_id()
     and m.status = 'active'
$$;

-- Acesso de suporte só vale com app.support_mode = 'on' e concessão vigente do proprietário.
create or replace function saas.support_access_active() returns boolean
language sql stable security definer set search_path = saas, pg_temp as $$
  select current_setting('app.support_mode', true) = 'on'
     and saas.is_platform_admin('support')
     and exists (select 1 from saas.support_access_grants g
                  where g.tenant_id = saas.requested_tenant_id()
                    and g.revoked_at is null and g.expires_at > now())
$$;

-- Tenant efetivamente autorizado para esta transação. Base de todas as políticas de isolamento.
create or replace function saas.current_tenant_id() returns uuid
language sql stable security definer set search_path = saas, pg_temp as $$
  select case
           when saas.requested_tenant_id() is null then null
           when current_setting('app.support_mode', true) = 'on' then
             case when saas.support_access_active() then saas.requested_tenant_id() end
           when saas.current_membership_role() is not null then saas.requested_tenant_id()
         end
$$;

-- Nível de acesso derivado da assinatura: 'full' ou 'read_only'. Dados nunca são apagados por atraso.
create or replace function saas.tenant_access_level(p_tenant uuid) returns text
language sql stable security definer set search_path = saas, pg_temp as $$
  select coalesce((
    select case
             when t.status = 'closed' then 'read_only'
             when s.status in ('trialing', 'pending_payment', 'active', 'past_due') then 'full'
             when s.status = 'canceled' and s.current_period_end > now() then 'full'
             else 'read_only'
           end
      from saas.tenants t
      left join saas.subscriptions s on s.tenant_id = t.id and s.status <> 'ended'
     where t.id = p_tenant
  ), 'read_only')
$$;

-- Pode gravar dados de negócio: membro real (não suporte) e assinatura com acesso pleno.
create or replace function saas.can_write() returns boolean
language sql stable security definer set search_path = saas, pg_temp as $$
  select coalesce(current_setting('app.support_mode', true), '') <> 'on'
     and saas.current_membership_role() is not null
     and saas.tenant_access_level(saas.requested_tenant_id()) = 'full'
$$;

create or replace function saas.has_perm(p text) returns boolean
language sql stable security definer set search_path = saas, pg_temp as $$
  select exists (
    select 1 from saas.memberships m
     where m.tenant_id = saas.requested_tenant_id()
       and m.user_id = saas.current_user_id()
       and m.status = 'active'
       and coalesce(current_setting('app.support_mode', true), '') <> 'on'
       and (m.role = 'owner' or p = any (m.permissions))
  )
$$;

-- Resumo da assinatura do tenant atual, visível a qualquer membro (sem dados de cobrança).
create or replace function saas.current_subscription_summary()
returns table (subscription_id uuid, plan_id uuid, plan_code text, plan_name text, status text,
               billing_interval text, trial_ends_at timestamptz, current_period_end timestamptz,
               access_level text)
language sql stable security definer set search_path = saas, pg_temp as $$
  select s.id, p.id, p.code, p.name, s.status, s.billing_interval, s.trial_ends_at, s.current_period_end,
         saas.tenant_access_level(s.tenant_id)
    from saas.subscriptions s
    join saas.plans p on p.id = s.plan_id
   where s.tenant_id = saas.current_tenant_id() and s.status <> 'ended'
$$;

-- Proteção contra escalonamento de privilégios em vínculos.
create or replace function saas.memberships_guard() returns trigger
language plpgsql security definer set search_path = saas, pg_temp as $$
declare
  actor uuid := saas.current_user_id();
  actor_role text;
  actor_perms text[];
begin
  -- Operações do sistema (dono das tabelas, sem sessão) passam; validação feita no serviço.
  if actor is null then
    return new;
  end if;
  select role, permissions into actor_role, actor_perms
    from saas.memberships where tenant_id = new.tenant_id and user_id = actor and status = 'active';
  if new.user_id = actor then
    raise exception 'Não é permitido alterar o próprio vínculo' using errcode = '42501';
  end if;
  if (new.role = 'owner') is distinct from (old.role = 'owner') and actor_role is distinct from 'owner' then
    raise exception 'Somente o proprietário pode transferir a propriedade' using errcode = '42501';
  end if;
  if old.role = 'owner' and actor_role is distinct from 'owner' then
    raise exception 'O proprietário não pode ser alterado por outro usuário' using errcode = '42501';
  end if;
  if actor_role is distinct from 'owner' and not (new.permissions <@ actor_perms) then
    raise exception 'Não é permitido conceder permissões que você não possui' using errcode = '42501';
  end if;
  if new.tenant_id <> old.tenant_id or new.user_id <> old.user_id then
    raise exception 'Vínculo não pode mudar de empresa ou usuário' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger memberships_guard before update on saas.memberships
  for each row execute function saas.memberships_guard();

-- ---------------------------------------------------------------------------------------
-- Permissões e políticas RLS
-- ---------------------------------------------------------------------------------------
grant select on saas.plans, saas.plan_prices, saas.plan_features, saas.plan_limits to saas_app;
grant insert, update on saas.plans, saas.plan_prices, saas.plan_limits to saas_app;
grant insert, delete on saas.plan_features to saas_app;
grant delete on saas.plan_limits to saas_app;
grant select, update on saas.tenants to saas_app;
grant select, update on saas.memberships to saas_app;
grant select, insert, update on saas.invitations to saas_app;
grant select, insert, update on saas.support_access_grants to saas_app;
grant select on saas.subscriptions, saas.subscription_events, saas.invoices, saas.billing_events to saas_app;
grant select, insert, update, delete on saas.tenant_feature_overrides, saas.tenant_limit_overrides to saas_app;
grant select, insert, update on saas.tenant_modules to saas_app;
grant select, insert on saas.audit_log to saas_app;
grant execute on all functions in schema saas to saas_app;

alter table saas.plans enable row level security;
alter table saas.plan_prices enable row level security;
alter table saas.plan_features enable row level security;
alter table saas.plan_limits enable row level security;
alter table saas.tenants enable row level security;
alter table saas.memberships enable row level security;
alter table saas.invitations enable row level security;
alter table saas.support_access_grants enable row level security;
alter table saas.subscriptions enable row level security;
alter table saas.subscription_events enable row level security;
alter table saas.invoices enable row level security;
alter table saas.billing_events enable row level security;
alter table saas.tenant_feature_overrides enable row level security;
alter table saas.tenant_limit_overrides enable row level security;
alter table saas.tenant_modules enable row level security;
alter table saas.audit_log enable row level security;

-- Catálogo de planos: leitura para qualquer sessão válida; escrita só superadmin.
create policy plans_read on saas.plans for select to saas_app
  using ((is_active and is_public) or (select saas.current_user_id()) is not null);
create policy plans_write on saas.plans for insert to saas_app with check ((select saas.is_platform_admin('superadmin')));
create policy plans_update on saas.plans for update to saas_app
  using ((select saas.is_platform_admin('superadmin'))) with check ((select saas.is_platform_admin('superadmin')));
create policy plan_prices_read on saas.plan_prices for select to saas_app using (true);
create policy plan_prices_insert on saas.plan_prices for insert to saas_app with check ((select saas.is_platform_admin('superadmin')));
create policy plan_prices_update on saas.plan_prices for update to saas_app
  using ((select saas.is_platform_admin('superadmin'))) with check ((select saas.is_platform_admin('superadmin')));
create policy plan_features_read on saas.plan_features for select to saas_app using (true);
create policy plan_features_insert on saas.plan_features for insert to saas_app with check ((select saas.is_platform_admin('superadmin')));
create policy plan_features_delete on saas.plan_features for delete to saas_app using ((select saas.is_platform_admin('superadmin')));
create policy plan_limits_read on saas.plan_limits for select to saas_app using (true);
create policy plan_limits_insert on saas.plan_limits for insert to saas_app with check ((select saas.is_platform_admin('superadmin')));
create policy plan_limits_update on saas.plan_limits for update to saas_app
  using ((select saas.is_platform_admin('superadmin'))) with check ((select saas.is_platform_admin('superadmin')));
create policy plan_limits_delete on saas.plan_limits for delete to saas_app using ((select saas.is_platform_admin('superadmin')));

-- Empresas: o tenant atual, as empresas das quais o usuário é membro, ou administradores da plataforma
-- (que veem apenas o cadastro da empresa, nunca os dados financeiros).
create policy tenants_select on saas.tenants for select to saas_app using (
  id = (select saas.current_tenant_id())
  or id in (select m.tenant_id from saas.memberships m
             where m.user_id = (select saas.current_user_id()) and m.status = 'active')
  or (select saas.is_platform_admin())
);
create policy tenants_update on saas.tenants for update to saas_app
  using (id = (select saas.current_tenant_id()) and (select saas.can_write()) and (select saas.has_perm('settings.manage')))
  with check (id = (select saas.current_tenant_id()));

create policy memberships_select on saas.memberships for select to saas_app using (
  tenant_id = (select saas.current_tenant_id())
  or user_id = (select saas.current_user_id())
  or (select saas.is_platform_admin())
);
create policy memberships_update on saas.memberships for update to saas_app
  using (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write()) and (select saas.has_perm('users.manage')))
  with check (tenant_id = (select saas.current_tenant_id()));

-- Usuários: o próprio usuário, colegas do tenant atual e administradores da plataforma.
create policy users_select on saas.users for select to saas_app using (
  id = (select saas.current_user_id())
  or id in (select m.user_id from saas.memberships m where m.tenant_id = (select saas.current_tenant_id()))
  or (select saas.is_platform_admin())
);
create policy users_update on saas.users for update to saas_app
  using (id = (select saas.current_user_id())) with check (id = (select saas.current_user_id()));

create policy invitations_select on saas.invitations for select to saas_app
  using (tenant_id = (select saas.current_tenant_id()) and (select saas.has_perm('users.manage')));
create policy invitations_insert on saas.invitations for insert to saas_app
  with check (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write())
              and (select saas.has_perm('users.manage')) and invited_by = (select saas.current_user_id()));
create policy invitations_update on saas.invitations for update to saas_app
  using (tenant_id = (select saas.current_tenant_id()) and (select saas.has_perm('users.manage')))
  with check (tenant_id = (select saas.current_tenant_id()));

create policy support_grants_select on saas.support_access_grants for select to saas_app using (
  (tenant_id = (select saas.current_tenant_id()) and (select saas.has_perm('settings.manage')))
  or (select saas.is_platform_admin('support'))
);
create policy support_grants_insert on saas.support_access_grants for insert to saas_app
  with check (tenant_id = (select saas.current_tenant_id()) and (select saas.current_membership_role()) = 'owner'
              and granted_by = (select saas.current_user_id()));
create policy support_grants_update on saas.support_access_grants for update to saas_app
  using (tenant_id = (select saas.current_tenant_id()) and (select saas.current_membership_role()) = 'owner')
  with check (tenant_id = (select saas.current_tenant_id()));

-- Assinaturas e faturas: leitura para quem gerencia a cobrança do tenant ou para a plataforma.
-- Escritas acontecem exclusivamente pelo serviço de assinaturas (contexto de sistema).
create policy subscriptions_select on saas.subscriptions for select to saas_app using (
  (tenant_id = (select saas.current_tenant_id()) and (select saas.has_perm('billing.manage')))
  or (select saas.is_platform_admin())
);
create policy subscription_events_select on saas.subscription_events for select to saas_app using (
  (tenant_id = (select saas.current_tenant_id()) and (select saas.has_perm('billing.manage')))
  or (select saas.is_platform_admin())
);
create policy invoices_select on saas.invoices for select to saas_app using (
  (tenant_id = (select saas.current_tenant_id()) and (select saas.has_perm('billing.manage')))
  or (select saas.is_platform_admin())
);
create policy billing_events_select on saas.billing_events for select to saas_app
  using ((select saas.is_platform_admin()));

create policy feature_overrides_select on saas.tenant_feature_overrides for select to saas_app
  using (tenant_id = (select saas.current_tenant_id()) or (select saas.is_platform_admin()));
create policy feature_overrides_write on saas.tenant_feature_overrides for all to saas_app
  using ((select saas.is_platform_admin('superadmin'))) with check ((select saas.is_platform_admin('superadmin')));
create policy limit_overrides_select on saas.tenant_limit_overrides for select to saas_app
  using (tenant_id = (select saas.current_tenant_id()) or (select saas.is_platform_admin()));
create policy limit_overrides_write on saas.tenant_limit_overrides for all to saas_app
  using ((select saas.is_platform_admin('superadmin'))) with check ((select saas.is_platform_admin('superadmin')));

create policy tenant_modules_select on saas.tenant_modules for select to saas_app
  using (tenant_id = (select saas.current_tenant_id()) or (select saas.is_platform_admin()));
create policy tenant_modules_insert on saas.tenant_modules for insert to saas_app
  with check (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write()) and (select saas.has_perm('settings.manage')));
create policy tenant_modules_update on saas.tenant_modules for update to saas_app
  using (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write()) and (select saas.has_perm('settings.manage')))
  with check (tenant_id = (select saas.current_tenant_id()));

-- Auditoria: inclusão apenas em nome do próprio usuário, no tenant atual (ou escopo de plataforma
-- para administradores). Leitura para quem tem audit.view no tenant ou para a plataforma.
create policy audit_insert on saas.audit_log for insert to saas_app with check (
  actor_user_id = (select saas.current_user_id())
  and (
    tenant_id = (select saas.current_tenant_id())
    or (tenant_id is null and (select saas.is_platform_admin()))
  )
);
create policy audit_select on saas.audit_log for select to saas_app using (
  (tenant_id = (select saas.current_tenant_id()) and (select saas.has_perm('audit.view')))
  or (select saas.is_platform_admin())
);
