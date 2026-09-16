/**
 * Recognize an intrinsic constructor across JavaScript engines without
 * accepting user-authored function bodies.
 * @param source - result of `Function.prototype.toString` for the candidate.
 * @param name - expected intrinsic constructor name.
 * @returns whether only whitespace differs from the native-function form.
 */
export function isIntrinsicConstructorSource(source: string, name: 'Array' | 'Object'): boolean {
  return source.replace(/\s+/g, ' ').trim() === `function ${name}() { [native code] }`
}
