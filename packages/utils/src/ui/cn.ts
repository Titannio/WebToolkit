/**
 * @module cn
 * @description Utility for merging Tailwind CSS classes with conditional logic.
 * Combines the power of `clsx` for conditional classes and `tailwind-merge` to resolve conflicts.
 */

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Combines CSS classes conditionally and ensures that Tailwind classes are merged correctly.
 * 
 * Features:
 * - Conditional Classes: Handles objects, arrays, and boolean conditions via `clsx`.
 * - Conflict Resolution: Uses `tailwind-merge` to ensure the last class wins in case of Tailwind conflicts (e.g., `px-2 px-4` becomes `px-4`).
 * 
 * @param {ClassValue[]} inputs - A variadic list of class names, conditional objects, or arrays.
 * @returns {string} - A single string containing the merged and deduplicated class names.
 * 
 * @example
 * ```typescript
 * // Returns "px-2 py-1 bg-red-500"
 * cn("px-2 py-1 bg-blue-500", "bg-red-500")
 * 
 * // Returns "btn btn-active" if isActive is true
 * cn("btn", isActive && "btn-active")
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

