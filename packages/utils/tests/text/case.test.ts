import { describe, expect, it } from 'vitest'
import { toCamelCase, toKebabCase, toPascalCase } from '@src/text/case.js'

describe('case utils', () => {
  it('should convert words and separators to kebab-case', () => {
    expect(toKebabCase('Exam Type')).toBe('exam-type')
    expect(toKebabCase('exam_type')).toBe('exam-type')
    expect(toKebabCase('examType')).toBe('exam-type')
  })

  it('should convert words to camelCase', () => {
    expect(toCamelCase('exam-type')).toBe('examType')
    expect(toCamelCase('Exam Type')).toBe('examType')
  })

  it('should convert words to PascalCase', () => {
    expect(toPascalCase('exam-type')).toBe('ExamType')
    expect(toPascalCase('exam type')).toBe('ExamType')
  })

  it('should return empty string when no identifier parts exist', () => {
    expect(toKebabCase('---')).toBe('')
    expect(toCamelCase('---')).toBe('')
    expect(toPascalCase('---')).toBe('')
  })
})
