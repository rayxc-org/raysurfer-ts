/**
 * RaySurfer SDK errors
 */

/** Base error for RaySurfer SDK */
export class RaySurferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RaySurferError";
  }
}

/** API returned an error response */
export class APIError extends RaySurferError {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
  }
}

/** Authentication failed */
export class AuthenticationError extends RaySurferError {
  constructor(message: string = "Invalid API key") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Cache backend is unreachable */
export class CacheUnavailableError extends RaySurferError {
  statusCode: number;

  constructor(
    message: string = "Cache backend is unreachable",
    statusCode: number = 503,
  ) {
    super(message);
    this.name = "CacheUnavailableError";
    this.statusCode = statusCode;
  }
}

/** Rate limit exceeded */
export class RateLimitError extends RaySurferError {
  retryAfter?: number;

  constructor(message: string = "Rate limit exceeded", retryAfter?: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/** Validation failed */
export class ValidationError extends RaySurferError {
  field?: string;

  constructor(message: string = "Validation failed", field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}
