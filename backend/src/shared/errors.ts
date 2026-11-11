export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'PRECONDITION_FAILED';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  PRECONDITION_FAILED: 412,
};

/** Base for every expected failure. The HTTP layer maps `code` to a status; the UI shows `message`. */
export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.status = STATUS[code];
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION', message, details);
  }
}
export class UnauthenticatedError extends DomainError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', message);
  }
}
export class ForbiddenError extends DomainError {
  constructor(message = 'You are not allowed to do this') {
    super('FORBIDDEN', message);
  }
}
export class NotFoundError extends DomainError {
  constructor(what: string, id: string) {
    super('NOT_FOUND', `${what} ${id} not found`);
  }
}
export class ConflictError extends DomainError {
  constructor(message: string) {
    super('CONFLICT', message);
  }
}
/** A lost race (stale version, same id created twice). Safe to retry the whole unit of work. */
export class ConcurrencyError extends ConflictError {
  constructor(message: string) {
    super(message);
  }
}
export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super('INVALID_STATE', message);
  }
}
export class PreconditionFailedError extends DomainError {
  constructor(message: string) {
    super('PRECONDITION_FAILED', message);
  }
}
