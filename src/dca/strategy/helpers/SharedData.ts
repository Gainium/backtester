import {
  type DCABotSettings,
  type Symbols,
  type Prices,
  type IndicatorsEvents,
  PositionSide,
  Deal,
  Profit,
  FullBar,
  FullGrid,
  Asset,
  DCAGrid,
  ExchangeIntervals,
  IndicatorStartConditionEnum,
  EdgeBacktestEnum,
  DCABacktestingResult,
  BotStartTypeEnum,
  StrategyEnum,
  BotMarginTypeEnum,
  ComboTpBase,
  CloseConditionEnum,
  DCAConditionEnum,
  ScaleDcaTypeEnum,
  BaseSlOnEnum,
  FuturesStrategyEnum,
} from '../../../types'
import DCABotFunctions from '../../../helper/dcaBotFunctions'
import { MathHelper } from '../../../helper/math'
import { Indicator } from '../ti'
import { StrategyInput } from '../main'
import ComboBotFunctions from '../../../helper/comboBotFunctions'
import findUSDRate from '../../../helper/price'

export type DataType = {
  bar: FullBar[]
  interval: ExchangeIntervals
}

/**
 * # SharedData
 *
 * Central runtime configuration and state management for DCA trading strategy.
 * Provides a unified data access layer that eliminates circular dependencies
 * and enables efficient data sharing across all strategy components.
 *
 * ## Architecture
 * - **Static Data Store**: All data stored as static properties for global access
 * - **Type Safety**: Strongly typed data structures with comprehensive type definitions
 * - **Initialization**: Centralized initialization from strategy input parameters
 * - **Cache Management**: Built-in cache invalidation and cleanup methods
 *
 * ## Data Categories
 *
 * ### Trading Configuration
 * - Strategy settings (DCA, combo, futures)
 * - Position management (long/short, leverage)
 * - Risk management (stop-loss, take-profit)
 *
 * ### Market Data
 * - Symbol definitions and metadata
 * - Price feeds and USD conversion rates
 * - Balance tracking and portfolio management
 *
 * ### Deal Management
 * - Deal collections organized by symbol and status
 * - Performance tracking and statistics
 * - Transaction history and auditing
 *
 * ### Optimization Infrastructure
 * - Price calculation caches
 * - Deal counter optimizations
 * - Performance monitoring
 *
 * ## Usage Example
 * ```typescript
 * // Initialize shared data
 * SharedData.initialize(strategyInput)
 *
 * // Access configuration
 * const isLong = SharedData.long
 * const maxDeals = SharedData.settings.maxNumberOfOpenDeals
 *
 * // Access market data
 * const symbol = SharedData.symbols.get('BTCUSDT')
 * const price = SharedData.prices.find(p => p.symbol === 'BTCUSDT')
 *
 * // Manage caches
 * SharedData.invalidateAllCaches()
 * ```
 *
 * @author Gainium Team
 * @version 2.0.0 - Enhanced with optimization infrastructure
 */
export class SharedData {
  static fundsWarning =
    'The bot used more funds than allocated, this might not be accurate in live trading. Please check your settings.'

  static maxDealsPerResult = 50 * 1000

  static combo = false

  static portfolioTimes: Set<string> = new Set()

  static candleTimes: Set<string> = new Set()

  static indicatorEvents: IndicatorsEvents[] = []

  static emptyPosition = {
    qty: 0,
    entryPrice: 0,
    liquidationPrice: 0,
    side: PositionSide.LONG,
  }

  static settings: DCABotSettings

  static botFunctions: Map<string, DCABotFunctions> = new Map()

  static workingShift: { start: number; end?: number }[] = []

  static rangeStatus = false

  static messages: string[] = []

  static maxUsage: {
    deal: number
    bot: number
    botQuote: number
  } = {
    deal: 0,
    bot: 0,
    botQuote: 0,
  }

  static dealsBySymbolsStatusId: Map<string, Map<string, Map<string, Deal>>> =
    new Map()

  static profits: Profit[] = []

  static filterFn: {
    filledOrders: (b: FullBar) => (o: FullGrid) => boolean
    filledTp: (b: FullBar) => (o: FullGrid) => boolean
  }

