/**
 * All possible phone types supported by international standards or common use cases.
 * This serves as a master list for utility functions.
 */
export const PHONE_TYPE = {
  MOBILE: 'MOBILE',
  LANDLINE: 'LANDLINE',
  SATTELITE: 'SATTELITE',
  VOIP: 'VOIP',
  PAGER: 'PAGER',
  DEFAULT: 'DEFAULT',
} as const

/**
 * Type representing any supported phone category.
 */
export type PhoneType = (typeof PHONE_TYPE)[keyof typeof PHONE_TYPE]
