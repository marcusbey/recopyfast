import { cn } from '../utils/cn'

describe('cn utility function', () => {
  it('should combine class names correctly', () => {
    expect(cn('class1', 'class2')).toBe('class1 class2')
  })

  it('should handle conditional classes', () => {
    expect(cn('class1', false && 'class2', 'class3')).toBe('class1 class3')
    expect(cn('class1', true && 'class2', 'class3')).toBe('class1 class2 class3')
  })

  it('should merge Tailwind classes correctly', () => {
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500')
    expect(cn('px-4 py-2', 'px-6')).toBe('py-2 px-6')
  })

  it('should handle objects', () => {
    expect(cn({ 'class1': true, 'class2': false })).toBe('class1')
  })

  it('should handle arrays', () => {
    expect(cn(['class1', 'class2'])).toBe('class1 class2')
  })

  it('should handle empty inputs', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
    expect(cn(null, undefined)).toBe('')
  })

  it('should handle complex combinations', () => {
    expect(cn(
      'base-class',
      {
        'conditional-class': true,
        'false-class': false
      },
      ['array-class1', 'array-class2'],
      'final-class'
    )).toBe('base-class conditional-class array-class1 array-class2 final-class')
  })
})