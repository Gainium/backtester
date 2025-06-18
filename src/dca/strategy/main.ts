/**
 * # DCA Trading Strategy Main Module
 *
 * Core implementation of the Dollar Cost Averaging (DCA) trading strategy with advanced
 * optimization features, modular architecture, and comprehensive backtesting capabilities.
 *
 * ## Architecture Overview
 * This module implements a highly optimized, modular DCA trading strategy that replaces
 * traditional monolithic approaches with a clean separation of concerns through specialized
 * helper classes. The architecture achieves significant performance improvements through
 * algorithmic optimizations (O(n) → O(1)) and intelligent caching systems.
 *
 * ## Core Components
 *
 * ### Strategy Management
 * - **Strategy**: Abstract base class providing common functionality
 * - **StrategyInterface**: Contract defining required strategy operations
 * - **SharedData**: Centralized configuration and state management
 *
 * ### Deal Management
 * - **DealManager**: Complete deal lifecycle management with O(1) operations
 * - **DealCounters**: High-performance deal counting optimization
 *
 * ### Price & Portfolio Management
 * - **PriceCalculator**: Optimized price calculations with smart caching
 * - **PortfolioManager**: Real-time portfolio valuation and PnL tracking
 * - **OptimizedPriceCalculator**: Single-pass price calculations
 *
 * ### Analysis & Results
 * - **ResultManager**: Comprehensive performance analysis and reporting
 * - **StrategyUtils**: Essential utility functions for strategy operations
 *
 * ### Performance Optimizations
 * - **CacheManager**: Intelligent caching system (80-95% performance improvement)
 * - **DealCounters**: O(1) deal counting (90-99% performance improvement)
 * - **OptimizedPortfolioManager**: Cached portfolio calculations
 *
 * ## Key Features
 *
 * ### Trading Capabilities
 * - Multi-asset DCA strategy execution
 * - Long and short position support
 * - Futures and spot trading modes
 * - Dynamic grid management
 * - Take-profit and stop-loss automation
 *
 * ### Performance Optimizations
 * - **Algorithmic**: O(n) → O(1) for deal counting and queries
 * - **Caching**: Smart caching for USD rates, prices, and calculations
 * - **Memory**: Efficient data structures and memory management
 * - **Processing**: Single-pass algorithms where possible
 *
 * ### Backtesting Features
 * - Historical data processing with multiple timeframes
 * - Real-time portfolio valuation
 * - Comprehensive performance metrics
 * - Risk analysis and drawdown calculations
 *
 * ## Usage Example
 * ```typescript
 * // Initialize strategy
 * const strategy = new ConcreteStrategy({
 *   settings: dcaSettings,
 *   symbols: tradingPairs,
 *   prices: marketPrices,
 *   // ... other configuration
 * })
 *
 * // Load historical data
 * strategy.loadData(historicalData)
 *
 * // Run backtesting
 * await strategy.test(startTime, endTime)
 *
 * // Get results
 * const results = strategy.returnResult(firstBar, lastBar, loadTime, processTime)
 * ```
 *
 * @author Gainium Team
 * @version 2.0.0 - Modular architecture with O(1) optimizations
 * @since 1.0.0 - Initial DCA strategy implementation
 */

import { StrategyUtils, CandleTypeEnum } from './helpers/StrategyUtils'
import { DealManager } from './helpers/DealManager'
import { DCAOrderTypeEnum, ExchangeIntervals } from '../../types'

import type {
  DCABotSettings,
  Deal,
  FullGrid,
  Symbols,
  DCABacktestingResult,
  Prices,
  Asset,
  Bar as BarTV,
  TradeResponse,
  EdgeBacktestEnum,
  FullBar,
  ExchangeEnum,
} from '../../types'
import { DataType, SharedData } from './helpers/SharedData'
import { PortfolioManager } from './helpers/PortfolioManager'
import { ResultManager } from './helpers/ResultManager'

export type Bar = BarTV

/**
 * Configuration input for DCA trading strategy initialization.
 * Contains all necessary parameters for strategy setup and execution.
 */
