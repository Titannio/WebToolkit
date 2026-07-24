/**
 * @module security.utils
 * @description Security-related utilities for data masking and privacy.
 */

/**
 * @description Masks sensitive data like emails and phone numbers for privacy/compliance.
 * 
 * @param {string} text - The text to mask.
 * @param {'EMAIL' | 'PHONE'} type - The type of data ('EMAIL' | 'PHONE').
 * @returns {string} - The masked string.
 */
export function maskSensitiveData(text: string, type: 'EMAIL' | 'PHONE'): string {
  if (!text) return '';

  if (type === 'EMAIL') {
    const [local, domain] = text.split('@');
    if (!domain) return text; // Invalid email format

    if (local.length <= 2) {
      // Very short local part: a@domain.com -> a***@domain.com
      return `${local}***@${domain}`;
    }
    
    // Show first 2 characters: an***@domain.com
    const visibleStart = local.substring(0, 2);
    return `${visibleStart}***@${domain}`;
  }

  if (type === 'PHONE') {
    const hasPlusPrefix = text.trim().startsWith('+')
    const digits = text.replace(/\D/g, '')

    if (digits.length <= 4) return text

    const visiblePrefixLength = Math.min(2, Math.max(0, digits.length - 4))
    const visiblePrefix = digits.slice(0, visiblePrefixLength)
    const visibleSuffix = digits.slice(-4)
    const maskedLength = Math.max(0, digits.length - visiblePrefixLength - visibleSuffix.length)

    return `${hasPlusPrefix ? '+' : ''}${visiblePrefix}${'*'.repeat(maskedLength)}${visibleSuffix}`
  }

  return text;
}









