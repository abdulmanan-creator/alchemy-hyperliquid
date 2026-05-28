/**
 * Zod schemas for everything that crosses the /exchange wire.
 *
 * The shapes mirror Hyperliquid's contract exactly — bad shape = INVALID_PARAMS
 * before any signing or upstream call.
 */

import { z } from "zod";

const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const PERCENT = /^\d+(\.\d+)?%$/;

export const AddressSchema = z
  .string()
  .regex(HEX_ADDR)
  .transform((s) => s as `0x${string}`);

export const Bytes32Schema = z
  .string()
  .regex(HEX_32)
  .transform((s) => s as `0x${string}`);

export const SignatureSchema = z.object({
  r: Bytes32Schema,
  s: Bytes32Schema,
  v: z.number().int().min(0).max(255),
});

// ---- Order action -----------------------------------------------------------

const OrderTypeSchema = z.union([
  z.object({
    limit: z.object({ tif: z.enum(["Alo", "Ioc", "Gtc"]) }),
  }),
  z.object({
    trigger: z.object({
      isMarket: z.boolean(),
      triggerPx: z.string(),
      tpsl: z.enum(["tp", "sl"]),
    }),
  }),
]);

const OrderLegSchema = z.object({
  a: z.number().int().min(0),
  b: z.boolean(),
  p: z.string(),
  s: z.string(),
  r: z.boolean(),
  t: OrderTypeSchema,
  c: Bytes32Schema.optional(),
});

export const OrderActionSchema = z.object({
  type: z.literal("order"),
  orders: z.array(OrderLegSchema).min(1),
  grouping: z.enum(["na", "normalTpsl", "positionTpsl"]),
  builder: z
    .object({
      b: AddressSchema,
      f: z.number().int().min(0),
    })
    .optional(),
});

export const CancelActionSchema = z.object({
  type: z.literal("cancel"),
  cancels: z
    .array(z.object({ a: z.number().int().min(0), o: z.number().int() }))
    .min(1),
});

export const CancelByCloidActionSchema = z.object({
  type: z.literal("cancelByCloid"),
  cancels: z
    .array(z.object({ asset: z.number().int().min(0), cloid: Bytes32Schema }))
    .min(1),
});

export const ApproveBuilderFeeActionSchema = z.object({
  type: z.literal("approveBuilderFee"),
  hyperliquidChain: z.enum(["Mainnet", "Testnet"]).optional(),
  maxFeeRate: z.string().regex(PERCENT, "must be a percentage like \"0.04%\" or \"1%\""),
  builder: AddressSchema.optional(),
  nonce: z.number().int().min(0).optional(),
  signatureChainId: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .transform((s) => s as `0x${string}`)
    .optional(),
});

export const ActionSchema = z.discriminatedUnion("type", [
  OrderActionSchema,
  CancelActionSchema,
  CancelByCloidActionSchema,
  ApproveBuilderFeeActionSchema,
]);

// ---- Top-level /exchange body ----------------------------------------------

/**
 * Either Phase A (no nonce, no signature) or Phase B (both present).
 *
 * We discriminate inside the route rather than via discriminatedUnion — the
 * key is the *presence* of `signature`, not a tagged literal.
 */
export const ExchangeBodySchema = z.object({
  action: ActionSchema,
  nonce: z.number().int().min(0).optional(),
  signature: SignatureSchema.optional(),
});

export type ExchangeBody = z.infer<typeof ExchangeBodySchema>;

// ---- Other endpoint param schemas ------------------------------------------

export const ApprovalQuerySchema = z.object({
  user: AddressSchema,
});

export const UserBodySchema = z.object({
  user: AddressSchema,
});

export const OrderStatusBodySchema = z.object({
  user: AddressSchema,
  oid: z.number().int(),
});

export const PreflightBodySchema = z.object({
  action: OrderActionSchema,
});
