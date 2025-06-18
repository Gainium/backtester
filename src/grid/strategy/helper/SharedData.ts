/**
 * Grid Strategy Shared Data Management
 *
 * This class manages all shared state and configuration data for the grid trading strategy.
 * It serves as a centralized data store that all strategy components can access and modify.
 *
 * Key Responsibilities:
 * - Strategy configuration and settings management
 * - Trading state tracking (positions, balances, transactions)
 * - Grid management (active grids, filled orders)
 * - Price and market data storage
 * - Performance metrics and portfolio tracking
 *
 * Performance Considerations:
 * - Static properties provide O(1) access to all data
 * - Arrays grow dynamically with trading activity
 * - Memory usage scales with number of transactions and grids
 *
 * @fileoverview Centralized data management for grid trading strategy
 */

import BotFunctions from '../../../helper/botFunctions'
import {
  BacktestingTransaction,
  Bar,
  BotMarginTypeEnum,
  ExchangeIntervals,
  FullGrid,
  FullGridWithTime,
  FuturesStrategyEnum,
  Grid,
  GridBacktestingResult,
  PositionSide,
  Precision,
  Prices,
  Settings,
  StrategyEnum,
  Symbols,
  ValueChangeHistory,
} from '../../../types'
import { GRIDStrategyInput } from '..'
import findUSDRate from '../../../helper/price'

/**
 * Centralized data management class for grid trading strategy
 *
 * Maintains all shared state including configuration, trading data, and performance metrics.
 * All properties are static to ensure single source of truth across the strategy components.
 */
export class SharedData {
  // === STRATEGY CONFIGURATION ===

  /** Core strategy settings and parameters */
  static settings: Settings

  /** Bot functions instance for order creation and trading logic */
  static botFunctions: BotFunctions

  // === TRADING STATE ===

  /** Active trading sessions with start/end timestamps */
  static workingShift: { start: number; end?: number }[] = []

  /** Whether the strategy is currently within acceptable price range */
  static rangeStatus = false

  /** Complete history of all executed transactions */
  static transactions: BacktestingTransaction[] = []

  /** Portfolio value change history over time */
  static values: ValueChangeHistory[] = []

  /** Total profit/loss in base currency */
  static totalProfit = 0

  /** Total profit/loss in USD */
  static totalProfitUsd = 0

  /** Free (unrealized) total profit */
  static freeTotalProfit = 0

  // === MARKET DATA ===

  /** Trading pair symbol information */
  static symbol: Symbols

  /** User's trading fee percentage */
  static userFee: number

  /** Current USD exchange rate for profit calculations */
  static usdRate: number

  /** Initial USD exchange rate (at strategy start) */
  static firstUsdRate = 0

  /** Last recorded USD exchange rate */
  static lastUsdRate = 0

  /** USD exchange rate for quote asset */
  static usdRateQuote: number

  /** Price precision for the trading pair */
  static precision: number

  /** Quote asset precision */
  static precisionQuote: number

  /** Time interval for price bars */
  static interval?: ExchangeIntervals

  /** Historical price data for backtesting */
  static data: Bar[] = []

  // === GRID MANAGEMENT ===

  /** Current active grid orders (buy and sell) */
  static grids: FullGrid[] = []

  /** Smart grids for advanced order management */
  static smartGrids: FullGrid[] = []

  /** Initial grid configuration when strategy started */
  static initialGrids: { buy: number; sell: number }[] = []

  /** Set of already used order IDs to prevent duplicates */
  static usedOrderId: Set<string> = new Set()

  /** History of all filled orders with timestamps */
  static filledOrders: FullGridWithTime[] = []

  /** Map of filled orders by ID for transaction processing */
  static filledOrdersForTransaction: Map<string, FullGridWithTime> = new Map()

  // === BALANCE TRACKING ===

  /** Initial balances by asset type when strategy started */
  static initialBalancesByAsset = {
    base: 0,
    quote: 0,
  }

  /** Total initial balance value */
  static initialBalances = 0

  /** Initial balance value in USD */
  static initialBalancesUsd = 0

  /** Current balances by asset type */
  static currentBalancesByAsset = {
    base: 0,
    quote: 0,
  }

  /** Total current balance value */
  static currentBalances = 0

  /** Current balance value in USD */
  static currentBalancesUsd = 0

  /** Precision settings for all assets */
  static allPrecision: Precision

  /** Index counter for transaction tracking */
  static transactionIndex = 0