  static maxProfit = {
    asset: 0,
    usd: 0,
    perc: 0,
  }

  static maxLoss = {
    asset: 0,
    usd: 0,
    perc: 0,
  }

  static seriesWin = {
    count: 0,
    value: 0,
    valueUsd: 0,
    min: 0,
    minUsd: 0,
    max: 0,
    maxUsd: 0,
    perc: 0,
  }

  static seriesLossE = {
    valueUsd: 0,
    minUsd: 0,
    maxUsd: 0,
    perc: 0,
  }

  static seriesLoss = {
    count: 0,
    value: 0,
    valueUsd: 0,
    min: 0,
    minUsd: 0,
    max: 0,
    maxUsd: 0,
    perc: 0,
  }

  static previousDeal?: Deal

  static maxConsecutiveWins = 0

  static maxConsecutiveLosses = 0

  static totalProfit = 0

  static totalProfitPerSymbol: Map<string, number> = new Map()

  static totalProfitUsdPerSymbol: Map<string, number> = new Map()

  static totalProfitUsd = 0

  static lastIndex = 0

  static useFile?: boolean

  static portfolio: Map<number, number> = new Map()

  protected math = new MathHelper()

  static userFee: number

  static usdRate: Map<string, number> = new Map()

  static usdRateQuote: Map<string, number> = new Map()

  static usdRateBase: Map<string, number> = new Map()

  static precision: Map<string, number> = new Map()

  static precisionQuote: Map<string, number> = new Map()

  static precisionBase: Map<string, number> = new Map()

  static prices: Prices

  static symbols: Map<string, Symbols> = new Map()

  static balances?: Asset[] | null

  static gridsOnPrice: Map<string, DCAGrid[]> = new Map()

  static pricesCache: Map<
    string,
    ReturnType<DCABotFunctions['utils']['getPrices']>
  > = new Map()

  static interval: ExchangeIntervals

  static data: DataType[] = []

  static dataMap: Map<ExchangeIntervals, Map<string, FullBar>> = new Map()

  static slippage?: number

  static defaultUnpnl = 2

  static defaultUnpnlCondition = IndicatorStartConditionEnum.gt

  static lastOpenedDeal = 0

  static lastClosedDeal = 0

  static lastOpenedDealPerSymbol: Map<string, number> = new Map()

  static lastClosedDealPerSymbol: Map<string, number> = new Map()

  static lastPricesPerSymbol: Map<string, { avg: number; entry: number }> =
    new Map()

  static lowestInterval?: ExchangeIntervals

  static highestInterval?: ExchangeIntervals

  static indicators: Indicator[] = []

  static next: Map<string, number> = new Map()

  static transactionIndex = 0

  static minPrice: Map<string, number> = new Map()

  static maxPrice: Map<string, number> = new Map()

  static priceMin = 0

  static priceMax = 0

  static start = 0

  static previousValues = 0

  static previousValuesInAsset = new Map<
    string,
    { base: number; quote: number }
  >()

  static fullResult?: boolean

  static preventOpen = false

  static status: 'open' | 'closed' | 'monitoring' = 'open'

  static position: Map<string, typeof SharedData.emptyPosition> = new Map()

  static usedOrderId: Set<string> = new Set()

  static trades?: boolean

  static _stop = false

  static balance: Map<string, number> = new Map()

  static balanceUsd = 0

  static initialBalance = 0

  static balanceForProfit = 0

  static startRate = 0

  static initialBalanceUsd = 0

  static edge?: EdgeBacktestEnum

  static previousResult?: DCABacktestingResult

  static multi = false

  static lowestDataForBnHSymbol = ''

  static lowestDataForBnH: Map<number, FullBar> = new Map()

  static initialized = false

  static long = true

  static profitBase = false

  static futures = false

  static coinm = false

  static leverage = 1

  static comboBasedOn = ComboTpBase.filled

  static scaleAr = false

  static tpAr = false

  static slAr = false

  static baseSlOn = BaseSlOnEnum.avg

  static futuresStrategy = undefined as FuturesStrategyEnum | undefined

