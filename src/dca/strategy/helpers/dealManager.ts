import type {
  Deal,
  DCABotSettings,
  FullBar,
  Symbols,
  FullGrid,
  BotOrderSideEnum,
} from '../../../types'
import { Strategy } from '../main'

/**
 * Helper class for managing DCA deals - creation, tracking, updates, and validation.
 *
 * This class encapsulates all logic related to deal lifecycle management,
 * including deal storage, retrieval, validation, and update operations.
 *
 * @example
 * ```typescript
 * const dealManager = new DealManager(settings, symbols, userFee);
 * dealManager.setDeal(deal, 'open', 'BTCUSDT');
 * const openDeals = dealManager.getDeals('open', 'BTCUSDT');
 * ```
 */
export class DealManager {
  private readonly settings: DCABotSettings
  private readonly symbols: Map<string, Symbols>
  private readonly userFee: number

  constructor(
    settings: DCABotSettings,
    symbols: Map<string, Symbols>,
    userFee: number,
  ) {
    this.settings = settings
    this.symbols = symbols
    this.userFee = userFee
  }

  /**
   * Stores a deal in the appropriate symbol and status maps.
   *
   * @param deal - The deal to store
   * @param status - The status of the deal ('open' or 'closed')
   * @param symbol - The trading pair symbol
   */
  setDeal(deal: Deal, status: Deal['status'], symbol: string): void {
    if (!symbol) {
      return
    }
    const getBySymbol = Strategy.dealsBySymbolsStatusId.get(symbol)
    if (!getBySymbol) {
      Strategy.dealsBySymbolsStatusId.set(
        symbol,
        new Map().set(status, new Map().set(deal.id, deal)),
      )
      return
    }
    const getDeals = getBySymbol.get(status)
    if (!getDeals) {
      getBySymbol.set(status, new Map().set(deal.id, deal))
      return
    }
    getDeals.set(deal.id, deal)
  }

  /**
   * Removes a deal from the symbol and status maps.
   *
   * @param id - The deal ID to remove
   * @param status - The status of the deal to remove
   * @param symbol - The trading pair symbol
   */
  removeDeal(id: string, status: Deal['status'], symbol: string): void {
    const getBySymbol = Strategy.dealsBySymbolsStatusId.get(symbol)
    if (!getBySymbol) {
      return
    }
    const getDeals = getBySymbol.get(status)
    if (!getDeals) {
      return
    }
    getDeals.delete(id)
  }

  /**
   * Processes closing a deal by moving it from 'open' to 'closed' status.
   *
   * @param deal - The deal to close
   */
  processDealCloseFromMap(deal: Deal): void {
    this.removeDeal(deal.id, 'open', deal.symbol.pair)
    this.setDeal(deal, 'closed', deal.symbol.pair)
  }

  /**
   * Checks if the maximum number of deals per trading pair is exceeded.
   *
   * @param symbol - The trading pair symbol to check
   * @returns True if more deals can be opened for this pair
   */
  checkMaxDealsPerPair(symbol: string): boolean {
    const { useMulti, maxDealsPerPair } = this.settings
    if (useMulti && maxDealsPerPair && maxDealsPerPair !== '') {
      const max = +maxDealsPerPair
      if (!isNaN(max) && max >= 0) {
        const symbolDealsLength = Strategy.getDealsCount('open', symbol)
        if (symbolDealsLength < max) {
          return true
        }
        return false
      }
    }
    return true
  }

  /**
   * Checks if the maximum total number of open deals is exceeded.
   *
   * @param symbol - The trading pair symbol to check for pair-specific limits
   * @returns True if more deals can be opened
   */
  checkMaxDeals(symbol: string): boolean {
    const { maxNumberOfOpenDeals } = this.settings
    if (maxNumberOfOpenDeals && maxNumberOfOpenDeals !== '') {
      const max = +maxNumberOfOpenDeals
      if (!isNaN(max) && max >= 0) {
        const dealsLength = Strategy.getDealsCount('open')
        if (dealsLength < max) {
          if (this.checkMaxDealsPerPair(symbol)) {
            return true
          }
        }
        return false
      }
    }
    return this.checkMaxDealsPerPair(symbol)
  }

  /**
   * Updates the volume information for a deal based on current balances.
   *
   * @param deal - The deal to update
   */
  updateDealVolume(deal: Deal): void {
    const volume = deal.mingrids.reduce(
      (acc: { base: number; quote: number }, minigrid) => {
        const filledOrders = minigrid.filledOrders
        const baseSum = filledOrders
          .filter((o) => o.side === 'sell')
          .reduce((sum: number, o) => sum + o.qty, 0)
        const quoteSum = filledOrders
          .filter((o) => o.side === 'buy')
          .reduce((sum: number, o) => sum + o.qty * o.price, 0)
        return {
          base: acc.base + baseSum,
          quote: acc.quote + quoteSum,
        }
      },
      { base: 0, quote: 0 },
    )

    deal.volume = volume
  }

