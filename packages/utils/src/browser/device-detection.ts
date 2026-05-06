/**
 * @module device-detection.utils
 * @description Utilities for detecting device types from user-agent strings.
 */

/**
 * Supported device categories used for UI adaptation and analytics.
 * 
 * These constants provide a unified way to refer to different device classes
 * throughout the frontend and backend logic.
 */
export const DEVICE_TYPE = {
    /** Smartphones and other small form-factor touch devices. */
    MOBILE: 'mobile',
    /** Tablets and medium form-factor touch devices (e.g., iPad, Galaxy Tab). */
    TABLET: 'tablet',
    /** Desktop computers, laptops, and large-screen workstations. */
    DESKTOP: 'desktop'
} as const

/**
 * Represents the type of device detected from a user-agent.
 * 
 * @see {@link DEVICE_TYPE}
 */
export type DeviceType = (typeof DEVICE_TYPE)[keyof typeof DEVICE_TYPE]

/**
 * Analyzes a user-agent string to determine the most likely device category.
 * 
 * This utility uses heuristic pattern matching to categorize devices. 
 * Tablet detection is prioritized over mobile detection because many tablets 
 * include the word "mobile" in their user-agent strings.
 * 
 * @param {string | undefined} userAgent - The raw User-Agent string from HTTP headers.
 * @returns {DeviceType | null} - The detected device category (mobile, tablet, or desktop) or null if the input is empty.
 * 
 * @example
 * detectDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)')
 * // returns 'mobile'
 * 
 * @example
 * detectDeviceType('Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)')
 * // returns 'tablet'
 * 
 * @example
 * detectDeviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...')
 * // returns 'desktop'
 */
export function detectDeviceType(userAgent: string | undefined): DeviceType | null {
    if (!userAgent) return null

    const ua = userAgent.toLowerCase()

    // Tablet detection (before mobile, as tablets often include "mobile")
    if (
        /(ipad|tablet|playbook|silk)/.test(ua) ||
        (/(android)/.test(ua) && !/(mobile)/.test(ua))
    ) {
        return DEVICE_TYPE.TABLET
    }

    // Mobile detection
    if (/(mobile|iphone|ipod|android|blackberry|opera mini|iemobile)/.test(ua)) {
        return DEVICE_TYPE.MOBILE
    }

    // Default to desktop
    return DEVICE_TYPE.DESKTOP
}









