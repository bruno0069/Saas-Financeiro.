-- 0003 — Núcleo financeiro compartilhado.
--
-- Regras centrais garantidas pelo banco:
--   * Toda linha pertence a um tenant; chaves estrangeiras compostas (tenant_id, id) impedem
--     que um registro referencie dados de outra empresa, mesmo por erro do servidor.
--   * Valores em centavos (bigint), sempre positivos; a direção define entrada/saída.
--   * Movimentações realizadas (cash_movements) são imutáveis: correções por estorno/ajuste.
--   * O valor pago de um título é mantido pelo banco a partir das movimentações, e nunca
--     ultrapassa o valor do título.
--   * Transferências entre contas próprias e saldos iniciais não são receitas nem despesas.

create table saas.financial_accounts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references saas.tenants (id),
  name                  text not null check (length(name) between 1 and 80),
  kind                  text not null check (kind in ('cash', 'checking', 'savings', 'digital_wallet', 'card_receivables', 'other')),
  institution           text,
  is_active             boolean not null default true,
  opening_balance_cents bigint not null default 0,
  opening_date          date not null,
  created_by            uuid references saas.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index financial_accounts_name on saas.financial_accounts (tenant_id, lower(name));
create trigger financial_accounts_touch before update on saas.financial_accounts for each row execute function saas.touch_updated_at();

create table saas.categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references saas.tenants (id),
  name       text not null check (length(name) between 1 and 80),
  kind       text not null check (kind in ('income', 'expense')),
  -- Código estável usado por módulos (ex.: 'padaria.vendas_balcao'). Nome pode ser personalizado.
  code       text,
  is_system  boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);
create unique index categories_name on saas.categories (tenant_id, kind, lower(name));
create trigger categories_touch before update on saas.categories for each row execute function saas.touch_updated_at();

create table saas.contacts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references saas.tenants (id),
  name       text not null check (length(name) between 1 and 120),
  kind       text not null check (kind in ('customer', 'supplier', 'both')),
  tax_id     text check (tax_id is null or tax_id ~ '^[0-9]{11}$|^[0-9]{14}$'),
  email      text,
  phone      text,
  notes      text,
  is_active  boolean not null default true,
  created_by uuid references saas.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index contacts_tenant_name on saas.contacts (tenant_id, lower(name));
create trigger contacts_touch before update on saas.contacts for each row execute function saas.touch_updated_at();

-- Títulos: contas a pagar e a receber. Uma linha por parcela.
create table saas.titles (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references saas.tenants (id),
  direction            text not null check (direction in ('payable', 'receivable')),
  description          text not null check (length(description) between 1 and 200),
  contact_id           uuid,
  category_id          uuid not null,
  amount_cents         bigint not null check (amount_cents > 0),
  paid_cents           bigint not null default 0,
  issue_date           date not null default current_date,
  due_date             date not null,
  status               text not null default 'open' check (status in ('open', 'partial', 'paid', 'canceled')),
  installment_group_id uuid,
  installment_number   integer not null default 1,
  installment_count    integer not null default 1,
  document_number      text,
  notes                text,
  source_module        text,
  source_ref_id        uuid,
  canceled_at          timestamptz,
  canceled_by          uuid references saas.users (id),
  cancel_reason        text,
  created_by           uuid references saas.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  check (paid_cents >= 0 and paid_cents <= amount_cents),
  check (installment_number between 1 and installment_count and installment_count between 1 and 360),
  check (status <> 'canceled' or (canceled_at is not null and paid_cents = 0)),
  foreign key (tenant_id, contact_id) references saas.contacts (tenant_id, id),
  foreign key (tenant_id, category_id) references saas.categories (tenant_id, id)
);
create index titles_open_due on saas.titles (tenant_id, direction, due_date) where status in ('open', 'partial');
create index titles_group on saas.titles (tenant_id, installment_group_id) where installment_group_id is not null;
create index titles_source on saas.titles (tenant_id, source_module, source_ref_id) where source_module is not null;
create trigger titles_touch before update on saas.titles for each row execute function saas.touch_updated_at();

create table saas.transfers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references saas.tenants (id),
  from_account_id uuid not null,
  to_account_id   uuid not null,
  amount_cents    bigint not null check (amount_cents > 0),
  transfer_date   date not null,
  description     text,
  source_module   text,
  source_ref_id   uuid,
  created_by      uuid references saas.users (id),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  check (from_account_id <> to_account_id),
  foreign key (tenant_id, from_account_id) references saas.financial_accounts (tenant_id, id),
  foreign key (tenant_id, to_account_id) references saas.financial_accounts (tenant_id, id)
);