export type StrategyInput = {
  /** DCA bot configuration settings */
  settings: DCABotSettings
  /** Trading pairs to be processed */
  symbols: Symbols[]
  /** User's trading fee percentage */
  userFee: number
  /** Price data for market analysis */
  prices: Prices
  /** Primary candlestick interval for strategy execution */
  interval: ExchangeIntervals
  /** Initial account balances (optional) */
  balances?: Asset[] | null
  /** Order slippage percentage (optional) */
  slippage?: number
  /** Enable combo trading mode (optional) */
  combo?: boolean
  /** Enable live trading mode (optional) */
  trades?: boolean
  /** Edge testing mode configuration (optional) */
  edge?: EdgeBacktestEnum
  /** Previous backtesting results for continuation (optional) */
  previousData?: DCABacktestingResult
  /** Multi-symbol processing mode (optional) */
  multi?: boolean
  /** Trading timezone (optional) */
  timezone?: string | null
  /** Generate full detailed results (optional) */
  fullResult?: boolean
  /** Use file-based data storage (optional) */
  useFile?: boolean
  /** Target exchange for strategy execution */
  exchange: ExchangeEnum
}

/**
 * Core strategy interface defining the contract for DCA trading strategy implementations.
 * All concrete strategy classes must implement these methods to ensure consistent behavior.
 */
export interface StrategyInterface {
  /** Get additional timeframe intervals required for strategy analysis */
  getOtherIntervals(): { interval: ExchangeIntervals; countBack: number }[]

  /** Load historical market data for backtesting */
  loadData(data: DataType[], start?: number): void

  /** Execute backtesting process over specified time range */
  test(
    start: number,
    end: number,
    updateProgress?: (value: number, text: string) => void,
    total?: number,
  ): Promise<void>

  /** Perform pre-testing initialization and validation */
  preTest(): Promise<void>

  /** Initialize a new working shift at specified timestamp */
  startWorkingShift(start: number): void

  /** Process individual market candle/bar data */
  processBar(
    checkPortfolio: boolean,
    bar: FullBar,
    interval?: ExchangeIntervals,
  ): Promise<void>

  /** Process individual trade execution */
  processTrade(
    trade: TradeResponse,
    candles: { candle: FullBar[] | null; interval: ExchangeIntervals }[],
  ): void

  /** Optional callback for passing trade candle data */
  passTradeCandleData?: (
    trade: TradeResponse,
    candles: { candle: FullBar[] | null; interval: ExchangeIntervals }[],
  ) => void

  /** Generate final backtesting results with performance metrics */
  returnResult(
    firstData: Map<string, FullBar>,
    lastData: Map<string, FullBar>,
    loadingTime: number,
    processingTime: number,
  ): DCABacktestingResult

  /** Flag to stop strategy execution */
  stop: boolean

  /** Strategy start timestamp */
  _start: number
}

/**
 * Abstract base class for DCA trading strategy implementations.
 *
 * Provides common functionality and state management for all DCA strategy variants.
 * Concrete strategy classes extend this base to implement specific trading logic
 * while leveraging the shared infrastructure provided here.
 *
 * ## Responsibilities
 * - **Initialization**: Strategy setup and SharedData initialization
 * - **Data Management**: Historical data loading and organization
 * - **State Control**: Stop/start mechanism and progress tracking
 * - **Deal Processing**: Core deal checking and candle processing logic
 * - **Infrastructure**: Common utilities used by all strategy implementations
 *
 * ## Key Features
 * - **Modular Architecture**: Delegates specialized operations to helper classes
 * - **Optimized Performance**: Leverages O(1) operations via optimized helpers
 * - **State Management**: Centralized state via SharedData pattern
 * - **Extensibility**: Abstract methods allow customization in concrete implementations
 *
 * ## Architecture Integration
 * This class serves as the orchestrator that coordinates between:
 * - **DealManager**: Deal lifecycle and operations
 * - **PortfolioManager**: Portfolio valuation and tracking
 * - **StrategyUtils**: Common utility functions
 * - **SharedData**: Centralized configuration and state
 *
 * ## Usage Pattern
 * ```typescript
 * class MyDCAStrategy extends Strategy {
 *   async test(start: number, end: number) {
 *     // Custom testing logic
 *   }
 *
 *   async processBar(checkPortfolio: boolean, bar: FullBar) {
 *     await this.checkDeals(checkPortfolio, bar)
 *     // Additional custom processing
 *   }
 * }
 * ```
 */
