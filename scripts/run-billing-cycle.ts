import "./env";
import { runBillingCycle } from "../src/domains/billing/subscriptions";
import { purgeRateLimits } from "../src/server/system/rate-limit";
import { closePools } from "../src/server/db/pool";

// Executa o ciclo de cobrança (para cron do sistema operacional ou execução manual).
runBillingCycle()
  .then(async (stats) => {
    await purgeRateLimits();
    console.log(JSON.stringify({ job: "billing_cycle", ...stats }));
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closePools);