-- Movimentações realizadas (o "razão" do caixa). Imutáveis.
create table saas.cash_movements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references saas.tenants (id),
  account_id     uuid not null,
  direction      text not null check (direction in ('in', 'out')),
  amount_cents   bigint not null check (amount_cents > 0),
  occurred_on    date not null,
  kind           text not null check (kind in ('opening_balance', 'settlement', 'transfer', 'adjustment', 'reversal')),
  title_id       uuid,
  transfer_id    uuid,
  reverses_id    uuid unique,
  category_id    uuid,
  payment_method text check (payment_method is null or payment_method in
                   ('cash', 'pix', 'debit_card', 'credit_card', 'voucher', 'boleto', 'bank_transfer', 'other')),
  description    text,
  reason         text,
  created_by     uuid references saas.users (id),
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references saas.financial_accounts (tenant_id, id),
  foreign key (tenant_id, title_id) references saas.titles (tenant_id, id),
  foreign key (tenant_id, transfer_id) references saas.transfers (tenant_id, id),
  foreign key (tenant_id, reverses_id) references saas.cash_movements (tenant_id, id),
  foreign key (tenant_id, category_id) references saas.categories (tenant_id, id),
  check (kind <> 'settlement' or (title_id is not null and transfer_id is null)),
  check (kind <> 'transfer' or (transfer_id is not null and title_id is null)),
  check (kind <> 'reversal' or (reverses_id is not null and length(coalesce(reason, '')) >= 3)),
  check (kind <> 'adjustment' or (length(coalesce(reason, '')) >= 3 and title_id is null and transfer_id is null)),
  check (kind <> 'opening_balance' or (title_id is null and transfer_id is null))
);
create index cash_movements_account on saas.cash_movements (tenant_id, account_id, occurred_on);
create index cash_movements_date on saas.cash_movements (tenant_id, occurred_on);
create index cash_movements_title on saas.cash_movements (tenant_id, title_id) where title_id is not null;
create unique index cash_movements_one_opening on saas.cash_movements (tenant_id, account_id) where kind = 'opening_balance';

create trigger cash_movements_immutable before update or delete on saas.cash_movements
  for each row execute function saas.forbid_mutation();
create trigger transfers_immutable before update or delete on saas.transfers
  for each row execute function saas.forbid_mutation();

-- Valida cada movimentação e mantém o valor pago do título de forma atômica.
create or replace function saas.cash_movements_apply() returns trigger
language plpgsql security definer set search_path = saas, pg_temp as $$
declare
  t saas.titles%rowtype;
  orig saas.cash_movements%rowtype;
  delta bigint := 0;
  target_title uuid;
begin
  if new.kind = 'reversal' then
    select * into orig from saas.cash_movements where id = new.reverses_id and tenant_id = new.tenant_id;
    if not found then
      raise exception 'Movimentação original não encontrada' using errcode = 'P0001';
    end if;
    if orig.kind in ('reversal', 'opening_balance') then
      raise exception 'Este tipo de movimentação não pode ser estornado' using errcode = 'P0001';
    end if;
    if orig.amount_cents <> new.amount_cents or orig.direction = new.direction or orig.account_id <> new.account_id then
      raise exception 'Estorno deve ter o mesmo valor e conta, em direção oposta' using errcode = 'P0001';
    end if;
    if new.title_id is distinct from orig.title_id or new.transfer_id is distinct from orig.transfer_id then
      raise exception 'Estorno deve referenciar o mesmo título/transferência' using errcode = 'P0001';
    end if;
    if orig.kind = 'settlement' then
      target_title := orig.title_id;
      delta := -orig.amount_cents;
    end if;
  elsif new.kind = 'settlement' then
    target_title := new.title_id;
    delta := new.amount_cents;
  end if;

  if target_title is not null then
    select * into t from saas.titles where id = target_title and tenant_id = new.tenant_id for update;
    if new.kind = 'settlement' then
      if t.status = 'canceled' then
        raise exception 'Título cancelado não pode receber baixa' using errcode = 'P0001';
      end if;
      if (t.direction = 'payable' and new.direction <> 'out') or (t.direction = 'receivable' and new.direction <> 'in') then
        raise exception 'Direção da baixa incompatível com o título' using errcode = 'P0001';
      end if;
      if t.paid_cents + delta > t.amount_cents then
        raise exception 'Valor da baixa excede o saldo em aberto do título' using errcode = 'P0001';
      end if;
    end if;
    update saas.titles
       set paid_cents = paid_cents + delta,
           status = case
                      when paid_cents + delta = 0 then 'open'
                      when paid_cents + delta >= amount_cents then 'paid'
                      else 'partial'
                    end
     where id = target_title;
  end if;
  return new;
