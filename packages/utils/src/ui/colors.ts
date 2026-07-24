/**
 * @module color.utils
 * @description Utilities for color manipulation and contrast calculations.
 */

/**
 * Calculates the relative luminance of a color according to the WCAG formula.
 * Formula: 0.2126 * R + 0.7152 * G + 0.0722 * B
 * where R, G, B are normalized to [0, 1] using sRGB standards.
 * 
 * @param {string} hex - The hex color string (e.g., "#FFFFFF" or "000").
 * @returns {number} - The calculated luminance value between 0 and 1.
 */
function getLuminance(hex: string): number {
    const rgb = hex.startsWith('#') ? hex.slice(1) : hex;
    const r = parseInt(rgb.substring(0, 2), 16) / 255;
    const g = parseInt(rgb.substring(2, 4), 16) / 255;
    const b = parseInt(rgb.substring(4, 6), 16) / 255;

    const [R, G, B] = [r, g, b].map(v => {
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Exports the structure of testing.
 */
export const colorTesting = { getLuminance }

/**
 * Determines whether white or black text provides better contrast against a given background color.
 * Useful for dynamic UI components where the background color can vary.
 * 
 * @param {string} hexColor - The hex color string to check against.
 * @returns {'white' | 'black'} - The color that provides optimal contrast.
 * 
 * @example
 * ```typescript
 * const textColor = getContrastColor('#000000'); // Returns 'white'
 * const textColor = getContrastColor('#FFFFFF'); // Returns 'black'
 * ```
 */
export function getContrastColor(hexColor: string): 'white' | 'black' {
    if (!hexColor) return 'white';

    // Normalize hex color
    const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;

    // Handle short hex codes (e.g. #000)
    let fullHex = hex;
    if (hex.length === 3) {
        fullHex = hex.split('').map(c => c + c).join('');
    }

    const luminance = getLuminance(fullHex);

    // WCAG threshold for contrast is usually 4.5:1 for normal text
    // The simplified luminance threshold is often around 0.179
    // If luminance > 0.179, use black text, otherwise use white text
    return luminance > 0.179 ? 'black' : 'white';
}

/**
 * Ensures a hex color string is correctly prefixed with '#'.
 * If the input is empty or invalid, it defaults to black ('#000000').
 * 
 * @param {string} color - The input color string.
 * @returns {string} - The normalized hex color string.
 */
export function ensureHexPrefix(color: string): string {
    if (!color) return '#000000';
    return color.startsWith('#') ? color : `#${color}`;
}

