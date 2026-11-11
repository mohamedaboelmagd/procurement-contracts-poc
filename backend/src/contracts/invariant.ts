/** A bug, not a user error: an invariant that the code is supposed to guarantee was broken. */
export class InvariantError extends Error {
  constructor(message: string) {
    super(`Invariant violated: ${message}`);
    this.name = 'InvariantError';
  }
}
