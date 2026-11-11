/**
 * Mongoose schemas. Documents use the entity id as `_id`, integer money fields are validated as safe
 * integers, and the indexes back every query the services make (plus the unique business keys).
 */
import { Schema, type Connection, type Model, type SchemaDefinition, type SchemaOptions } from 'mongoose';

/** Untyped schema factory: Mongoose's schema-type inference is very expensive for the compiler, and the
 * domain types (not Mongoose documents) are the source of truth here. */
function schema(def: Record<string, unknown>, opts: SchemaOptions<any>): Schema {
  return new Schema(def as SchemaDefinition<any>, opts);
}

const int = { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: '{PATH} must be an integer' } };
const str = { type: String, required: true };
const optStr = { type: String };
const sub: SchemaOptions = { _id: false, versionKey: false };
const root: SchemaOptions = { versionKey: false, minimize: false, strict: 'throw' };
const base = { _id: { type: String, required: true }, tenantId: str, version: int };

const RfxSchema = schema(
  {
    ...base,
    number: str,
    type: { type: String, enum: ['RFI', 'RFQ', 'RFP'], required: true },
    title: str,
    projectName: str,
    currency: str,
    status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'CLOSED', 'AWARDED', 'CANCELLED'], required: true },
    lines: [schema({ id: str, code: str, description: str, unit: str, quantity: { type: Number, required: true } }, sub)],
    invitations: [schema({ supplierId: str, supplierName: str, status: str, invitedAt: str, respondedAt: optStr }, sub)],
    bidDueAt: str,
    createdBy: str,
    createdAt: str,
    publishedAt: optStr,
    closedAt: optStr,
    award: schema(
      { supplierId: str, supplierName: str, bidId: str, totalMinor: int, awardedAt: str, awardedBy: str, justification: optStr, lowestBid: { type: Boolean, required: true } },
      sub,
    ),
  },
  root,
);
RfxSchema.index({ tenantId: 1, number: 1 }, { unique: true });
RfxSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
RfxSchema.index({ tenantId: 1, 'invitations.supplierId': 1 });

const BidSchema = schema(
  {
    ...base,
    rfxId: str,
    supplierId: str,
    supplierName: str,
    lines: [schema({ lineId: str, unitPriceMinor: int, note: optStr }, sub)],
    totalMinor: int,
    leadTimeDays: int,
    validityDays: int,
    exclusions: optStr,
    revision: int,
    submittedAt: str,
    sealHash: str,
  },
  root,
);
BidSchema.index({ tenantId: 1, rfxId: 1, supplierId: 1 }, { unique: true });

const ContractSchema = schema(
  {
    ...base,
    number: str,
    title: str,
    projectName: str,
    rfxId: str,
    rfxNumber: str,
    bidId: str,
    supplierId: str,
    supplierName: str,
    currency: str,
    status: { type: String, enum: ['ACTIVE', 'CLOSED'], required: true },
    sov: [
      schema(
        { id: str, code: str, description: str, originalValueMinor: int, changeOrderValueMinor: int, source: { type: String, enum: ['BID', 'CHANGE_ORDER'], required: true }, changeOrderNumber: optStr },
        sub,
      ),
    ],
    originalValueMinor: int,
    approvedChangesMinor: int,
    revisedValueMinor: int,
    retentionBps: int,
    startDate: str,
    originalCompletionDate: str,
    revisedCompletionDate: str,
    scheduleDaysAdded: int,
    revision: int,
    revisions: [
      schema({ revision: int, reason: str, changeOrderId: optStr, changeOrderNumber: optStr, valueMinor: int, completionDate: str, at: str, by: str }, sub),
    ],
    createdAt: str,
  },
  root,
);
ContractSchema.index({ tenantId: 1, rfxId: 1 }, { unique: true });
ContractSchema.index({ tenantId: 1, number: 1 }, { unique: true });
ContractSchema.index({ tenantId: 1, supplierId: 1 });

const Totals = schema({ addsMinor: int, omitsMinor: int, costMinor: int, markupMinor: int, totalMinor: int }, sub);