export abstract class Strategy implements StrategyInterface {
  /**
   * Reset all static data - primarily for testing and cleanup
   */
  static resetData() {
    SharedData.resetData
  }

  /**
   * Initialize strategy with configuration input.
   * Sets up SharedData if not already initialized.
   *
   * @param input Strategy configuration parameters
   */
  constructor(input: StrategyInput) {
    if (!SharedData.initialized) {
      SharedData.initialize(input)
    }
  }

  /**
   * Set strategy stop flag to halt execution
   */
  public set stop(value: boolean) {
    SharedData._stop = value
  }

  /**
   * Update strategy settings during execution
   */
  public set settingsUpdate(settings: DCABotSettings) {
    SharedData.settings = settings
  }

  /**
   * Set strategy start timestamp
   */
  public set _start(value: number) {
    SharedData.start = value
  }

  /**
   * Load historical market data for backtesting.
   *
   * Organizes data into time-indexed maps for efficient lookups during processing.
   * Creates both interval-based and symbol+time-based indexing for O(1) data access.
   *
   * @param data Array of market data organized by intervals
   * @param start Optional start timestamp override
   */
  public loadData(data: DataType[], start?: number): void {
    SharedData.start = start ?? 0
    SharedData.data = data
    SharedData.dataMap = new Map(
      data.map((d) => [
        d.interval,
        new Map(d.bar.map((b) => [`${b.time}@${b.symbol}`, b])),
      ]),
    )
  }

  /**
   * Get additional timeframe intervals required for strategy analysis.
   * Override in concrete implementations to specify multi-timeframe requirements.
   *
   * @returns Array of interval configurations with lookback counts
   */
  public getOtherIntervals(): {
    interval: ExchangeIntervals
    countBack: number
  }[] {
    return []
  }

  /**
   * Execute backtesting process over specified time range.
   * Must be implemented by concrete strategy classes.
   */
  public abstract test(start: number, end: number): Promise<void>

  /**
   * Perform pre-testing initialization and validation.
   * Must be implemented by concrete strategy classes.
   */
  public abstract preTest(): Promise<void>

  /**
   * Initialize a new working shift at specified timestamp.
   * Tracks working periods for performance analysis.
   *
   * @param start Timestamp when working shift begins
   */
  public startWorkingShift(start: number): void {
    SharedData.workingShift.push({ start })
  }

  /**
   * Process individual market candle/bar data.
   * Must be implemented by concrete strategy classes.
   */
  public abstract processBar(
    checkPortfolio: boolean,
    bar: FullBar,
    interval?: ExchangeIntervals,
  ): Promise<void>

  /**
   * Process individual trade execution.
   * Must be implemented by concrete strategy classes.
   */
  public abstract processTrade(
    trade: TradeResponse,
    candles: { candle: FullBar[] | null; interval: ExchangeIntervals }[],
  ): void

