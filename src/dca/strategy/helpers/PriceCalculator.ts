import findUSDRate from '../../../helper/price'
import type {
  Deal,
  FullGrid,
  Minigrid,
  Symbols,
  Prices,
  DCABotSettings,
} from '../../../types'
import { BotOrderSideEnum } from '../../../types'

/**
 * PriceCalculator - Handles all price and rate calculations for DCA strategy
 *
 * This class centralizes price-related calculations including USD conversions,
 * average price calculations, profit calculations, and rate management.
 * It provides optimized methods for financial calculations with proper precision handling.
 */
export class PriceCalculator {
  private readonly math = new MathHelper()
  private readonly usdRate = new Map<string, number>()
  private readonly usdRateQuote = new Map<string, number>()
  private readonly usdRateBase = new Map<string, number>()
  private readonly precision = new Map<string, number>()
  private readonly precisionQuote = new Map<string, number>()
  private readonly precisionBase = new Map<string, number>()

  constructor(
    private readonly settings: DCABotSettings,
    private readonly symbols: Map<string, Symbols>,
    private readonly prices: Prices,
    private readonly profitBase: boolean,
    private readonly userFee: number,
  ) {
    this.initializeRatesAndPrecision()
  }

  /**
   * Initializes USD rates and precision for all symbols
   */
  private initializeRatesAndPrecision(): void {
    for (const [pair, symbol] of this.symbols) {
      // Set USD rates
      this.usdRate.set(
        pair,
        findUSDRate(
          this.profitBase ? symbol.baseAsset.name : symbol.quoteAsset.name,
          this.prices,
        ),
      )
      this.usdRateQuote.set(
        pair,
        findUSDRate(symbol.quoteAsset.name, this.prices),
      )
      this.usdRateBase.set(
        pair,
        findUSDRate(symbol.baseAsset.name, this.prices),
      )

      // Set precision (this would need to be implemented based on bot functions)
      this.precision.set(pair, this.profitBase ? 8 : 6) // Default precision
      this.precisionQuote.set(pair, 6) // Default quote precision
      this.precisionBase.set(pair, 8) // Default base precision
    }
  }

  /**
   * Gets USD rate for a symbol and price
   * @param symbol - Trading pair symbol
   * @param price - Price to convert
   * @param type - Type of conversion ('base' | 'quote')
   * @returns USD rate
   */
  getUsdRate(symbol: string, price: number, type?: 'base' | 'quote'): number {
    if (type === 'base') {
      return (this.usdRateBase.get(symbol) || 1) * price
    }
    if (type === 'quote') {
      return (this.usdRateQuote.get(symbol) || 1) * price
    }
    return (this.usdRate.get(symbol) || 1) * price
  }

  /**
   * Calculates average price for a deal or minigrid
   * @param deal - Deal to calculate average price for
   * @param minigrid - Optional specific minigrid
   * @returns Average price
   */
  avgPrice(deal?: Deal, minigrid?: Minigrid): number {
    if (!deal && !minigrid) return 0

    const target = minigrid || deal
    if (!target?.orders) return 0

    const filledOrders = target.orders.filter(
      (o) => o.filled && o.side === BotOrderSideEnum.buy,
    )

    if (filledOrders.length === 0) return 0

    const totalValue = filledOrders.reduce((sum, order) => {
      return sum + (order.size || 0) * (order.price || 0)
    }, 0)

    const totalQuantity = filledOrders.reduce((sum, order) => {
      return sum + (order.size || 0)
    }, 0)

    return totalQuantity > 0 ? totalValue / totalQuantity : 0
  }

  /**
   * Calculates average price after a new order
   * @param order - New order to include
   * @param minigrid - Minigrid to calculate for
   * @returns New average price
   */
  avgPriceAfterOrder(order: FullGrid, minigrid: Minigrid): number {
    if (!order.filled || order.side !== BotOrderSideEnum.buy) {
      return this.avgPrice(undefined, minigrid)
    }

    const currentAvg = this.avgPrice(undefined, minigrid)
    const currentQty = minigrid.orders
      ? minigrid.orders
          .filter((o) => o.filled && o.side === BotOrderSideEnum.buy)
          .reduce((sum, o) => sum + (o.size || 0), 0)
      : 0

    const newOrderValue = (order.size || 0) * (order.price || 0)
    const newOrderQty = order.size || 0

    const totalValue = currentAvg * currentQty + newOrderValue
    const totalQty = currentQty + newOrderQty

    return totalQty > 0 ? totalValue / totalQty : 0
  }

  /**
   * Replaces the average price history line for a deal
   * @param deal - Deal to update
   * @param price - New average price
   * @param time - Timestamp
   */
  replaceAvgPriceHistoryLine(deal: Deal, price: number, time: number): void {
    if (!deal.avgPriceHistory) {
      deal.avgPriceHistory = []
    }

    // Find if there's already an entry for this time
    const existingIndex = deal.avgPriceHistory.findIndex(
      (entry) => entry.time === time,
    )

    if (existingIndex >= 0) {
      deal.avgPriceHistory[existingIndex].price = price
    } else {
      deal.avgPriceHistory.push({ time, price })
    }

    // Keep history sorted by time
    deal.avgPriceHistory.sort((a, b) => a.time - b.time)
  }

  /**
   * Updates deal average price at a specific time
   * @param deal - Deal to update
   * @param time - Current timestamp
   */
  updateDealAvgPrice(deal: Deal, time: number): void {
    const avgPrice = this.avgPrice(deal)
    deal.avgPrice = avgPrice
    this.replaceAvgPriceHistoryLine(deal, avgPrice, time)
  }

