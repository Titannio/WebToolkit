import { describe, it, expect } from 'vitest'
import { PHONE_TYPE } from '@src/types/phone.js'
import { getCountryConfig, detectPhoneMaskType } from '@src/countries/phone-masks.js'

describe('countries/phone-masks', () => {
  it('should resolve country config case-insensitively and with leading plus', () => {
    expect(getCountryConfig('br')?.countryCode).toBe('+55')
    expect(getCountryConfig('+us')?.name).toBe('United States')
    expect(getCountryConfig('ZZ')).toBeUndefined()
  })

  it('should detect phone types for brazilian numbers in all branches', () => {
    const br = getCountryConfig('BR')
    expect(br).toBeDefined()
    if (!br) throw new Error('BR config must exist')

    expect(detectPhoneMaskType('+5511912345678', br)).toBe(PHONE_TYPE.MOBILE)
    expect(detectPhoneMaskType('+551132165432', br)).toBe(PHONE_TYPE.LANDLINE)

    expect(detectPhoneMaskType('912345678', br)).toBe(PHONE_TYPE.MOBILE)
    expect(detectPhoneMaskType('32165432', br)).toBe(PHONE_TYPE.LANDLINE)
    expect(detectPhoneMaskType('11912345678', br)).toBe(PHONE_TYPE.MOBILE)
    expect(detectPhoneMaskType('1132165432', br)).toBe(PHONE_TYPE.LANDLINE)
    expect(detectPhoneMaskType('+55123', br)).toBe(PHONE_TYPE.LANDLINE)
  })

  it('should detect phone types from the configured regexes for non-BR countries', () => {
    const uk = getCountryConfig('UK')
    const india = getCountryConfig('IN')

    expect(uk).toBeDefined()
    expect(india).toBeDefined()
    if (!uk || !india) throw new Error('Country config must exist')

    expect(detectPhoneMaskType('+447911123456', uk)).toBe(PHONE_TYPE.MOBILE)
    expect(detectPhoneMaskType('+442079460958', uk)).toBe(PHONE_TYPE.LANDLINE)
    expect(detectPhoneMaskType('7911123456', uk)).toBe(PHONE_TYPE.MOBILE)
    expect(detectPhoneMaskType('2079460958', uk)).toBe(PHONE_TYPE.LANDLINE)

    expect(detectPhoneMaskType('+919876543210', india)).toBe(PHONE_TYPE.MOBILE)
    expect(detectPhoneMaskType('9876543210', india)).toBe(PHONE_TYPE.MOBILE)
  })

  it('should prefer the most specific partial local match instead of a country-specific heuristic', () => {
    const custom = {
      name: 'Custom',
      countryCode: '+99',
      masks: [
        {
          type: PHONE_TYPE.MOBILE,
          mask: '## #####-####',
          regex: '^\\+99\\d{2}9\\d{8}$',
          example: '+99 11 91234-5678',
        },
        {
          type: PHONE_TYPE.LANDLINE,
          mask: '## ####-####',
          regex: '^\\+99\\d{10}$',
          example: '+99 11 1234-5678',
        },
      ],
    }

    expect(detectPhoneMaskType('912345678', custom)).toBe(PHONE_TYPE.MOBILE)
    expect(detectPhoneMaskType('32165432', custom)).toBe(PHONE_TYPE.LANDLINE)
  })

  it('should fallback to default type when no mask matches', () => {
    const custom = {
      name: 'No masks',
      countryCode: '+999',
      masks: [],
    }

    expect(detectPhoneMaskType('1', custom)).toBe(PHONE_TYPE.DEFAULT)
  })
})
