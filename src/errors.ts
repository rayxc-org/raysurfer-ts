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