  static resetData() {
    SharedData.status = 'open'
    SharedData.preventOpen = false
    SharedData.useFile = false
    SharedData.fullResult = false
    SharedData.dataMap = new Map()
    SharedData.previousValuesInAsset = new Map()
    SharedData.previousValues = 0
    SharedData.start = 0
    SharedData.workingShift = []
    SharedData.maxUsage = {
      deal: 0,
      bot: 0,
      botQuote: 0,
    }
    SharedData.profits = []
    SharedData.maxProfit = {
      asset: 0,
      usd: 0,
      perc: 0,
    }
    SharedData.maxLoss = {
      asset: 0,
      usd: 0,
      perc: 0,
    }
    SharedData.seriesWin = {
      count: 0,
      value: 0,
      valueUsd: 0,
      min: 0,
      minUsd: 0,
      max: 0,
      maxUsd: 0,
      perc: 0,
    }
    SharedData.seriesLossE = {
      valueUsd: 0,
      minUsd: 0,
      maxUsd: 0,
      perc: 0,
    }
    SharedData.seriesLoss = {
      count: 0,
      value: 0,
      valueUsd: 0,
      min: 0,
      minUsd: 0,
      max: 0,
      maxUsd: 0,
      perc: 0,
    }
    SharedData.previousDeal = undefined
    SharedData.maxConsecutiveWins = 0
    SharedData.maxConsecutiveLosses = 0
    SharedData.totalProfit = 0
    SharedData.totalProfitPerSymbol = new Map()
    SharedData.totalProfitUsdPerSymbol = new Map()
    SharedData.totalProfitUsd = 0
    SharedData.lastOpenedDeal = 0
    SharedData.lastClosedDeal = 0
    SharedData.lowestInterval = undefined
    SharedData.highestInterval = undefined
    SharedData.indicators = []
    SharedData.data = []
    SharedData.next = new Map()
    SharedData.rangeStatus = false
    SharedData.transactionIndex = 0
    SharedData.minPrice = new Map()
    SharedData.maxPrice = new Map()
    SharedData.trades = false
    SharedData.indicatorEvents = []
    SharedData.balance = new Map()
    SharedData.balanceUsd = 0
    SharedData.initialBalance = 0
    SharedData.balanceForProfit = 0
    SharedData.startRate = 0
    SharedData.initialBalanceUsd = 0
    SharedData.position = new Map()
    SharedData.edge = undefined
    SharedData.previousResult = undefined
    SharedData.multi = false
    SharedData.lastIndex = 0
    SharedData.portfolio = new Map()
    SharedData.dealsBySymbolsStatusId = new Map()
    SharedData.lowestDataForBnHSymbol = ''
    SharedData.lowestDataForBnH = new Map()
    SharedData.lastClosedDealPerSymbol = new Map()
    SharedData.lastOpenedDealPerSymbol = new Map()
    SharedData.lastPricesPerSymbol = new Map()
    SharedData.messages = []
    SharedData.portfolioTimes = new Set()
    SharedData.candleTimes = new Set()
    SharedData.initialized = false
  }

