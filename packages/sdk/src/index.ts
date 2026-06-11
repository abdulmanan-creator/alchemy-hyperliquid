/**
 * @alchemy-hl/sdk — TypeScript client for the Alchemy Hyperliquid REST API.
 *
 * @example Quickstart with a hot key
 * ```ts
 * import { Alchemy } from "@alchemy-hl/sdk";
 *
 * const sdk = new Alchemy({
 *   privateKey: process.env.PK as `0x${string}`,
 *   baseUrl: "https://api.alchemy.com/hyperliquid",
 * });
 *
 * // One-time: approve Alchemy as a builder on your HL account.
 * await sdk.approveBuilder({ maxFeeRate: "1%" });
 *
 * // Trade.
 * await sdk.marketBuy("BTC", { notional: 100 });
 * await sdk.limitOrder({ symbol: "ETH", side: "sell", size: 0.05, price: 2500 });
 *
 * // Inspect state.
 * const balance = await sdk.balance();
 * const open = await sdk.openOrders();
 * ```
 *
 * @example Browser usage with Privy / wagmi
 * ```ts
 * const sdk = new Alchemy({
 *   account: wallet.address as `0x${string}`,
 *   signTypedDataAsync: async (params) => {
 *     const provider = await wallet.getEthereumProvider();
 *     return provider.request({
 *       method: "eth_signTypedData_v4",
 *       params: [wallet.address, JSON.stringify(params)],
 *     });
 *   },
 * });
 * ```
 */

export { Alchemy, type ClientOptions, type OrderResult, type TriggerOpts } from "./client.js";
export { AlchemyHlError, SdkInputError } from "./errors.js";
export type { ApiError, ErrorCode } from "./errors.js";
export type { Signer, SignerConfig, SignTypedDataParams } from "./signer.js";
export { normalizeHexSig, makeSigner } from "./signer.js";
export type { AssetInfo } from "./assets.js";
export type {
  LimitOrderParams,
  MarketOrderParams,
  Tif,
  TriggerOrderParams,
} from "./actions.js";
export { buildTriggerOrder } from "./actions.js";

// Re-export shared types for convenience so consumers don't need a second import.
export type {
  Action,
  ApprovalState,
  BalanceState,
  BuildResponse,
  DexesResponse,
  MarketsResponse,
  PerpPosition,
  PositionsResponse,
  SendResponse,
  Signature,
  UserFill,
  UserFillsResponse,
} from "@alchemy-hl/shared";
