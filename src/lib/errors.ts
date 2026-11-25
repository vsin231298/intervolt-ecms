/** An error whose message is safe to show to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
export class ForbiddenError extends UserError {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
export class NotFoundError extends UserError {
  constructor(what = "Record") {
    super(`${what} not found.`);
    this.name = "NotFoundError";
  }
}
export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new UserError(message);
}