  // === BOT STATE ===

  /** Whether the bot/strategy has been closed */
  static botClosed = false

  /** Whether the bot was closed and should sell positions */
  static botClosedAndSell = false

  /** Last recorded price */
  static lastPrice = 0

  // === POSITION MANAGEMENT ===

  /** Empty position template */
  static emptyPositon = {
    qty: 0,
    entryPrice: 0,
    liquidationPrice: 0,
    side: PositionSide.LONG,
  }

  /** Current position state */
  static position = SharedData.emptyPositon

  /** Position statistics tracking */
  static positionStats = {
    count: 0,
  }

  /** Whether initial position opening has occurred */
  static initialOpen = false

  // === HISTORY AND REPORTING ===

  /** History of grid order execution for reporting */
  static historyLines: NonNullable<GridBacktestingResult['ordersHistory']> = []

  /** Pending history line to be added */
  static pendingHistoryLine:
    | NonNullable<GridBacktestingResult['ordersHistory']>[0]
    | null = null

  /** Cumulative profit tracking by asset type */
  static cummulativeProfit = {
    base: 0,
    quote: 0,
    usd: 0,
  }

  // === PRICE TRACKING ===

  /** Last processed bar price */
  static lastBarPrice = 0

  /** First bar price (strategy start price) */
  static firstBarPrice = 0

  // === CONTROL FLAGS ===

  /** Flag to stop strategy execution */
  static _stop = false

  // === EXTERNAL DATA ===

  /** Price data for other symbols (excluding current trading pair) */
  static pricesWOutSymbols: Prices = []

  /** Memoized orders cache for performance optimization */
  static memoryOrders: Map<string, Grid[]> = new Map()

  /** Whether to return full detailed results */
  static fullResult?: boolean

  /** Whether profits are calculated in base asset */
  static profitBase = false

  /** Trading leverage (for futures) */
  static leverage = 1

  /** Whether trading futures contracts */
  static futures = false

  /** Whether using coin-margined futures */
  static coinm = false

  /** Futures trading strategy type */
  static futuresStrategy = FuturesStrategyEnum.neutral

  /** Whether taking short positions */
  static isShort = false

  /**
   * Initialize the shared data with strategy configuration
   *
   * Sets up all necessary data structures and configuration for the grid trading strategy.
   * This method must be called before any trading operations begin.
   *
   * @param input Complete strategy configuration including settings, symbol, and market data
   */
  static initialize(input: GRIDStrategyInput) {
    const { settings, userFee, symbol, prices, interval, trades, fullResult } =
      input

    // Core configuration setup
    SharedData.fullResult = fullResult
    SharedData.settings = settings
    SharedData.botFunctions = new BotFunctions(
      settings,
      userFee,
      symbol,
      0,
      0,
      trades,
    )

    // Trading mode configuration
    SharedData.profitBase =
      this.coinm || this.settings.profitCurrency === 'base'
    SharedData.leverage = settings.futures
      ? settings.marginType !== BotMarginTypeEnum.inherit
        ? (this.settings.leverage ?? 1)
        : 1
      : 1
    SharedData.futures = !!settings.futures
    SharedData.coinm = !!settings.coinm
    SharedData.futuresStrategy =
      settings.futuresStrategy ?? FuturesStrategyEnum.neutral
    SharedData.isShort = SharedData.settings.strategy === StrategyEnum.short

    // Market data setup
    SharedData.botFunctions.forceLocal = true
    SharedData.symbol = symbol
    SharedData.userFee = userFee
    SharedData.interval = interval

    // USD rate calculations for profit reporting
    SharedData.usdRate = findUSDRate(
      SharedData.profitBase ? symbol.baseAsset.name : symbol.quoteAsset.name,
      prices,
    )
    SharedData.usdRateQuote = SharedData.profitBase
      ? findUSDRate(symbol.quoteAsset.name, prices)
      : SharedData.usdRate

    // Precision settings for price and quantity calculations
    SharedData.allPrecision = SharedData.botFunctions.utils.getPrecision(symbol)
    SharedData.precision =
      SharedData.allPrecision[SharedData.profitBase ? 'base' : 'quote']
    SharedData.precisionQuote =
      SharedData.botFunctions.utils.getPrecision(symbol).quote

    // Filter external price data (exclude current trading pair)
    SharedData.pricesWOutSymbols = prices.filter(
      (p) => p.symbol !== SharedData.symbol.pair,
    )
  }
}
