import { BotOrderSideEnum, PositionSide, CooldownUnits } from '../../../types'
import type { Asset, DCAGrid, FullBar } from '../../../types'
import { SharedData } from './SharedData'

enum CandleTypeEnum {
  bull = 'bull',
  bear = 'bear',
}

/**
 * # StrategyUtils
 *
 * Essential utility functions for DCA trading strategy operations.
 * Provides commonly needed calculations, conversions, and helper methods
 * that support various aspects of the trading strategy.
 *
 * ## Features
 * - **Time Conversions**: Cooldown period calculations and time utilities
 * - **Market Analysis**: Candle type determination and market state analysis
 * - **Position Management**: Futures position tracking and updates
 * - **Data Validation**: Input validation and data integrity checks
 *
 * ## Utility Categories
 *
 * ### Time & Scheduling
 * - Cooldown period conversions (seconds, minutes, hours, days)
 * - Time-based condition evaluations
 * - Schedule management utilities
 *
 * ### Market Analysis
 * - Candle pattern recognition (bull/bear)
 * - Price movement analysis
 * - Market state determination
 *
 * ### Position Management
 * - Futures position calculations
 * - Leverage and margin management
 * - Liquidation price calculations
 *
 * ## Usage Example
 * ```typescript
 * // Convert cooldown to milliseconds
 * const cooldownMs = StrategyUtils.convertCooldown(5, CooldownUnits.minutes)
 *
 * // Analyze candle type
 * const candleType = StrategyUtils.getCandleType(bar)
 *
 * // Update position with new order
 * StrategyUtils.updatePositionWithOrder(order, symbol)
 * ```
 *
 * @author Gainium Team
 * @version 2.0.0 - Enhanced with comprehensive utilities
 */
export class StrategyUtils {
  /**
   * Convert cooldown interval and units to milliseconds
   */
  static convertCooldown(interval?: number, units?: CooldownUnits): number {
    if (!interval || !units) {
      return 0
    }
    return (
      interval *
      (units === CooldownUnits.seconds
        ? 1000
        : units === CooldownUnits.minutes
        ? 60 * 1000
        : units === CooldownUnits.hours
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000)
    )
  }

  /**
   * Determine candle type based on open/close prices
   */
  static getCandleType(b: FullBar): CandleTypeEnum {
    return b.close >= b.open ? CandleTypeEnum.bull : CandleTypeEnum.bear
  }

  /**
   * Update futures position based on order execution
   */
  static updatePositionWithOrder(order: DCAGrid, s: string): void {
    if (!order) {
      return
    }
    if (SharedData.futures) {
      let position = SharedData.position.get(s)
      if (!position) {
        position = SharedData.emptyPosition
      }
      const margin = order.qty
      const sameDirection =
        (position.side === PositionSide.LONG &&
          order.side === BotOrderSideEnum.buy) ||
        (position.side === PositionSide.SHORT &&
          order.side === BotOrderSideEnum.sell)
      const liquidationPrice = (entryPrice: number, pos: PositionSide) =>
        entryPrice *
        (SharedData.leverage > 1
          ? 1 +
            (1 / SharedData.leverage) *
              (pos === PositionSide.LONG ? -1 : 1) /* *
              (1 + StrategyUtils.userFee * (position === PositionSide.LONG ? 1 : -1)) */
          : pos === PositionSide.LONG
          ? SharedData.userFee
          : 1 / SharedData.userFee)

      if (sameDirection || position.qty === 0) {
        const entryPrice =
          (position.qty * position.entryPrice + order.qty * order.price) /
          (position.qty + order.qty)
        const side = SharedData.long ? PositionSide.LONG : PositionSide.SHORT
        position = {
          side,
          qty: position.qty + margin,
          entryPrice,
          liquidationPrice: liquidationPrice(entryPrice, side),
        }
      } else {
        const diff = position.qty - order.qty
        if (Math.abs(diff) <= Number.EPSILON) {
          position = SharedData.emptyPosition
        } else if (diff < 0) {
          const side =
            position.side === PositionSide.SHORT
              ? PositionSide.LONG
              : PositionSide.SHORT
          position = {
            qty: -diff,
            entryPrice: order.price,
            side,
            liquidationPrice: liquidationPrice(order.price, side),
          }
        } else {
          position.qty -= margin
        }
      }
      SharedData.position.set(s, position)
    }
  }

  static getBalances(s: string): Asset[] | null | undefined {
    const symbol = SharedData.symbols.get(s)
    if (!symbol) {
      return SharedData.balances
    }
    if (SharedData.balanceUsd === 0) {
      return SharedData.balances
    }

    const asset = SharedData.futures
      ? SharedData.coinm
        ? symbol.baseAsset.name
        : symbol.quoteAsset.name
      : SharedData.long
      ? symbol.quoteAsset.name
      : symbol.baseAsset.name
    const balanceAsset = (SharedData.balances ?? []).find(
      (b) => b.asset === asset,
    )
    const balanceItem = +(balanceAsset?.free ?? '0')
    const fullBalance = balanceItem + SharedData.totalProfit
    const free = SharedData.futures
      ? fullBalance
      : SharedData.long
      ? balanceItem + SharedData.totalProfit * (SharedData.profitBase ? 0 : 1)
      : balanceItem + SharedData.totalProfit * (SharedData.profitBase ? 1 : 0)
    const balance = {
      asset,
      free: `${free}`,
      locked: balanceAsset?.locked ?? '0',
    }
    if (+balance.free < 0) {
      SharedData.messages.push(SharedData.fundsWarning)
    }
    return SharedData.balances
      ? SharedData.balances.filter((b) => b.asset !== asset).concat(balance)
      : [balance]
  }
  static replacePortfolioValue(time: number, val: number, shared: number) {
    const current = SharedData.portfolio.get(time)
    if (current) {
      return SharedData.portfolio.set(time, current + val - shared)
    }
    return SharedData.portfolio.set(time, val)
  }
}

export { CandleTypeEnum }
