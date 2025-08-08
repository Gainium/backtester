import { Deal, Minigrid, BotOrderSideEnum } from '../../../../types'
import { SharedData } from '../SharedData'

// OPTIMIZATION: Single-pass price calculations
export class OptimizedPriceCalculator {
  /**
   * OPTIMIZED: Calculate average price in single pass - O(n) → O(n) but with 1x iteration
   * Original: 3 array operations (filter + filter + reduce + reduce)
   * Optimized: 1 iteration with early filtering
   */
  static avgPriceOptimized(deal?: Deal, minigrid?: Minigrid): number {
    const targetSide = SharedData.long
      ? BotOrderSideEnum.buy
      : BotOrderSideEnum.sell

    // Single pass calculation
    let base = 0
    let quote = 0
    let openMinigridIds: Set<string> | null = null

    // Pre-calculate open minigrids if needed (done once)
    if (deal && SharedData.combo) {
      openMinigridIds = new Set(
        deal.minigrids.filter((m) => m.status === 'open').map((m) => m.id),
      )
    }

    // Single iteration instead of multiple filter/reduce chains
    const orders = deal ? deal.filledOrders : (minigrid?.filledOrders ?? [])
    for (const order of orders) {
      // Early continue instead of multiple filters
      if (order.side !== targetSide) continue
      if (
        deal &&
        SharedData.combo &&
        order.minigridId &&
        !openMinigridIds?.has(order.minigridId)
      )
        continue

      // Accumulate in same loop
      base += order.qty
      quote += order.qty * order.price
    }

    // Add minigrid initial balances if needed
    if (minigrid) {
      if (SharedData.long) {
        base += minigrid.initialBalances.base
        quote += minigrid.initialPrice * minigrid.initialBalances.base
      } else {
        base += minigrid.initialBalances.quote / minigrid.initialPrice
        quote += minigrid.initialBalances.quote
      }
    }

    return base === 0 ? 0 : quote / base
  }
}
