import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { jurisdictionsRouter } from "./jurisdictions";
import { sectorsRouter } from "./sectors";
import { opportunitiesRouter } from "./opportunities";
import { scenariosRouter } from "./scenarios";
import { legislationRouter } from "./legislation";
import { documentsRouter } from "./documents";
import { searchRouter } from "./search";
import { briefsRouter } from "./briefs";
import { adminRouter } from "./admin";
import { opsRouter } from "./ops";
import { innovationsRouter } from "./innovations";
import { auditLogRouter } from "./audit-log";
import { onboardingRouter } from "./onboarding";
import { geoRouter } from "./geo";
import { outcomesRouter } from "./outcomes";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  jurisdictions: jurisdictionsRouter,
  sectors: sectorsRouter,
  opportunities: opportunitiesRouter,
  scenarios: scenariosRouter,
  legislation: legislationRouter,
  documents: documentsRouter,
  search: searchRouter,
  briefs: briefsRouter,
  admin: adminRouter,
  ops: opsRouter,
  innovations: innovationsRouter,
  auditLog: auditLogRouter,
  onboarding: onboardingRouter,
  geo: geoRouter,
  outcomes: outcomesRouter,
});

export type AppRouter = typeof appRouter;
