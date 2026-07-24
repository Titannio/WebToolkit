import { describe, it, expect } from 'vitest'
import { cn } from '@src/ui/cn.js'

describe('cn', () => {
  it('should merge tailwind classes', () => {
    const isHidden = false
    const result = cn('px-2', 'px-4', isHidden && 'hidden')
    expect(result).toContain('px-4')
    expect(result).not.toContain('px-2')
    expect(result).not.toContain('hidden')
  })
})