  /**
   * Updates the equity (current value) of a deal.
   *
   * @param deal - The deal to update
   */
  updateDealEquity(deal: Deal): void {
    const currentPrice = Strategy.lastPricesPerSymbol.get(
      deal.symbol.pair,
    )?.close
    if (!currentPrice) {
      return
    }

    const totalBase = deal.minigrids.reduce(
      (acc, minigrid) => acc + minigrid.currentBalances.base,
      0,
    )
    const totalQuote = deal.minigrids.reduce(
      (acc, minigrid) => acc + minigrid.currentBalances.quote,
      0,
    )

    // Calculate equity based on current price
    deal.equity = totalQuote + totalBase * currentPrice
  }

  /**
   * Updates the balance information for a deal.
   *
   * @param deal - The deal to update
   */
  updateDealBalances(deal: Deal): void {
    const totalBalances = deal.minigrids.reduce(
      (acc, minigrid) => ({
        base: acc.base + minigrid.currentBalances.base,
        quote: acc.quote + minigrid.currentBalances.quote,
      }),
      { base: 0, quote: 0 },
    )

    deal.currentBalances = totalBalances
  }

  /**
   * Updates deal balances based on a specific order execution.
   *
   * @param deal - The deal to update
   * @param order - The order that was executed
   */
  updateDealBalancesByOrder(deal: Deal, order: FullGrid): void {
    const minigrid = deal.minigrids.find((m) => m.id === order.minigridId)
    if (!minigrid) {
      return
    }

    if (order.side === 'buy') {
      minigrid.currentBalances.base += order.qty
      minigrid.currentBalances.quote -= order.qty * order.price
    } else {
      minigrid.currentBalances.base -= order.qty
      minigrid.currentBalances.quote += order.qty * order.price
    }

    this.updateDealBalances(deal)
  }

  /**
   * Updates the asset usage tracking for a deal.
   *
   * @param deal - The deal to update
   */
  updateDealUsage(deal: Deal): void {
    const totalUsed = deal.minigrids.reduce(
      (acc, minigrid) => ({
        base: acc.base + minigrid.assets.used.base,
        quote: acc.quote + minigrid.assets.used.quote,
      }),
      { base: 0, quote: 0 },
    )

    deal.usage = totalUsed
  }

  /**
   * Updates the average price of a deal at a specific time.
   *
   * @param deal - The deal to update
   * @param time - The current timestamp
   */
  updateDealAvgPrice(deal: Deal, time: number): void {
    const totalValue = deal.minigrids.reduce((acc, minigrid) => {
      const filledValue = minigrid.filledOrders.reduce(
        (sum, order) => sum + order.qty * order.price,
        0,
      )
      return acc + filledValue
    }, 0)

    const totalQuantity = deal.minigrids.reduce((acc, minigrid) => {
      const filledQty = minigrid.filledOrders.reduce(
        (sum, order) => sum + order.qty,
        0,
      )
      return acc + filledQty
    }, 0)

    if (totalQuantity > 0) {
      deal.avgPrice = totalValue / totalQuantity
      deal.lastUpdatedAvgPrice = time
    }
  }

  /**
   * Updates the duration of a deal based on the current bar.
   *
   * @param deal - The deal to update
   * @param bar - The current price bar
   */
  updateDealDuration(deal: Deal, bar: FullBar): void {
    if (deal.startedAt) {
      deal.duration = bar.time - deal.startedAt
    }
  }

  /**
   * Sets the last deal timestamp for a specific symbol.
   *
   * @param symbol - The trading pair symbol
   * @param ignoreId - Optional deal ID to ignore when finding the last deal
   */
  setLastDealPerSymbol(symbol: string, ignoreId?: string): void {
    const deals = Strategy.getDeals('closed', symbol)
    const filteredDeals = ignoreId
      ? deals.filter((d) => d.id !== ignoreId)
      : deals

    if (filteredDeals.length > 0) {
      const lastDeal = filteredDeals.reduce((latest, current) =>
        current.closedAt &&
        (!latest.closedAt || current.closedAt > latest.closedAt)
          ? current
          : latest,
      )
      if (lastDeal.closedAt) {
        Strategy.lastClosedDealPerSymbol.set(symbol, lastDeal.closedAt)
      }
    }
  }

  /**
   * Comprehensive deal update that refreshes all deal properties.
   *
   * @param deal - The deal to update
   * @param bar - The current price bar
   * @param updateUsage - Whether to update usage tracking
   * @param updateBalance - Whether to update balance tracking
   */
  updateDeal(
    deal: Deal,
    bar: FullBar,
    updateUsage = true,
    updateBalance = true,
  ): void {
    this.updateDealDuration(deal, bar)
    this.updateDealAvgPrice(deal, bar.time)

    if (updateUsage) {
      this.updateDealUsage(deal)
    }

    if (updateBalance) {
      this.updateDealBalances(deal)
      this.updateDealEquity(deal)
      this.updateDealVolume(deal)
    }
  }
}
