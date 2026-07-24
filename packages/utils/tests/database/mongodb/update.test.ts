import { describe, expect, it } from 'vitest'
import { toSetPaths } from '@src/database/mongodb/update.js'

describe('mongo/update', () => {
  it('flattens simple objects into dot notation', () => {
    expect(
      toSetPaths({
        personInfo: {
          personFullname: 'Maria Silva',
          personCPF: '12345678901',
        },
      }),
    ).toEqual({
      'personInfo.personFullname': 'Maria Silva',
      'personInfo.personCPF': '12345678901',
    })
  })

  it('preserves Date as a leaf value', () => {
    const birthDate = new Date('1990-02-15T00:00:00.000Z')

    expect(
      toSetPaths({
        personInfo: {
          personBirthDate: birthDate,
        },
      }),
    ).toEqual({
      'personInfo.personBirthDate': birthDate,
    })
  })

  it('keeps arrays as leaf values instead of flattening them', () => {
    expect(
      toSetPaths({
        tags: ['a', 'b'],
        profile: {
          aliases: ['x', 'y'],
        },
      }),
    ).toEqual({
      tags: ['a', 'b'],
      'profile.aliases': ['x', 'y'],
    })
  })

  it('skips undefined values while preserving other leaves', () => {
    expect(
      toSetPaths({
        keep: 1,
        skip: undefined,
      }),
    ).toEqual({
      keep: 1,
    })
  })
})
