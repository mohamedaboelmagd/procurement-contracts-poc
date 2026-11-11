/** OpenAPI 3.1 document generated from the zod request schemas (zod 4's native JSON Schema output). */
import { z } from 'zod';
import * as S from './schemas.js';

type Op = { method: 'get' | 'post' | 'put' | 'patch'; path: string; summary: string; tag: string; body?: z.ZodType; auth?: 'user' | 'any' | 'none'; scopes?: string[] };

const ops: Op[] = [
  { method: 'post', path: '/auth/login', summary: 'Email + password → access JWT (15 min) and rotating refresh token', tag: 'Auth', body: S.LoginBody, auth: 'none' },
  { method: 'post', path: '/auth/refresh', summary: 'Rotate refresh token (reuse revokes the session family)', tag: 'Auth', body: S.RefreshBody, auth: 'none' },
  { method: 'post', path: '/auth/logout', summary: 'Revoke the refresh-token family', tag: 'Auth', body: S.RefreshBody, auth: 'none' },
  { method: 'post', path: '/oauth/token', summary: 'OAuth 2.0 client credentials for supplier systems (form or JSON, Basic auth supported)', tag: 'Auth', body: S.ClientCredentialsBody, auth: 'none' },
  { method: 'get', path: '/api/v1/rfx', summary: 'List sourcing events', tag: 'Sourcing' },
  { method: 'post', path: '/api/v1/rfx', summary: 'Create an RFI / RFQ / RFP with line items and invited suppliers', tag: 'Sourcing', body: S.CreateRfxBody },
  { method: 'get', path: '/api/v1/rfx/{id}', summary: 'Get one sourcing event', tag: 'Sourcing' },
  { method: 'post', path: '/api/v1/rfx/{id}/publish', summary: 'Publish to invited suppliers', tag: 'Sourcing' },
  { method: 'get', path: '/api/v1/rfx/{id}/bids', summary: 'Sealed bid status (prices only after closing)', tag: 'Sourcing' },
  { method: 'post', path: '/api/v1/rfx/{id}/close', summary: 'Close bidding and open the seals', tag: 'Sourcing' },
  { method: 'get', path: '/api/v1/rfx/{id}/levelling', summary: 'Bid levelling matrix', tag: 'Sourcing' },
  { method: 'post', path: '/api/v1/rfx/{id}/award', summary: 'Award (creates the contract via the rfx.awarded event)', tag: 'Sourcing', body: S.AwardBody },
  { method: 'get', path: '/api/v1/contracts', summary: 'List contracts', tag: 'Contracts' },
  { method: 'get', path: '/api/v1/contracts/{id}', summary: 'Contract with schedule of values and revisions', tag: 'Contracts' },
  { method: 'get', path: '/api/v1/contracts/{id}/change-orders', summary: 'Change orders on a contract', tag: 'Change orders' },
  { method: 'post', path: '/api/v1/contracts/{id}/change-orders', summary: 'Draft a change order', tag: 'Change orders', body: S.ChangeOrderBody },
  { method: 'get', path: '/api/v1/change-orders/{id}', summary: 'Get a change order (ETag = version)', tag: 'Change orders' },
  { method: 'put', path: '/api/v1/change-orders/{id}', summary: 'Edit / rework (If-Match required for optimistic concurrency)', tag: 'Change orders', body: S.ChangeOrderBody },
  { method: 'post', path: '/api/v1/change-orders/{id}/submit', summary: 'Submit for approval (steps from the delegation-of-authority policy)', tag: 'Change orders' },
  { method: 'post', path: '/api/v1/change-orders/{id}/decision', summary: 'Approve or reject the current step', tag: 'Change orders', body: S.DecisionBody },
  { method: 'post', path: '/api/v1/change-orders/{id}/withdraw', summary: 'Withdraw', tag: 'Change orders' },
  { method: 'get', path: '/api/v1/audit/{entityId}', summary: 'Audit trail for an entity', tag: 'Audit' },
  { method: 'get', path: '/supplier/v1/rfx', summary: 'Events the supplier is invited to', tag: 'Supplier API', auth: 'any', scopes: ['rfx:read'] },
  { method: 'get', path: '/supplier/v1/rfx/{id}', summary: 'One invited event', tag: 'Supplier API', auth: 'any', scopes: ['rfx:read'] },
  { method: 'put', path: '/supplier/v1/rfx/{id}/bid', summary: 'Submit or revise a sealed bid; returns a seal receipt', tag: 'Supplier API', body: S.BidBody, auth: 'any', scopes: ['bids:write'] },
];

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of ops) {
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(params.length ? { parameters: params } : {}),
      ...(op.auth === 'none' ? { security: [] } : op.auth === 'any' ? { security: [{ clientCredentials: op.scopes ?? [] }, { bearer: [] }] } : {}),
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(op.body, { io: 'input', unrepresentable: 'any' }) } } } } : {}),
      responses: {
        '200': { description: 'OK' },
        '4XX': { description: 'Error', content: { 'application/json': { schema: z.toJSONSchema(S.ErrorBody, { unrepresentable: 'any' }) } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Procurement & contracts PoC API',
      version: '0.1.0',
      description: 'RFx sourcing → award → contract → change orders. Money is integer minor units.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        clientCredentials: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: '/oauth/token', scopes: { 'rfx:read': 'Read invited events', 'bids:write': 'Submit bids', 'contracts:read': 'Read own contracts' } } } },
      },
    },
    security: [{ bearer: [] }],
    paths,
  };
}