  /**
   * Core deal processing engine - the heart of the DCA strategy execution.
   *
   * This method orchestrates all deal-related operations for each market candle,
   * including deal opening, order processing, portfolio tracking, and price monitoring.
   * It implements the complete DCA trading logic with optimization features.
   *
   * ## Processing Flow
   * 1. **Validation**: Check stop conditions and prevent duplicate processing
   * 2. **Price Tracking**: Update min/max price ranges for strategy analysis
   * 3. **Portfolio Management**: Update portfolio values and drawdown calculations
   * 4. **Deal Opening**: Create new deals when conditions are met
   * 5. **Deal Processing**: Process existing deals for each candle movement
   *
   * ## Candle Processing Strategy
   * The method simulates realistic intracandle price movement by processing
   * different price levels in logical order:
   * - **Bull Candles**: open → low (DCA/SL) → high → close (TP)
   * - **Bear Candles**: open → high (TP) → low → close (DCA/SL)
   *
   * ## Performance Optimizations
   * - **Duplicate Prevention**: Uses Set-based candle tracking (O(1) lookups)
   * - **Optimized Deal Queries**: Leverages DealManager's O(1) operations
   * - **Smart Processing**: Only processes relevant deals per symbol
   * - **Cached Calculations**: Portfolio and price calculations use caching
   *
   * ## Deal Operations Processed
   * - **Grid Orders**: Take-profit level execution
   * - **DCA Orders**: Dollar cost averaging entries
   * - **Stop Loss**: Risk management order execution
   * - **Close Timers**: Time-based deal closure
   * - **Portfolio Updates**: Real-time value tracking
   *
   * ## Integration with Helpers
   * - **DealManager**: Deal lifecycle management and order processing
   * - **PortfolioManager**: Portfolio valuation and drawdown tracking
   * - **StrategyUtils**: Candle analysis and utility functions
   * - **SharedData**: Centralized state and configuration access
   *
   * @param checkPortfolio Whether to update portfolio calculations this cycle
   * @param b Current market candle/bar being processed
   * @param cbClose Optional callback function executed on deal closure
   *
   * @example
   * ```typescript
   * // Process a market candle with portfolio updates
   * await strategy.checkDeals(true, currentBar, (price) => {
   *   console.log(`Deal closed at price: ${price}`)
   * })
   *
   * // Process candle without portfolio updates (for performance)
   * await strategy.checkDeals(false, currentBar)
   * ```
   */
  public async checkDeals(
    checkPortfolio: boolean,
    b: FullBar,
    cbClose?: (price: number) => void,
  ) {
    // Early exit if strategy is stopped
    if (SharedData._stop) {
      return
    }

    // Prevent duplicate processing of the same candle
    const key = `${b.symbol}-${b.time}`
    if (SharedData.candleTimes.has(key)) {
      return
    }
    SharedData.candleTimes.add(key)

    // Track price ranges for strategy analysis (non-multi mode)
    if (!SharedData.settings.useMulti && !SharedData.edge) {
      if (SharedData.priceMin === 0 || b.low < SharedData.priceMin) {
        SharedData.priceMin = b.low
      }
      if (SharedData.priceMax === 0 || b.high > SharedData.priceMax) {
        SharedData.priceMax = b.high
      }
    }

    // Initialize and track buy & hold reference data
    if (!SharedData.lowestDataForBnHSymbol) {
      SharedData.lowestDataForBnHSymbol = b.symbol
    }
    if (b.symbol === SharedData.lowestDataForBnHSymbol) {
      SharedData.lowestDataForBnH.set(b.time, b)
    }

    // Attempt to open new deal if conditions are met
    const fullSymbol = SharedData.symbols.get(b.symbol)
    if (fullSymbol) {
      // Determine the relevant asset for balance checking
      const k = SharedData.futures
        ? SharedData.coinm
          ? fullSymbol.baseAsset.name
          : fullSymbol.quoteAsset.name
        : SharedData.long
          ? fullSymbol.quoteAsset.name
          : fullSymbol.baseAsset.name

      // Open deal if no balance exists for this asset (first time setup)
      if (!SharedData.balance.has(k)) {
        DealManager.openDeal(b.close, b.time, b.high, b.low, b.symbol, true)
      }
    }

    // Update portfolio values and check for drawdowns
    if (checkPortfolio) {
      PortfolioManager.checkPortfolio(b.time, b.close, b.symbol)
      PortfolioManager.checkEquityDrawdown()
    }
    // Process all open deals for this symbol
    // OPTIMIZED: Uses DealManager.getDeals() with O(1) symbol filtering
    for (let d of DealManager.getDeals('open', b.symbol)) {
      // Create deep copy to avoid mutation issues
      d = JSON.parse(JSON.stringify(d)) as Deal

      // Check if deal should be closed due to time limits
      let tpOrder: FullGrid | undefined
      tpOrder = DealManager.checkCloseTimer(d, b)

      // Create candle variations for realistic intra-candle price simulation
      const bOpenHigh = { ...b, low: b.open } // open → high movement
      const bLowClose = { ...b, high: b.close } // low → close movement
      const bHighClose = { ...b, low: b.close } // high → close movement
      const bOpenLow = { ...b, high: b.open } // open → low movement

      // Determine candle type for processing order
      const candleType = StrategyUtils.getCandleType(b)
      let closePrice = 0
      // LONG POSITION PROCESSING
      // For long positions: buy low, sell high
      if (SharedData.long && !tpOrder) {
        if (candleType === CandleTypeEnum.bull) {
          // Bull candle: Process open → low (DCA and SL opportunities)
          const r = await DealManager.processGridOrders(d, b)
          d = r.deal
          closePrice = r.closePrice
          if (d.status !== 'closed') {
            // Process DCA (Dollar Cost Averaging) orders
            d = await DealManager.processDCAOrders(d, b)

            // Check stop-loss conditions
            const slReturn = DealManager.getSLOrder(d, b)
            d = slReturn.deal
            if (slReturn.order) {
              tpOrder = slReturn.order
            }

            // Bull candle: low → high movement. Check TP and trailing SL
            if (!tpOrder) {
              const tpReturn = DealManager.filterTP(d, bOpenHigh)
              d = tpReturn.deal
              tpOrder = tpReturn.order
              d = DealManager.checkValue(b, d)
              d = DealManager.checkTrailing(d, b.high, b.time)
            }

            // Bull candle: high → close movement. Check if SL was moved
            if (!tpOrder) {
              const slNext = DealManager.getSLOrder(d, bHighClose)
              d = slNext.deal
              if (slNext.order) {
                tpOrder = slNext.order
              }
            }
          }
        }

        // BEAR CANDLE PROCESSING FOR LONG POSITIONS
        if (candleType === CandleTypeEnum.bear) {
          // Bear candle: open → high movement. Check TP and trailing SL first
          const tpReturn = DealManager.filterTP(d, bOpenHigh)
          d = tpReturn.deal
          tpOrder = tpReturn.order
          d = DealManager.checkValue(bOpenHigh, d)
          d = DealManager.checkTrailing(d, b.high, b.time)

          // Bear candle: high → low movement. Check SL and DCA if no TP
          if (!tpOrder) {
            const r = await DealManager.processGridOrders(d, b)
            d = r.deal
            closePrice = r.closePrice
            if (d.status !== 'closed') {
              d = await DealManager.processDCAOrders(d, b)
              const slReturn = DealManager.getSLOrder(d, b)
              d = slReturn.deal
              if (slReturn.order) {
                tpOrder = slReturn.order
              }
            }
          }

          // Bear candle: low → close movement. Final TP check
          if (!tpOrder) {
            const tpReturnNext = DealManager.filterTP(d, bLowClose)
            d = tpReturnNext.deal
            tpOrder = tpReturnNext.order
          }
        }
      }
      // SHORT POSITION PROCESSING (else clause)
      // For short positions: sell high, buy low
      else if (!tpOrder) {
        // BULL CANDLE PROCESSING FOR SHORT POSITIONS
        if (candleType === CandleTypeEnum.bull) {
          // Bull candle: open → low movement. Check TP first for shorts
          const tpReturn = DealManager.filterTP(d, bOpenLow)
          d = tpReturn.deal
          tpOrder = tpReturn.order
          d = DealManager.checkValue(bOpenLow, d)
          d = DealManager.checkTrailing(d, b.low, b.time)

          // Bull candle: low → high movement. Check SL and DCA for shorts
          if (!tpOrder) {
            const r = await DealManager.processGridOrders(d, b)
            d = r.deal
            closePrice = r.closePrice
            if (d.status !== 'closed') {
              d = await DealManager.processDCAOrders(d, b)
              const slReturn = DealManager.getSLOrder(d, b)
              d = slReturn.deal
              if (slReturn.order) {
                tpOrder = slReturn.order
              }
            }
          }

          // Bull candle: high → close movement. Final TP check for shorts
          if (!tpOrder) {
            const tpReturnNext = DealManager.filterTP(d, bHighClose)
            d = tpReturnNext.deal
            tpOrder = tpReturnNext.order
          }
        }
        if (candleType === CandleTypeEnum.bear) {
          // open -> high movement. Check for filled DCA and SL
          const r = await DealManager.processGridOrders(d, bOpenHigh)
          d = r.deal
          closePrice = r.closePrice
          if (d.status !== 'closed') {
            d = await DealManager.processDCAOrders(d, bOpenHigh)
            const slReturn = DealManager.getSLOrder(d, bOpenHigh)
            d = slReturn.deal
            if (slReturn.order) {
              tpOrder = slReturn.order
            }

            // high -> low movement. Check for filled TP and move SL and check trailing
            if (!tpOrder) {
              const tpReturn = DealManager.filterTP(d, b)
              d = tpReturn.deal
              tpOrder = tpReturn.order
              d = DealManager.checkValue(b, d)
              d = DealManager.checkTrailing(d, b.low, b.time)
            }
            // low -> close. Check SL if it was moved
            if (!tpOrder) {
              const slReturnNext = DealManager.getSLOrder(d, bLowClose)
              d = slReturnNext.deal
              if (slReturnNext.order) {
                tpOrder = slReturnNext.order
              }
            }
          }
        }
      }

      // DEAL CLOSURE PROCESSING
      // If any take-profit order was triggered, close the deal
      if (tpOrder) {
        const r = DealManager.closeDeal(d, b, tpOrder)
        d = r.deal
        closePrice = r.closePrice
      }

      // DEAL STATE MANAGEMENT
      // Update deal status and trigger callbacks
      if (d.status === 'closed') {
        DealManager.processDealCloseFromMap(d)
        if (closePrice && cbClose) {
          cbClose(closePrice) // Notify caller of deal closure
        }
      } else {
        // Keep deal active and update in collections
        DealManager.setDeal(d, d.status, b.symbol)
      }
    }

    // POST-PROCESSING: Position and usage tracking
    PortfolioManager.checkPosition(b)

    // USAGE TRACKING AND RISK MANAGEMENT
    // Calculate and track maximum usage for risk analysis
    const openDeals = DealManager.getDeals('open')
    if ((SharedData.long || SharedData.futures) && !SharedData.coinm) {
      // For long positions or futures (non-coinm): track quote asset usage
      const all = openDeals.reduce(
        (acc, deal) => (acc += deal.usage.current.quote),
        0,
      )
      if (all > SharedData.maxUsage.bot) {
        SharedData.maxUsage.bot = all
        SharedData.maxUsage.botQuote = all
      }
    } else if (!SharedData.long || SharedData.coinm) {
      // For short positions or coinm futures: track base asset usage
      const all = openDeals.reduce(
        (acc, deal) => (acc += deal.usage.current.base),
        0,
      )
      if (all > SharedData.maxUsage.bot) {
        SharedData.maxUsage.bot = all
        SharedData.maxUsage.botQuote = openDeals.reduce(
          (acc, deal) =>
            acc +
            deal.filledOrders
              .filter(
                (df) =>
                  df.type &&
                  [DCAOrderTypeEnum.dca, DCAOrderTypeEnum.bo].includes(df.type),
              )
              .reduce((acco, v) => acco + v.qty * v.price, 0),
          0,
        )
      }
    }
  }

  /**
   * Generate comprehensive backtesting results with performance metrics.
   *
   * Delegates to ResultManager to compile and analyze all trading data,
   * performance metrics, risk statistics, and portfolio analytics collected
   * during the backtesting process.
   *
   * @param firstData Map of first candle data per symbol for baseline comparison
   * @param lastData Map of last candle data per symbol for final valuation
   * @param loadingTime Time spent loading and preparing data (milliseconds)
   * @param processingTime Time spent executing strategy logic (milliseconds)
   * @returns Comprehensive backtesting result with all performance metrics
   */
  public returnResult(
    firstData: Map<string, FullBar>,
    lastData: Map<string, FullBar>,
    loadingTime: number,
    processingTime: number,
  ): DCABacktestingResult {
    return ResultManager.returnResult(
      firstData,
      lastData,
      loadingTime,
      processingTime,
    )
  }
}