  /**
   * Gets prices for different calculation scenarios
   * @param price - Current price
   * @param tp - Take profit percentage
   * @param sl - Stop loss percentage
   * @param side - Order side
   * @returns Price calculation object
   */
  getPrices(
    price: number,
    tp?: number,
    sl?: number,
    side: BotOrderSideEnum = BotOrderSideEnum.buy,
  ): { entry: number; tp?: number; sl?: number } {
    const result: { entry: number; tp?: number; sl?: number } = {
      entry: price,
    }

    if (tp !== undefined) {
      if (side === BotOrderSideEnum.buy) {
        result.tp = price * (1 + tp / 100)
      } else {
        result.tp = price * (1 - tp / 100)
      }
    }

    if (sl !== undefined) {
      if (side === BotOrderSideEnum.buy) {
        result.sl = price * (1 - sl / 100)
      } else {
        result.sl = price * (1 + sl / 100)
      }
    }

    return result
  }

  /**
   * Checks if start/stop price conditions are met
   * @param price - Current price
   * @param high - High price of the bar
   * @param low - Low price of the bar
   * @returns True if conditions are met
   */
  checkStartStopPrice(price: number, high: number, low: number): boolean {
    if (!this.settings.useStartStopPrice) return true

    const startPrice = parseFloat(this.settings.startPrice || '0')
    const stopPrice = parseFloat(this.settings.stopPrice || '0')

    if (startPrice > 0 && price < startPrice) return false
    if (stopPrice > 0 && price > stopPrice) return false

    return true
  }

  /**
   * Calculates profit for a deal at a specific time
   * @param deal - Deal to calculate profit for
   * @param time - Current timestamp
   * @returns Profit calculation object
   */
  getProfit(
    deal: Deal,
    time: number,
  ): {
    asset: number
    usd: number
    percentage: number
  } {
    if (!deal.minigrids || deal.minigrids.length === 0) {
      return { asset: 0, usd: 0, percentage: 0 }
    }

    const symbol = deal.symbol.pair
    const currentPrice = deal.currentPrice || 0
    const avgPrice = this.avgPrice(deal)

    if (avgPrice === 0) {
      return { asset: 0, usd: 0, percentage: 0 }
    }

    // Calculate total invested and current value
    let totalInvested = 0
    let totalQuantity = 0

    for (const minigrid of deal.minigrids) {
      if (minigrid.orders) {
        for (const order of minigrid.orders) {
          if (order.filled && order.side === BotOrderSideEnum.buy) {
            totalInvested += (order.size || 0) * (order.price || 0)
            totalQuantity += order.size || 0
          }
        }
      }
    }

    const currentValue = totalQuantity * currentPrice
    const profitAsset = currentValue - totalInvested
    const profitPercentage =
      totalInvested > 0 ? (profitAsset / totalInvested) * 100 : 0

    // Convert to USD
    const usdRate = this.getUsdRate(symbol, profitAsset)
    const profitUsd = profitAsset * usdRate

    return {
      asset: profitAsset,
      usd: profitUsd,
      percentage: profitPercentage,
    }
  }

  /**
   * Gets precision for a symbol
   * @param symbol - Trading pair symbol
   * @param type - Type of precision ('base' | 'quote' | 'price')
   * @returns Precision value
   */
  getPrecision(
    symbol: string,
    type: 'base' | 'quote' | 'price' = 'price',
  ): number {
    switch (type) {
      case 'base':
        return this.precisionBase.get(symbol) || 8
      case 'quote':
        return this.precisionQuote.get(symbol) || 6
      case 'price':
      default:
        return this.precision.get(symbol) || 6
    }
  }

  /**
   * Rounds a number to the appropriate precision for a symbol
   * @param value - Value to round
   * @param symbol - Trading pair symbol
   * @param type - Type of precision to use
   * @returns Rounded value
   */
  roundToPrecision(
    value: number,
    symbol: string,
    type: 'base' | 'quote' | 'price' = 'price',
  ): number {
    const precision = this.getPrecision(symbol, type)
    return Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision)
  }

  /**
   * Calculates price deviation statistics
   * @param deals - Array of deals to analyze
   * @returns Price deviation statistics
   */
  calculatePriceDeviation(deals: Deal[]): {
    average: number
    median: number
    min: number
    max: number
    standardDeviation: number
  } {
    if (deals.length === 0) {
      return { average: 0, median: 0, min: 0, max: 0, standardDeviation: 0 }
    }

    const avgPrices = deals
      .map((deal) => this.avgPrice(deal))
      .filter((price) => price > 0)

    if (avgPrices.length === 0) {
      return { average: 0, median: 0, min: 0, max: 0, standardDeviation: 0 }
    }

    const average =
      avgPrices.reduce((sum, price) => sum + price, 0) / avgPrices.length
    const min = Math.min(...avgPrices)
    const max = Math.max(...avgPrices)

    // Calculate median
    const sorted = [...avgPrices].sort((a, b) => a - b)
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)]

    // Calculate standard deviation
    const variance =
      avgPrices.reduce((sum, price) => {
        return sum + Math.pow(price - average, 2)
      }, 0) / avgPrices.length
    const standardDeviation = Math.sqrt(variance)

    return {
      average,
      median,
      min,
      max,
      standardDeviation,
    }
  }

  /**
   * Calculates fee-adjusted price for orders
   * @param price - Original price
   * @param side - Order side
   * @returns Fee-adjusted price
   */
  getFeeAdjustedPrice(price: number, side: BotOrderSideEnum): number {
    if (side === BotOrderSideEnum.buy) {
      return price * (1 + this.userFee)
    } else {
      return price * (1 - this.userFee)
    }
  }
}
