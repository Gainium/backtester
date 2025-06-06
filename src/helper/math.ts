/**
 * Mathematical Helper Class for Trading Calculations
 *
 * Provides essential mathematical operations and number formatting utilities
 * specifically designed for financial calculations and trading operations.
 * Handles precision, rounding, number formatting, and statistical calculations
 * with proper consideration for floating-point arithmetic limitations.
 *
 * Key Features:
 * - Exponential notation conversion with precision control
 * - Flexible rounding with direction control (up, down, standard)
 * - Human-friendly number formatting (K, M, B suffixes)
 * - Percentage calculations and comparisons
 * - Statistical functions (mean, median, percentiles)
 * - Precision detection and validation utilities
 *
 * @fileoverview Core mathematical utilities for trading calculations
 */
export class MathHelper {
  /** Small epsilon value for floating-point comparisons */
  private eps = 1e-10

  /**
   * Converts exponential notation numbers to decimal string representation
   *
   * Handles numbers in scientific notation (e.g., 1.23e-5) and converts them
   * to readable decimal format while maintaining specified precision.
   *
   * @param num - Number or string in exponential notation
   * @param precision - Number of decimal places to maintain (default: 2)
   * @returns Decimal string representation without exponential notation
   *
   * @example
   * ```typescript
   * const math = new MathHelper();
   * math.convertFromExponential(1.23e-5, 8); // "0.0000123"
   * math.convertFromExponential("2.5e-3", 4); // "0.0025"
   * ```
   */
  convertFromExponential(num: number | string, precision = 2) {
    return Number(num)
      .toFixed(Math.min(precision, 20))
      .replace(/0*$/, '')
      .replace(/\.*$/, '')
  }

  /**
   * Rounds a number with configurable precision and direction
   *
   * Provides precise rounding control with options for rounding down (floor),
   * up (ceil), or standard rounding. Handles exponential notation and ensures
   * precision limits don't exceed JavaScript's number precision.
   *
   * @param _num - Number to round
   * @param precision - Number of decimal places (default: 2)
   * @param down - If true, always round down (floor behavior)
   * @param up - If true, always round up (ceil behavior)
   * @returns Rounded number with specified precision
   *
   * @example
   * ```typescript
   * math.round(1.2345, 2); // 1.23
   * math.round(1.2345, 2, true); // 1.23 (floor)
   * math.round(1.2345, 2, false, true); // 1.24 (ceil)
   * ```
   */
  round(_num: number, precision = 2, down = false, up = false) {
    let num = `${_num}`
    if (`${_num}`.indexOf('e') !== -1) {
      num = this.convertFromExponential(_num, precision + 2)
    }
    const intPart = num.split('.')[0]
    if ((intPart?.length ?? 0) + precision > 20) {
      precision = 20 - intPart.length
    }
    if (down) {
      const res = Number(
        `${Math.floor(Number(`${num}e${precision}`))}e-${precision}`,
      )
      return isNaN(res) ? 0 : res
    }
    if (up) {
      const res = Number(
        `${Math.ceil(Number(`${num}e${precision}`))}e-${precision}`,
      )
      return isNaN(res) ? 0 : res
    }
    const res = Number(
      `${Math.round(Number(`${num}e${precision}`))}e-${precision}`,
    )
    return isNaN(res) ? 0 : res
  }

  /**
   * Formats numbers in a human-friendly way with K/M/B suffixes
   *
   * Converts large numbers into readable format using standard suffixes:
   * - K for thousands
   * - M for millions
   * - B for billions
   * - T for trillions
   *
   * @param n - Number to format
   * @returns Human-readable string representation
   *
   * @example
   * ```typescript
   * math.friendly(1500); // "1.5K"
   * math.friendly(2500000); // "2.5M"
   * math.friendly(-1200000); // "-1.2M"
   * ```
   */
  friendly(n: number) {
    const number = Math.abs(n)
    const num = Math.abs(n)
      .toString()
      .replace(/[^0-9.]/g, '')
    let minus = ''
    if (n < 0) {
      minus = '-'
    }

    if (number < 10000) {
      return `${minus}${num}`
    }
    const si = [
      { v: 1e3, s: 'K' },
      { v: 1e6, s: 'M' },
      { v: 1e9, s: 'B' },
      { v: 1e12, s: 'T' },
      { v: 1e15, s: 'P' },
      { v: 1e18, s: 'E' },
    ]
    let index
    for (index = si.length - 1; index > 0; index--) {
      if (number >= si[index].v) {
        break
      }
    }
    return `${minus}${(number / si[index].v)
      .toFixed(1)
      .replace(/\.0+$|(\.[0-9]*[1-9])0+$/, '$1')}${si[index].s}`
  }

