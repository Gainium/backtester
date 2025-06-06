/**
 * Grid Trading Strategy Implementation
 *
 * This module implements a grid trading strategy for backtesting cryptocurrency trades.
 * Grid trading involves placing buy and sell orders at regular price intervals (grids)
 * to profit from market volatility within a price range.
 *
 * Key Features:
 * - Dynamic grid creation based on price movements
 * - Take profit and stop loss management
 * - Position tracking and portfolio management
 * - Support for both futures and spot trading
 * - Real-time price processing and order execution simulation
 *
 * Performance Considerations:
 * - O(n) filtering operations on grids per bar (n = number of grids)
 * - Typical grid counts: 10-100 grids, making linear operations acceptable
 * - Memory usage scales with number of grids and historical data
 *
 * @fileoverview Grid trading strategy main implementation
 */

import {
  BotOrderSideEnum,
  ExchangeIntervals,
  timeIntervalMap,
} from '../../types'

import { MathHelper } from '../../helper/math'
import findUSDRate from '../../helper/price'

import type {
  Settings,
  Symbols,
  GridBacktestingResult,
  Prices,
  Bar,
  TradeResponse,
} from '../../types'
import { ResultManager } from './helper/ResultManager'
import { SharedData } from './helper/SharedData'
import { PriceCalculator } from './helper/PriceCalculator'
import { TpSlReturn, TradeManager } from './helper/TradeManager'
import { StrategyUtils } from './helper/StrategyUtils'

const math = new MathHelper()

/**
 * Input configuration for grid trading strategy
 */
export type GRIDStrategyInput = {
  /** Strategy configuration settings */
  settings: Settings
  /** Trading pair symbol information */
  symbol: Symbols
  /** User's trading fee percentage */
  userFee: number
  /** Price data for other symbols (for USD rate calculation) */
  prices: Prices
  /** Time interval for price bars (optional, defaults to 5m) */
  interval?: ExchangeIntervals
  /** Whether to include detailed trade information in results */
  trades?: boolean
  /** Whether to return comprehensive backtesting results */
  fullResult?: boolean
}

/**
 * Interface defining the core strategy methods
 */
export interface StrategyInterface {
  /** Load historical price data for backtesting */
  loadData(data: Bar[]): void
  /** Run the backtesting simulation */
  test(updateProgress?: (value: number, text: string) => void): Promise<void>
  /** Process a single price bar and execute trading logic */
  processBar(checkPortfolio: boolean, bar: Bar): Promise<void>
  /** Optional callback for live trade data processing */
  passTradeCandleData?: (
    trade: TradeResponse,
    candles: { candle: Bar[] | null; interval: ExchangeIntervals }[],
  ) => void
  /** Generate final backtesting results */
  returnResult(
    firstData: Bar,
    lastData: Bar,
    loadingTime: number,
    processingTime: number,
  ): GridBacktestingResult
  /** Flag to stop strategy execution */
  stop: boolean
}

/**
 * Grid Trading Strategy Implementation
 *
 * Implements a grid trading strategy that places buy and sell orders at regular intervals
 * to capture profits from market volatility. The strategy creates a grid of orders around
 * the current market price and executes them as the price moves through the grid levels.
 *
 * Key Operations:
 * - Grid creation and management
 * - Order execution simulation
 * - Position tracking and profit calculation
 * - Take profit and stop loss handling
 * - Portfolio value monitoring
 *
 * Performance Notes:
 * - Uses O(n) filtering operations for grid processing per bar
 * - Optimized for typical grid sizes (10-100 orders)
 * - Memory usage scales with grid count and historical data length
 */
export class Strategy implements StrategyInterface {
  /**
   * Initialize the grid trading strategy with input configuration
   * @param input Configuration containing settings, symbol, fees, and price data
   */
  constructor(input: GRIDStrategyInput) {
    SharedData.initialize(input)
  }

  /**
   * Set the stop flag to halt strategy execution
   * @param value True to stop execution, false to continue
   */
  public set stop(value: boolean) {
    SharedData._stop = value
  }

