import { describe, expect, it } from 'vitest'
import { isIntrinsicConstructorSource } from '../src/intrinsic.ts'

describe('isIntrinsicConstructorSource', () => {
  it('accepts native constructor rendering from Node and JavaScriptCore', () => {
    expect(isIntrinsicConstructorSource('function Object() { [native code] }', 'Object')).toBe(true)
    expect(isIntrinsicConstructorSource('function Object() {\n    [native code]\n}', 'Object')).toBe(true)
    expect(isIntrinsicConstructorSource('function Array() {\n    [native code]\n}', 'Array')).toBe(true)
  })

  it('rejects another constructor and user-authored bodies', () => {
    expect(isIntrinsicConstructorSource('function Array() { [native code] }', 'Object')).toBe(false)
    expect(isIntrinsicConstructorSource('function Object() { return {}; }', 'Object')).toBe(false)
    expect(isIntrinsicConstructorSource('function Object() { /* [native code] */ }', 'Object')).toBe(false)
  })
})
