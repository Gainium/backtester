/**
 * Performance Debugging Decorator
 *
 * Provides a method decorator for measuring and logging execution time
 * of functions. Useful for performance analysis and optimization work.
 *
 * Features:
 * - Execution time measurement using console.time/timeEnd
 * - Optional argument logging for debugging
 * - Optional stack trace information
 * - Configurable prefix for method identification
 *
 * @fileoverview Performance debugging utilities
 */

/**
 * Decorator function for measuring method execution time
 *
 * Wraps a method to automatically measure and log its execution time.
 * Can optionally log arguments and stack trace information for debugging.
 *
 * @param prefix - Optional prefix for the timing label
 * @param showArgs - Whether to include method arguments in the log
 * @param trace - Whether to include stack trace information
 * @returns Method decorator function
 *
 * @example
 * ```typescript
 * class MyClass {
 *   @Debug('GridStrategy', true, false)
 *   processOrder(price: number, quantity: number) {
 *     // method implementation
 *   }
 * }
 *
 * // Output: GridStrategy processOrder args [100.5, 10]: 15.234ms
 * ```
 */
export function Debug(prefix?: string, showArgs?: boolean, trace?: boolean) {
  return (
    _target: unknown,
    _propertyKey: PropertyKey,
    descriptor: PropertyDescriptor,
  ) => {
    const fn = descriptor.value
    descriptor.value = function (...args: unknown[]) {
      const name = `${prefix ? `${prefix} ` : ''}${fn.name}${
        showArgs ? ` args ${JSON.stringify(args)}` : ''
      }${trace ? ` ${new Error().stack?.split('\n')[2]}` : ''}`
      console.time(name)
      const r = fn.apply(this, args)
      console.timeEnd(name)
      return r
    }
  }
}
