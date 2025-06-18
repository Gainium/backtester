import { Strategy, StrategyInterface } from './main'

import type { StrategyInput } from './main'

import { TradeResponse, FullBar, DCABotSettings } from '../../types'
import { DealManager } from './helpers/DealManager'
import { SharedData } from './helpers/SharedData'
import { PortfolioManager } from './helpers/PortfolioManager'

/**
 * ASAP (As Soon As Possible) DCA Strategy
 *
 * This strategy opens deals immediately when conditions are met, without waiting
 * for specific technical indicators or market conditions. It's designed for
 * aggressive DCA approaches where the bot should enter positions as quickly as
 * possible within the defined risk parameters.
 *
 * Key features:
 * - Immediate deal opening when start conditions are met
 * - Support for multi-pair trading with configurable limits per symbol
 * - Dynamic price filtering capabilities
 * - Automatic deal management with safety exits
 * - Portfolio rebalancing on new shift starts
 *
 * Performance optimizations:
 * - Cached deal count calculations to avoid repeated strategy queries
 * - Simplified loop constructs for better memory efficiency
 * - Extracted helper methods for better code organization
 *
 * @example
 * ```typescript
 * const strategy = new ASAPStrategy({
 *   settings: botSettings,
 *   symbols: symbolData,
 *   data: marketData
 * });
 *
 * await strategy.test(); // Run full backtest
 * ```
 */
class ASAPStrategy extends Strategy implements StrategyInterface {
  public settings: DCABotSettings

  /**
   * Creates a new ASAP strategy instance.
   *
   * @param input - Strategy configuration including settings, symbols, and market data
   */
  constructor(input: StrategyInput) {
    super(input)
    this.settings = input.settings
    this.processBar = this.processBar.bind(this)
  }

  /**
   * Runs the complete backtesting process for the ASAP strategy.
   * Processes all available market data to simulate trading performance.
   *
   * @returns Promise that resolves when backtesting is complete
   */
  public async test(): Promise<void> {
    for (const bar of SharedData.data[0].bar) {
      await this.processBar(false, bar)
    }
  }

  /**
   * Pre-test initialization method.
   * Currently no pre-processing is required for ASAP strategy.
   *
   * @returns Promise that resolves immediately
   */
  public async preTest(): Promise<void> {
    // No pre-test processing required for ASAP strategy
  }

  /**
   * Processes individual trade events for immediate deal opening.
   *
   * This method handles real-time trade processing and makes decisions about
   * when to open new deals based on current portfolio state and trade data.
   *
   * @param trade - Individual trade data containing price, timestamp, and symbol info
   */
  public processTrade(trade: TradeResponse): void {
    const dealsState = this.getDealsState()

    if (dealsState.totalDeals === 0) {
      this.handleFirstDeal(trade)
    } else if (
      dealsState.totalDeals !== 0 &&
      dealsState.closedDeals === dealsState.totalDeals
    ) {
      this.handleSubsequentDeal(trade)
    } else {
      this.handleExistingDeals(trade)
    }
  }

  /**
   * Handles opening the very first deal when no deals exist.
   *
   * @param trade - Trade data for the new deal
   */
  private handleFirstDeal(trade: TradeResponse): void {
    if (
      SharedData.workingShift.length === 0 &&
      ((SharedData.start && trade.timestamp >= SharedData.start) ||
        !SharedData.start)
    ) {
      this.startWorkingShift(trade.timestamp)
    }
    DealManager.openDeal(
      +trade.price,
      trade.timestamp,
      +trade.price,
      +trade.price,
      trade.symbol,
    )
  }

  /**
   * Handles opening a new deal when all previous deals are closed.
   *
   * @param trade - Trade data for the new deal
   */
  private handleSubsequentDeal(trade: TradeResponse): void {
    DealManager.openDeal(
      +trade.price,
      trade.timestamp,
      +trade.price,
      +trade.price,
      trade.symbol,
    )
  }

  /**
   * Handles deal management when existing deals are still active.
   *
   * @param trade - Trade data to process
   */
  private handleExistingDeals(trade: TradeResponse): void {
    this.checkDeals(
      false,
      {
        open: +trade.price,
        high: +trade.price,
        low: +trade.price,
        close: +trade.price,
        time: trade.timestamp,
        symbol: trade.symbol,
      },
      (price: number) =>
        DealManager.openDeal(
          price,
          trade.timestamp,
          +trade.price,
          +trade.price,
          trade.symbol,
        ),
    )
  }

  /**
   * Gets the current state of deals for decision making.
   * Cached to avoid repeated expensive queries.
   *
   * @returns Object containing deal counts
   */
  private getDealsState() {
    return {
      totalDeals: DealManager.getDealsCount(),
      closedDeals: DealManager.getDealsCount('closed'),
    }
  }

