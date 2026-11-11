# ADR-0003: Short-lived JWT access tokens, rotating refresh tokens, OAuth 2.0 client credentials for suppliers

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Tech lead, security reviewer

## Context

Two kinds of callers: people in the web app (buyers, project managers, commercial managers,
directors, supplier staff) and supplier systems that push bids from their own ERP. Sessions must be
revocable, and a stolen refresh token must not give indefinite access.

## Decision

- **Access token:** JWT (HS256 in this PoC, asymmetric keys + JWKS in production), 15 minutes, claims
  `sub`, `tid` (tenant), `roles`, `sid` (supplier id), `iss`, `aud`, `jti`. Verified on every request;
  tenant and supplier scoping come from the token, never from request parameters.
- **Refresh token:** opaque random 256-bit value, only its SHA-256 is stored, 7 days, **rotated on every
  use** within a token family. Presenting a token that was already used revokes the whole family
  (reuse detection, as in the OAuth 2.0 Security BCP).
- **Supplier systems:** OAuth 2.0 **client credentials** (`POST /oauth/token`, HTTP Basic or body),
  secrets hashed with scrypt, scopes `rfx:read bids:write contracts:read`, 10-minute tokens with no
  refresh. Client tokens are rejected outside `/supplier/v1`, and permissions require both the role
  and the scope.
- **Authorisation:** one role → permission matrix (`shared/actor.ts`) checked in the services, plus
  resource rules in the domain (only invited suppliers see an event; suppliers only see their own
  contracts; segregation of duties on approvals).

## Consequences

- Login and refresh responses are `Cache-Control: no-store`; refresh tokens should live in an
  `HttpOnly; Secure; SameSite=Strict` cookie in the real web app (the PoC returns JSON for API clients).
- Production follow-ups: an external IdP (OIDC) for staff SSO, asymmetric signing with key rotation,
  rate limiting and lockout on `/auth/login`, mTLS or private-key JWT for high-value supplier clients.
