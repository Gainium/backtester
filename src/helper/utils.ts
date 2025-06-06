/**
 * Basic Utility Functions for Input Validation
 *
 * Provides simple utility functions for common validation tasks
 * and input sanitization used throughout the backtesting system.
 *
 * @fileoverview Basic validation and utility functions
 */

/**
 * Validates if a string represents a valid number
 *
 * Checks if the input string is non-empty and can be converted
 * to a valid number using JavaScript's number parsing.
 *
 * @param num - String to validate as a number
 * @returns True if the string represents a valid number
 *
 * @example
 * ```typescript
 * checkNumber("123.45"); // true
 * checkNumber(""); // false
 * checkNumber("abc"); // false
 * checkNumber(undefined); // false
 * ```
 */
export const checkNumber = (num?: string) => {
  return num && num !== '' && !isNaN(+num)
}
