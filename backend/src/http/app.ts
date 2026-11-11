/**
 * Express 5 app. Thin controllers: authenticate, validate with zod, call a service, map errors.
 * Business rules (RBAC, state machines, sealed bids, approvals) live in the services so the browser
 * demo and the API enforce exactly the same thing.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import type { AuthService } from '../identity/auth.service.js';
import type { Platform } from '../platform.js';
import type { Actor } from '../shared/actor.js';
import { DomainError, ForbiddenError, UnauthenticatedError, ValidationError } from '../shared/errors.js';
import { buildOpenApi } from './openapi.js';
import * as S from './schemas.js';

type Locals = { actor: Actor; requestId: string };
const actorOf = (res: Response) => (res.locals as Locals).actor;

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  return schema.parse(value);
}

function etag(version: number) {
  return `W/"v${version}"`;
}

function parseIfMatch(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const m = header.match(/v?(\d+)/);
  if (!m) throw new ValidationError('If-Match must be an ETag returned by GET');
  return Number(m[1]);
}

export function createApp(deps: { platform: Platform; auth: AuthService }) {
  const { platform, auth } = deps;
  const { sourcing, contracts } = platform;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use((req, res, next) => {
    const id = (req.header('x-request-id') ?? '').slice(0, 64) || randomUUID();
    (res.locals as Locals).requestId = id;
    res.setHeader('x-request-id', id);
    next();
  });

  const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthenticatedError();
    (res.locals as Locals).actor = await auth.verify(token);
    next();
  };
  /** Interactive users only; machine (client-credentials) tokens are limited to /supplier. */
  const usersOnly = (_req: Request, res: Response, next: NextFunction) => {
    if (actorOf(res).scopes) throw new ForbiddenError('Client tokens may only call the supplier API');
    next();
  };
  const suppliersOnly = (_req: Request, res: Response, next: NextFunction) => {
    if (!actorOf(res).supplierId) throw new ForbiddenError('Supplier API is for supplier accounts and clients');
    next();
  };

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  const spec = buildOpenApi();
  app.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
  app.get('/docs', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline'; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data:");
    res.type('html').send(`<!doctype html><html><head><title>API docs</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/openapi.json', dom_id: '#ui' });</script></body></html>`);
  });

  // ---- Auth -------------------------------------------------------------------------------
  app.post('/auth/login', async (req, res) => {
    const body = parse(S.LoginBody, req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await auth.login(body.email, body.password));
  });
  app.post('/auth/refresh', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await auth.refresh(parse(S.RefreshBody, req.body).refresh_token));
  });
  app.post('/auth/logout', async (req, res) => {
    await auth.logout(parse(S.RefreshBody, req.body).refresh_token);
    res.status(204).end();
  });
  /** RFC 6749 §4.4 + RFC 6749 §5.2 error shape. Credentials via HTTP Basic or the body. */
  app.post('/oauth/token', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = S.ClientCredentialsBody.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'unsupported_grant_type', error_description: 'grant_type must be client_credentials' });
    let { client_id: id, client_secret: secret } = parsed.data;
    const basic = req.header('authorization')?.match(/^Basic (.+)$/i)?.[1];
    if (basic) [id, secret] = Buffer.from(basic, 'base64').toString('utf8').split(':') as [string, string];
    if (!id || !secret) return void res.status(401).json({ error: 'invalid_client' });
    try {
      res.json(await auth.clientCredentials(decodeURIComponent(id), decodeURIComponent(secret), parsed.data.scope));
    } catch (err) {
      if (err instanceof UnauthenticatedError) return void res.status(401).setHeader('WWW-Authenticate', 'Basic').json({ error: 'invalid_client' });
      if (err instanceof ValidationError) return void res.status(400).json({ error: 'invalid_scope', error_description: err.message });
      throw err;
    }
  });

  // ---- Buyer / project API ---------------------------------------------------------------
  const api = express.Router();
  api.use(authenticate, usersOnly);

  api.get('/rfx', async (_req, res) => {
    res.json({ data: await sourcing.list(actorOf(res)) });
  });
  api.post('/rfx', async (req, res) => {
    res.status(201).json(await sourcing.create(actorOf(res), parse(S.CreateRfxBody, req.body)));
  });
  api.get('/rfx/:id', async (req, res) => {
    res.json(await sourcing.get(actorOf(res), req.params.id as string));
  });
  api.post('/rfx/:id/publish', async (req, res) => {
    res.json(await sourcing.publish(actorOf(res), req.params.id as string));
  });
  api.get('/rfx/:id/bids', async (req, res) => {
    res.json({ data: await sourcing.bidSummaries(actorOf(res), req.params.id as string) });
  });
  api.post('/rfx/:id/close', async (req, res) => {
    res.json(await sourcing.close(actorOf(res), req.params.id as string));
  });
  api.get('/rfx/:id/levelling', async (req, res) => {
    res.json(await sourcing.levelling(actorOf(res), req.params.id as string));
  });
  api.post('/rfx/:id/award', async (req, res) => {
    const rfx = await sourcing.award(actorOf(res), req.params.id as string, parse(S.AwardBody, req.body));
    const contract = await contracts.byRfx(actorOf(res), rfx.id);
    res.json({ rfx, contractId: contract?.id ?? null });
  });

  api.get('/contracts', async (_req, res) => {
    res.json({ data: await contracts.list(actorOf(res)) });
  });
  api.get('/contracts/:id', async (req, res) => {
    const c = await contracts.get(actorOf(res), req.params.id as string);
    res.setHeader('ETag', etag(c.version)).json(c);
  });
  api.get('/contracts/:id/change-orders', async (req, res) => {
    res.json({ data: await contracts.listChangeOrders(actorOf(res), req.params.id as string) });
  });
  api.post('/contracts/:id/change-orders', async (req, res) => {
    const co = await contracts.createChangeOrder(actorOf(res), req.params.id as string, parse(S.ChangeOrderBody, req.body));
    res.status(201).setHeader('ETag', etag(co.version)).json(co);
  });
  api.get('/change-orders/:id', async (req, res) => {
    const co = await contracts.getChangeOrder(actorOf(res), req.params.id as string);
    res.setHeader('ETag', etag(co.version)).json(co);
  });
  api.put('/change-orders/:id', async (req, res) => {
    const expected = parseIfMatch(req.header('if-match'));
    if (expected === undefined) return void res.status(428).json({ error: { code: 'PRECONDITION_REQUIRED', message: 'Send If-Match with the ETag from GET' } });
    const co = await contracts.updateChangeOrder(actorOf(res), req.params.id as string, parse(S.ChangeOrderBody, req.body), expected);
    res.setHeader('ETag', etag(co.version)).json(co);
  });
  api.post('/change-orders/:id/submit', async (req, res) => {
    res.json(await contracts.submit(actorOf(res), req.params.id as string));
  });
  api.post('/change-orders/:id/decision', async (req, res) => {
    res.json(await contracts.decide(actorOf(res), req.params.id as string, parse(S.DecisionBody, req.body)));
  });
  api.post('/change-orders/:id/withdraw', async (req, res) => {
    res.json(await contracts.withdraw(actorOf(res), req.params.id as string));
  });
  api.get('/audit/:entityId', async (req, res) => {
    res.json({ data: await contracts.auditTrail(actorOf(res), req.params.entityId as string) });
  });
  app.use('/api/v1', api);

  // ---- Supplier API (supplier users or client-credentials tokens) -----------------------------
  const supplier = express.Router();
  supplier.use(authenticate, suppliersOnly);
  supplier.get('/rfx', async (_req, res) => {
    res.json({ data: await sourcing.list(actorOf(res)) });
  });
  supplier.get('/rfx/:id', async (req, res) => {
    res.json(await sourcing.get(actorOf(res), req.params.id as string));
  });
  supplier.put('/rfx/:id/bid', async (req, res) => {
    res.json(await sourcing.submitBid(actorOf(res), req.params.id as string, parse(S.BidBody, req.body)));
  });
  app.use('/supplier/v1', supplier);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such route' } });
  });

  // ---- Errors -------------------------------------------------------------------------------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const requestId = (res.locals as Locals).requestId;
    if (err instanceof ZodError) {
      return void res.status(400).json({ error: { code: 'VALIDATION', message: 'Request body is invalid', details: z.flattenError(err), requestId } });
    }
    if (err instanceof DomainError) {
      if (err.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
      return void res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}), requestId } });
    }
    const status = (err as { status?: number; type?: string }).status;
    if (status === 400 || status === 413) {
      return void res.status(status).json({ error: { code: 'VALIDATION', message: status === 413 ? 'Payload too large' : 'Malformed JSON', requestId } });
    }
    console.error(`[${requestId}]`, err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected error', requestId } });
  });

  return app;
}