  /**
   * Processes market bar data for deal management and portfolio updates.
   *
   * This is the core method that analyzes each market bar and makes decisions about
   * opening new deals, managing existing ones, and updating portfolio state.
   *
   * Performance optimizations:
   * - Cached deal count calculations
   * - Simplified loop constructs
   * - Early returns for better flow control
   *
   * @param checkPortfolio - Whether to perform portfolio checks
   * @param bar - Market bar data containing OHLC and timestamp
   */
  public async processBar(
    checkPortfolio: boolean,
    bar: FullBar,
  ): Promise<void> {
    const config = this.getBarProcessingConfig()
    const symbolDeals = this.getSymbolDealsState(bar.symbol)

    let newShift = false

    // Handle first deals for symbol
    if (symbolDeals.total === 0) {
      newShift = await this.handleFirstSymbolDeals(bar, config)
    }
    // Handle additional deals when conditions allow
    else if (this.shouldOpenAdditionalDeals(symbolDeals, config)) {
      this.openMultipleDeals(bar, config)
    }

    // Process existing deals if any are open or new shift started
    if (symbolDeals.open > 0 || newShift) {
      await this.processExistingDeals(checkPortfolio, bar)
    }

    // Check portfolio on new shifts
    if (newShift) {
      PortfolioManager.checkPortfolio(bar.time, bar.close, bar.symbol)
    }
  }

  /**
   * Gets the configuration needed for bar processing.
   * Calculates and validates settings like max deals and multi-pair options.
   *
   * @returns Configuration object for processing decisions
   */
  private getBarProcessingConfig() {
    const multi = this.settings.useMulti && SharedData.multi
    const useDynamic = !!(
      this.settings.useDynamicPriceFilter &&
      this.settings.dynamicPriceFilterDeviation &&
      this.settings.dynamicPriceFilterPriceType
    )

    let maxDeals = this.parsePositiveNumber(
      this.settings.maxNumberOfOpenDeals,
      1,
    )
    let maxPerSymbol = multi
      ? this.parsePositiveNumber(this.settings.maxDealsPerPair, 1)
      : 1

    return {
      multi,
      useDynamic,
      maxDeals: maxDeals < 0 ? Infinity : maxDeals,
      maxPerSymbol: maxPerSymbol < 0 ? Infinity : maxPerSymbol,
    }
  }

  /**
   * Gets the current deal state for a specific symbol.
   *
   * @param symbol - Symbol to check deals for
   * @returns Object containing deal counts for the symbol
   */
  private getSymbolDealsState(symbol: string) {
    return {
      total: DealManager.getDealsCount(undefined, symbol),
      closed: DealManager.getDealsCount('closed', symbol),
      open: DealManager.getDealsCount('open', symbol),
    }
  }

  /**
   * Handles opening the first deals for a symbol.
   *
   * @param bar - Market bar data
   * @param config - Processing configuration
   * @returns Whether a new shift was started
   */
  private async handleFirstSymbolDeals(
    bar: FullBar,
    config: ReturnType<typeof this.getBarProcessingConfig>,
  ): Promise<boolean> {
    if (
      (SharedData.start && bar.time >= SharedData.start) ||
      !SharedData.start
    ) {
      const newShift = SharedData.workingShift.length === 0

      if (newShift) {
        this.startWorkingShift(bar.time)
      }

      this.openMultipleDeals(bar, config)
      return newShift
    }
    return false
  }

  /**
   * Determines if additional deals should be opened for a symbol.
   *
   * @param symbolDeals - Current deal state for the symbol
   * @param config - Processing configuration
   * @returns Whether to open additional deals
   */
  private shouldOpenAdditionalDeals(
    symbolDeals: ReturnType<typeof this.getSymbolDealsState>,
    config: ReturnType<typeof this.getBarProcessingConfig>,
  ): boolean {
    return (
      symbolDeals.total !== 0 &&
      (symbolDeals.closed === symbolDeals.total ||
        symbolDeals.open <
          (config.multi
            ? config.maxPerSymbol
            : config.useDynamic && config.maxDeals
              ? config.maxDeals
              : 1))
    )
  }

  /**
   * Opens multiple deals based on configuration.
   * Optimized to avoid unnecessary array creation.
   *
   * @param bar - Market bar data
   * @param config - Processing configuration
   */
  private openMultipleDeals(
    bar: FullBar,
    config: ReturnType<typeof this.getBarProcessingConfig>,
  ): void {
    const dealCount = config.useDynamic ? 1 : config.maxPerSymbol

    // Optimized loop - no array creation
    for (let i = 0; i < dealCount; i++) {
      DealManager.openDeal(bar.close, bar.time, bar.high, bar.low, bar.symbol)
    }
  }

  /**
   * Processes existing deals and checks for new deal opportunities.
   *
   * @param checkPortfolio - Whether to check portfolio
   * @param bar - Market bar data
   */
  private async processExistingDeals(
    checkPortfolio: boolean,
    bar: FullBar,
  ): Promise<void> {
    await this.checkDeals(checkPortfolio, bar, (price: number) => {
      DealManager.openDeal(price, bar.time, bar.high, bar.low, bar.symbol)
      if (SharedData.combo) {
        this.checkDeals(false, bar)
      }
    })
  }

  /**
   * Safely parses a numeric setting with fallback.
   *
   * @param value - String value to parse
   * @param fallback - Default value if parsing fails
   * @returns Parsed number or fallback
   */
  private parsePositiveNumber(
    value: string | undefined,
    fallback: number,
  ): number {
    if (!value || value === '' || isNaN(+value)) {
      return fallback
    }
    return +value
  }
}

export default ASAPStrategy
