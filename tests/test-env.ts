// Banco de testes dedicado. Nunca aponte para um banco com dados reais.
export const TEST_ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://saas_app:dev-app-password-123@localhost:5432/saas_test",
  DATABASE_URL_OWNER: process.env.TEST_DATABASE_URL_OWNER ?? "postgres://saas_owner:devowner@localhost:5432/saas_test",
  APP_URL: "http://localhost:3000",
  MAIL_PROVIDER: "console",
  ASAAS_WEBHOOK_TOKEN: "test-webhook-token",
  REQUIRE_EMAIL_VERIFICATION: "true",
};
