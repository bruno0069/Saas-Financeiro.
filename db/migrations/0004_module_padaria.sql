-- 0004 — Módulos do segmento Padaria. Extensões tipadas; não alteram o núcleo financeiro.
--
-- padaria.caixa    — Fechamento de caixa diário por operador/caixa. Efeitos financeiros são
--                    gerados SOMENTE pelos serviços centrais (títulos, baixas, transferências).
-- padaria.producao — Fichas técnicas (custo de insumos), margem por produto e registro de perdas.
--                    Sem efeito financeiro direto: compras de insumos entram como contas a pagar.

create table saas.bakery_settings (
  tenant_id         uuid primary key references saas.tenants (id),
  pix_account_id    uuid,
  card_account_id   uuid,
  safe_account_id   uuid,
  debit_days        integer not null default 1 check (debit_days between 0 and 60),
  credit_days       integer not null default 30 check (credit_days between 0 and 60),
  voucher_days      integer not null default 30 check (voucher_days between 0 and 60),
  -- Taxas em pontos-base (1% = 100).
  debit_fee_bps     integer not null default 150 check (debit_fee_bps between 0 and 2000),
  credit_fee_bps    integer not null default 350 check (credit_fee_bps between 0 and 2000),
  voucher_fee_bps   integer not null default 500 check (voucher_fee_bps between 0 and 2000),
  updated_at        timestamptz not null default now(),
  foreign key (tenant_id, pix_account_id) references saas.financial_accounts (tenant_id, id),
  foreign key (tenant_id, card_account_id) references saas.financial_accounts (tenant_id, id),
  foreign key (tenant_id, safe_account_id) references saas.financial_accounts (tenant_id, id)
);

create table saas.bakery_cash_closings (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references saas.tenants (id),
  closing_date        date not null,
  register_name       text not null check (length(register_name) between 1 and 40),
  register_account_id uuid not null,
  operator_user_id    uuid references saas.users (id),
  opening_float_cents bigint not null default 0 check (opening_float_cents >= 0),
  cash_sales_cents    bigint not null default 0 check (cash_sales_cents >= 0),
  pix_sales_cents     bigint not null default 0 check (pix_sales_cents >= 0),
  debit_sales_cents   bigint not null default 0 check (debit_sales_cents >= 0),
  credit_sales_cents  bigint not null default 0 check (credit_sales_cents >= 0),
  voucher_sales_cents bigint not null default 0 check (voucher_sales_cents >= 0),
  withdrawals_cents   bigint not null default 0 check (withdrawals_cents >= 0),
  counted_cash_cents  bigint not null check (counted_cash_cents >= 0),
  ticket_count        integer check (ticket_count is null or ticket_count >= 0),
  -- Diferença = contado - (troco inicial + vendas em dinheiro - sangrias). Negativo = falta.
  difference_cents    bigint not null,
  status              text not null default 'closed' check (status in ('closed', 'reversed')),
  notes               text,
  reversed_at         timestamptz,
  reversed_by         uuid references saas.users (id),
  reverse_reason      text,
  created_by          uuid references saas.users (id),
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, register_account_id) references saas.financial_accounts (tenant_id, id),
  check (difference_cents = counted_cash_cents - (opening_float_cents + cash_sales_cents - withdrawals_cents))
);
create unique index bakery_closings_one_per_register_day on saas.bakery_cash_closings (tenant_id, closing_date, lower(register_name))
  where status = 'closed';

-- Vínculo tipado entre o recebível de cartão e a taxa correspondente (gerados pelo fechamento).
create table saas.bakery_card_receivables (
  tenant_id           uuid not null references saas.tenants (id),
  closing_id          uuid not null,
  method              text not null check (method in ('debit', 'credit', 'voucher')),
  receivable_title_id uuid not null,
  fee_title_id        uuid,
  primary key (tenant_id, receivable_title_id),
  foreign key (tenant_id, closing_id) references saas.bakery_cash_closings (tenant_id, id),
  foreign key (tenant_id, receivable_title_id) references saas.titles (tenant_id, id),
  foreign key (tenant_id, fee_title_id) references saas.titles (tenant_id, id)
);

