import { describe, it, expect } from 'vitest';
import { PHONE_TYPE } from '@src/types/phone.js';

describe('Phone Types', () => {
  it('should have correct phone types', () => {
    expect(PHONE_TYPE).toEqual({
      MOBILE: 'MOBILE',
      LANDLINE: 'LANDLINE',
      SATTELITE: 'SATTELITE',
      VOIP: 'VOIP',
      PAGER: 'PAGER',
      DEFAULT: 'DEFAULT',
    });
  });
});