  /**
   * Load historical price data for backtesting
   *
   * Initializes the strategy with price data and calculates USD exchange rates
   * for profit calculations. Sets up the data array that will be processed
   * during backtesting.
   *
   * @param data Array of price bars (OHLC + timestamp)
   */
  public loadData(data: Bar[]): void {
    SharedData.data = data
    const lastRate = SharedData.data[SharedData.data.length - 1]?.close ?? 0
    if (lastRate) {
      // Calculate USD exchange rate for the profit base asset
      SharedData.usdRate = findUSDRate(
        SharedData.profitBase
          ? SharedData.symbol.baseAsset.name
          : SharedData.symbol.quoteAsset.name,
        PriceCalculator.updatePriceWithOldPrice(lastRate),
      )
      // Calculate USD exchange rate for quote asset
      SharedData.usdRateQuote = SharedData.profitBase
        ? findUSDRate(
            SharedData.symbol.quoteAsset.name,
            PriceCalculator.updatePriceWithOldPrice(lastRate),
          )
        : SharedData.usdRate
    }
  }

  /**
   * Get additional time intervals needed for strategy (currently none)
   * @returns Empty array as grid strategy only uses main timeframe
   */
  public getOtherIntervals(): ExchangeIntervals[] {
    return []
  }

  /**
   * Run the complete backtesting simulation
   *
   * Processes all historical price bars sequentially, executing the grid trading
   * logic for each bar. Handles progress reporting and portfolio value tracking.
   *
   * Time Complexity: O(m * n) where m = number of bars, n = average number of grids
   * Space Complexity: O(m + n) for storing bars and grids
   *
   * @param updateProgress Optional callback for progress updates during processing
   */
  public async test(updateProgress?: (value: number, text: string) => void) {
    const size = SharedData.data?.length ?? 0
    let step = 0
    let total = 0
    let i = 0

    // Initialize progress tracking
    if (updateProgress) {
      if (step === 0 && total === 0) {
        updateProgress(
          0,
          `Processing candle on ${new Date(
            SharedData.data?.[0]?.time,
          ).toUTCString()}`,
        )
      }
      if (size !== 0) {
        if (step === 0) {
          step = Math.floor(size * 0.03) // Update every 3% of progress
        }
        if (total === 0) {
          total = size
        }
      }
    }

    // Calculate portfolio check intervals (every 1% of time range)
    const start = SharedData.data[0]?.time
    const end = SharedData.data[SharedData.data.length - 1]?.time
    let stepPortfolio = start !== 0 && end !== 0 ? (end - start) / 100 : 0
    if (
      stepPortfolio <
      timeIntervalMap[SharedData.interval ?? ExchangeIntervals.fiveM]
    ) {
      stepPortfolio =
        timeIntervalMap[SharedData.interval ?? ExchangeIntervals.fiveM]
    }
    let current = start

    // Process each price bar sequentially
    for (const d of SharedData.data) {
      if (SharedData._stop) {
        break
      }
      i++

      // Update progress periodically
      if (size !== 0 && updateProgress) {
        if (math.remainder(i, step) === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0.0000000001))
          updateProgress(
            i / total,
            `Processing candle on ${new Date(d.time).toUTCString()}`,
          )
        }
      }

      // Execute trading operations for this bar
      TradeManager.openPosition(d)
      TradeManager.checkPosition(d)

      if (SharedData.botClosed) {
        break
      }

      // Determine if portfolio should be checked at this interval
      const checkPortfolio = current === start || d.time >= current
      if (checkPortfolio) {
        current += stepPortfolio
      }