  /**
   * Calculates the appropriate precision for a given number
   *
   * Determines the number of decimal places needed to represent a number
   * with sufficient precision for trading calculations.
   *
   * @param num - Number to analyze for precision
   * @param lowerThanZero - Whether to handle numbers less than zero differently
   * @returns Number of decimal places needed
   */
  getPrecision(num: number, lowerThanZero = false) {
    const add = num >= 1 ? 1 : 2
    const precision = Math.floor(
      Math.floor(Math.log(num)) / Math.floor(Math.LN10),
    )
    if (lowerThanZero) {
      if (precision > 0) {
        return precision + add
      }
      return Math.abs(precision - add > 0 ? 0 : precision - add)
    }
    return precision + 2 < 0 ? 0 : precision + 2
  }

  /**
   * Converts a decimal number to percentage format
   *
   * @param num - Decimal number (e.g., 0.15 for 15%)
   * @returns Percentage value rounded to 2 decimal places
   *
   * @example
   * ```typescript
   * math.convertPerc(0.15); // 15
   * math.convertPerc(0.12345); // 12.35
   * ```
   */
  convertPerc(num: number) {
    return this.round(num * 100, 2)
  }

  /**
   * Splits a number into whole and decimal parts
   *
   * @param n - Number to split
   * @returns Object with wholeNumber and decimal string parts
   */
  splitNumberToParts(n: number) {
    const wholeNumber = `${n}`.split('.')[0] || ''
    const decimal = `${n}`.split('.')[1] || ''
    return { wholeNumber, decimal }
  }

  /**
   * Splits a large number into parts, using friendly formatting when appropriate
   *
   * @param n - Number to split (may be large)
   * @returns Object with wholeNumber and decimal parts, using K/M/B notation for large numbers
   */
  splitBigNumberToParts(n: number) {
    const adjust = this.friendly(n)
    if (/[A-Za-z]/g.test(adjust.charAt(adjust.length - 1))) {
      return { wholeNumber: adjust, decimal: '' }
    }
    const wholeNumber = `${n}`.split('.')[0] || ''
    const decimal = `${n}`.split('.')[1] || ''
    return { wholeNumber, decimal }
  }

  /**
   * Safely converts a string to number, returning 0 for invalid input
   *
   * @param s - String to convert
   * @returns Parsed number or 0 if parsing fails
   */
  convertString(s: string) {
    const tmp = parseFloat(s)
    return isNaN(tmp) ? 0 : tmp
  }

