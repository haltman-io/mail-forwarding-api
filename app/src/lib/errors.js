"use strict";

/**
 * @fileoverview Application error hierarchy.
 */

/**
 * Base application error with a status code and public error code.
 */
class AppError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {number} statusCode
   * @param {boolean} expose
   */
  constructor(message, code, statusCode, expose = true) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

class ValidationError extends AppError {
  constructor(message = "Validation failed", code = "invalid_params") {
    super(message, code, 400, true);
  }
}

class AuthError extends AppError {
  constructor(message = "Unauthorized", code = "unauthorized") {
    super(message, code, 401, true);
  }
}

class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "forbidden") {
    super(message, code, 403, true);
  }
}

class NotFoundError extends AppError {
  constructor(message = "Not found", code = "not_found") {
    super(message, code, 404, true);
  }
}

class ConflictError extends AppError {
  constructor(message = "Conflict", code = "conflict") {
    super(message, code, 409, true);
  }
}

class RateLimitError extends AppError {
  constructor(message = "Rate limited", code = "rate_limited") {
    super(message, code, 429, true);
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
};