end $$;
create trigger cash_movements_apply before insert on saas.cash_movements
  for each row execute function saas.cash_movements_apply();

-- Títulos: não é permitido alterar valores já liquidados por edição direta.
create or replace function saas.titles_guard() returns trigger
language plpgsql as $$
begin
  if new.tenant_id <> old.tenant_id or new.direction <> old.direction then
    raise exception 'Empresa e natureza do título não podem ser alteradas' using errcode = 'P0001';
  end if;
  if old.status = 'canceled' and new.status <> 'canceled' then
    raise exception 'Título cancelado não pode ser reaberto' using errcode = 'P0001';
  end if;
  if new.amount_cents <> old.amount_cents and old.paid_cents > 0 then
    raise exception 'Valor de título com baixas não pode ser alterado; estorne as baixas antes' using errcode = 'P0001';
  end if;
  -- A situação é derivada do valor pago; somente o cancelamento é uma escolha explícita.
  if new.status <> 'canceled' then
    new.status := case when new.paid_cents = 0 then 'open'
                       when new.paid_cents >= new.amount_cents then 'paid'
                       else 'partial' end;
  end if;
  return new;
end $$;
create trigger titles_guard before update on saas.titles for each row execute function saas.titles_guard();

create or replace function saas.titles_insert_guard() returns trigger
language plpgsql as $$
begin
  new.paid_cents := 0;
  new.status := 'open';
  new.canceled_at := null;
  return new;
end $$;
create trigger titles_insert_guard before insert on saas.titles for each row execute function saas.titles_insert_guard();

-- Saldos por conta (saldo inicial é uma movimentação explícita do tipo opening_balance).
create or replace view saas.account_balances with (security_invoker = true) as
  select a.tenant_id, a.id as account_id,
         coalesce(sum(case when m.direction = 'in' then m.amount_cents else -m.amount_cents end), 0)::bigint as balance_cents
    from saas.financial_accounts a
    left join saas.cash_movements m on m.account_id = a.id and m.tenant_id = a.tenant_id
   group by a.tenant_id, a.id;

-- ---------------------------------------------------------------------------------------
-- Permissões e RLS. Isolamento por tenant + bloqueio de escrita (suporte/assinatura) no banco;
-- permissões finas por função são verificadas no serviço (src/server/authz.ts).
-- ---------------------------------------------------------------------------------------
grant select, insert, update on saas.categories, saas.contacts to saas_app;
-- Saldo inicial só é definido na criação (movimentação opening_balance); correções por ajuste.
grant select, insert on saas.financial_accounts to saas_app;
grant update (name, kind, institution, is_active) on saas.financial_accounts to saas_app;
-- paid_cents não é gravável pela aplicação: só o gatilho de movimentações o altera.
grant select, insert on saas.titles to saas_app;
grant update (description, contact_id, category_id, amount_cents, due_date, document_number, notes,
              status, canceled_at, canceled_by, cancel_reason) on saas.titles to saas_app;
grant select, insert on saas.transfers, saas.cash_movements to saas_app;
grant select on saas.account_balances to saas_app;

do $$
declare
  t text;
begin
  foreach t in array array['financial_accounts', 'categories', 'contacts', 'titles', 'transfers', 'cash_movements'] loop
    execute format('alter table saas.%I enable row level security', t);
    execute format($p$create policy %1$s_select on saas.%1$I for select to saas_app
                     using (tenant_id = (select saas.current_tenant_id()))$p$, t);
    execute format($p$create policy %1$s_insert on saas.%1$I for insert to saas_app
                     with check (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write()))$p$, t);
  end loop;
  foreach t in array array['financial_accounts', 'categories', 'contacts', 'titles'] loop
    execute format($p$create policy %1$s_update on saas.%1$I for update to saas_app
                     using (tenant_id = (select saas.current_tenant_id()) and (select saas.can_write()))
                     with check (tenant_id = (select saas.current_tenant_id()))$p$, t);
  end loop;
end $$;
