import { BotOrderSideEnum, PositionSide, CooldownUnits } from '../../../types'
import type { DCAGrid, FullBar } from '../../../types'

enum CandleTypeEnum {
  bull = 'bull',
  bear = 'bear',
}

type Position = {
  side: PositionSide
  qty: number
  entryPrice: number
  liquidationPrice: number
}

/**
 * Strategy utilities helper containing small utility methods for DCA strategy operations.
 *
 * Uses a hybrid approach with shared static data (position map, empty position template)
 * and instance-specific strategy configuration (leverage, fees, long/short).
 * This supports multiple strategy instances sharing the same base data.
 */
export class StrategyUtils {
  // Shared data across all strategy instances
  public static position: Map<string, Position>
  public static emptyPosition: Position

  // Instance-specific strategy configuration
  private readonly futures: boolean
  private readonly leverage: number
  private readonly userFee: number
  private readonly long: boolean

  constructor(
    futures: boolean | undefined,
    leverage: number,
    userFee: number,
    long: boolean,
  ) {
    this.futures = !!futures
    this.leverage = leverage
    this.userFee = userFee
    this.long = long
  }

  /**
   * Initialize shared static data. Called once before creating instances.
   */
  static initialize() {
    StrategyUtils.emptyPosition = {
      side: PositionSide.LONG,
      qty: 0,
      entryPrice: 0,
      liquidationPrice: 0,
    }
  }

  /**
   * Reset shared data. Called when starting new backtest run.
   */
  static resetData() {
    StrategyUtils.position = new Map()
  }

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
  updatePositionWithOrder(order: DCAGrid, s: string): void {
    if (!order) {
      return
    }
    if (this.futures) {
      let position = StrategyUtils.position.get(s)
      if (!position) {
        position = StrategyUtils.emptyPosition
      }
      const margin = order.qty
      const sameDirection =
        (position.side === PositionSide.LONG &&
          order.side === BotOrderSideEnum.buy) ||
        (position.side === PositionSide.SHORT &&
          order.side === BotOrderSideEnum.sell)
      const liquidationPrice = (entryPrice: number, pos: PositionSide) =>
        entryPrice *
        (this.leverage > 1
          ? 1 + (1 / this.leverage) * (pos === PositionSide.LONG ? -1 : 1) /* *
              (1 + this.userFee * (position === PositionSide.LONG ? 1 : -1)) */
          : pos === PositionSide.LONG
          ? this.userFee
          : 1 / this.userFee)

      if (sameDirection || position.qty === 0) {
        const entryPrice =
          (position.qty * position.entryPrice + order.qty * order.price) /
          (position.qty + order.qty)
        const side = this.long ? PositionSide.LONG : PositionSide.SHORT
        position = {
          side,
          qty: position.qty + margin,
          entryPrice,
          liquidationPrice: liquidationPrice(entryPrice, side),
        }
      } else {
        const diff = position.qty - order.qty
        if (Math.abs(diff) <= Number.EPSILON) {
          position = StrategyUtils.emptyPosition
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
      StrategyUtils.position.set(s, position)
    }
  }
}

export { CandleTypeEnum }