      await this.processBar(checkPortfolio, d)
    }
  }

  /**
   * Process live trade data from external source
   *
   * Handles real-time trade data by converting it to a price bar format
   * and processing it through the trading logic. Used for live trading simulation.
   *
   * @param trade Trade response containing price, timestamp, and trade details
   */
  public passTradeCandleData(trade: TradeResponse) {
    if (SharedData.botClosed) {
      return
    }

    // Convert trade to price bar format
    const bar: Bar = {
      open: +trade.price,
      high: +trade.price,
      low: +trade.price,
      close: +trade.price,
      time: trade.timestamp,
    }

    // Process the trade through standard trading logic
    TradeManager.openPosition(bar)
    TradeManager.checkPosition(bar)

    this.processBar(false, bar)
  }

  /**
   * Process a single price bar and execute grid trading logic
   *
   * This is the core method that handles all grid trading operations for each price bar:
   * 1. Initialize price tracking on first bar
   * 2. Check for take profit/stop loss conditions
   * 3. Process filled buy orders and create new grids
   * 4. Process filled sell orders and create new grids
   * 5. Update portfolio value if needed
   *
   * Performance Note: O(n) complexity due to filtering operations on grids array.
   * For typical grid sizes (10-100), this is acceptable performance.
   *
   * @param checkPortfolio Whether to record portfolio value for this bar
   * @param bar Current price bar with OHLC data
   */
  public async processBar(checkPortfolio: boolean, bar: Bar) {
    // Initialize price tracking on first bar
    if (!SharedData.firstBarPrice) {
      SharedData.firstBarPrice = bar.close
    }
    if (!SharedData.botFunctions.initPrice) {
      SharedData.botFunctions.initPrice = bar.close
    }
    if (!SharedData.firstUsdRate) {
      SharedData.lastBarPrice = bar.close
      PriceCalculator.setFirstRate()
    }

    // Check take profit and stop loss conditions if grids exist
    if (SharedData.grids.length !== 0) {
      // Check TP/SL against close, low, and high prices
      for (const p of [bar.close, bar.low, bar.high]) {
        const tpSl = TradeManager.tpSl(p)
        if (tpSl !== TpSlReturn.none) {
          tpSl
          return TradeManager.closeBot(p, bar.time, tpSl)
        }
      }
    }

    // Check if price is within trading range
    TradeManager.checkInRange(bar.close, bar.time)

    // Initialize first working shift and create initial grids
    if (SharedData.workingShift.length === 0) {
      StrategyUtils.startWorkingShift(bar.time)
      TradeManager.createGrids(bar.close, BotOrderSideEnum.buy)
    }

    // Process filled buy orders (price touched grid level from above)
    // Performance: O(n) filter + O(n log n) sort where n = number of grids
    const filledBuy = SharedData.grids
      .filter((g) => g.side === BotOrderSideEnum.buy && g.price >= bar.low)
      .sort((a, b) => a.price - b.price)

    // Execute all filled buy orders
    for (const o of filledBuy) {
      TradeManager.createTransaction({ ...o, filledTime: bar.time })
      StrategyUtils.updatePositionWithOrder(o)
    }

    // Create new grids after buy order execution
    const [lastFilledBuy] = filledBuy
    if (lastFilledBuy) {
      const lastPrice = lastFilledBuy.price
      TradeManager.createGrids(lastPrice, lastFilledBuy.side)
      TradeManager.addAvgHistoryLine(bar.time)
    }

    // Process filled sell orders (price touched grid level from below)
    // Performance: O(n) filter + O(n log n) sort where n = number of grids
    const filledSell = SharedData.grids
      .filter((g) => g.side === BotOrderSideEnum.sell && g.price <= bar.high)
      .sort((a, b) => b.price - a.price)

    // Execute all filled sell orders
    for (const o of filledSell) {
      TradeManager.createTransaction({ ...o, filledTime: bar.time })
      StrategyUtils.updatePositionWithOrder(o)
    }

    // Create new grids after sell order execution
    const [lastFilledSell] = filledSell
    if (lastFilledSell) {
      const lastPrice = lastFilledSell.price
      TradeManager.createGrids(lastPrice, lastFilledSell.side)
      TradeManager.addAvgHistoryLine(bar.time)
    }

    // Record portfolio value at specified intervals
    if (checkPortfolio) {
      SharedData.values.push({
        value: SharedData.currentBalances - SharedData.initialBalances,
        time: bar.time,
      })
    }
  }

  /**
   * Generate comprehensive backtesting results
   *
   * Delegates to ResultManager to compile all trading statistics, performance metrics,
   * and analysis data into a complete backtesting report.
   *
   * @param firstData First price bar from the dataset
   * @param lastData Last price bar from the dataset
   * @param loadingTime Time spent loading and preparing data (ms)
   * @param processingTime Time spent executing the strategy (ms)
   * @returns Complete grid backtesting results with all metrics
   */
  public returnResult(
    firstData: Bar,
    lastData: Bar,
    loadingTime: number,
    processingTime: number,
  ): GridBacktestingResult {
    return ResultManager.returnResult(
      firstData,
      lastData,
      loadingTime,
      processingTime,
    )
  }
}
