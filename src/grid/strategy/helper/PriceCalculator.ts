/**
 * Grid Strategy Price Calculator
 *
 * Handles price calculations and USD rate conversions for the grid trading strategy.
 * Provides utilities for currency conversion, rate tracking, and liquidation price calculations.
 *
 * Key Responsibilities:
 * - USD exchange rate calculations and updates
 * - Price data management for multiple symbols
 * - Liquidation price calculations for futures trading
 * - Currency conversion utilities
 *
 * @fileoverview Price calculation utilities for grid trading strategy
 */

import findUSDRate from 'src/helper/price'
import { SharedData } from './SharedData'
import { PositionSide } from 'src/types'

/**
 * Price calculation utilities for grid trading strategy
 *
 * Provides methods for handling price conversions, USD rate tracking,
 * and liquidation price calculations for both spot and futures trading.
 */
export class PriceCalculator {
  /**
   * Update price array with current trading pair price
   *
   * Creates a price array that includes the current trading pair price
   * along with other symbol prices for USD rate calculations.
   *
   * @param price Current price of the trading pair
   * @returns Updated price array with current trading pair included
   */
  static updatePriceWithOldPrice(price: number) {
    return [
      { price, symbol: SharedData.symbol.pair },
      ...SharedData.pricesWOutSymbols,
    ]
  }

  /**
   * Set and update the last USD exchange rate
   *
   * Updates the latest USD exchange rate based on current market price.
   * Used for real-time profit calculations and reporting.
   */
  static setLastRate() {
    SharedData.lastUsdRate =
      findUSDRate(
        SharedData.symbol.quoteAsset.name,
        PriceCalculator.updatePriceWithOldPrice(SharedData.lastBarPrice),
      ) * (SharedData.profitBase ? SharedData.lastBarPrice : 1)
  }

  /**
   * Set the initial USD exchange rate
   *
   * Establishes the baseline USD exchange rate at strategy start.
   * Used for calculating returns and performance metrics.
   */
  static setFirstRate() {
    SharedData.firstUsdRate =
      findUSDRate(
        SharedData.symbol.quoteAsset.name,
        PriceCalculator.updatePriceWithOldPrice(SharedData.lastBarPrice),
      ) * (SharedData.profitBase ? SharedData.lastBarPrice : 1)
  }

  /**
   * Calculate liquidation price for futures positions
   *
   * Determines the price level at which a futures position would be liquidated
   * based on leverage and position side. Critical for risk management.
   *
   * @param entryPrice Position entry price
   * @param position Position side (LONG or SHORT)
   * @returns Calculated liquidation price
   */
  static getLiquidationPrice(entryPrice: number, position: PositionSide) {
    return (
      entryPrice *
      (SharedData.leverage > 1
        ? // Leveraged position calculation
          (1 +
            (1 / SharedData.leverage) *
              (position === PositionSide.LONG ? -1 : 1)) *
          (1 + SharedData.userFee * (position === PositionSide.LONG ? -1 : 1))
        : // Spot position calculation
        position === PositionSide.LONG
        ? SharedData.userFee
        : 1 / SharedData.userFee)
    )
  }
}