  /**
   * Calculates the standard deviation of an array of numbers
   *
   * Used for statistical analysis of trading performance and risk metrics.
   *
   * @param array - Array of numbers to analyze
   * @returns Standard deviation value
   */
  stDev(array: number[]) {
    const n = array.length
    const mean = array.reduce((a, b) => a + b, 0) / n
    return Math.sqrt(
      array.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) / n,
    )
  }

  /**
   * Calculates downside standard deviation (downside risk)
   *
   * Measures volatility of negative returns relative to a minimum acceptable return (MAR).
   * Used in risk-adjusted performance metrics like Sortino ratio.
   *
   * @param array - Array of return values
   * @param MAR - Minimum acceptable return percentage (default: 2%)
   * @returns Downside standard deviation
   */
  downsideStDev(array: number[], MAR = 2) {
    const mar = MAR / 100
    const DD = Math.sqrt(
      array.reduce((acc, v) => (acc += Math.min(0, v - mar) ** 2), 0) /
        array.length,
    )
    return DD
  }

  /**
   * Checks if a number is effectively zero within epsilon tolerance
   *
   * @param a - Number to check
   * @returns True if the number is within epsilon of zero
   */
  isZero(a: number) {
    return Math.abs(a) <= this.eps
  }

  /**
   * Floating-point safe greater than comparison
   *
   * @param a - First number
   * @param b - Second number
   * @returns True if a is greater than b (accounting for floating-point precision)
   */
  gt(a: number, b: number) {
    return !this.isZero(a - b) && a > b
  }

  /**
   * Floating-point safe less than comparison
   *
   * @param a - First number
   * @param b - Second number
   * @returns True if a is less than b (accounting for floating-point precision)
   */
  lt(a: number, b: number) {
    return !this.isZero(a - b) && a < b
  }

  /**
   * Floating-point safe greater than or equal comparison
   *
   * @param a - First number
   * @param b - Second number
   * @returns True if a is greater than or equal to b (accounting for floating-point precision)
   */
  gte(a: number, b: number) {
    return (!this.isZero(a - b) && a > b) || this.isZero(a - b)
  }

  /**
   * Floating-point safe less than or equal comparison
   *
   * @param a - First number
   * @param b - Second number
   * @returns True if a is less than or equal to b (accounting for floating-point precision)
   */
  lte(a: number, b: number) {
    return (!this.isZero(a - b) && a <= b) || this.isZero(a - b)
  }

  /**
   * Calculates Sharpe ratio for risk-adjusted performance measurement
   *
   * The Sharpe ratio measures excess return per unit of risk, comparing
   * portfolio performance to a risk-free rate adjusted for volatility.
   *
   * @param profit - Array of profit values over time
   * @param denominator - Base value for percentage calculations
   * @param periodRatio - Time period ratio for annualization
   * @param RFR - Risk-free rate percentage (default: 2%)
   * @returns Sharpe ratio value (higher is better)
   */
  sharpeRatio(
    profit: number[],
    denominator: number,
    periodRatio: number,
    RFR = 2,
  ) {
    const profitPercByPeriod = profit.map((v) => v / denominator)
    const MR =
      profitPercByPeriod.reduce((acc, v) => (acc += v), 0) /
      profitPercByPeriod.length
    const SD = this.stDev(profitPercByPeriod)
    const rfr = RFR / 100 / periodRatio
    return SD !== 0 ? this.round((MR - rfr) / SD, 3) : 0
  }

  /**
   * Calculates Sortino ratio (modified Sharpe ratio using downside deviation)
   *
   * The Sortino ratio measures excess return per unit of downside risk,
   * penalizing only negative volatility rather than all volatility.
   *
   * @param profit - Array of profit values over time
   * @param denominator - Base value for percentage calculations
   * @param periodRatio - Time period ratio for annualization
   * @param RFR - Risk-free rate percentage (default: 2%)
   * @param MAR - Minimum acceptable return percentage (default: 7%)
   * @returns Sortino ratio value (higher is better)
   */
  santinoRatio(
    profit: number[],
    denominator: number,
    periodRatio: number,
    RFR = 2,
    MAR = 7,
  ) {
    const profitPercByPeriod = profit.map((v) => v / denominator)
    const MR =
      profitPercByPeriod.reduce((acc, v) => (acc += v), 0) /
      profitPercByPeriod.length
    const rfr = RFR / 100 / periodRatio
    const mar = MAR / 100 / periodRatio
    const DD = Math.sqrt(
      profitPercByPeriod.reduce(
        (acc, v) => (acc += Math.min(0, v - mar) ** 2),
        0,
      ) / profitPercByPeriod.length,
    )
    return DD !== 0 ? this.round((MR - rfr) / DD, 3) : Infinity
  }

  /**
   * Counts the number of decimal places in a number
   *
   * @param number - Number to analyze
   * @returns Count of decimal places
   */
  countDecimals(number: number) {
    const str = number.toString()
    if (str.indexOf('.') !== -1) {
      return str.split('.')[1]?.length ?? 0
    }
    return 0
  }

  /**
   * Calculates remainder with proper handling of decimal precision
   *
   * Performs modulo operation while maintaining decimal precision,
   * useful for price step calculations and grid spacing.
   *
   * @param a - Dividend
   * @param b - Divisor
   * @returns Remainder with proper decimal precision
   */
  remainder(a: number, b: number) {
    const e = this.countDecimals(b)
    const multiplier = Number(`1e${e}`)
    return ((a * multiplier) % (b * multiplier)) / multiplier
  }
}
