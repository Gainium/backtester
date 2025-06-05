import { BotOrderSideEnum } from '../../../types'
import findUSDRate from '../../../helper/price'
import type { Deal, FullGrid, Minigrid, Symbols, Prices } from '../../../types'
import type DCABotFunctions from '../../../helper/dcaBotFunctions'

/**
 * Price calculation helper for DCA strategy operations.
 *
 * Uses a hybrid approach with shared static data (symbols, prices, cache)
 * and instance-specific strategy configuration (profitBase, long, combo).
 * This supports multiple strategy instances sharing the same base data.
 */
export class PriceCalculator {
  // Shared data across all strategy instances
  private static symbols: Map<string, Symbols>
  private static prices: Prices
  private static botFunctions: Map<string, DCABotFunctions>
  private static pricesCache: Map<
    string,
    ReturnType<DCABotFunctions['utils']['getPrices']>
  >

  // Instance-specific strategy configuration
  private readonly profitBase: boolean
  private readonly long: boolean
  private readonly combo: boolean

  constructor(profitBase: boolean, long: boolean, combo: boolean) {
    this.profitBase = profitBase
    this.long = long
    this.combo = combo
  }

  /**
   * Initialize shared static data. Called once before creating instances.
   */
  static initialize(
    symbols: Map<string, Symbols>,
    prices: Prices,
    botFunctions: Map<string, DCABotFunctions>,
    pricesCache: Map<string, ReturnType<DCABotFunctions['utils']['getPrices']>>,
  ) {
    PriceCalculator.symbols = symbols
    PriceCalculator.prices = prices
    PriceCalculator.botFunctions = botFunctions
    PriceCalculator.pricesCache = pricesCache
  }

  /**
   * Reset shared data. Called when starting new backtest run.
   */
  static resetData() {
    PriceCalculator.pricesCache?.clear()
    // Note: symbols, prices, botFunctions typically don't need reset
  }

  /**
   * Gets USD rate for a symbol's asset.
   *
   * @param symbol - Trading pair symbol
   * @param price - Current price
   * @param type - Asset type ('base', 'quote', or auto-detect based on profitBase)
   * @returns USD conversion rate
   */
  getUsdRate(symbol: string, price: number, type?: 'base' | 'quote'): number {
    const s = PriceCalculator.symbols.get(symbol)
    if (!s) {
      return 1
    }
    return findUSDRate(
      type === 'base'
        ? s.baseAsset.name
        : type === 'quote'
        ? s.quoteAsset.name
        : this.profitBase
        ? s.baseAsset.name
        : s.quoteAsset.name,
      [
        { symbol, price },
        ...PriceCalculator.prices.filter((p) => p.symbol !== symbol),
      ],
    )
  }

  /**
   * Calculates average price for a deal or minigrid.
   *
   * @param deal - Deal to calculate average price for
   * @param minigrid - Minigrid to calculate average price for
   * @returns Average price
   */
  avgPrice(deal?: Deal, minigrid?: Minigrid): number {
    const minigrids =
      deal?.minigrids.filter((m) => m.status === 'open').map((m) => m.id) ?? []
    const filledDealOrder = (
      deal ? deal.filledOrders : minigrid?.filledOrders ?? []
    )
      .filter(
        (o) =>
          o.side === (this.long ? BotOrderSideEnum.buy : BotOrderSideEnum.sell),
      )
      .filter((o) =>
        deal && this.combo
          ? !o.minigridId || minigrids.includes(o.minigridId)
          : true,
      )
    let base = filledDealOrder.reduce((acc, v) => acc + v.qty, 0)
    let quote = filledDealOrder.reduce((acc, v) => acc + v.qty * v.price, 0)
    if (minigrid) {
      base += this.long
        ? minigrid.initialBalances.base
        : minigrid.initialBalances.quote / minigrid.initialPrice
      quote += this.long
        ? minigrid.initialPrice * minigrid.initialBalances.base
        : minigrid.initialBalances.quote
    }
    return quote / base
  }

