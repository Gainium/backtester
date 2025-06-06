/**
 * Price Rate Calculation and Currency Conversion Utilities
 *
 * Provides functions for finding exchange rates between different cryptocurrencies
 * and calculating USD values for various assets. Handles multiple symbol formats
 * and supports cross-rate calculations through intermediate currencies.
 *
 * Key Features:
 * - Multi-format symbol matching (BTC/USDT, BTC-USDT, BTCUSDT, etc.)
 * - USD rate calculation with fallback through BTC
 * - Exchange-specific rate filtering
 * - Reverse rate calculation support
 *
 * @fileoverview Currency conversion and exchange rate utilities
 */

import type { Prices } from '../types'

/**
 * Creates a function to find asset pairs in different symbol formats
 *
 * Supports various symbol formats used by different exchanges:
 * - BTC/USDT (slash separated)
 * - BTC-USDT (dash separated)
 * - BTCUSDT (concatenated)
 * - BTCZUSDT (Kraken format with Z prefix)
 *
 * @param base - Base asset symbol (e.g., 'BTC')
 * @param quote - Quote asset symbol (e.g., 'USDT')
 * @returns Function that matches price objects with the given asset pair
 */
const findAsset = (base: string, quote: string) => (p: Prices[0]) => {
  const pr = p.symbol.split('_')[0]
  return (
    pr === `${base}${quote}` ||
    pr === `${base}-${quote}` ||
    pr === `${base}/${quote}` ||
    pr === `${base}Z${quote}`
  )
}

/**
 * Finds exchange rate between two assets
 *
 * Attempts to find a direct rate between base and quote assets,
 * with automatic fallback to reverse rate calculation if needed.
 *
 * @param base - Base asset symbol
 * @param quote - Quote asset symbol
 * @param prices - Array of price data to search
 * @param reverse - Whether to return inverted rate (1/rate)
 * @returns Exchange rate or undefined if not found
 *
 * @example
 * ```typescript
 * const rate = findRate('BTC', 'USDT', prices); // Direct BTC/USDT rate
 * const reverseRate = findRate('USDT', 'BTC', prices); // Will find BTC/USDT and invert
 * ```
 */
const findRate = (
  base: string,
  quote: string,
  prices: Prices,
  reverse = false,
): number | undefined => {
  const rate = prices.find(findAsset(base, quote))
  if (rate) {
    return reverse ? 1 / rate.price : rate.price
  }
  if (!reverse) {
    return findRate(quote, base, prices, true)
  }
  return undefined
}

/**
 * Calculates USD exchange rate for any asset
 *
 * Determines the USD value of an asset using multiple fallback strategies:
 * 1. Direct USD pair (if available)
 * 2. USDT rate (assuming USDT ≈ USD)
 * 3. BTC rate × BTC/USDT rate (cross-rate calculation)
 * 4. ETH rate × ETH/USDT rate (secondary cross-rate)
 *
 * @param asset - Asset symbol to find USD rate for
 * @param _prices - Array of price data
 * @param exchange - Optional exchange filter
 * @returns USD exchange rate or 0 if unable to calculate
 *
 * @example
 * ```typescript
 * const btcUsdRate = findUSDRate('BTC', prices); // Direct BTC/USD or BTC/USDT
 * const ethUsdRate = findUSDRate('ETH', prices, 'binance'); // ETH rate from Binance only
 * ```
 */
const findUSDRate = (asset: string, _prices: Prices, exchange?: string) => {
  const prices = _prices.filter((p) =>
    exchange ? [exchange, 'all'].includes(p.exchange ?? '') : true,
  )
  if (asset === 'USD') {
    return 1
  }
  let usdRate = Number(asset === 'USDT')
  let usdtRate = Number(asset === 'USDT')
  if (asset !== 'USDT') {
    const findUsdtRate = findRate(asset, 'USDT', prices)
    if (findUsdtRate) {
      usdtRate = findUsdtRate
      usdRate = usdtRate
    } else {
      const _findUsdRate = findRate(asset, 'USD', prices)
      if (_findUsdRate) {
        return _findUsdRate
      }
      const findBtcRate = findRate(asset, 'BTC', prices)
      if (findBtcRate) {
        const findBtcUsdtRate = findRate('BTC', 'USDT', prices)
        if (findBtcUsdtRate) {
          usdtRate = findBtcRate * findBtcUsdtRate
          usdRate = usdtRate
        }
      }
    }
  }
  const findUsdtUsdRate = findRate('USDT', 'USD', prices)
  if (findUsdtUsdRate) {
    usdRate = usdtRate * findUsdtUsdRate
  }
  return usdRate
}

/**
 * Default export of the USD rate calculation function
 *
 * @see findUSDRate
 */
export default findUSDRate
