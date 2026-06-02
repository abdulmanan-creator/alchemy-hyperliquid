import type { FastifyInstance } from "fastify";

import { exchangeRoute } from "./exchange.js";
import { approvalRoute } from "./approval.js";
import { agentRoute } from "./agent.js";
import { balanceRoute } from "./balance.js";
import { openOrdersRoute } from "./openOrders.js";
import { orderStatusRoute } from "./orderStatus.js";
import { preflightRoute } from "./preflight.js";
import { marketsRoute } from "./markets.js";
import { markPriceRoute } from "./markPrice.js";
import { dexesRoute } from "./dexes.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(exchangeRoute);
  await app.register(approvalRoute);
  await app.register(agentRoute);
  await app.register(balanceRoute);
  await app.register(openOrdersRoute);
  await app.register(orderStatusRoute);
  await app.register(preflightRoute);
  await app.register(marketsRoute);
  await app.register(markPriceRoute);
  await app.register(dexesRoute);
}
