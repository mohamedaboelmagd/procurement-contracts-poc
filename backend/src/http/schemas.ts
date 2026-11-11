/** Request schemas (zod). The same objects validate requests and generate the OpenAPI document. */
import { z } from 'zod';

const money = z.number().int().min(0).max(1e13).describe('Integer minor units (e.g. cents)');
const qty = z.number().positive().max(1e7).refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, 'At most 3 decimals');
const text = (max: number) => z.string().trim().min(1).max(max);

export const LoginBody = z.object({ email: z.email(), password: z.string().min(1).max(200) }).meta({ id: 'LoginBody' });
export const RefreshBody = z.object({ refresh_token: z.string().min(20).max(200) }).meta({ id: 'RefreshBody' });
export const ClientCredentialsBody = z
  .object({
    grant_type: z.literal('client_credentials'),
    client_id: z.string().min(1).optional(),
    client_secret: z.string().min(1).optional(),
    scope: z.string().max(200).optional(),
  })
  .meta({ id: 'ClientCredentialsBody' });

export const CreateRfxBody = z
  .object({
    type: z.enum(['RFI', 'RFQ', 'RFP']),
    title: text(200),
    projectName: text(200),
    currency: z.enum(['USD', 'EGP', 'SAR', 'AED']),
    bidDueAt: z.iso.datetime({ offset: true }),
    lines: z.array(z.object({ code: text(20), description: text(300), unit: text(20), quantity: qty })).min(1).max(500),
    suppliers: z.array(z.object({ supplierId: text(60), supplierName: text(200) })).min(1).max(50),
  })
  .meta({ id: 'CreateRfxBody' });

export const BidBody = z
  .object({
    lines: z.array(z.object({ lineId: text(60), unitPriceMinor: money, note: z.string().max(300).optional() })).min(1).max(500),
    leadTimeDays: z.number().int().min(0).max(1000),
    validityDays: z.number().int().min(1).max(365),
    exclusions: z.string().max(2000).optional(),
  })
  .meta({ id: 'BidBody' });

export const AwardBody = z.object({ supplierId: text(60), justification: z.string().max(2000).optional() }).meta({ id: 'AwardBody' });

export const ChangeOrderBody = z
  .object({
    title: text(200),
    reason: z.enum(['OWNER_REQUEST', 'DESIGN_CHANGE', 'UNFORESEEN_CONDITION', 'VALUE_ENGINEERING', 'REGULATORY']),
    description: z.string().max(4000).default(''),
    lines: z
      .array(
        z.object({
          kind: z.enum(['ADD', 'OMIT']),
          sovLineId: z.string().max(60).nullable().default(null),
          description: text(300),
          costType: z.enum(['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACT']),
          quantity: qty,
          unit: text(20),
          unitPriceMinor: money,
        }),
      )
      .min(1)
      .max(200),
    markupBps: z.number().int().min(0).max(2500).describe('Overhead & profit on added work, basis points'),
    scheduleImpactDays: z.number().int().min(-365).max(365),
  })
  .meta({ id: 'ChangeOrderBody' });

export const DecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().max(2000).optional() }).meta({ id: 'DecisionBody' });

export const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string().optional() }) })
  .meta({ id: 'Error' });