  static initialize(input: StrategyInput) {
    const {
      settings,
      userFee,
      symbols,
      interval,
      balances,
      slippage,
      combo,
      trades,
      edge,
      previousData,
      multi,
      exchange,
    } = input
    let { prices } = input
    if (!combo) {
      SharedData.edge = edge
      SharedData.previousResult = previousData
    }
    SharedData.multi = !!multi
    SharedData.trades = trades
    SharedData.combo = !!combo
    SharedData.settings = settings
    SharedData.long = settings.strategy === StrategyEnum.long
    SharedData.profitBase =
      (settings.futures && settings.coinm) ||
      (!settings.futures && settings.profitCurrency === 'base')
    SharedData.futures = !!settings.futures
    SharedData.coinm = !!settings.coinm
    SharedData.leverage = settings.futures
      ? settings.marginType !== BotMarginTypeEnum.inherit
        ? (settings.leverage ?? 1)
        : 1
      : 1
    SharedData.comboBasedOn =
      settings.comboTpBase && !settings.useTp && !settings.useSl
        ? ComboTpBase.filled
        : !settings.comboTpBase || settings.comboTpBase === ComboTpBase.full
          ? ComboTpBase.full
          : ComboTpBase.filled
    SharedData.tpAr =
      settings.dealCloseCondition === CloseConditionEnum.dynamicAr &&
      settings.useTp
    SharedData.scaleAr =
      (settings.dcaCondition === DCAConditionEnum.percentage ||
        !settings.dcaCondition) &&
      [ScaleDcaTypeEnum.adr, ScaleDcaTypeEnum.atr].includes(
        settings.scaleDcaType ?? ScaleDcaTypeEnum.percentage,
      ) &&
      settings.useDca
    SharedData.slAr =
      settings.dealCloseConditionSL === CloseConditionEnum.dynamicAr &&
      settings.useSl
    SharedData.baseSlOn =
      combo || settings.trailingSl || settings.moveSL
        ? BaseSlOnEnum.avg
        : (settings.baseSlOn ?? BaseSlOnEnum.avg)
    SharedData.futuresStrategy = this.futures
      ? SharedData.long
        ? FuturesStrategyEnum.long
        : FuturesStrategyEnum.short
      : undefined

    SharedData.status =
      (settings.botActualStart === BotStartTypeEnum.price ||
        settings.botActualStart === BotStartTypeEnum.indicators) &&
      settings.useBotController
        ? 'monitoring'
        : 'open'
    SharedData.preventOpen = !!(
      settings.useBotController &&
      settings.botActualStart === BotStartTypeEnum.indicators
    )
    SharedData.filterFn = {
      filledOrders: SharedData.long
        ? (b: FullBar) => (o: FullGrid) =>
            (b.high >= o.price && b.low <= o.price) || b.high <= o.price
        : (b: FullBar) => (o: FullGrid) =>
            (b.high >= o.price && b.low <= o.price) || b.low >= o.price,
      filledTp: SharedData.long
        ? (b: FullBar) => (o: FullGrid) =>
            (b.high >= o.price && b.low <= o.price) || b.low >= o.price
        : (b: FullBar) => (o: FullGrid) =>
            (b.high >= o.price && b.low <= o.price) || b.high <= o.price,
    }
    prices = prices.filter((p) => (p.exchange ? p.exchange === exchange : true))
    for (const s of symbols) {
      const bu = combo
        ? new ComboBotFunctions(settings, s, userFee, trades)
        : new DCABotFunctions(settings, s, userFee)
      SharedData.symbols.set(s.pair, s)
      SharedData.botFunctions.set(s.pair, bu)
      SharedData.usdRate.set(
        s.pair,
        findUSDRate(
          SharedData.profitBase ? s.baseAsset.name : s.quoteAsset.name,
          prices,
        ),
      )
      SharedData.usdRateQuote.set(
        s.pair,
        findUSDRate(s.quoteAsset.name, prices),
      )
      SharedData.usdRateBase.set(s.pair, findUSDRate(s.baseAsset.name, prices))
      SharedData.precision.set(
        s.pair,
        bu.utils.getPrecision(s)[SharedData.profitBase ? 'base' : 'quote'] + 3,
      )
      SharedData.precisionQuote.set(s.pair, bu.utils.getPrecision(s).quote)
      SharedData.precisionBase.set(s.pair, bu.utils.getPrecision(s).base)
    }
    SharedData.userFee = userFee
    SharedData.prices = prices
    SharedData.interval = interval
    SharedData.balances = balances
    SharedData.slippage = slippage
  }

  /**
   * OPTIMIZATION: Cache management methods
   */
  static invalidateAllCaches() {
    // Import here to avoid circular dependencies
    const { CacheManager } = require('./optimizations/CacheManager')
    const { DealCounters } = require('./optimizations/DealCounters')

    CacheManager.resetAll()
    DealCounters.reset()
  }

  static invalidatePriceCaches() {
    const { CacheManager } = require('./optimizations/CacheManager')
    CacheManager.invalidatePrices()
    CacheManager.invalidateUsdRates()
  }
}
