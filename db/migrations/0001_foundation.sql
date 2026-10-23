-- 0001 — Fundação: schema, papel da aplicação, usuários, sessões e funções de contexto (RLS).
--
-- Modelo de acesso ao banco:
--   * O papel que executa as migrações é o DONO das tabelas ("owner"). Donos ignoram RLS
--     (não usamos FORCE ROW LEVEL SECURITY). Ele é usado apenas pelo servidor em operações
--     de sistema explicitamente controladas (cadastro, webhooks, jobs) — nunca no navegador.
--   * O papel "saas_app" é usado pelas requisições dos usuários. Ele NÃO é dono das tabelas,
--     não tem BYPASSRLS e só enxerga linhas permitidas pelas políticas abaixo.
--   * A identidade do usuário é derivada do token de sessão dentro do banco
--     (app.session_token -> sessions.token_hash). Um identificador de usuário ou de empresa
--     enviado pelo navegador nunca é suficiente para obter acesso.

create schema if not exists saas;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'saas_app') then
    create role saas_app nologin nobypassrls;
  end if;
end $$;

grant usage on schema saas to saas_app;

create or replace function saas.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------
-- Usuários e autenticação
-- ---------------------------------------------------------------------------------------
create table saas.users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null check (email = lower(email) and position('@' in email) > 1),
  name              text not null check (length(name) between 1 and 120),
  password_hash     text not null,
  email_verified_at timestamptz,
  status            text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create unique index users_email_key on saas.users (email);
create trigger users_touch before update on saas.users for each row execute function saas.touch_updated_at();

create table saas.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references saas.users (id) on delete cascade,
  token_hash   bytea not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  user_agent   text
);
create index sessions_user_idx on saas.sessions (user_id);

create table saas.auth_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references saas.users (id) on delete cascade,
  purpose    text not null check (purpose in ('verify_email', 'reset_password')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table saas.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------------------
-- Plataforma (administração do SaaS)
-- ---------------------------------------------------------------------------------------
create table saas.platform_admins (
  user_id    uuid primary key references saas.users (id),
  role       text not null check (role in ('superadmin', 'support', 'billing')),
  created_at timestamptz not null default now()
);

create table saas.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references saas.users (id)
);

create table saas.ops_events (
  id         uuid primary key default gen_random_uuid(),
  level      text not null check (level in ('info', 'warn', 'error')),
  source     text not null,
  message    text not null,
  context    jsonb not null default '{}',
  tenant_id  uuid,
  request_id text,
  created_at timestamptz not null default now()
);
create index ops_events_created_idx on saas.ops_events (created_at desc);

create table saas.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  stats       jsonb not null default '{}',
  error       text
);
create index job_runs_job_idx on saas.job_runs (job, started_at desc);

-- ---------------------------------------------------------------------------------------
-- Funções de identidade usadas pelas políticas RLS
-- ---------------------------------------------------------------------------------------
create or replace function saas.current_user_id() returns uuid
language sql stable security definer set search_path = saas, pg_temp as $$
  select s.user_id
    from saas.sessions s
    join saas.users u on u.id = s.user_id
   where s.token_hash = sha256(convert_to(nullif(current_setting('app.session_token', true), ''), 'UTF8'))
     and s.revoked_at is null
     and s.expires_at > now()
     and u.status = 'active'
$$;

create or replace function saas.platform_admin_role() returns text
language sql stable security definer set search_path = saas, pg_temp as $$
  select role from saas.platform_admins where user_id = saas.current_user_id()
$$;

create or replace function saas.is_platform_admin(required text default null) returns boolean
language sql stable security definer set search_path = saas, pg_temp as $$
  select exists (
    select 1 from saas.platform_admins
     where user_id = saas.current_user_id()
       and (required is null or role = required or role = 'superadmin')
  )
$$;

-- Lê o tenant solicitado de forma segura (valor inválido => null, nunca erro).
create or replace function saas.requested_tenant_id() returns uuid
language sql stable as $$
  select case
           when current_setting('app.tenant_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then current_setting('app.tenant_id', true)::uuid
         end
$$;

grant select (id, email, name, email_verified_at, status, created_at) on saas.users to saas_app;
grant update (name) on saas.users to saas_app;
grant select on saas.platform_settings to saas_app;
grant insert, update on saas.platform_settings to saas_app;
grant select on saas.platform_admins, saas.ops_events, saas.job_runs to saas_app;

alter table saas.users enable row level security;
alter table saas.sessions enable row level security;
alter table saas.auth_tokens enable row level security;
alter table saas.rate_limits enable row level security;
alter table saas.platform_admins enable row level security;
alter table saas.platform_settings enable row level security;
alter table saas.ops_events enable row level security;
alter table saas.job_runs enable row level security;

create policy platform_admins_select on saas.platform_admins for select to saas_app
  using (user_id = (select saas.current_user_id()) or (select saas.is_platform_admin()));
create policy platform_settings_select on saas.platform_settings for select to saas_app
  using ((select saas.current_user_id()) is not null);
create policy platform_settings_insert on saas.platform_settings for insert to saas_app
  with check ((select saas.is_platform_admin('superadmin')));
create policy platform_settings_update on saas.platform_settings for update to saas_app
  using ((select saas.is_platform_admin('superadmin')))
  with check ((select saas.is_platform_admin('superadmin')));
create policy ops_events_select on saas.ops_events for select to saas_app
  using ((select saas.is_platform_admin()));
create policy job_runs_select on saas.job_runs for select to saas_app
  using ((select saas.is_platform_admin()));
-- sessions, auth_tokens e rate_limits: sem políticas e sem GRANT => inacessíveis ao papel da aplicação.
