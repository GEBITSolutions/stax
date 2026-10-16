import { evaluateRunner } from '../src/evaluateRunner.js'

describe('evaluateRunner', () => {
  it('should replace dots with hyphens', () => {
    const result = evaluateRunner('runner.name.test')
    expect(result).toBe('runner-name-test')
  })

  it('should return empty string when runner is undefined', () => {
    const result = evaluateRunner(undefined)
    expect(result).toBe('')
  })

  it('should return empty string when runner is empty string', () => {
    const result = evaluateRunner('')
    expect(result).toBe('')
  })

  it('should handle runner with no dots', () => {
    const result = evaluateRunner('runner')
    expect(result).toBe('runner')
  })

  it('should handle runner with multiple consecutive dots', () => {
    const result = evaluateRunner('runner..test')
    expect(result).toBe('runner--test')
  })

  it('should handle runner with dots at start and end', () => {
    const result = evaluateRunner('.runner.test.')
    expect(result).toBe('-runner-test-')
  })

  it('should handle runner with single dot', () => {
    const result = evaluateRunner('.')
    expect(result).toBe('-')
  })

  it('should preserve existing hyphens', () => {
    const result = evaluateRunner('runner-name.test')
    expect(result).toBe('runner-name-test')
  })

  it('should handle mixed special characters (dots and other chars)', () => {
    const result = evaluateRunner('runner.name_test')
    expect(result).toBe('runner-name_test')
  })

  it('should handle numbers and dots', () => {
    const result = evaluateRunner('runner.v1.2.3')
    expect(result).toBe('runner-v1-2-3')
  })

  it('should handle whitespace with dots', () => {
    const result = evaluateRunner('runner name.test')
    expect(result).toBe('runner name-test')
  })

  it('should handle only dots', () => {
    const result = evaluateRunner('...')
    expect(result).toBe('---')
  })

  it('should handle very long strings with dots', () => {
    const longString = 'a'.repeat(100) + '.' + 'b'.repeat(100)
    const result = evaluateRunner(longString)
    expect(result).toBe('a'.repeat(100) + '-' + 'b'.repeat(100))
  })

  it('should handle special characters like slashes with dots', () => {
    const result = evaluateRunner('runner/path.test')
    expect(result).toBe('runner/path-test')
  })
})