  /**
   * Calculates average price after adding an order to a minigrid.
   *
   * @param o - Order to add
   * @param minigrid - Minigrid to update
   * @returns New average price
   */
  avgPriceAfterOrder(o: FullGrid, minigrid: Minigrid): number {
    if (
      (this.long && o.side === BotOrderSideEnum.sell) ||
      (!this.long && o.side === BotOrderSideEnum.buy)
    ) {
      return minigrid.avgPrice
    }
    let filledBase = minigrid.filledBase
    let filledQuote = minigrid.filledQuote

    filledBase += o.qty
    filledQuote += o.qty * o.price
    minigrid.filledBase = filledBase
    minigrid.filledQuote = filledQuote
    const base =
      filledBase +
      (this.long
        ? minigrid.initialBalances.base
        : minigrid.initialBalances.quote / minigrid.initialPrice)
    const quote =
      filledQuote +
      (this.long
        ? minigrid.initialPrice * minigrid.initialBalances.base
        : minigrid.initialBalances.quote)

    return quote / base
  }

  /**
   * Replaces average price history line for a deal.
   *
   * @param d - Deal to update
   * @param price - New average price
   * @param time - Current time
   * @returns Updated deal
   */
  replaceAvgPriceHistoryLine(d: Deal, price: number, time: number): Deal {
    d.ordersHistory = d.ordersHistory
      .map((oh) => {
        if (!oh.filledTime && oh.avgLine) {
          oh.filledTime = time
        }
        return oh
      })
      .filter((o) =>
        o.filledTime ? (d.finishedOrdersHistory.push(o), false) : true,
      )
    const botFunctions = PriceCalculator.botFunctions.get(d.symbol.pair)
    d.ordersHistory.push({
      qty: 0,
      price,
      side: BotOrderSideEnum.buy,
      id: botFunctions?.utils.id(10) ?? '',
      startTime: time,
      avgLine: true,
      dealId: d.id,
    })
    return d
  }

  /**
   * Updates deal's average price if it has changed.
   *
   * @param d - Deal to update
   * @param time - Current time
   * @returns Updated deal
   */
  updateDealAvgPrice(d: Deal, time: number): Deal {
    const avgPrice = this.avgPrice(d)
    if (avgPrice !== d.avgPrice) {
      d.avgPrice = avgPrice
      d = this.replaceAvgPriceHistoryLine(d, avgPrice, time)
    }
    return d
  }

  /**
   * Gets cached price levels for grid trading.
   *
   * @param lowPrice - Lower price bound
   * @param topPrice - Upper price bound
   * @param symbol - Trading symbol
   * @param levels - Number of price levels
   * @param sellDisplacement - Sell price displacement
   * @returns Array of price levels
   */
  getPrices(
    lowPrice: number,
    topPrice: number,
    symbol: Symbols,
    levels: number,
    sellDisplacement: number,
  ): ReturnType<DCABotFunctions['utils']['getPrices']> {
    const botFunctions = PriceCalculator.botFunctions.get(symbol.pair)
    const key = JSON.stringify({
      lowPrice: `${lowPrice}`,
      topPrice: `${topPrice}`,
      sellDisplacement: `${sellDisplacement}`,
      gridType: 'arithmetic',
      levels: `${levels}`,
      symbol,
    })
    const local = PriceCalculator.pricesCache.get(key)
    const result =
      local ??
      botFunctions?.utils.getPrices({
        lowPrice: `${lowPrice}`,
        topPrice: `${topPrice}`,
        sellDisplacement: `${sellDisplacement}`,
        gridType: 'arithmetic',
        levels: `${levels}`,
        symbol,
      }) ??
      []
    if (!local && result.length) {
      PriceCalculator.pricesCache.set(key, result)
    }
    return result
  }
}