const ChangeOrderSchema = schema(
  {
    ...base,
    number: str,
    contractId: str,
    title: str,
    reason: str,
    description: { type: String, default: '' },
    lines: [
      schema(
        { id: str, kind: { type: String, enum: ['ADD', 'OMIT'], required: true }, sovLineId: { type: String, default: null }, description: str, costType: str, quantity: { type: Number, required: true }, unit: str, unitPriceMinor: int },
        sub,
      ),
    ],
    markupBps: int,
    scheduleImpactDays: int,
    totals: { type: Totals, required: true },
    status: { type: String, enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN'], required: true },
    revision: int,
    history: [schema({ revision: int, totals: Totals, scheduleImpactDays: int, status: str, at: str, by: str, note: str }, sub)],
    approvalPolicy: optStr,
    steps: [schema({ role: str, label: str, status: str, decidedBy: optStr, decidedByName: optStr, decidedAt: optStr, comment: optStr }, sub)],
    requestedBy: str,
    requestedByName: str,
    createdAt: str,
    submittedAt: optStr,
    decidedAt: optStr,
  },
  root,
);
ChangeOrderSchema.index({ tenantId: 1, contractId: 1, number: 1 }, { unique: true });
ChangeOrderSchema.index({ tenantId: 1, status: 1 });

const AuditSchema = schema(
  { ...base, entityType: str, entityId: str, action: str, actorId: str, actorName: str, at: str, details: { type: Schema.Types.Mixed } },
  root,
);
AuditSchema.index({ tenantId: 1, entityId: 1, at: 1 });
AuditSchema.index({ tenantId: 1, at: -1 });

const CounterSchema = schema({ ...base, value: int }, root);

const OutboxSchema = schema({ ...base, event: { type: Schema.Types.Mixed, required: true }, dispatchedAt: { type: String, default: null } }, root);
OutboxSchema.index({ tenantId: 1, dispatchedAt: 1, _id: 1 });

const UserSchema = schema(
  { _id: { type: String, required: true }, tenantId: str, email: { ...str, lowercase: true }, name: str, roles: [String], supplierId: optStr, passwordHash: str },
  root,
);
UserSchema.index({ email: 1 }, { unique: true });

const ClientSchema = schema(
  { _id: { type: String, required: true }, tenantId: str, name: str, supplierId: str, secretHash: str, scopes: [String] },
  root,
);

const RefreshSchema = schema(
  { _id: { type: String, required: true }, familyId: str, userId: str, tenantId: str, expiresAt: str, usedAt: { type: String, default: null }, revokedAt: { type: String, default: null } },
  root,
);
RefreshSchema.index({ familyId: 1 });

export type AnyModel = Model<any>;

export interface Models {
  rfx: AnyModel;
  bids: AnyModel;
  contracts: AnyModel;
  changeOrders: AnyModel;
  auditLog: AnyModel;
  counters: AnyModel;
  outbox: AnyModel;
  users: AnyModel;
  clients: AnyModel;
  refreshTokens: AnyModel;
}

export function createModels(conn: Connection): Models {
  const m = (name: string, s: Schema, collection: string): AnyModel => (conn.model as (...a: unknown[]) => unknown)(name, s, collection) as AnyModel;
  return {
    rfx: m('Rfx', RfxSchema, 'rfx'),
    bids: m('Bid', BidSchema, 'bids'),
    contracts: m('Contract', ContractSchema, 'contracts'),
    changeOrders: m('ChangeOrder', ChangeOrderSchema, 'change_orders'),
    auditLog: m('AuditEntry', AuditSchema, 'audit'),
    counters: m('Counter', CounterSchema, 'counters'),
    outbox: m('Outbox', OutboxSchema, 'outbox'),
    users: m('User', UserSchema, 'users'),
    clients: m('Client', ClientSchema, 'clients'),
    refreshTokens: m('RefreshToken', RefreshSchema, 'refresh_tokens'),
  };
}


/** Collections must exist before multi-document transactions write to them; build indexes too. */
export async function initModels(models: Models): Promise<void> {
  for (const model of Object.values(models)) {
    await model.createCollection();
    await model.syncIndexes();
  }
}