create table saas.bakery_ingredients (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references saas.tenants (id),
  name            text not null check (length(name) between 1 and 80),
  unit            text not null check (unit in ('kg', 'g', 'l', 'ml', 'un')),
  pack_quantity   numeric(14, 4) not null check (pack_quantity > 0),
  pack_cost_cents bigint not null check (pack_cost_cents >= 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index bakery_ingredients_name on saas.bakery_ingredients (tenant_id, lower(name));
create trigger bakery_ingredients_touch before update on saas.bakery_ingredients for each row execute function saas.touch_updated_at();

create table saas.bakery_products (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references saas.tenants (id),
  name             text not null check (length(name) between 1 and 80),
  sale_unit        text not null default 'un' check (sale_unit in ('un', 'kg', 'cento', 'fatia')),
  sale_price_cents bigint not null check (sale_price_cents >= 0),
  yield_quantity   numeric(14, 4) not null check (yield_quantity > 0),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index bakery_products_name on saas.bakery_products (tenant_id, lower(name));
create trigger bakery_products_touch before update on saas.bakery_products for each row execute function saas.touch_updated_at();

create table saas.bakery_recipe_items (
  tenant_id     uuid not null references saas.tenants (id),
  product_id    uuid not null,
  ingredient_id uuid not null,
  quantity      numeric(14, 4) not null check (quantity > 0),
  primary key (tenant_id, product_id, ingredient_id),
  foreign key (tenant_id, product_id) references saas.bakery_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references saas.bakery_ingredients (tenant_id, id)
);

create table saas.bakery_losses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references saas.tenants (id),
  loss_date       date not null,
  product_id      uuid not null,
  quantity        numeric(14, 4) not null check (quantity > 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  reason          text not null check (reason in ('sobra', 'queimado', 'vencido', 'avaria', 'outro')),
  notes           text,
  created_by      uuid references saas.users (id),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references saas.bakery_products (tenant_id, id)
);
create index bakery_losses_date on saas.bakery_losses (tenant_id, loss_date);

grant select, insert, update on saas.bakery_settings, saas.bakery_ingredients, saas.bakery_products to saas_app;
grant select, insert on saas.bakery_losses, saas.bakery_card_receivables to saas_app;
grant select, insert on saas.bakery_cash_closings to saas_app;
grant update (status, reversed_at, reversed_by, reverse_reason) on saas.bakery_cash_closings to saas_app;
grant select, insert, update, delete on saas.bakery_recipe_items to saas_app;

do $$
declare
  t text;
begin
  foreach t in array array['bakery_settings', 'bakery_cash_closings', 'bakery_ingredients', 'bakery_products',
                           'bakery_recipe_items', 'bakery_losses', 'bakery_card_receivables'] loop
    execute format('alter table saas.%I enable row level security', t);
    execute format($p$create policy %1$s_select on saas.%1$I for select to saas_app
                     using (tenant_id = (select saas.current_tenant_id()))$p$, t);
    execute format($p$create policy %1$s_insert on saas.%1$I for insert to saas_app
                     with check (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write()))$p$, t);
    execute format($p$create policy %1$s_update on saas.%1$I for update to saas_app
                     using (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write()))
                     with check (tenant_id = (select saas.current_tenant_id()))$p$, t);
  end loop;
  create policy bakery_recipe_items_delete on saas.bakery_recipe_items for delete to saas_app
    using (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write()));
end $$;

-- Métricas de uso de módulos para a plataforma: somente contagens, nunca valores financeiros.
create or replace function saas.platform_module_usage(p_days integer default 30)
returns table (module_key text, tenants_enabled bigint, tenants_active bigint, events bigint)
language plpgsql stable security definer set search_path = saas, pg_temp as $$
begin
  if not saas.is_platform_admin() then
    raise exception 'Acesso restrito à administração da plataforma' using errcode = '42501';
  end if;
  return query
    select m.module_key,
           count(*) filter (where m.enabled),
           (case m.module_key
              when 'padaria.caixa' then (select count(distinct c.tenant_id) from saas.bakery_cash_closings c
                                          where c.created_at > now() - make_interval(days => p_days))
              when 'padaria.producao' then (select count(distinct l.tenant_id) from saas.bakery_losses l
                                             where l.created_at > now() - make_interval(days => p_days))
              else 0 end)::bigint,
           (case m.module_key
              when 'padaria.caixa' then (select count(*) from saas.bakery_cash_closings c
                                          where c.created_at > now() - make_interval(days => p_days))
              when 'padaria.producao' then (select count(*) from saas.bakery_losses l
                                             where l.created_at > now() - make_interval(days => p_days))
              else 0 end)::bigint
      from saas.tenant_modules m
     group by m.module_key;
end $$;
grant execute on function saas.platform_module_usage(integer) to saas_app;
