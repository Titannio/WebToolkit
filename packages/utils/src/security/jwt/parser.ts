/**
 * @module auth.utils
 * @description Authentication-related utility functions.
 */

import type { JwtPayload } from './types.js';

/**
 * Parses a JSON Web Token (JWT) payload without verifying the signature.
 * 
 * This client-side safe parser uses standard web APIs (`atob`, `decodeURIComponent`) 
 * making it compatible with both browser and Node.js environments.
 * 
 * @param {string} token - The encoded JWT string.
 * @returns {JwtPayload} - The decoded payload object or an empty object if the token is malformed.
 */
export function parseJwt(token: string): JwtPayload {
    try {
        const base64Url = token.split('.')[1];
        if (!base64Url) return {};
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload) as JwtPayload;
    } catch (e) {
        console.error('Failed to parse JWT', e);
        return {};
    }
}


