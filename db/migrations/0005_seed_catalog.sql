-- 0005 — Dados iniciais do catálogo comercial. Valores são EXEMPLOS editáveis no painel administrativo
-- (Planos). Nenhum preço é fixado no código da aplicação.

insert into saas.plans (code, name, description, is_default, trial_days, sort_order) values
  ('essencial', 'Essencial', 'Núcleo financeiro: contas a pagar e receber, fluxo de caixa e relatórios básicos.', false, 14, 1),
  ('profissional', 'Profissional', 'Tudo do Essencial + módulos do segmento, relatórios avançados e mais usuários.', true, 14, 2),
  ('avancado', 'Avançado', 'Tudo do Profissional com maior capacidade e auditoria completa.', false, 14, 3);

insert into saas.plan_prices (plan_id, billing_interval, price_cents)
select id, i.billing_interval, i.price_cents
  from saas.plans p
  join (values ('essencial', 'monthly', 4990), ('essencial', 'yearly', 49900),
               ('profissional', 'monthly', 9990), ('profissional', 'yearly', 99900),
               ('avancado', 'monthly', 19990), ('avancado', 'yearly', 199900)) as i(code, billing_interval, price_cents)
    on i.code = p.code;

insert into saas.plan_features (plan_id, feature_key)
select p.id, f.feature_key
  from saas.plans p
  join (values
    ('essencial', 'core.finance'), ('essencial', 'reports.basic'), ('essencial', 'export.csv'),
    ('essencial', 'users.invite'), ('essencial', 'module.padaria.caixa'),
    ('profissional', 'core.finance'), ('profissional', 'reports.basic'), ('profissional', 'reports.advanced'),
    ('profissional', 'export.csv'), ('profissional', 'users.invite'), ('profissional', 'module.padaria.caixa'),
    ('profissional', 'module.padaria.producao'), ('profissional', 'audit.view'),
    ('avancado', 'core.finance'), ('avancado', 'reports.basic'), ('avancado', 'reports.advanced'),
    ('avancado', 'export.csv'), ('avancado', 'users.invite'), ('avancado', 'module.padaria.caixa'),
    ('avancado', 'module.padaria.producao'), ('avancado', 'audit.view')
  ) as f(code, feature_key) on f.code = p.code;

insert into saas.plan_limits (plan_id, limit_key, limit_value)
select p.id, l.limit_key, l.limit_value
  from saas.plans p
  join (values
    ('essencial', 'max_users', 2), ('essencial', 'max_financial_accounts', 3), ('essencial', 'max_titles_per_month', 300),
    ('profissional', 'max_users', 6), ('profissional', 'max_financial_accounts', 10), ('profissional', 'max_titles_per_month', 2000),
    ('avancado', 'max_users', 20), ('avancado', 'max_financial_accounts', null), ('avancado', 'max_titles_per_month', null)
  ) as l(code, limit_key, limit_value) on l.code = p.code;

insert into saas.platform_settings (key, value) values
  ('billing.grace_days', '15'),
  ('billing.invoice_due_days', '5'),
  ('modules.disabled', '[]'),
  ('retention.read_only_days', '365'),
  ('support.grant_max_hours', '72');
