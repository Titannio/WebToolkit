/**
 * @module auth.types
 * @description Authentication-related types and interfaces.
 */

/**
 * @description Minimal interface for a JWT (JSON Web Token) Payload.
 */
export interface JwtPayload {
  /** @type {string | undefined} - Subject identifier. */
  sub?: string;
  /** @type {number | undefined} - Issued at timestamp. */
  iat?: number;
  /** @type {number | undefined} - Expiration timestamp. */
  exp?: number;
  /** @type {unknown} - Custom claims. */
  [key: string]: unknown;
}

/**
 * Type-only marker used to keep this module in runtime export maps.
 */
export const __authTypes = true as const;

