import { MathHelper } from '../../../helper/math'
import {
  Deal,
  FullGrid,
  DCAOrderTypeEnum,
  ComboTpBase,
  IndicatorAction,
  DCAConditionEnum,
  BotOrderSideEnum,
  CooldownOptionsEnum,
  CooldownUnits,
  IndicatorStartConditionEnum,
  BotStartTypeEnum,
  DynamicArPrices,
  DynamicPriceFilterPriceTypeEnum,
  DynamicPriceFilterDirectionEnum,
  IndicatorEnum,
  ppValueEnum,
  SRCrossingEnum,
  BBCrossingEnum,
  MAResult,
  STConditionEnum,
  RiskSlTypeEnum,
  IndicatorSection,
  Sizes,
  DCAGrid,
  OrderSizeTypeEnum,
  StrategyEnum,
  CloseConditionEnum,
  BaseSlOnEnum,
  TrailingModeEnum,
  FullBar,
  Bar as BarTV,
  IndicatorsLogicEnum,
  CloseDCATypeEnum,
  Minigrid,
  FuturesStrategyEnum,
  BacktestingTransaction,
  PreparedDeal,
} from '../../../types'
import { PriceCalculator } from './PriceCalculator'
import { SharedData } from './SharedData'
import {
  BandsResult,
  PivotResult,
  PriorPivotResult,
  QFLResult,
  SuperTrendResult,
} from '@gainium/indicators'
import { StrategyUtils } from './StrategyUtils'
import { friendlyTime } from '../../../helper/timeFunctions'
import { checkNumber } from '../../../helper/utils'
import { v4 } from 'uuid'
import { DealCounters } from './optimizations/DealCounters'

const math = new MathHelper()

/**
 * # DealManager
 *
 * Core deal lifecycle management system for DCA trading strategy.
 * Handles all aspects of deal creation, state management, and operations.
 *
 * ## Features
 * - **Deal Collections**: Efficient deal storage and retrieval using nested Maps
 * - **State Management**: Deal status transitions (open ↔ closed)
 * - **Validation**: Deal limits, conditions, and constraints
 * - **Optimization**: O(1) deal counting via DealCounters integration
 *
 * ## Performance Optimizations
 * - Uses `DealCounters` for O(1) deal counting operations
 * - Nested Map structure for O(1) deal lookups by symbol and status
 * - Smart caching for frequently accessed deal data
 *
 * ## Usage Example
 * ```typescript
 * // Get deals by status and symbol
 * const openDeals = DealManager.getDeals('open', 'BTCUSDT')
 *
 * // Check deal count limits
 * const canCreate = DealManager.checkMaxDeals('BTCUSDT')
 *
 * // Create and manage deals
 * const deal = DealManager.createDeal(symbol, baseOrder, settings)
 * DealManager.setDeal(deal, 'open', symbol)
 * ```
 *
 * @author Gainium Team
 * @version 2.0.0 - Optimized with O(1) counters
 */
export class DealManager {
  // ========================================
  // DEAL COLLECTION AND QUERY METHODS
  // ========================================

  /**
   * Retrieves deals based on status and symbol filters.
   *
   * @param status - Optional deal status filter ('open' | 'closed')
   * @param symbol - Optional trading pair symbol filter
   * @returns Array of deals matching the criteria
   *
   * @complexity O(n) for collection iteration, O(1) for specific lookups
   *
   * @example
   * ```typescript
   * // Get all open deals
   * const openDeals = DealManager.getDeals('open')
   *
   * // Get all deals for BTCUSDT
   * const btcDeals = DealManager.getDeals(undefined, 'BTCUSDT')
   *
   * // Get open BTCUSDT deals
   * const openBtcDeals = DealManager.getDeals('open', 'BTCUSDT')
   * ```
   */
  static getDeals(status?: Deal['status'], symbol?: string): Deal[] {
    if (!status) {
      const d: Deal[] = []
      if (!symbol) {
        for (const [, k] of SharedData.dealsBySymbolsStatusId.entries()) {
          for (const [, deal] of k.entries()) {
            d.push(...Array.from(deal.values()))
          }
        }
      } else {
        for (const [, deal] of (
          SharedData.dealsBySymbolsStatusId.get(symbol) ??
          new Map<string, Map<string, Deal>>()
        ).entries()) {
          d.push(...Array.from(deal.values()))
        }
      }
      return d
    }
    if (symbol) {
      const getBySymbol = SharedData.dealsBySymbolsStatusId.get(symbol)
      if (!getBySymbol) {
        return []
      }
      const getByStatus = getBySymbol.get(status)
      if (!getByStatus) {
        return []
      }
      return Array.from(getByStatus.values())
    }
    const d: Deal[] = []
    for (const [, k] of SharedData.dealsBySymbolsStatusId.entries()) {
      for (const deal of (k.get(status) ?? new Map<string, Deal>()).values()) {
        d.push(deal)
      }
    }
    return d
  }

  /**
   * Gets the count of deals matching the specified criteria.
   *
   * **OPTIMIZED**: Uses O(1) DealCounters instead of O(n) iteration.
   *
   * @param status - Optional deal status filter ('open' | 'closed')
   * @param symbol - Optional trading pair symbol filter
   * @returns Number of deals matching the criteria
   *
   * @complexity O(1) - Optimized with DealCounters
   *
   * @example
   * ```typescript
   * // Get total open deals count
   * const openCount = DealManager.getDealsCount('open')
   *
   * // Get BTCUSDT deal count
   * const btcCount = DealManager.getDealsCount(undefined, 'BTCUSDT')
   * ```
   */
  static getDealsCount(status?: Deal['status'], symbol?: string): number {
    // OPTIMIZED: Use O(1) counters instead of O(n) size calculations
    return DealCounters.getCount(status, symbol)
  }

  // Deal state management methods
  static setDeal(deal: Deal, status: Deal['status'], symbol: string) {
    if (!symbol) {
      return
    }
    const getBySymbol = SharedData.dealsBySymbolsStatusId.get(symbol)
    if (!getBySymbol) {
      SharedData.dealsBySymbolsStatusId.set(
        symbol,
        new Map().set(status, new Map().set(deal.id, deal)),
      )
      // OPTIMIZED: Update O(1) counters
      if (status === 'open') {
        DealCounters.incrementOpen(symbol)
      } else if (status === 'closed') {
        DealCounters.incrementClosed(symbol)
      }
      return
    }
    const getDeals = getBySymbol.get(status)
    if (!getDeals) {
      getBySymbol.set(status, new Map().set(deal.id, deal))
      // OPTIMIZED: Update O(1) counters
      if (status === 'open') {
        DealCounters.incrementOpen(symbol)
      } else if (status === 'closed') {
        DealCounters.incrementClosed(symbol)
      }
      return
    }
    const alreadyExists = getDeals.has(deal.id)
    getDeals.set(deal.id, deal)

    // OPTIMIZED: Only increment counters for new deals
    if (!alreadyExists) {
      if (status === 'open') {
        DealCounters.incrementOpen(symbol)
      } else if (status === 'closed') {
        DealCounters.incrementClosed(symbol)
      }
    }
  }

  static removeDeal(id: string, status: Deal['status'], symbol: string) {
    const getBySymbol = SharedData.dealsBySymbolsStatusId.get(symbol)
    if (!getBySymbol) {
      return
    }
    const getDeals = getBySymbol.get(status)
    if (!getDeals) {
      return
    }
    const wasDeleted = getDeals.delete(id)

    // OPTIMIZED: Update O(1) counters only if deal was actually removed
    if (wasDeleted) {
      if (status === 'open') {
        DealCounters.decrementOpen(symbol)
      } else if (status === 'closed') {
        DealCounters.decrementClosed(symbol)
      }
    }
  }

  static processDealCloseFromMap(deal: Deal) {
    DealManager.removeDeal(deal.id, 'open', deal.symbol.pair)
    DealManager.setDeal(deal, 'closed', deal.symbol.pair)
    // Note: DealCounters will handle the open->closed transition automatically
  }

  // Deal validation methods
  static checkMaxDealsPerPair(symbol: string) {
    const { useMulti, maxDealsPerPair } = SharedData.settings
    if (useMulti && maxDealsPerPair && maxDealsPerPair !== '') {
      const max = +maxDealsPerPair
      if (!isNaN(max) && max >= 0) {
        const symbolDealsLength = DealManager.getDealsCount('open', symbol)
        if (symbolDealsLength < max) {
          return true
        }
        return false
      }
    }
    return true
  }

  static checkMaxDeals(symbol: string) {
    const { maxNumberOfOpenDeals } = SharedData.settings
    if (maxNumberOfOpenDeals && maxNumberOfOpenDeals !== '') {
      const max = +maxNumberOfOpenDeals
      if (!isNaN(max) && max >= 0) {
        const dealsLength = DealManager.getDealsCount('open')
        if (dealsLength < max) {
          if (DealManager.checkMaxDealsPerPair(symbol)) {
            return true
          }
        }
        return false
      }
    }
    return DealManager.checkMaxDealsPerPair(symbol)
  }

  // Deal volume and balance calculation
  static updateDealVolume(deal: Deal) {
    const usdRateQuote = SharedData.usdRateQuote.get(deal.symbol.pair) ?? 1
    const usdRate = SharedData.usdRate.get(deal.symbol.pair) ?? 1
    const _usageBase =
      SharedData.comboBasedOn === ComboTpBase.full
        ? deal.usage.max.base
        : deal.usage.current.base
    const _usageQuote =
      SharedData.comboBasedOn === ComboTpBase.full
        ? deal.usage.max.quote
        : deal.usage.current.quote
    const usageBase = SharedData.combo ? _usageBase : deal.usage.current.base
    const usageQuote = SharedData.combo ? _usageQuote : deal.usage.current.quote
    deal.volume = math.round(
      (SharedData.futures
        ? SharedData.coinm
          ? usageBase
          : usageQuote
        : SharedData.long
          ? usageQuote * (SharedData.profitBase ? 1 / deal.avgPrice : 1)
          : usageBase * (SharedData.profitBase ? 1 : deal.avgPrice)) *
        (SharedData.profitBase ? deal.avgPrice : 1) *
        (SharedData.profitBase ? usdRateQuote : usdRate),
      3,
    )
    return deal
  }

  static updateDealEquity(deal: Deal) {
    if (!deal.closedTime) {
      return deal
    }

    const separatePerSymbol =
      !SharedData.futures &&
      ((SharedData.long && SharedData.profitBase) ||
        (!SharedData.long && !SharedData.profitBase))
    const previousAsset = separatePerSymbol ? deal.symbol.pair : 'all'
    const previousValuesInAsset =
      SharedData.previousValuesInAsset.get(previousAsset)
    const previousValuesInAssetBase = previousValuesInAsset?.base || 0
    const previousValuesInAssetQuote = previousValuesInAsset?.quote || 0
    const newPreviousValue = deal.profit.totalUsd + SharedData.previousValues
    deal.equity = math.round(newPreviousValue + SharedData.initialBalanceUsd, 3)
    SharedData.previousValues = newPreviousValue
    const newPreviousValueBaseInAsset = SharedData.profitBase
      ? deal.profit.total + previousValuesInAssetBase
      : 0
    const newPreviousValueQuoteInAsset = SharedData.profitBase
      ? 0
      : deal.profit.total + previousValuesInAssetQuote
    const initialBalance = SharedData.initialBalance
    const startRate = SharedData.startRate
    const base = math.round(
      newPreviousValueBaseInAsset +
        (SharedData.long &&
        ((SharedData.futures && !SharedData.coinm) || !SharedData.futures)
          ? 0
          : initialBalance / (!SharedData.profitBase ? startRate : 1)),
      SharedData.precisionBase.get(deal.symbol.pair),
    )
    const quote = math.round(
      newPreviousValueQuoteInAsset +
        (SharedData.long &&
        ((SharedData.futures && !SharedData.coinm) || !SharedData.futures)
          ? initialBalance * (SharedData.profitBase ? startRate : 1)
          : 0),
      SharedData.precisionQuote.get(deal.symbol.pair),
    )
    SharedData.previousValuesInAsset.set(previousAsset, {
      base: newPreviousValueBaseInAsset,
      quote: newPreviousValueQuoteInAsset,
    })
    deal.equityInAsset = {
      base,
      quote,
    }
    return deal
  }

  static setLastDealPerSymbol(symbol: string, ignoreId?: string) {
    const deal = DealManager.getDeals('open', symbol)
      .filter((d) => (ignoreId ? d.id !== ignoreId : true))
      .sort((a, b) => b.startTime - a.startTime)[0]
    if (deal) {
      SharedData.lastPricesPerSymbol.set(symbol, {
        avg: deal.avgPrice,
        entry: deal.startPrice,
      })
    } else {
      SharedData.lastPricesPerSymbol.delete(symbol)
    }
  }

  // Deal Balance & Tracking methods (simple wrappers that delegate to existing complex methods)
  static updateDealBalances(d: Deal) {
    const filled = d.filledOrders.reduce(
      (acc, v) => {
        acc.base += v.qty * (v.side === BotOrderSideEnum.buy ? 1 : -1)
        acc.quote +=
          v.qty * v.price * (v.side === BotOrderSideEnum.buy ? -1 : 1)
        return acc
      },
      { base: 0, quote: 0 },
    )
    d.currentBalance.quote = d.initialBalance.quote + filled.quote
    d.currentBalance.base = d.initialBalance.base + filled.base
    return d
  }

  static updateDealBalancesByOrder(d: Deal, o: FullGrid) {
    d.currentBalance.quote +=
      (o.side === BotOrderSideEnum.buy ? -1 : 1) * o.qty * o.price
    d.currentBalance.base += (o.side === BotOrderSideEnum.buy ? 1 : -1) * o.qty
    return d
  }

  static getUsage(d: Deal) {
    const _b = SharedData.combo
      ? SharedData.profitBase
        ? d.profit.total
        : 0
      : 0
    const _q = SharedData.combo
      ? !SharedData.profitBase
        ? d.profit.total
        : 0
      : 0
    const base = SharedData.futures
      ? SharedData.coinm
        ? SharedData.long
          ? d.currentBalance.base
          : d.initialBalance.base - (d.currentBalance.base - _b)
        : 0
      : SharedData.long
        ? 0
        : d.initialBalance.base - (d.currentBalance.base - _b)

    const quote = SharedData.futures
      ? SharedData.coinm
        ? 0
        : !SharedData.long
          ? d.currentBalance.quote
          : d.initialBalance.quote - (d.currentBalance.quote - _q)
      : SharedData.long
        ? d.initialBalance.quote - (d.currentBalance.quote - _q)
        : 0

    const usage = {
      current: {
        base: SharedData.futures
          ? SharedData.coinm
            ? base
            : 0
          : SharedData.long
            ? 0
            : base,
        quote: SharedData.futures
          ? SharedData.coinm
            ? 0
            : quote
          : SharedData.long
            ? quote
            : 0,
      },
    }
    return usage
  }

  static updateDealUsage(d: Deal) {
    const usage = DealManager.getUsage(d)
    if (
      (!SharedData.long || SharedData.coinm) &&
      usage.current.base > SharedData.maxUsage.deal
    ) {
      SharedData.maxUsage.deal = usage.current.base
    }
    if (
      (SharedData.long || (SharedData.futures && !SharedData.coinm)) &&
      usage.current.quote > SharedData.maxUsage.deal
    ) {
      SharedData.maxUsage.deal = usage.current.quote
    }
    d.usage = { ...d.usage, ...usage }
    return d
  }
  static convertCooldown(interval?: number, units?: CooldownUnits) {
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
  // Deal Risk Management methods
  static checkCooldownStart(time: number, symbol: string) {
    if (
      SharedData.settings.cooldownAfterDealStart &&
      SharedData.settings.useCooldown
    ) {
      const cooldownAfterDealStartOption =
        SharedData.settings.cooldownAfterDealStartOption &&
        SharedData.settings.useMulti
          ? SharedData.settings.cooldownAfterDealStartOption
          : CooldownOptionsEnum.bot
      const lastTime =
        cooldownAfterDealStartOption === CooldownOptionsEnum.bot
          ? SharedData.lastOpenedDeal
          : (SharedData.lastOpenedDealPerSymbol.get(symbol) ?? 0)
      return (
        time - lastTime >=
        DealManager.convertCooldown(
          SharedData.settings.cooldownAfterDealStartInterval,
          SharedData.settings.cooldownAfterDealStartUnits,
        )
      )
    }
    return true
  }

  static checkCooldownStop(time: number, symbol: string) {
    if (
      SharedData.settings.cooldownAfterDealStop &&
      SharedData.settings.useCooldown
    ) {
      const cooldownAfterDealStartOption =
        SharedData.settings.cooldownAfterDealStopOption &&
        SharedData.settings.useMulti
          ? SharedData.settings.cooldownAfterDealStopOption
          : CooldownOptionsEnum.bot
      return (
        time -
          (cooldownAfterDealStartOption === CooldownOptionsEnum.bot
            ? SharedData.lastClosedDeal
            : (SharedData.lastClosedDealPerSymbol.get(symbol) ?? 0)) >=
        DealManager.convertCooldown(
          SharedData.settings.cooldownAfterDealStopInterval,
          SharedData.settings.cooldownAfterDealStopUnits,
        )
      )
    }
    return true
  }

  static checkCloseAfterX() {
    if (SharedData.edge) {
      return true
    }
    if (SharedData.settings.useBotController) {
      let close = false
      if (
        SharedData.settings.useCloseAfterXloss &&
        SharedData.settings.closeAfterXloss
      ) {
        const d = DealManager.getDeals('closed').filter(
          (_d) => _d.profit.totalUsd <= 0,
        ).length
        close = !(d < +SharedData.settings.closeAfterXloss)
      }
      if (
        SharedData.settings.useCloseAfterXwin &&
        SharedData.settings.closeAfterXwin &&
        !close
      ) {
        const d = DealManager.getDeals('closed').filter(
          (_d) => _d.profit.totalUsd > 0,
        ).length
        close = !(d < +SharedData.settings.closeAfterXwin)
      }
      if (
        SharedData.settings.useCloseAfterXprofit &&
        SharedData.settings.closeAfterXprofitCond &&
        SharedData.settings.closeAfterXprofitValue &&
        !close
      ) {
        const val = SharedData.totalProfitUsd
        close = !(SharedData.settings.closeAfterXprofitCond ===
        IndicatorStartConditionEnum.gt
          ? val < +SharedData.settings.closeAfterXprofitValue
          : val > +SharedData.settings.closeAfterXprofitValue)
      }
      if (
        SharedData.settings.useCloseAfterX &&
        SharedData.settings.closeAfterX &&
        !close
      ) {
        close = !(
          DealManager.getDealsCount('closed') < +SharedData.settings.closeAfterX
        )
      }
      if (
        SharedData.settings.useCloseAfterXopen &&
        SharedData.settings.closeAfterXopen &&
        !close
      ) {
        close = !(
          DealManager.getDealsCount() < +SharedData.settings.closeAfterXopen
        )
      }
      return !close
    }
    return true
  }

  static checkStartStopPrice(price: number, high: number, low: number) {
    if (
      SharedData.settings.botStart === BotStartTypeEnum.price &&
      SharedData.status === 'open'
    ) {
      if (
        SharedData.settings.stopBotPriceValue &&
        SharedData.settings.stopBotPriceCondition
      ) {
        SharedData.preventOpen =
          SharedData.settings.stopBotPriceCondition ===
          IndicatorStartConditionEnum.gt
            ? Math.max(price, high, low) >
              +SharedData.settings.stopBotPriceValue
            : Math.min(price, high, low) <
              +SharedData.settings.stopBotPriceValue
        if (SharedData.preventOpen) {
          SharedData.status =
            SharedData.settings.stopStatus === 'monitoring'
              ? 'monitoring'
              : 'closed'
        }
      }
    }
    if (
      SharedData.settings.botActualStart === BotStartTypeEnum.price &&
      SharedData.status === 'monitoring'
    ) {
      if (
        SharedData.settings.startBotPriceCondition &&
        SharedData.settings.startBotPriceValue
      ) {
        SharedData.preventOpen = !(SharedData.settings
          .startBotPriceCondition === IndicatorStartConditionEnum.gt
          ? Math.max(price, high, low) > +SharedData.settings.startBotPriceValue
          : Math.min(price, high, low) <
            +SharedData.settings.startBotPriceValue)
        if (!SharedData.preventOpen) {
          SharedData.status = 'open'
        }
      }
    }
  }

  static checkInDynamicRange(symbol: string, price: number): boolean {
    const { settings } = SharedData
    if (!settings.useDynamicPriceFilter) {
      return true
    }

    const overValue =
      parseFloat(settings.dynamicPriceFilterOverValue || '') ||
      parseFloat(settings.dynamicPriceFilterDeviation || '') ||
      0
    const underValue =
      parseFloat(settings.dynamicPriceFilterUnderValue || '') ||
      parseFloat(settings.dynamicPriceFilterDeviation || '') ||
      0
    if (
      isNaN(overValue) ||
      !isFinite(overValue) ||
      isNaN(underValue) ||
      !isFinite(underValue)
    ) {
      return true
    }
    if (DealManager.getDealsCount('open', symbol) === 0) {
      return true
    }
    const lastData = SharedData.lastPricesPerSymbol.get(symbol)
    if (!lastData) {
      return true
    }
    const latestPrice = price
    const referencePrice =
      settings.dynamicPriceFilterPriceType ===
      DynamicPriceFilterPriceTypeEnum.avg
        ? lastData.avg
        : lastData.entry
    const calculatedOverValue =
      referencePrice + (referencePrice * overValue) / 100
    const calculatedUnderValue =
      referencePrice - (referencePrice * underValue) / 100
    if (settings.useNoOverlapDeals) {
      const openDeals = DealManager.getDeals('open', symbol)
      if (openDeals.length > 0) {
        const ranges = openDeals.map((d) => ({
          start:
            (settings.dynamicPriceFilterPriceType ===
            DynamicPriceFilterPriceTypeEnum.avg
              ? d.avgPrice
              : d.startPrice) *
            (SharedData.long
              ? settings.dynamicPriceFilterDirection ===
                  DynamicPriceFilterDirectionEnum.over ||
                settings.dynamicPriceFilterDirection ===
                  DynamicPriceFilterDirectionEnum.overAndUnder
                ? 1 + overValue / 100
                : 1
              : settings.dynamicPriceFilterDirection ===
                    DynamicPriceFilterDirectionEnum.under ||
                  settings.dynamicPriceFilterDirection ===
                    DynamicPriceFilterDirectionEnum.overAndUnder
                ? 1 - underValue / 100
                : 1),
          end:
            (settings.dynamicPriceFilterPriceType ===
            DynamicPriceFilterPriceTypeEnum.avg
              ? d.avgPrice
              : d.startPrice) *
            (SharedData.long
              ? settings.dynamicPriceFilterDirection ===
                  DynamicPriceFilterDirectionEnum.under ||
                settings.dynamicPriceFilterDirection ===
                  DynamicPriceFilterDirectionEnum.overAndUnder
                ? 1 - underValue / 100
                : 1
              : settings.dynamicPriceFilterDirection ===
                    DynamicPriceFilterDirectionEnum.over ||
                  settings.dynamicPriceFilterDirection ===
                    DynamicPriceFilterDirectionEnum.overAndUnder
                ? 1 + overValue / 100
                : 1),
        }))
        const currentRange = {
          start: price,
          end: price,
        }
        const isCurrentDealRangeIsInRanges = ranges.some((r) => {
          const isInRange = SharedData.long
            ? (currentRange.start <= r.start && currentRange.start >= r.end) ||
              (currentRange.end <= r.start && currentRange.end >= r.end)
            : (currentRange.start >= r.start && currentRange.start <= r.end) ||
              (currentRange.end >= r.start && currentRange.end <= r.end)
          return isInRange
        })
        if (isCurrentDealRangeIsInRanges) {
          return false
        }
      }
    }
    if (
      settings.dynamicPriceFilterDirection ===
        DynamicPriceFilterDirectionEnum.overAndUnder ||
      !settings.dynamicPriceFilterDirection
    ) {
      return (
        latestPrice > calculatedOverValue || latestPrice < calculatedUnderValue
      )
    } else if (
      settings.dynamicPriceFilterDirection ===
      DynamicPriceFilterDirectionEnum.over
    ) {
      return latestPrice > calculatedOverValue
    } else if (
      settings.dynamicPriceFilterDirection ===
      DynamicPriceFilterDirectionEnum.under
    ) {
      return latestPrice < calculatedUnderValue
    }
    return false
  }

  static checkInRange(symbol: string, price: number, time: number) {
    const {
      maxOpenDeal,
      minOpenDeal,
      useMulti,
      useStaticPriceFilter,
      useDynamicPriceFilter,
    } = SharedData.settings
    if (useMulti && !useDynamicPriceFilter) {
      return true
    }
    const dynamic = DealManager.checkInDynamicRange(symbol, price)
    let staticResult = true
    if (useStaticPriceFilter) {
      if (maxOpenDeal || minOpenDeal) {
        if (maxOpenDeal && !minOpenDeal) {
          staticResult = price <= +maxOpenDeal
        }
        if (minOpenDeal && !maxOpenDeal) {
          staticResult = price >= +minOpenDeal
        }
        if (maxOpenDeal && minOpenDeal) {
          staticResult = price >= +minOpenDeal && price <= +maxOpenDeal
        }
      }
    }
    const result = dynamic && staticResult
    const last = SharedData.workingShift[SharedData.workingShift.length - 1]
    if (
      !staticResult &&
      SharedData.workingShift.length > 0 &&
      !SharedData.rangeStatus
    ) {
      if (!last.end) {
        last.end = time
        SharedData.workingShift = [
          ...SharedData.workingShift.filter((ws) => ws.start !== last.start),
          last,
        ]
      }
      SharedData.rangeStatus = true
    }
    if (staticResult && SharedData.rangeStatus) {
      SharedData.rangeStatus = false
      if (last.end) {
        SharedData.workingShift.push({ start: time })
      }
    }
    return result
  }

  static checkRiskRewardCondition(
    pair: string,
    price: number,
  ): { tp?: number; sl: number; size: number } | null {
    const {
      riskTpRatio,
      riskSlAmountValue,
      riskSlType,
      riskSlAmountPerc,
      riskMaxPositionSize,
      riskMinPositionSize,
      riskUseTpRatio,
      riskMaxSl,
      riskMinSl,
    } = SharedData.settings
    const indicator = SharedData.indicators.find(
      (i) =>
        i.symbol === pair &&
        i.settings.indicatorAction === IndicatorAction.riskReward,
    )
    if (indicator) {
      const [last] = [...indicator.data].sort((a, b) => b.time - a.time)
      if (last) {
        const { type, ppValue, srCrossingValue, bbCrossingValue, stCondition } =
          indicator.settings
        let value = NaN
        if (type === IndicatorEnum.pp) {
          const data = last.value as PriorPivotResult
          if (ppValue === ppValueEnum.anyH) {
            value = isNaN(data.hh) ? data.lh : data.hh
          }
          if (ppValue === ppValueEnum.hh) {
            value = data.all.hh
          }
          if (ppValue === ppValueEnum.lh) {
            value = data.all.lh
          }
          if (ppValue === ppValueEnum.anyL) {
            value = isNaN(data.ll) ? data.hl : data.ll
          }
          if (ppValue === ppValueEnum.hl) {
            value = data.all.hl
          }
          if (ppValue === ppValueEnum.ll) {
            value = data.all.ll
          }
          if (ppValue === ppValueEnum.anySWH) {
            value = isNaN(data.wh) ? data.sh : data.wh
          }
          if (ppValue === ppValueEnum.wh) {
            value = data.all.wh
          }
          if (ppValue === ppValueEnum.sh) {
            value = data.all.sh
          }
          if (ppValue === ppValueEnum.anySWL) {
            value = isNaN(data.wl) ? data.sl : data.wl
          }
          if (ppValue === ppValueEnum.wl) {
            value = data.all.wl
          }
          if (ppValue === ppValueEnum.sl) {
            value = data.all.sl
          }
        }
        if (type === IndicatorEnum.qfl) {
          const data = last.value as QFLResult
          value = data.base
        }
        if (type === IndicatorEnum.sr) {
          const data = last.value as PivotResult
          value =
            srCrossingValue === SRCrossingEnum.resistance ? data.high : data.low
        }
        if (type === IndicatorEnum.bb || type === IndicatorEnum.kc) {
          const data = last.value as {
            result: BandsResult
            price: number
          }
          value =
            bbCrossingValue === BBCrossingEnum.lower
              ? data.result.lower
              : bbCrossingValue === BBCrossingEnum.middle
                ? data.result.middle
                : data.result.upper
        }
        if (type === IndicatorEnum.ma) {
          const data = last.value as MAResult
          value = data.ma
        }
        if (type === IndicatorEnum.st) {
          const data = last.value as SuperTrendResult
          value =
            stCondition === STConditionEnum.down ? data.all.down : data.all.up
        }
        if (type === IndicatorEnum.psar) {
          const data = last.value as { psar: number; price: number }
          value = data.psar
        }
        if (type === IndicatorEnum.atr) {
          const atrMultiplier = +(indicator?.settings.riskAtrMult ?? '1')
          const data = last.value as number
          value = SharedData.long
            ? price - data * atrMultiplier
            : price + data * atrMultiplier
        }
        if (!isNaN(value)) {
          const symbol = SharedData.symbols.get(pair)
          const precisionPrice = symbol?.priceAssetPrecision
          const precisionQuote = SharedData.precisionQuote.get(pair) ?? 8
          const precisionBase = SharedData.precisionBase.get(pair) ?? 8
          let currentRiskSlPrice = math.round(value, precisionPrice)
          const minSl =
            typeof riskMinSl !== 'undefined' && `${riskMinSl}` !== 'null'
              ? Math.abs(+riskMinSl) / 100
              : riskSlType === RiskSlTypeEnum.perc && riskSlAmountPerc
                ? Math.abs(+riskSlAmountPerc) / 100
                : null
          const maxSl = riskMaxSl ? Math.abs(+riskMaxSl) / 100 : 1
          let currentSl = Math.abs((currentRiskSlPrice - price) / price)
          if (minSl && currentSl < minSl) {
            currentSl = minSl * -1
          } else if (maxSl && currentSl > maxSl) {
            currentSl = maxSl * -1
          } else {
            currentSl *= -1
          }
          const riskSlPerc = currentSl
          currentRiskSlPrice = math.round(
            price * (1 + riskSlPerc * (SharedData.long ? 1 : -1)),
            symbol?.priceAssetPrecision,
          )
          const rewardTpPerc = Math.abs(riskSlPerc) * +(riskTpRatio ?? '1')
          const rewardTpPrice = math.round(
            price * (1 + rewardTpPerc * (SharedData.long ? 1 : -1)),
            precisionPrice,
          )
          const riskPrecision = SharedData.futures
            ? SharedData.coinm
              ? precisionBase
              : precisionQuote
            : SharedData.long
              ? precisionQuote
              : precisionBase

          let riskBalance = symbol
            ? +(
                StrategyUtils.getBalances(symbol.pair)?.find(
                  (s) =>
                    s.asset ===
                    (SharedData.futures
                      ? SharedData.coinm
                        ? symbol.baseAsset.name
                        : symbol.quoteAsset.name
                      : SharedData.long
                        ? symbol.quoteAsset.name
                        : symbol.baseAsset.name),
                )?.free || '0'
              )
            : 0

          if ((riskBalance ?? 0) < 0) {
            return null
          }
          if (!riskBalance) {
            riskBalance =
              ((SharedData.futures
                ? SharedData.coinm
                  ? symbol?.baseAsset.minAmount
                  : symbol?.quoteAsset.minAmount
                : SharedData.long
                  ? symbol?.quoteAsset.minAmount
                  : symbol?.baseAsset.minAmount) ?? 0) * 10
          }
          const riskSize = math.round(
            riskSlType === RiskSlTypeEnum.fixed
              ? +(riskSlAmountValue ?? 0)
              : (riskBalance ?? 0) * (+(riskSlAmountPerc ?? '1') / 100),
            riskPrecision + 2,
          )
          const positionSize =
            riskSlPerc >= 0 || riskSize === 0
              ? 0
              : math.round(
                  riskSize / Math.abs(riskSlPerc) / SharedData.leverage,
                  riskPrecision,
                )
          if (positionSize <= 0) {
            return null
          }
          let min = +(riskMinPositionSize ?? '0')
          if (min === -1) {
            min = 0
          }
          let max = +(riskMaxPositionSize ?? '0')
          if (max === -1 || max === 0) {
            max = Infinity
          }
          if (positionSize < min || positionSize > max) {
            return null
          }
          if (positionSize > riskBalance) {
            SharedData.messages.push(SharedData.fundsWarning)
          }
          return {
            size: positionSize,
            sl: currentRiskSlPrice,
            tp: riskUseTpRatio ? rewardTpPrice : undefined,
          }
        }
      }
    }
    return null
  }

  static getDynamicLevels(pair: string): DynamicArPrices[] {
    if (!SharedData.scaleAr && !SharedData.tpAr && !SharedData.slAr) {
      return []
    }
    const indicators = SharedData.indicators.filter(
      (i) =>
        i.symbol === pair &&
        ((SharedData.scaleAr &&
          i.settings.indicatorAction === IndicatorAction.startDca) ||
          (SharedData.tpAr &&
            i.settings.indicatorAction === IndicatorAction.closeDeal &&
            i.settings.section !== IndicatorSection.sl) ||
          (SharedData.slAr &&
            i.settings.indicatorAction === IndicatorAction.closeDeal &&
            i.settings.section === IndicatorSection.sl)),
    )
    const result: DynamicArPrices[] = []
    for (const i of indicators) {
      if (!i.data || !i.data.length) {
        continue
      }
      const id = i.id.split('@')[0]
      if (!id) {
        continue
      }
      const [last] = [...i.data].sort((a, b) => b.time - a.time)

      result.push({ id, value: last.value as number })
    }
    if (indicators.length !== result.length) {
      return []
    }
    return result
  }

  static calculateCompoundReduce(initialOrders: DCAGrid[]): Sizes | null {
    const use =
      [OrderSizeTypeEnum.base, OrderSizeTypeEnum.quote].includes(
        SharedData.settings.orderSizeType,
      ) &&
      ((SharedData.settings.strategy === StrategyEnum.long &&
        SharedData.settings.profitCurrency === 'quote') ||
        (SharedData.settings.strategy === StrategyEnum.short &&
          SharedData.settings.profitCurrency === 'base') ||
        SharedData.settings.futures) &&
      (SharedData.settings.useRiskReduction || SharedData.settings.useReinvest)
    if (!use) {
      return null
    }

    const profit = SharedData.totalProfit

    if (
      (profit > 0 && !SharedData.settings.useReinvest) ||
      (profit < 0 && !SharedData.settings.useRiskReduction)
    ) {
      return null
    }

    let maxDeals = +(SharedData.settings.maxNumberOfOpenDeals ?? '0')
    if (!maxDeals || maxDeals <= 0) {
      if (SharedData.settings.useMulti) {
        const maxDealsPerPair = +(SharedData.settings.maxDealsPerPair ?? '0')
        if (!maxDealsPerPair || maxDealsPerPair <= 0) {
          maxDeals = 1
        } else {
          maxDeals = Math.max(
            1,
            maxDealsPerPair * SharedData.settings.pair.length,
          )
        }
      }
    }

    const toUse =
      (profit *
        (SharedData.settings.useReinvest
          ? +(SharedData.settings.reinvestValue ?? '50') / 100
          : +(SharedData.settings.riskReductionValue ?? '50') / 100)) /
      maxDeals

    const orders = initialOrders.filter(
      (o) =>
        o.type && [DCAOrderTypeEnum.bo, DCAOrderTypeEnum.dca].includes(o.type),
    )

    const baseOrder = orders.find((o) => o.type === DCAOrderTypeEnum.bo)

    if (!baseOrder) {
      return null
    }

    const totalOrders = orders.reduce((acc, v) => acc + v.qty, 0)

    const sizes: Sizes = {
      base:
        (baseOrder.qty / totalOrders) *
        (toUse *
          (SharedData.settings.profitCurrency === 'base'
            ? 1
            : 1 / baseOrder.price)),
      dca: orders
        .filter((o) => o.type === DCAOrderTypeEnum.dca)
        .map(
          (o) =>
            (o.qty / totalOrders) *
            (toUse *
              (SharedData.settings.profitCurrency === 'base'
                ? 1
                : 1 / o.price)),
        ),
    }

    return sizes
  }

  static getTP(
    deal: Deal,
    _price?: number,
    aggregate = false,
    sl = false,
    time?: number,
  ) {
    const {
      settings: { tpPerc, useMultiTp, multiTp, useMultiSl, multiSl },
    } = SharedData
    const symbol = SharedData.symbols.get(deal.symbol.pair)
    const botFunctions = SharedData.botFunctions.get(deal.symbol.pair)
    if (!symbol || !botFunctions) {
      return []
    }
    const { filledOrders, tpSlTargetFilled, avgPrice, slPerc } = deal
    const precision = botFunctions.utils.getBaseAssetPrecision(symbol)
    const filledRegular = filledOrders.filter(
      (o) =>
        o.type && [DCAOrderTypeEnum.dca, DCAOrderTypeEnum.bo].includes(o.type),
    )
    const filledTP = filledOrders.filter(
      (o) =>
        o.type && [DCAOrderTypeEnum.tp, DCAOrderTypeEnum.sl].includes(o.type),
    )
    const qty = SharedData.combo
      ? SharedData.long
        ? SharedData.profitBase
          ? (deal.initialBalance.quote - deal.currentBalance.quote) /
            (_price || deal.avgPrice)
          : deal.currentBalance.base
        : SharedData.profitBase
          ? deal.currentBalance.quote / (_price || deal.avgPrice)
          : deal.initialBalance.base - deal.currentBalance.base
      : filledRegular.reduce((acc, g) => acc + g.qty, 0) -
        filledTP.reduce((acc, g) => acc + g.qty, 0)
    const origQty = qty
    const quote = SharedData.combo
      ? deal.currentBalance.quote
      : filledRegular.reduce((acc, g) => acc + g.qty * g.price, 0) -
        filledTP.reduce((acc, g) => acc + g.qty * g.price, 0)
    const sellDisplacement = SharedData.userFee * 2
    const priceDisplacement = SharedData.long
      ? 1 + sellDisplacement
      : 1 - sellDisplacement
    const price = SharedData.combo
      ? deal.avgPrice * priceDisplacement
      : (sl && SharedData.baseSlOn === BaseSlOnEnum.start
          ? deal.startPrice
          : quote / qty) * priceDisplacement
    let tpPrice = math.round(
      _price ??
        price *
          (1 +
            (SharedData.long ? 1 : -1) *
              (sl ? +(slPerc || '0') : +tpPerc / 100)),
      symbol.priceAssetPrecision,
    )
    if (tpPrice === deal.avgPrice) {
      tpPrice = math.round(
        (tpPrice +
          (SharedData.long ? 1 : -1) *
            Number(`${1}e-${symbol.priceAssetPrecision}`)) *
          (SharedData.long ? 1 + sellDisplacement : 1 - sellDisplacement),
        symbol.priceAssetPrecision,
      )
    }
    const tpOrder: FullGrid = {
      qty,
      price: tpPrice,
      type: DCAOrderTypeEnum.tp,
      side: SharedData.long ? BotOrderSideEnum.sell : BotOrderSideEnum.buy,
      id: botFunctions.utils.id(20),
      filledTime: time,
    }
    if (SharedData.tpAr && !sl && !_price) {
      const indicator = SharedData.settings.indicators.find(
        (ind) =>
          ind.indicatorAction === IndicatorAction.closeDeal &&
          ind.section !== IndicatorSection.sl,
      )
      if (indicator) {
        let value = (deal.dynamicAr ?? []).find(
          (d) => d.id === indicator.uuid,
        )?.value
        if (value && !isNaN(value) && isFinite(value)) {
          value *= +(indicator.dynamicArFactor || '1')
          tpOrder.price = math.round(
            deal.avgPrice + value * (SharedData.long ? 1 : -1),
            symbol?.priceAssetPrecision ?? 8,
          )
        }
      }
    }
    if (SharedData.slAr && sl && !_price) {
      const indicator = SharedData.settings.indicators.find(
        (ind) =>
          ind.indicatorAction === IndicatorAction.closeDeal &&
          ind.section === IndicatorSection.sl,
      )
      if (indicator) {
        let value = (deal.dynamicAr ?? []).find(
          (d) => d.id === indicator.uuid,
        )?.value
        if (value && !isNaN(value) && isFinite(value)) {
          value *= +(indicator.dynamicArFactor || '1')
          tpOrder.price = math.round(
            deal.startPrice + value * (SharedData.long ? -1 : 1),
            symbol?.priceAssetPrecision ?? 8,
          )
        }
      }
    }
    if (qty < 0 && SharedData.combo) {
      return [{ ...tpOrder, qty: 0 }]
    }
    if (SharedData.profitBase) {
      const newQty = math.round(
        (origQty * deal.avgPrice) / tpOrder.price,
        precision,
        true,
      )
      tpOrder.qty = SharedData.coinm
        ? newQty
        : SharedData.long
          ? Math.min(tpOrder.qty, newQty)
          : sl
            ? Math.min(tpOrder.qty, newQty)
            : Math.max(tpOrder.qty, newQty)
    }
    if (
      tpOrder.price * tpOrder.qty < symbol.quoteAsset.minAmount &&
      SharedData.combo
    ) {
      return [{ ...tpOrder, qty: 0 }]
    }
    /* if (
      tpOrder.price * tpOrder.qty < symbol.quoteAsset.minAmount &&
      !SharedData.futures
    ) {
      tpOrder.qty = math.round(
        symbol.quoteAsset.minAmount / tpOrder.price,
        precision,
        false,
        true,
      )
    } */
    let tpOrders = [tpOrder]
    if (aggregate) {
      return tpOrders
    }
    if (!sl && useMultiTp) {
      let restQty = tpOrder.qty
      let end = false
      tpOrders = []
      const usedTp = (multiTp ?? [])
        .filter((mtp) => (tpSlTargetFilled ?? []).includes(mtp.uuid))
        .reduce((acc, tp) => acc + +tp.amount, 0)

      ;(multiTp ?? [])
        .sort((a, b) => +a.target - +b.target)
        .map((tp) => {
          if (end || tpSlTargetFilled?.includes(tp.uuid)) {
            return null
          }
          let priceTp = math.round(
            avgPrice *
              (1 + (SharedData.long ? 1 : -1) * (+tp.target / 100)) *
              priceDisplacement,
            symbol.priceAssetPrecision,
          )
          if (priceTp === avgPrice) {
            priceTp = math.round(
              avgPrice +
                (SharedData.long ? 1 : -1) *
                  Number(`${1}e-${symbol.priceAssetPrecision}`),
              symbol.priceAssetPrecision,
            )
          }
          let qtyTp = math.round(
            tpOrder.qty * (+tp.amount / (100 - usedTp)),
            precision,
          )
          if (qtyTp > restQty) {
            qtyTp = restQty
          }
          /* if (qtyTp < symbol.baseAsset.minAmount) {
            qtyTp = symbol.baseAsset.minAmount
          }
          if (priceTp * qtyTp < symbol.quoteAsset.minAmount) {
            qtyTp = symbol.quoteAsset.minAmount / priceTp
          } */
          const modQty = math.remainder(
            math.round(qtyTp, 12),
            symbol.baseAsset.step,
          )
          if (modQty !== 0) {
            qtyTp = math.round(
              qtyTp - modQty + symbol.baseAsset.step,
              precision,
              true,
            )
          }
          restQty -= qtyTp
          if (
            restQty < symbol.baseAsset.minAmount ||
            restQty * priceTp < symbol.quoteAsset.minAmount ||
            restQty < 0
          ) {
            end = true
            qtyTp =
              restQty > 0 && restQty > symbol.baseAsset.step
                ? math.round(qtyTp + restQty, precision)
                : qtyTp
          }
          return {
            ...tpOrder,
            qty: qtyTp,
            price: priceTp,
            id: botFunctions.utils.id(20),
            tpSlTarget: tp.uuid,
          }
        })
        .forEach((o) => {
          if (o) {
            tpOrders.push(o)
          }
        })
    }
    if (
      sl &&
      useMultiSl &&
      SharedData.settings.dealCloseConditionSL === CloseConditionEnum.tp
    ) {
      let restQty = tpOrder.qty
      let end = false
      tpOrders = []
      const usedSL = (multiSl ?? [])
        .filter((msl) => (tpSlTargetFilled ?? []).includes(msl.uuid))
        .reduce((acc, _sl) => acc + +_sl.amount, 0)
      ;(multiSl ?? [])
        .sort((a, b) => +b.target - +a.target)
        .map((tp) => {
          if (end || deal?.tpSlTargetFilled?.includes(tp.uuid)) {
            return null
          }
          let priceSl = math.round(
            avgPrice *
              (1 + (SharedData.long ? 1 : -1) * (+tp.target / 100)) *
              priceDisplacement,
            symbol.priceAssetPrecision,
          )
          if (priceSl === avgPrice) {
            priceSl = math.round(
              avgPrice +
                (SharedData.long ? 1 : -1) *
                  Number(`${1}e-${symbol.priceAssetPrecision}`),
              symbol.priceAssetPrecision,
            )
          }
          let qtySl = math.round(
            tpOrder.qty * (+tp.amount / (100 - usedSL)),
            precision,
          )
          if (qtySl > restQty) {
            qtySl = restQty
          }
          if (qtySl < symbol.baseAsset.minAmount) {
            qtySl = symbol.baseAsset.minAmount
          }
          if (priceSl * qtySl < symbol.quoteAsset.minAmount) {
            qtySl = symbol.quoteAsset.minAmount / priceSl
          }
          const modQty = math.remainder(
            math.round(qtySl, 12),
            symbol.baseAsset.step,
          )
          if (modQty !== 0) {
            qtySl = math.round(
              qtySl - modQty + symbol.baseAsset.step,
              precision,
              true,
            )
          }
          restQty -= qtySl
          if (
            restQty < symbol.baseAsset.minAmount ||
            restQty * priceSl < symbol.quoteAsset.minAmount ||
            restQty < 0
          ) {
            end = true
            qtySl =
              restQty > 0 && restQty > symbol.baseAsset.step
                ? math.round(qtySl + restQty, precision)
                : qtySl
          }

          return {
            ...tpOrder,
            qty: qtySl,
            price: priceSl,
            id: botFunctions.utils.id(20),
            tpSlTarget: tp.uuid,
            type: DCAOrderTypeEnum.sl,
          }
        })
        .forEach((o) => {
          if (o) {
            tpOrders.push(o)
          }
        })
    }
    return tpOrders
  }

  static getSlHistoryLine(
    deal: Deal,
    startTime?: number,
  ): Deal['ordersHistory'] {
    const botFunctions = SharedData.botFunctions.get(deal.symbol.pair)
    if (!botFunctions) {
      return []
    }
    if (
      SharedData.settings.useSl &&
      SharedData.settings.dealCloseConditionSL === CloseConditionEnum.tp
    ) {
      if (
        !botFunctions.isTrailingSl &&
        !SharedData.settings.useMultiSl &&
        typeof deal.slPerc !== 'undefined'
      ) {
        const price =
          (SharedData.baseSlOn === BaseSlOnEnum.avg
            ? deal.avgPrice
            : deal.startPrice) *
          (1 -
            (deal.slPerc * -1 - SharedData.userFee * 2) *
              (SharedData.long ? 1 : -1))
        return [
          {
            qty: 0,
            price,
            side: SharedData.long
              ? BotOrderSideEnum.sell
              : BotOrderSideEnum.buy,
            id: botFunctions.utils.id(10),
            startTime: startTime ?? deal.startTime,
            slLine: true,
            dealId: deal.id,
          },
        ]
      }
      if (
        (botFunctions.isTrailingSl || botFunctions.isTrailingTp) &&
        !SharedData.settings.useMultiSl &&
        typeof deal.slPerc !== 'undefined'
      ) {
        const price = deal.trailingLevel
          ? deal.trailingLevel
          : deal.avgPrice *
            (1 -
              deal.slPerc * -1 * (SharedData.long ? 1 : -1) -
              SharedData.userFee * 2)
        return [
          {
            qty: 0,
            price,
            side: SharedData.long
              ? BotOrderSideEnum.sell
              : BotOrderSideEnum.buy,
            id: botFunctions.utils.id(10),
            startTime: startTime ?? deal.startTime,
            slLine: true,
            dealId: deal.id,
          },
        ]
      }
      if (SharedData.settings.useMultiSl) {
        return DealManager.getTP(deal, undefined, undefined, true).map((o) => ({
          qty: 0,
          price: o.price,
          side: o.side,
          id: botFunctions.utils.id(10),
          startTime: startTime ?? deal.startTime,
          slLine: true,
          dealId: deal.id,
        }))
      }
    }
    return []
  }

  static replaceSlHistoryLine(d: Deal, slLines: FullGrid[], time: number) {
    const localSlLines = d.ordersHistory
      .filter(
        (o) =>
          o.slLine &&
          !o.filledTime &&
          !slLines.find((sl) => sl.price === o.price),
      )
      .map((l) => {
        l.filledTime = time
        return l
      })
    d.ordersHistory = [
      ...d.ordersHistory.filter(
        (o) => !localSlLines.map((l) => l.id).includes(o.id),
      ),
      ...slLines,
      ...localSlLines,
    ].map((o) => ({ ...o, dealId: d.id }))
    return d
  }

  static checkTrailing(d: Deal, price: number, time: number) {
    const botFunctions = SharedData.botFunctions.get(d.symbol.pair)
    if (!botFunctions) {
      return d
    }
    if (!(botFunctions.isTrailingSl || botFunctions.isTrailingTp)) {
      return d
    }
    const { trailingSl, trailingTp, trailingTpPerc, tpPerc, slPerc } =
      SharedData.settings
    const sellDisplacement = SharedData.userFee * 2
    if (!d.bestPrice && d.bestPriceSet) {
      d.bestPrice = Math.max(price, d.startPrice)
      d.bestPriceSet = true
    } else if (
      (SharedData.long && price > (d.bestPrice ?? 0)) ||
      (!SharedData.long && price < (d.bestPrice ?? Infinity))
    ) {
      d.bestPrice = price
    }
    if (!d.trailingMode && trailingSl) {
      d.trailingMode = TrailingModeEnum.tsl
    }
    if (d.trailingMode !== TrailingModeEnum.ttp && trailingTp) {
      const unPnL =
        (SharedData.long
          ? d.currentBalance.base * price +
            d.currentBalance.quote -
            d.initialBalance.quote
          : d.currentBalance.quote -
            (d.initialBalance.base - d.currentBalance.base) * price) /
        (SharedData.long ? d.usage.current.quote : d.usage.current.base * price)
      if (trailingTpPerc && unPnL > +tpPerc / 100 + sellDisplacement) {
        d.trailingMode = TrailingModeEnum.ttp
      }
    }
    if (!d.trailingMode) {
      d.bestPrice = 0
    }
    const sl =
      (+slPerc / 100 + SharedData.userFee * 2) * (SharedData.long ? 1 : -1)
    const tp =
      (+(trailingTpPerc ?? '0') / 100 + SharedData.userFee * 2) *
      (SharedData.long ? 1 : -1)
    const newTrailingLevel = d.bestPrice
      ? d.trailingMode === TrailingModeEnum.tsl && slPerc
        ? d.bestPrice * (1 + sl)
        : d.trailingMode === TrailingModeEnum.ttp && trailingTpPerc
          ? d.bestPrice * (1 - tp)
          : 0
      : 0
    if (newTrailingLevel !== d.trailingLevel && !SharedData.combo) {
      d.trailingLevel = newTrailingLevel
      const newSl = DealManager.getSlHistoryLine(d, time)
      d = DealManager.replaceSlHistoryLine(d, newSl, time)
    }

    return d
  }

  // Deal lifecycle methods
  static openDeal(
    price: number,
    startTime: number,
    high: number,
    low: number,
    s: string,
    onlyReturn = false,
    cbIfNotOpened?: () => void,
  ) {
    if (!onlyReturn) {
      DealManager.checkStartStopPrice(price, high, low)
    }
    if (!onlyReturn && SharedData.preventOpen) {
      return cbIfNotOpened && cbIfNotOpened()
    }
    if (!DealManager.checkCloseAfterX()) {
      return cbIfNotOpened && cbIfNotOpened()
    }
    if (!DealManager.checkCooldownStart(startTime, s)) {
      return cbIfNotOpened && cbIfNotOpened()
    }
    if (!DealManager.checkCooldownStop(startTime, s)) {
      return cbIfNotOpened && cbIfNotOpened()
    }
    if (!DealManager.checkInRange(s, price, startTime)) {
      return cbIfNotOpened && cbIfNotOpened()
    }
    if (!DealManager.checkMaxDeals(s)) {
      return cbIfNotOpened && cbIfNotOpened()
    }
    let fixSl = 0
    let fixTp = 0
    let fixSize = 0
    if (SharedData.settings.useRiskReward) {
      const riskReward = DealManager.checkRiskRewardCondition(s, price)
      if (!riskReward) {
        return cbIfNotOpened && cbIfNotOpened()
      }
      fixSl = riskReward.sl
      fixTp = riskReward.tp ?? 0
      fixSize = riskReward.size
    }
    let dynamicAr: DynamicArPrices[] = []
    if (SharedData.scaleAr || SharedData.tpAr || SharedData.slAr) {
      const dynamic = DealManager.getDynamicLevels(s)
      if (!dynamic.length) {
        return cbIfNotOpened && cbIfNotOpened()
      }
      dynamicAr = dynamic
    }
    const symbol = SharedData.symbols.get(s)
    const botFunctions = SharedData.botFunctions.get(s)
    if (!symbol || !botFunctions) {
      return cbIfNotOpened && cbIfNotOpened()
    }
    if (!onlyReturn) {
      SharedData.lastOpenedDeal = startTime
      SharedData.lastOpenedDealPerSymbol.set(s, startTime)
    }
    let orderPrice = SharedData.slippage
      ? price * (1 + ((SharedData.long ? 1 : -1) * SharedData.slippage) / 100)
      : price
    orderPrice = math.round(
      orderPrice > high ? high : orderPrice < low ? low : orderPrice,
      symbol.priceAssetPrecision,
    )
    let initialOrders = botFunctions
      .createOrders(
        SharedData.usdRateQuote.get(s) ?? 0,
        orderPrice,
        true,
        undefined,
        undefined,
        StrategyUtils.getBalances(s),
        true,
        [],
        true,
        fixSl,
        fixTp,
        fixSize,
        dynamicAr,
      )
      .filter(
        (o) =>
          (!SharedData.settings.useRiskReward && !SharedData.slAr
            ? o.type !== DCAOrderTypeEnum.sl
            : true) && o.type !== DCAOrderTypeEnum.grid,
      )
    const sizes = DealManager.calculateCompoundReduce(initialOrders)
    if (sizes) {
      initialOrders = botFunctions
        .createOrders(
          SharedData.usdRateQuote.get(s) ?? 0,
          orderPrice,
          true,
          undefined,
          undefined,
          StrategyUtils.getBalances(s),
          true,
          [],
          true,
          fixSl,
          fixTp,
          fixSize,
          dynamicAr,
          sizes,
        )
        .filter(
          (o) =>
            (!SharedData.settings.useRiskReward && !SharedData.slAr
              ? o.type !== DCAOrderTypeEnum.sl
              : true) && o.type !== DCAOrderTypeEnum.grid,
        )
    }
    const allInitialOrder = [...initialOrders]
    initialOrders = initialOrders.filter((o) =>
      SharedData.settings.dcaCondition === DCAConditionEnum.indicators
        ? o.type !== DCAOrderTypeEnum.dca
        : true,
    )
    const hiddenDCA = [...initialOrders.filter((o) => o.grey)]
    initialOrders = [...initialOrders.filter((o) => !o.grey)]
    const id = botFunctions.utils.id(20)
    const filledOrders = initialOrders
      .filter((o) => o.type === DCAOrderTypeEnum.bo)
      .map((fo) => ({
        ...fo,
        startTime,
        filledTime: startTime,
        dealId: id,
      }))
    const baseOrder = filledOrders[0]
    if (!baseOrder) {
      return
    }
    if (!onlyReturn) {
      StrategyUtils.updatePositionWithOrder(baseOrder, s)
    }
    initialOrders =
      SharedData.settings.useRiskReward && SharedData.settings.riskUseTpRatio
        ? initialOrders
        : [...initialOrders.filter((o) => o.type !== DCAOrderTypeEnum.tp)]

    const step = baseOrder.price * (+SharedData.settings.step / 100)
    let deal: Deal = {
      finishedOrdersHistory: [],
      lastIndex: 0,
      symbol,
      transactions: [],
      transactionsCount: {
        buy: 0,
        sell: 0,
      },
      step,
      minigrids: [],
      id,
      initialOrders,
      filledOrders,
      hiddenOrders: [],
      activeOrders: [],
      ordersHistory: [],
      status: 'open',
      startTime,
      lastTime: startTime,
      profit: {
        total: 0,
        totalUsd: 0,
        perc: 0,
      },
      levels: {
        all: 1,
        complete: 1,
        max: 1,
      },
      duration: 0,
      splitDuration: {
        d: '',
        h: '',
        min: '',
        s: '',
      },
      usage: {
        current: {
          base: 0,
          quote: 0,
        },
        max: {
          base: 0,
          quote: 0,
        },
      },
      initialBalance: {
        base: 0,
        quote: 0,
      },
      currentBalance: {
        base: 0,
        quote: 0,
      },
      slPerc: +(SharedData.settings.slPerc || '0') / 100,
      avgPrice: orderPrice,
      startPrice: orderPrice,
      lastFilled: 0,
      lastPrice: orderPrice,
      volume: 0,
      equity: 0,
      equityInAsset: {
        base: 0,
        quote: 0,
      },
      portfolio: {
        base: 0,
        quote: 0,
      },
      dynamicAr,
      sizes: sizes ?? undefined,
    }

    if (
      SharedData.settings.useTp &&
      !botFunctions.isTrailingTp &&
      (SharedData.settings.dealCloseCondition === CloseConditionEnum.tp ||
        SharedData.tpAr) &&
      !SharedData.combo
    ) {
      const tp = DealManager.getTP(deal)
      initialOrders = [...initialOrders, ...tp]
    }

    const activeOrders: FullGrid[] = initialOrders
      .filter((o) => !filledOrders.map((fo) => fo.id).includes(o.id))
      .map((o) => ({ ...o, startTime }))

    if (SharedData.combo) {
      const minigrid = DealManager.createMinigrid(deal, baseOrder, false, s)
      if (minigrid) {
        deal.minigrids.push(minigrid)
        for (const o of minigrid.activeOrders) {
          activeOrders.push({ ...o, startTime })
        }
        for (const h of hiddenDCA) {
          const m = DealManager.createMinigrid(
            deal,
            h,
            true,
            s,
            baseOrder.price,
          )
          if (m) {
            deal.minigrids.push(m)
            for (const o of m.activeOrders) {
              activeOrders.push({ ...o, startTime })
              initialOrders.push(o)
              allInitialOrder.push(o)
            }
            deal.hiddenOrders.push({
              ...h,
              startTime,
              filledTime: startTime,
              dealId: id,
            })
          }
        }
      }
    }
    const initialBase = SharedData.long
      ? 0
      : allInitialOrder
          .filter(
            (o) =>
              o.type !== DCAOrderTypeEnum.tp && o.type !== DCAOrderTypeEnum.sl,
          )
          .reduce((acc, o) => acc + o.qty, 0)
    const initialQuote = SharedData.long
      ? allInitialOrder
          .filter(
            (o) =>
              o.type !== DCAOrderTypeEnum.tp && o.type !== DCAOrderTypeEnum.sl,
          )
          .reduce((acc, o) => acc + o.qty * o.price, 0)
      : 0
    const currentBase = filledOrders.reduce((acc, o) => acc + o.qty, 0)
    const currentQuote = filledOrders.reduce(
      (acc, o) => acc + o.qty * o.price,
      0,
    )
    const baseUsage =
      filledOrders.reduce((acc, fo) => (acc += fo.qty), 0) +
      hiddenDCA.reduce((acc, fo) => (acc += fo.qty), 0)
    const quoteUsage =
      filledOrders.reduce((acc, fo) => (acc += fo.qty * fo.price), 0) +
      hiddenDCA.reduce((acc, fo) => (acc += fo.qty * fo.price), 0)
    const maxBase = allInitialOrder
      .filter((io) => io.type !== DCAOrderTypeEnum.tp)
      .reduce((acc, io) => (acc += io.qty), 0)
    const maxQuote = allInitialOrder
      .filter((io) => io.type !== DCAOrderTypeEnum.tp)
      .reduce((acc, io) => (acc += io.qty * io.price), 0)
    deal = {
      ...deal,
      activeOrders,
      ordersHistory: [...activeOrders].map((o) => ({ ...o, dealId: id })),
      initialBalance: {
        base: initialBase,
        quote: initialQuote,
      },
      currentBalance: {
        base: !SharedData.long ? initialBase - currentBase : currentBase,
        quote: SharedData.long ? initialQuote - currentQuote : currentQuote,
      },
      levels: {
        all: SharedData.settings.useDca
          ? SharedData.settings.dcaCondition === DCAConditionEnum.indicators
            ? SharedData.settings.indicators.filter(
                (si) => si.indicatorAction === IndicatorAction.startDca,
              ).length + 1
            : SharedData.settings.dcaCondition === DCAConditionEnum.custom
              ? (SharedData.settings.dcaCustom ?? []).length + 1
              : initialOrders.filter((o) => o.type === DCAOrderTypeEnum.dca)
                  .length +
                1 +
                hiddenDCA.length
          : 1,
        complete: hiddenDCA.length + 1,
        max: hiddenDCA.length + 1,
      },
      lastFilled: SharedData.combo ? 1 : 0,
      usage: {
        current: {
          base: SharedData.futures
            ? SharedData.coinm
              ? baseUsage
              : 0
            : SharedData.long
              ? 0
              : baseUsage,
          quote: SharedData.futures
            ? SharedData.coinm
              ? 0
              : quoteUsage
            : SharedData.long
              ? quoteUsage
              : 0,
        },
        max: {
          base: SharedData.futures
            ? SharedData.coinm
              ? maxBase
              : 0
            : SharedData.long
              ? 0
              : maxBase,
          quote: SharedData.futures
            ? SharedData.coinm
              ? 0
              : maxQuote
            : SharedData.long
              ? maxQuote
              : 0,
        },
      },
    }
    deal = DealManager.updateDealVolume(deal)

    if (botFunctions.isTrailingSl || botFunctions.isTrailingTp) {
      deal = DealManager.checkTrailing(deal, price, startTime)
    } else {
      if (!SharedData.combo) {
        for (const slLine of DealManager.getSlHistoryLine(deal)) {
          deal.ordersHistory.push(slLine)
        }
      }
    }
    if (
      SharedData.profitBase &&
      deal.usage.current.base > SharedData.maxUsage.deal
    ) {
      SharedData.maxUsage.deal = deal.usage.current.base
    }
    if (
      !SharedData.profitBase &&
      deal.usage.current.quote > SharedData.maxUsage.deal
    ) {
      SharedData.maxUsage.deal = deal.usage.current.quote
    }

    if (!onlyReturn) {
      DealManager.setDeal(deal, 'open', s)
      DealManager.setLastDealPerSymbol(s)
    }
    const key = SharedData.futures
      ? SharedData.coinm
        ? deal.symbol.baseAsset.name
        : deal.symbol.quoteAsset.name
      : SharedData.long
        ? deal.symbol.quoteAsset.name
        : deal.symbol.baseAsset.name
    if (!SharedData.balance.has(key)) {
      const usdRateQuote = SharedData.usdRateQuote.get(s) ?? 1
      const usdRate = SharedData.usdRate.get(s) ?? 1

      let balanceForProfit =
        (SharedData.futures
          ? SharedData.coinm
            ? deal.usage.max.base
            : deal.usage.max.quote
          : SharedData.long
            ? deal.usage.max.quote *
              (SharedData.profitBase ? 1 / deal.startPrice : 1)
            : deal.usage.max.base *
              (SharedData.profitBase ? 1 : deal.startPrice)) /
        SharedData.leverage
      let balance =
        (SharedData.futures
          ? SharedData.coinm
            ? deal.usage.max.base
            : deal.usage.max.quote
          : SharedData.long
            ? deal.usage.max.quote
            : deal.usage.max.base) / SharedData.leverage
      const { maxNumberOfOpenDeals, maxDealsPerPair, useMulti } =
        SharedData.settings
      if (
        maxNumberOfOpenDeals &&
        maxNumberOfOpenDeals !== '' &&
        !isNaN(+maxNumberOfOpenDeals) &&
        +maxNumberOfOpenDeals >= 0 &&
        (SharedData.multi || (!SharedData.multi && !useMulti))
      ) {
        balance *= +maxNumberOfOpenDeals
        balanceForProfit *= +maxNumberOfOpenDeals
      }
      if (
        maxDealsPerPair &&
        maxDealsPerPair !== '' &&
        !isNaN(+maxDealsPerPair) &&
        +maxDealsPerPair >= 0 &&
        !SharedData.multi &&
        useMulti
      ) {
        balance *= +maxDealsPerPair
        balanceForProfit *= +maxDealsPerPair
      }

      SharedData.balance.set(key, balance)
      if (SharedData.balanceUsd === 0) {
        SharedData.balanceUsd =
          balanceForProfit *
          (SharedData.profitBase ? deal.startPrice : 1) *
          (SharedData.profitBase ? usdRateQuote : usdRate)
        SharedData.initialBalance = balanceForProfit
        SharedData.balanceForProfit = balanceForProfit
        SharedData.initialBalanceUsd = SharedData.balanceUsd
      }
      if (SharedData.startRate === 0) {
        SharedData.startRate = deal.startPrice
      }
    }
  }

  static getProfit(d: Deal, time: number) {
    const { filledOrders } = d
    const { userFee } = SharedData
    const usdRate =
      PriceCalculator.getUsdRate(
        d.symbol.pair,
        d.lastPrice,
        SharedData.profitBase ? 'base' : 'quote',
      ) ?? 1
    const precision = SharedData.precision.get(d.symbol.pair) ?? 8
    const commission = filledOrders
      .filter((o) => (SharedData.combo ? o.type === DCAOrderTypeEnum.tp : true))
      .reduce(
        (acc, v) =>
          (acc += SharedData.profitBase
            ? v.qty * userFee
            : v.qty * v.price * userFee),
        0,
      )
    const regularOrders = filledOrders.filter(
      (fo) =>
        fo.type &&
        [DCAOrderTypeEnum.dca, DCAOrderTypeEnum.bo].includes(fo.type),
    )

    const quote = SharedData.combo
      ? SharedData.long
        ? d.initialBalance.quote - d.currentBalance.quote
        : d.currentBalance.quote
      : regularOrders.reduce((acc, ro) => (acc += ro.qty * ro.price), 0)
    const base = SharedData.combo
      ? Math.max(
          SharedData.long
            ? d.currentBalance.base
            : d.initialBalance.base - d.currentBalance.base,
          0,
        )
      : regularOrders.reduce((acc, ro) => (acc += ro.qty), 0)
    const tpOrder = filledOrders.filter(
      (fo) =>
        fo.type && [DCAOrderTypeEnum.tp, DCAOrderTypeEnum.sl].includes(fo.type),
    )
    const qty = tpOrder.reduce((acc, tpo) => acc + tpo.qty, 0)
    const quoteTp = tpOrder.reduce((acc, tpo) => acc + tpo.qty * tpo.price, 0)
    let price = quoteTp / qty
    price = isNaN(price) ? tpOrder[0]?.price : price
    const pureProfit =
      (SharedData.profitBase
        ? base - qty + (quoteTp - quote) / price
        : quoteTp - quote + (qty - base) * price) *
        (SharedData.long ? 1 : -1) -
      (d.liquidationPrice ? 0 : commission)
    if (pureProfit !== 0 && SharedData.combo) {
      SharedData.profits.push({
        total: pureProfit,
        totalUsd: pureProfit * usdRate,
        time,
      })
    }
    const total = pureProfit

    const totalUsd = total * usdRate
    const usageBase =
      SharedData.comboBasedOn === ComboTpBase.full
        ? d.usage.max.base
        : d.usage.current.base
    const usageQuote =
      SharedData.comboBasedOn === ComboTpBase.full
        ? d.usage.max.quote
        : d.usage.current.quote
    const denominator = SharedData.combo
      ? SharedData.futures
        ? SharedData.coinm
          ? usageBase
          : usageQuote
        : SharedData.long
          ? usageQuote * (SharedData.profitBase ? 1 / d.lastPrice : 1)
          : usageBase * (SharedData.profitBase ? 1 : d.lastPrice)
      : SharedData.profitBase
        ? base
        : quote
    const perc = math.round(
      (total / denominator) * 100 * SharedData.leverage,
      2,
      false,
      true,
    )
    return {
      total: math.round(total, precision, false, true),
      totalUsd: math.round(totalUsd, 2),
      perc,
    }
  }

  static closeDeal(
    d: Deal,
    b: FullBar,
    tpOrder?: FullGrid,
    liquidationPrice?: number,
  ): { deal: Deal; closePrice: number } {
    let closePrice = b.close
    let profit: ReturnType<typeof DealManager.getProfit> | undefined
    d.status = 'closed'
    d.closedTime = tpOrder?.filledTime ?? b.time
    d.ordersHistory = d.ordersHistory.map((o) =>
      o.filledTime ? { ...o } : { ...o, filledTime: b.time },
    )
    d.duration = d.closedTime - d.startTime
    d.splitDuration = friendlyTime(d.duration)
    d.minigrids = d.minigrids.map((m) => DealManager.closeMinigrid(m))
    d.liquidationPrice = liquidationPrice
    d.lastIndex = SharedData.lastIndex
    SharedData.lastIndex++
    if (tpOrder && tpOrder.qty > 0) {
      const { price } = tpOrder
      closePrice = price
      d.closePrice = price
      d.lastPrice = price
      d.lastTime = tpOrder.filledTime ?? b.time
      d.filledOrders = [
        ...d.filledOrders.filter((fo) => fo.id !== tpOrder.id),
        { ...tpOrder, filledTime: b.time },
      ].map((o) => ({ ...o, dealId: d.id }))
      const _profit = DealManager.getProfit(d, b.time)
      if (_profit) {
        d.profit = _profit
        profit = d.profit
      }
    } else {
      const usageBase =
        SharedData.comboBasedOn === ComboTpBase.full
          ? d.usage.max.base
          : d.usage.current.base
      const usageQuote =
        SharedData.comboBasedOn === ComboTpBase.full
          ? d.usage.max.quote
          : d.usage.current.quote
      const denominator =
        (SharedData.futures
          ? SharedData.coinm
            ? usageBase
            : usageQuote
          : SharedData.long
            ? usageQuote * (SharedData.profitBase ? 1 / d.lastPrice : 1)
            : usageBase * (SharedData.profitBase ? 1 : d.lastPrice)) /
        SharedData.leverage
      d.profit.perc = math.round((d.profit.total / denominator) * 100, 2)
      const precision = SharedData.precision.get(d.symbol.pair) ?? 8
      d.profit.total = math.round(d.profit.total, precision + 3)
      d.profit.totalUsd = math.round(d.profit.totalUsd, 2)
      profit = d.profit
    }
    d = DealManager.updateDealEquity(d)
    const key = SharedData.profitBase
      ? d.symbol.baseAsset.name
      : d.symbol.quoteAsset.name
    let balance = SharedData.balanceForProfit
    const initialBalance = SharedData.initialBalance
    if (profit) {
      SharedData.balance.set(
        key,
        (SharedData.balance.get(key) ?? 0) + profit.total,
      )
      SharedData.balanceForProfit += profit.total
      balance = SharedData.balanceForProfit
      SharedData.balanceUsd += profit.totalUsd
      if (profit.total > 0 && profit.total > SharedData.maxProfit.asset) {
        SharedData.maxProfit.asset = profit.total
        SharedData.maxProfit.usd = profit.totalUsd
        SharedData.maxProfit.perc = profit.perc
      }
      if (profit.total < 0 && profit.total < SharedData.maxLoss.asset) {
        SharedData.maxLoss.asset = profit.total
        SharedData.maxLoss.usd = profit.totalUsd
        SharedData.maxLoss.perc = profit.perc
      }
      if (!SharedData.previousDeal && profit.total > 0) {
        SharedData.maxConsecutiveWins = 1
        SharedData.seriesWin.value = balance - initialBalance
        SharedData.seriesWin.valueUsd =
          SharedData.balanceUsd - SharedData.initialBalanceUsd
        SharedData.seriesWin.min = initialBalance
        SharedData.seriesWin.max = balance
        SharedData.seriesWin.minUsd = SharedData.initialBalanceUsd
        SharedData.seriesWin.maxUsd = SharedData.balanceUsd
        SharedData.seriesWin.perc = profit.totalUsd / SharedData.balanceUsd
      }
      if (!SharedData.previousDeal && profit.total < 0) {
        SharedData.maxConsecutiveLosses = 1
        SharedData.seriesLoss.value = initialBalance - balance
        SharedData.seriesLoss.valueUsd =
          SharedData.initialBalanceUsd - SharedData.balanceUsd
        SharedData.seriesLoss.min = balance
        SharedData.seriesLoss.max = initialBalance
        SharedData.seriesLoss.minUsd = SharedData.balanceUsd
        SharedData.seriesLoss.maxUsd = SharedData.initialBalanceUsd
        SharedData.seriesLoss.perc = profit.totalUsd / SharedData.balanceUsd
      }
      if (profit.total > 0) {
        if (
          SharedData.previousDeal &&
          SharedData.previousDeal.profit.total < 0
        ) {
          SharedData.seriesWin.count = 0
          SharedData.seriesLoss.count = 0
        }
        SharedData.seriesWin.count += 1
      }
      if (profit.total < 0) {
        if (
          SharedData.previousDeal &&
          SharedData.previousDeal.profit.total > 0
        ) {
          SharedData.seriesWin.count = 0
          SharedData.seriesLoss.count = 0
        }
        SharedData.seriesLoss.count += 1
      }
      SharedData.totalProfit += profit.total
      SharedData.totalProfitUsd += profit.totalUsd
      SharedData.totalProfitPerSymbol.set(
        d.symbol.pair,
        (SharedData.totalProfitPerSymbol.get(d.symbol.pair) ?? 0) +
          profit.total,
      )
      SharedData.totalProfitUsdPerSymbol.set(
        d.symbol.pair,
        (SharedData.totalProfitUsdPerSymbol.get(d.symbol.pair) ?? 0) +
          profit.totalUsd,
      )
    }

    if (SharedData.balanceUsd > SharedData.seriesWin.maxUsd) {
      SharedData.seriesWin.maxUsd = SharedData.balanceUsd
      SharedData.seriesWin.max = balance
      if (SharedData.seriesWin.min === 0) {
        SharedData.seriesWin.min =
          SharedData.seriesLoss.min === 0
            ? initialBalance
            : Math.min(SharedData.seriesLoss.min, initialBalance)
        SharedData.seriesWin.minUsd =
          SharedData.seriesLoss.minUsd === 0
            ? SharedData.initialBalanceUsd
            : Math.min(
                SharedData.seriesLoss.minUsd,
                SharedData.initialBalanceUsd,
              )
      }
      const tempValueUsd =
        SharedData.seriesWin.maxUsd - SharedData.seriesWin.minUsd
      if (tempValueUsd > SharedData.seriesWin.valueUsd) {
        SharedData.seriesWin.perc = Math.abs(
          tempValueUsd / SharedData.seriesWin.minUsd,
        )
        SharedData.seriesWin.valueUsd = tempValueUsd
        SharedData.seriesWin.value =
          SharedData.seriesWin.max - SharedData.seriesWin.min
      }
    }
    if (SharedData.balanceUsd < SharedData.seriesWin.minUsd) {
      SharedData.seriesWin.min = balance
      SharedData.seriesWin.max = balance
      SharedData.seriesWin.minUsd = SharedData.balanceUsd
      SharedData.seriesWin.maxUsd = SharedData.balanceUsd
    }
    if (SharedData.balanceUsd < SharedData.seriesLoss.minUsd) {
      SharedData.seriesLoss.min = balance
      SharedData.seriesLoss.minUsd = SharedData.balanceUsd
      if (SharedData.seriesLoss.max === 0) {
        SharedData.seriesLoss.max =
          SharedData.seriesWin.max === 0
            ? initialBalance
            : Math.max(SharedData.seriesWin.max, initialBalance)
        SharedData.seriesLoss.maxUsd =
          SharedData.seriesWin.maxUsd === 0
            ? SharedData.initialBalanceUsd
            : Math.max(
                SharedData.seriesWin.maxUsd,
                SharedData.initialBalanceUsd,
              )
      }
      const tempValueUsd =
        SharedData.seriesLoss.maxUsd - SharedData.seriesLoss.minUsd
      if (tempValueUsd > SharedData.seriesLoss.valueUsd) {
        SharedData.seriesLoss.perc = Math.abs(
          tempValueUsd / SharedData.seriesLoss.maxUsd,
        )
        SharedData.seriesLoss.valueUsd = tempValueUsd
        SharedData.seriesLoss.value =
          SharedData.seriesLoss.max - SharedData.seriesLoss.min
      }
    }
    if (SharedData.balanceUsd > SharedData.seriesLoss.maxUsd) {
      SharedData.seriesLoss.max = balance
      SharedData.seriesLoss.min = balance
      SharedData.seriesLoss.maxUsd = SharedData.balanceUsd
      SharedData.seriesLoss.minUsd = SharedData.balanceUsd
    }
    if (SharedData.seriesWin.count > SharedData.maxConsecutiveWins) {
      SharedData.maxConsecutiveWins = SharedData.seriesWin.count
    }
    if (SharedData.seriesLoss.count > SharedData.maxConsecutiveLosses) {
      SharedData.maxConsecutiveLosses = SharedData.seriesLoss.count
    }
    SharedData.previousDeal = d
    SharedData.lastClosedDeal = b.time
    SharedData.lastClosedDealPerSymbol.set(d.symbol.pair, b.time)
    DealManager.setLastDealPerSymbol(d.symbol.pair, d.id)
    return { deal: d, closePrice }
  }

  static updateDealDuration(d: Deal, b: BarTV) {
    d.duration = b.time - d.startTime
    d.splitDuration = friendlyTime(d.duration)
    return d
  }

  static updateDeal(d: Deal, b: FullBar, usage = true, balance = true) {
    if (balance) {
      d = DealManager.updateDealBalances(d)
    }
    if (usage) {
      d = DealManager.updateDealUsage(d)
    }
    d = PriceCalculator.updateDealAvgPrice(d, b.time)
    d = DealManager.updateDealDuration(d, b)
    d = DealManager.updateDealVolume(d)
    DealManager.setLastDealPerSymbol(b.symbol)
    return d
  }

  static filterTpOrders() {
    return (ao: FullGrid) =>
      ao.type !== DCAOrderTypeEnum.tp && ao.type !== DCAOrderTypeEnum.sl
  }

  static getSLOrder(d: Deal, b: FullBar): { deal: Deal; order?: FullGrid } {
    const foundInSl =
      SharedData.settings.dealCloseConditionSL === CloseConditionEnum.techInd
        ? SharedData.settings.indicators.find(
            (i) =>
              i.type === IndicatorEnum.unpnl &&
              i.section === IndicatorSection.sl,
          )
        : undefined
    const foundInTp =
      SharedData.settings.dealCloseCondition === CloseConditionEnum.techInd
        ? SharedData.settings.indicators.find(
            (i) =>
              i.type === IndicatorEnum.unpnl &&
              i.section !== IndicatorSection.sl,
          )
        : undefined
    const hasUnPnl = foundInSl || foundInTp
    if (
      SharedData.settings.dealCloseConditionSL !== CloseConditionEnum.tp &&
      !SharedData.slAr &&
      !SharedData.settings.useRiskReward &&
      !SharedData.combo &&
      !d.moveSlActivated &&
      !hasUnPnl
    ) {
      return { deal: d }
    }
    const symbol = SharedData.symbols.get(d.symbol.pair)
    const botFunctions = SharedData.botFunctions.get(d.symbol.pair)
    if (!symbol || !botFunctions) {
      return { deal: d }
    }
    let close = false
    let closePrice = 0
    let slOrder: FullGrid | undefined
    let lock = false
    if (
      SharedData.settings.useMultiSl &&
      SharedData.settings.multiSl &&
      SharedData.settings.multiSl.length > 0 &&
      !SharedData.combo &&
      SharedData.settings.dealCloseConditionSL === CloseConditionEnum.tp
    ) {
      const slOrders = DealManager.getTP(d, undefined, false, true)
      const filledSl = slOrders.filter((o) =>
        SharedData.long ? o.price >= b.low : o.price <= b.high,
      )
      if (slOrders.length && filledSl.length) {
        d.ordersHistory = d.ordersHistory.map((o) => {
          if (o.slLine && filledSl.find((fsl) => fsl.price === o.price)) {
            o.filledTime = b.time
          }
          return o
        })
        const lastSl = filledSl.sort((a, bb) =>
          SharedData.long ? a.price - bb.price : bb.price - a.price,
        )[0]
        d.filledOrders = [
          ...d.filledOrders,
          ...filledSl.map((fsl) => ({ ...fsl, filledTime: b.time })),
        ].map((o) => ({ ...o, dealId: d.id }))
        const filledBase = filledSl.reduce((acc, o) => acc + o.qty, 0)
        const filledQuote = filledSl.reduce(
          (acc, o) => acc + o.qty * o.price,
          0,
        )
        d.activeOrders = [
          ...d.activeOrders.filter(
            (deal) => deal.type && ![DCAOrderTypeEnum.dca].includes(deal.type),
          ),
        ]
        for (const sl of filledSl) {
          if (
            sl.tpSlTarget &&
            !(d.tpSlTargetFilled ?? []).includes(sl.tpSlTarget)
          ) {
            StrategyUtils.updatePositionWithOrder(sl, b.symbol)
            d.tpSlTargetFilled = [...(d.tpSlTargetFilled ?? []), sl.tpSlTarget]
          }
        }
        const newTpOrders = DealManager.getTP(d)
        d.activeOrders = [
          ...d.activeOrders.filter(DealManager.filterTpOrders()),
          ...newTpOrders,
        ]
        d.currentBalance.base = SharedData.long
          ? d.currentBalance.base - filledBase
          : d.currentBalance.base + filledBase
        d.currentBalance.quote = SharedData.long
          ? d.currentBalance.quote + filledQuote
          : d.currentBalance.quote - filledQuote
        const allFilled = SharedData.long
          ? math.lte(
              d.currentBalance.base * d.avgPrice,
              symbol.quoteAsset.minAmount,
            ) && math.lte(d.currentBalance.base, symbol.baseAsset.minAmount)
          : math.lte(d.currentBalance.quote, symbol.quoteAsset.minAmount) &&
            math.lte(
              d.currentBalance.quote / d.avgPrice,
              symbol.baseAsset.minAmount,
            )
        return { deal: d, order: allFilled ? lastSl : undefined }
      }
    } else if (
      ((botFunctions.isTrailingSl && d.trailingMode === TrailingModeEnum.tsl) ||
        (botFunctions.isTrailingTp &&
          d.trailingMode === TrailingModeEnum.ttp)) &&
      !SharedData.combo
    ) {
      if (d.trailingMode && d.trailingLevel) {
        if (
          (SharedData.long && b.low <= d.trailingLevel) ||
          (!SharedData.long && b.high >= d.trailingLevel)
        ) {
          close = true
          closePrice = d.trailingLevel
        }
      }
    } else if (
      SharedData.settings.useSl &&
      typeof d.slPerc !== 'undefined' &&
      (SharedData.settings.dealCloseConditionSL === CloseConditionEnum.tp ||
        (SharedData.settings.moveSL && d.moveSlActivated)) &&
      !SharedData.combo
    ) {
      const sl = d.slPerc
      const refPrice =
        SharedData.baseSlOn === BaseSlOnEnum.avg ? d.avgPrice : d.startPrice
      const diff = SharedData.long ? b.low - refPrice : refPrice - b.high
      if (diff / refPrice - SharedData.userFee * 2 <= sl) {
        close = true
        closePrice = refPrice * (SharedData.long ? 1 - -sl : 1 + -sl)
      }
    } else if (SharedData.settings.useRiskReward && !SharedData.combo) {
      const order = d.activeOrders.find((o) => o.type === DCAOrderTypeEnum.sl)
      if (order) {
        close = SharedData.long
          ? order.price >= Math.min(b.low, b.close, b.open)
          : order.price <= Math.max(b.high, b.close, b.open)
        if (close) {
          closePrice = order.price
          slOrder = order
          lock = true
        }
      }
    } else if (SharedData.slAr) {
      const order = DealManager.getTP(d, undefined, true, true)[0]
      if (order) {
        close = SharedData.long
          ? order.price >= Math.min(b.low, b.close, b.open)
          : order.price <= Math.max(b.high, b.close, b.open)
        if (close) {
          closePrice = order.price
          slOrder = order
          lock = true
        }
      }
    } else if (SharedData.combo) {
      if (SharedData.settings.useSl || SharedData.settings.useTp) {
        const slPerc = +(SharedData.settings.slPerc || '0')
        const tpPerc = +(SharedData.settings.tpPerc || '0')
        const useTp =
          SharedData.settings.useTp &&
          SharedData.settings.dealCloseCondition === CloseConditionEnum.tp
        const useSl =
          SharedData.settings.useSl &&
          SharedData.settings.dealCloseConditionSL === CloseConditionEnum.tp
        const price = b.close
        const qty = Math.max(
          SharedData.long
            ? d.currentBalance.base
            : d.initialBalance.base - d.currentBalance.base,
          0,
        )
        const quote = SharedData.long
          ? d.initialBalance.quote - d.currentBalance.quote
          : d.currentBalance.quote
        const quoteTp = qty * price
        const base = quote / price
        const commission = SharedData.profitBase
          ? qty * SharedData.userFee
          : qty * price * SharedData.userFee
        const total =
          (SharedData.profitBase ? qty - base : quoteTp - quote) *
            (SharedData.long ? 1 : -1) -
          commission
        const usageBase =
          SharedData.comboBasedOn === ComboTpBase.full
            ? d.usage.max.base
            : d.usage.current.base
        const usageQuote =
          SharedData.comboBasedOn === ComboTpBase.full
            ? d.usage.max.quote
            : d.usage.current.quote
        const denominator =
          (SharedData.futures
            ? SharedData.coinm
              ? usageBase
              : usageQuote
            : SharedData.long
              ? usageQuote * (SharedData.profitBase ? 1 / price : 1)
              : usageBase * (SharedData.profitBase ? 1 : price)) /
          SharedData.leverage
        const perc = total / denominator
        if (
          isFinite(Math.abs(perc)) &&
          !isNaN(perc) &&
          !isNaN(math.round(perc * 100)) &&
          useSl &&
          slPerc >= perc * 100
        ) {
          close = true
          const requiredPrice = SharedData.profitBase
            ? -(quote * (SharedData.long ? 1 : -1)) /
              (denominator * (slPerc / 100) +
                commission -
                qty * (SharedData.long ? 1 : -1))
            : (denominator * (slPerc / 100) +
                commission +
                quote * (SharedData.long ? 1 : -1)) /
              (qty * (SharedData.long ? 1 : -1))
          closePrice = requiredPrice
        }
        if (
          isFinite(Math.abs(perc)) &&
          !isNaN(perc) &&
          !isNaN(math.round(perc * 100)) &&
          useTp &&
          tpPerc <= perc * 100
        ) {
          close = true
          const requiredPrice = SharedData.profitBase
            ? -(quote * (SharedData.long ? 1 : -1)) /
              (denominator * (tpPerc / 100) +
                commission -
                qty * (SharedData.long ? 1 : -1))
            : (denominator * (tpPerc / 100) +
                commission +
                quote * (SharedData.long ? 1 : -1)) /
              (qty * (SharedData.long ? 1 : -1))
          closePrice = requiredPrice
        }
      }
    }
    if (hasUnPnl && !close) {
      const slLogicOr =
        SharedData.settings.stopDealSlLogic === IndicatorsLogicEnum.or
      const tpLogicOr =
        SharedData.settings.stopDealLogic === IndicatorsLogicEnum.or
      const slInidcators = foundInSl
        ? SharedData.settings.indicators.filter(
            (i) =>
              i.indicatorAction === IndicatorAction.closeDeal &&
              i.section === IndicatorSection.sl,
          )
        : undefined
      const tpInidcators = foundInTp
        ? SharedData.settings.indicators.filter(
            (i) =>
              i.indicatorAction === IndicatorAction.closeDeal &&
              i.section !== IndicatorSection.sl,
          )
        : undefined
      if (
        (foundInSl && ((slInidcators?.length ?? 0) === 1 || slLogicOr)) ||
        (foundInTp && ((tpInidcators?.length ?? 0) === 1 || tpLogicOr))
      ) {
        const slConditionGt =
          (foundInSl
            ? (foundInSl?.unpnlCondition ?? SharedData.defaultUnpnlCondition)
            : null) === IndicatorStartConditionEnum.gt
        const tpConditionGt =
          (foundInTp
            ? (foundInTp?.unpnlCondition ?? SharedData.defaultUnpnlCondition)
            : null) === IndicatorStartConditionEnum.gt

        const slValue = (foundInSl?.unpnlValue ?? SharedData.defaultUnpnl) / 100
        const tpValue = (foundInTp?.unpnlValue ?? SharedData.defaultUnpnl) / 100
        const min = Math.max(
          foundInSl && !slConditionGt ? slValue : -Infinity,
          foundInTp && !tpConditionGt ? tpValue : -Infinity,
        )
        const max = Math.min(
          foundInSl && slConditionGt ? slValue : Infinity,
          foundInTp && tpConditionGt ? tpValue : Infinity,
        )
        const diff = SharedData.long
          ? b.close - d.avgPrice
          : d.avgPrice - b.close
        const unPnl = diff / d.avgPrice - SharedData.userFee * 2
        const high = unPnl >= max
        const low = unPnl <= min
        close = high || low
        closePrice =
          ((high ? max : min) * (SharedData.long ? 1 : -1) + 1) * d.avgPrice
      }
    }
    if (close) {
      slOrder =
        lock && slOrder
          ? slOrder
          : DealManager.getTP(
              d,
              SharedData.combo && SharedData.profitBase ? b.close : undefined,
              false,
              true,
            )[0]
      slOrder.price = lock
        ? closePrice
        : closePrice *
          (SharedData.combo || (d.trailingLevel && d.trailingMode)
            ? 1
            : SharedData.long
              ? 1 + SharedData.userFee * 2
              : 1 - SharedData.userFee * 2)
      const min = Math.min(b.low, b.close, b.open)
      const max = Math.max(b.high, b.close, b.open)
      slOrder.price = lock
        ? closePrice
        : slOrder.price >= min && slOrder.price <= max
          ? slOrder.price
          : slOrder.price >= max
            ? max
            : slOrder.price <= min
              ? min
              : min
      if (SharedData.combo && SharedData.profitBase) {
        slOrder = DealManager.getTP(d, slOrder.price, false, true)[0]
      }
      StrategyUtils.updatePositionWithOrder(slOrder, b.symbol)
      return { deal: d, order: slOrder }
    }
    return { deal: d }
  }

  static async processDCAOrders(d: Deal, b: FullBar) {
    const filledDCA = d.activeOrders
      .filter(
        (o) =>
          o.type === DCAOrderTypeEnum.dca || o.type === DCAOrderTypeEnum.bo,
      )
      .filter(SharedData.filterFn.filledOrders(b))
      .map((o) => ({ ...o, filledTime: b.time }))
    if (filledDCA.length > 0) {
      for (const o of filledDCA.sort((a, B) =>
        SharedData.long ? B.price - a.price : a.price - B.price,
      )) {
        d.lastFilled = SharedData.combo
          ? o.levelNumber
            ? o.levelNumber + 1
            : d.lastFilled
          : (o.levelNumber ?? d.lastFilled)
        if (SharedData.combo) {
          const m = DealManager.createMinigrid(d, o, false, d.symbol.pair)
          if (m) {
            d.minigrids.push(m)
            for (const ao of m.activeOrders) {
              d.activeOrders.push({ ...ao, startTime: b.time })
            }
          }
        }
        StrategyUtils.updatePositionWithOrder(o, b.symbol)
        d.lastPrice = o.price
        d.lastTime = o.filledTime
      }
      d.filledOrders = [...d.filledOrders, ...filledDCA].map((o) => ({
        ...o,
        dealId: d.id,
      }))
      d = DealManager.updateDeal(d, b)
      if (
        SharedData.settings.useTp &&
        (SharedData.settings.dealCloseCondition === CloseConditionEnum.tp ||
          SharedData.tpAr) &&
        !SharedData.combo
      ) {
        const tpOrdersCurrent = DealManager.getTP(d)
        d.activeOrders = [
          ...d.activeOrders.filter(DealManager.filterTpOrders()),
          ...tpOrdersCurrent,
        ]
      }
      d.levels.max = Math.max(d.lastFilled, d.levels.max)
      d.levels.complete = SharedData.combo
        ? Math.max(d.lastFilled, 0)
        : d.levels.complete + filledDCA.length
      d.activeOrders = d.activeOrders.filter(
        (o) => !d.filledOrders.map((fo) => fo.id).includes(o.id),
      )
      d.ordersHistory = d.ordersHistory.map((o) => {
        if (
          (o.type === DCAOrderTypeEnum.dca ||
            o.type === DCAOrderTypeEnum.bo ||
            o.type === DCAOrderTypeEnum.tp) &&
          !o.filledTime
        ) {
          if (
            !d.activeOrders.find(
              (g) =>
                g.price === o.price && g.side === o.side && g.qty === o.qty,
            )
          ) {
            o.filledTime = b.time
          }
        }
        return o
      })
      d.ordersHistory = [
        ...d.ordersHistory,
        ...d.activeOrders
          .filter(
            (g) =>
              !d.ordersHistory.find(
                (oh) =>
                  (oh.type === DCAOrderTypeEnum.dca ||
                    oh.type === DCAOrderTypeEnum.bo ||
                    oh.type === DCAOrderTypeEnum.tp ||
                    oh.type === DCAOrderTypeEnum.grid) &&
                  !oh.filledTime &&
                  g.price === oh.price &&
                  g.side === oh.side &&
                  g.qty === oh.qty,
              ),
          )
          .map((o) => ({ ...o, startTime: b.time })),
      ].map((o) => ({ ...o, dealId: d.id }))
      if (!SharedData.combo) {
        const slLine = DealManager.getSlHistoryLine(d, b.time)
        d = DealManager.replaceSlHistoryLine(d, slLine, b.time)
      }
    }
    return d
  }

  static addDCAOrder(
    index: number,
    price: number,
    time: number,
    symbol: string,
  ) {
    for (const d of DealManager.getDeals('open', symbol).filter(
      (dd) => dd.lastFilled + 1 === index + 1,
    )) {
      if (SharedData.settings.dcaCondition === DCAConditionEnum.indicators) {
        const ind = SharedData.settings.indicators.filter(
          (i) => i.indicatorAction === IndicatorAction.startDca,
        )[index]
        if (ind) {
          const botFunctions = SharedData.botFunctions.get(d.symbol.pair)
          if (!botFunctions) {
            continue
          }
          const { minPercFromLast } = ind
          if (minPercFromLast && !isNaN(+minPercFromLast)) {
            const diff = SharedData.long
              ? d.lastPrice - price
              : price - d.lastPrice
            const absDiff = diff / d.lastPrice

            if (absDiff >= +minPercFromLast / 100) {
              const orders = botFunctions.createOrders(
                SharedData.usdRateQuote.get(d.symbol.pair) ?? 0,
                d.startPrice,
                true,
                undefined,
                [],
                StrategyUtils.getBalances(d.symbol.pair),
                true,
              )
              const dcaOrder = orders.find((o) => o.levelNumber === index + 1)
              if (dcaOrder) {
                d.activeOrders.push({ ...dcaOrder, startTime: time, price })
                DealManager.processDCAOrders(d, {
                  open: price,
                  close: price,
                  high: price,
                  low: price,
                  time,
                  symbol,
                })
              }
            }
          }
        }
      }
    }
  }

  static checkMinTp(price: number, d: Deal, section: 'tp' | 'sl') {
    let value: number | undefined
    let isGt = true
    if (
      section !== 'sl' &&
      SharedData.settings.useMinTP &&
      SharedData.settings.dealCloseCondition === CloseConditionEnum.techInd &&
      SharedData.settings.minTp &&
      checkNumber(SharedData.settings.minTp)
    ) {
      value = +(SharedData.settings.minTp ?? '0') / 100
    }
    if (section === 'sl') {
      const foundUnpnl =
        SharedData.settings.dealCloseConditionSL === CloseConditionEnum.techInd
          ? SharedData.settings.indicators.find(
              (i) =>
                i.type === IndicatorEnum.unpnl &&
                i.section === IndicatorSection.sl,
            )
          : undefined
      if (foundUnpnl) {
        isGt =
          (foundUnpnl.unpnlCondition ?? SharedData.defaultUnpnlCondition) ===
          IndicatorStartConditionEnum.gt
        value = (foundUnpnl.unpnlValue ?? SharedData.defaultUnpnl) / 100
      }
    }
    if (
      section === 'tp' &&
      (SharedData.settings.stopDealLogic === IndicatorsLogicEnum.and ||
        !SharedData.settings.stopDealLogic)
    ) {
      const foundUnpnl =
        SharedData.settings.dealCloseCondition === CloseConditionEnum.techInd
          ? SharedData.settings.indicators.find(
              (i) =>
                i.type === IndicatorEnum.unpnl &&
                i.section !== IndicatorSection.sl,
            )
          : undefined
      if (foundUnpnl) {
        isGt =
          (foundUnpnl.unpnlCondition ?? SharedData.defaultUnpnlCondition) ===
          IndicatorStartConditionEnum.gt
        value = (foundUnpnl.unpnlValue ?? SharedData.defaultUnpnl) / 100
      }
    }
    if (typeof value !== 'undefined') {
      const diff = SharedData.long ? price - d.avgPrice : d.avgPrice - price
      const current = diff / d.avgPrice - SharedData.userFee * 2
      return isGt ? current >= value : current <= value
    }
    return true
  }

  static closeAllDeals(b: FullBar, sl = false, ignoreTp = false, stop = false) {
    const allDeals = DealManager.getDeals('open', b.symbol).filter(
      (d) =>
        (!stop && DealManager.checkMinTp(b.open, d, sl ? 'sl' : 'tp')) || stop,
    )
    for (const d of allDeals) {
      const position = SharedData.emptyPosition
      SharedData.position.set(b.symbol, position)
      const tp = ignoreTp
        ? undefined
        : DealManager.getTP(d, b.open, true, false)[0]
      DealManager.closeDeal(d, b, tp)
      DealManager.processDealCloseFromMap(d)
    }
  }

  static stopByIndicator(b: FullBar) {
    SharedData.preventOpen = true
    const action =
      SharedData.settings.stopType || CloseDCATypeEnum.closeByMarket
    SharedData.status =
      SharedData.settings.stopStatus === 'monitoring'
        ? 'monitoring'
        : SharedData.status
    if (
      action === CloseDCATypeEnum.closeByMarket ||
      action === CloseDCATypeEnum.closeByLimit
    ) {
      return DealManager.closeAllDeals(b, true, false, true)
    }
    if (action === CloseDCATypeEnum.cancel) {
      DealManager.closeAllDeals(b, true, true, true)
    }
  }

  static generateGridsOnPrice(
    minigrid: Minigrid,
    price: number,
    side: BotOrderSideEnum,
    s: string,
  ) {
    const { long, settings, symbols } = SharedData
    const symbol = symbols.get(s)
    const botFunctions = SharedData.botFunctions.get(s)
    if (!symbol || !botFunctions) {
      return []
    }
    const {
      settings: {
        lowPrice,
        topPrice,
        budget,
        levels,
        sellDisplacement,
        profitCurrency,
        orderFixedIn,
      },
    } = minigrid
    const gridSettings = {
      lowPrice: `${lowPrice}`,
      topPrice: `${topPrice}`,
      budget: `${budget}`,
      levels: `${levels}`,
      useStartPrice: false,
      startPrice: undefined,
      updatedBudget: true,
      forceLocal: false,
      symbol,
      _lastPrice: price,
      userFee: SharedData.userFee,
      sellDisplacement: `${sellDisplacement}`,
      gridType: 'arithmetic' as const,
      initialPrice: long ? lowPrice : topPrice,
      futures: !!settings.futures,
      profitCurrency,
      orderFixedIn,
      coinm: !!settings.coinm,
      futuresStrategy: long
        ? FuturesStrategyEnum.long
        : FuturesStrategyEnum.short,
      useOrderInAdvance: false,
      combo: true,
      _side: side,
    }
    const feeOrder = settings.futures
      ? undefined
      : typeof settings.feeOrder !== 'undefined' && settings.feeOrder
        ? false
        : undefined
    const key = `${JSON.stringify(
      gridSettings,
    )}, ${true}, ${false}, ${!long}, ${feeOrder}, ${true}`
    const local = SharedData.gridsOnPrice.get(key)
    const grids: DCAGrid[] = (
      local ??
      botFunctions.utils.createGridOrders(
        gridSettings,
        true,
        false,
        !long,
        feeOrder,
        true,
      )
    ).map((g) => ({
      ...g,
      type: DCAOrderTypeEnum.grid,
      relatedTo: minigrid.dcaOrderId,
      minigridId: minigrid.id,
      id: local ? botFunctions.utils.id(20) : g.id,
    }))
    if (!local) {
      SharedData.gridsOnPrice.set(key, grids)
    }
    return grids
  }
  static createMinigrid(
    deal: Deal,
    startOrder: FullGrid,
    lockClose: boolean,
    s: string,
    _initialPrice?: number,
  ): Minigrid | undefined {
    const symbol = SharedData.symbols.get(s)
    if (!symbol) {
      return
    }
    const { settings, userFee, long } = SharedData
    const price = deal.startPrice
    const startPrice = startOrder.price
    const initialPrice = _initialPrice ?? startPrice
    const baseOrder = startOrder.type === DCAOrderTypeEnum.bo
    const stepScale = parseFloat(settings.stepScale)
    const stepVal = startOrder.levelNumber
      ? stepScale ** (startOrder.levelNumber - 1)
      : 1
    const gridStep =
      (baseOrder
        ? price * (+(settings.baseStep ?? settings.step) / 100)
        : price * (+settings.step / 100)) * stepVal
    const lowPrice = SharedData.long ? startPrice : startPrice - gridStep
    const topPrice = SharedData.long ? startPrice + gridStep : startPrice
    const levels = Math.floor(
      +(baseOrder
        ? (settings.baseGridLevels ?? settings.gridLevel ?? '1')
        : (settings.gridLevel ?? '1')),
    )
    const fee = userFee
    const sellDisplacement = fee * 2 * 100
    const profitCurrency = settings.futures ? 'quote' : settings.profitCurrency
    const orderFixedIn = settings.futures
      ? settings.coinm
        ? ('quote' as const)
        : ('base' as const)
      : settings.profitCurrency === 'quote'
        ? ('base' as const)
        : ('quote' as const)
    let asset = {
      base: 0,
      quote: 0,
    }
    const time = startOrder.filledTime ?? +new Date()
    const budget =
      startOrder.minigridBudget ?? startOrder.qty * startOrder.price
    let minigrid: Minigrid = {
      filledBase: 0,
      filledQuote: 0,
      notUsedFilledOrders: [],
      symbol,
      initialOrders: [],
      filledOrders: [],
      activeOrders: [],
      id:
        SharedData.botFunctions.values().next().value?.utils.id(20) ??
        'unknown',
      dealId: deal.id,
      dcaOrderId: startOrder.id,
      grids: { buy: 0, sell: 0 },
      status: 'open',
      initialBalances: asset,
      currentBalances: asset,
      initialPrice: initialPrice,
      lastPrice: initialPrice,
      lastSide: startOrder.side,
      profit: {
        total: 0,
        totalUsd: 0,
      },
      avgPrice: initialPrice,
      createTime: time,
      updateTime: time,
      assets: { used: asset, required: asset },
      settings: {
        topPrice,
        lowPrice,
        levels,
        budget,
        sellDisplacement,
        profitCurrency,
        orderFixedIn,
        step: deal.step,
      },
      transactions: {
        buy: 0,
        sell: 0,
      },
      lockClose,
    }
    const allOrders = DealManager.generateGridsOnPrice(
      minigrid,
      _initialPrice ?? (long ? lowPrice : topPrice),
      BotOrderSideEnum.buy,
      symbol.pair,
    )
    const buys = allOrders.filter((g) => g.side === BotOrderSideEnum.buy)
    const sells = allOrders.filter((g) => g.side === BotOrderSideEnum.sell)
    const base = sells.reduce((acc, o) => acc + o.qty, 0)
    const quote = buys.reduce((acc, o) => acc + o.qty * o.price, 0)
    asset = {
      base,
      quote,
    }
    minigrid = {
      ...minigrid,
      initialOrders: allOrders,
      activeOrders: allOrders,
      grids: { buy: buys.length, sell: sells.length },
      initialBalances: asset,
      currentBalances: asset,
      assets: { used: asset, required: asset },
    }
    return minigrid
  }

  static closeMinigrid(minigrid: Minigrid): Minigrid {
    return { ...minigrid, status: 'close' }
  }

  static createTransaction(
    o: FullGrid,
    minigrid: Minigrid,
  ): {
    profitBase: number
    profitQuote: number
    profitUsdt: number
  } {
    const symbol = SharedData.symbols.get(minigrid.symbol.pair)
    const botFunctions = SharedData.botFunctions.get(minigrid.symbol.pair)
    if (!symbol || !botFunctions) {
      return { profitBase: 0, profitQuote: 0, profitUsdt: 0 }
    }
    const { userFee } = SharedData
    const {
      settings: {
        lowPrice,
        topPrice,
        sellDisplacement,
        levels,
        profitCurrency,
      },
      initialPrice,
      avgPrice,
      notUsedFilledOrders,
    } = minigrid
    const prices = PriceCalculator.getPrices(
      lowPrice,
      topPrice,
      symbol,
      levels,
      sellDisplacement,
    )

    prices[prices.length - 1].buy = math.round(
      topPrice,
      symbol.priceAssetPrecision,
    )
    const grids =
      DealManager.generateGridsOnPrice(
        minigrid,
        topPrice * 2,
        BotOrderSideEnum.buy,
        symbol.pair,
      ) ?? []
    const _profitBase = profitCurrency === 'base'
    const { qty, price, side, filledTime, id } = o
    let comBase = side === BotOrderSideEnum.buy ? qty * userFee : 0
    let comQuote = side === BotOrderSideEnum.sell ? qty * price * userFee : 0
    let profitQuote = 0
    let matchedPrice = 0
    let matchQty = 0
    let profitBase = 0
    let matchedId = ''
    let profitUsdt = 0
    let amountBaseBuy = side === BotOrderSideEnum.sell ? 0 : qty
    let amountQuoteBuy = side === BotOrderSideEnum.sell ? 0 : qty * price
    let amountBaseSell = side === BotOrderSideEnum.buy ? 0 : qty
    let amountQuoteSell = side === BotOrderSideEnum.buy ? 0 : qty * price
    if (!SharedData.futures) {
      if (side === BotOrderSideEnum.sell && _profitBase) {
        comBase = comQuote / price
      }
      if (side === BotOrderSideEnum.buy && !_profitBase) {
        comQuote = comBase * price
      }
      let index = prices.findIndex(
        (p) => (side === BotOrderSideEnum.sell ? p.sell : p.buy) === price,
      )
      if (index === -1) {
        index = prices.findIndex(
          (p) => (side === BotOrderSideEnum.sell ? p.buy : p.sell) === price,
        )
      }
      const match = notUsedFilledOrders.find(
        (g) =>
          !SharedData.usedOrderId.has(g.id) &&
          g.price ===
            (side === BotOrderSideEnum.sell
              ? prices[index - 1]?.buy || 0
              : prices[index + 1]?.sell || 0) &&
          g.side !== o.side &&
          (g.filledTime ?? 0) <= (filledTime ?? 0),
      )
      const needMatch = SharedData.long
        ? side === BotOrderSideEnum.buy ||
          (initialPrice &&
            side === BotOrderSideEnum.sell &&
            price <= initialPrice)
        : side === BotOrderSideEnum.sell ||
          (initialPrice &&
            side === BotOrderSideEnum.buy &&
            price >= initialPrice)
      if (!needMatch && !match) {
        SharedData.usedOrderId.add(id)
        minigrid.notUsedFilledOrders = minigrid.notUsedFilledOrders.filter(
          (fo) => ![id].includes(fo.id),
        )
        matchedId = 'initial price'
        matchQty = _profitBase ? (price * qty) / (initialPrice ?? price) : qty
        matchedPrice = initialPrice ?? price
      } else if (match) {
        matchedId = match.id
        matchQty = match.qty
        matchedPrice = match.price
        SharedData.usedOrderId.add(matchedId)
        SharedData.usedOrderId.add(id)
        minigrid.notUsedFilledOrders = minigrid.notUsedFilledOrders.filter(
          (fo) => ![matchedId, id].includes(fo.id),
        )
      }
      if (matchedPrice !== 0) {
        const pnlBase =
          side === BotOrderSideEnum.sell ? matchQty - qty : qty - matchQty
        const pnlQuote =
          side === BotOrderSideEnum.sell
            ? qty * price - matchQty * matchedPrice
            : matchQty * matchedPrice - qty * price
        profitBase +=
          pnlBase +
          pnlQuote / (side === BotOrderSideEnum.buy ? price : matchedPrice)
        profitQuote +=
          pnlQuote +
          pnlBase * (side === BotOrderSideEnum.buy ? price : matchedPrice)
        if (side === 'BUY') {
          amountBaseSell = matchQty
          amountQuoteSell = matchQty * matchedPrice
        }
        if (side === 'SELL') {
          amountBaseBuy = matchQty
          amountQuoteBuy = matchQty * matchedPrice
        }
      }
    } else {
      if (!_profitBase && !SharedData.futures) {
        if (side === BotOrderSideEnum.buy) {
          comQuote = comBase * price
        }
        if (side === BotOrderSideEnum.sell) {
          let index = prices.findIndex((p) => p.sell === price)
          if (index === -1) {
            index = prices.findIndex((p) => p.buy === price)
          }
          const buyMatch = (grids ?? []).find(
            (g) =>
              index !== -1 &&
              g.price === prices[index - 1].buy &&
              g.side === BotOrderSideEnum.buy,
          )
          if (buyMatch) {
            profitBase = buyMatch.qty - qty
            profitQuote =
              qty * price - buyMatch.qty * buyMatch.price + profitBase * price
            matchedPrice = buyMatch.price
            amountBaseBuy = buyMatch.qty
            amountQuoteBuy = buyMatch.qty * buyMatch.price
          }
        }
      }
      if (_profitBase || SharedData.futures) {
        if (o.side === BotOrderSideEnum.sell) {
          comBase = comQuote / price
        }
        if (!SharedData.usedOrderId.has(id)) {
          if (SharedData.futuresStrategy !== FuturesStrategyEnum.neutral) {
            const withMatch =
              (SharedData.futuresStrategy === FuturesStrategyEnum.long &&
                o.side === BotOrderSideEnum.sell) ||
              (SharedData.futuresStrategy === FuturesStrategyEnum.short &&
                o.side === BotOrderSideEnum.buy)
            SharedData.usedOrderId.add(id)
            minigrid.notUsedFilledOrders = minigrid.notUsedFilledOrders.filter(
              (fo) => ![id].includes(fo.id),
            )
            if (withMatch) {
              matchedId = 'position price'
              matchQty = _profitBase ? (price * qty) / (avgPrice || price) : qty
              matchedPrice = avgPrice || price
              const pnlBase =
                o.side === BotOrderSideEnum.sell
                  ? matchQty - qty
                  : qty - matchQty
              const pnlQuote =
                o.side === BotOrderSideEnum.sell
                  ? qty * price - matchQty * matchedPrice
                  : matchQty * matchedPrice - qty * price
              profitBase +=
                pnlBase +
                pnlQuote /
                  (o.side === BotOrderSideEnum.buy ? price : matchedPrice)
              profitQuote +=
                pnlQuote +
                pnlBase *
                  (o.side === BotOrderSideEnum.buy ? price : matchedPrice)
              if (side === 'BUY') {
                amountBaseSell = matchQty
                amountQuoteSell = matchQty * matchedPrice
              }
              if (side === 'SELL') {
                amountBaseBuy = matchQty
                amountQuoteBuy = matchQty * matchedPrice
              }
            }
          } else {
            let index = prices.findIndex(
              (p) =>
                (o.side === BotOrderSideEnum.sell ? p.sell : p.buy) === price,
            )
            if (index === -1) {
              index = prices.findIndex(
                (p) =>
                  (o.side === BotOrderSideEnum.sell ? p.buy : p.sell) === price,
              )
            }

            const match = notUsedFilledOrders.find(
              (g) =>
                g.price ===
                  (o.side === BotOrderSideEnum.sell
                    ? prices[index - 1]?.buy || 0
                    : prices[index + 1]?.sell || 0) &&
                g.side !== side &&
                (g.filledTime ?? 0) < (filledTime ?? 0) &&
                !SharedData.usedOrderId.has(g.id),
            )
            if (match) {
              matchedId = match.id
              SharedData.usedOrderId.add(matchedId)
              SharedData.usedOrderId.add(id)
              minigrid.notUsedFilledOrders =
                minigrid.notUsedFilledOrders.filter(
                  (fo) => ![matchedId, id].includes(fo.id),
                )
              matchQty = match.qty
              matchedPrice = match.price
              const pnlBase =
                side === BotOrderSideEnum.sell ? matchQty - qty : qty - matchQty
              const pnlQuote =
                side === BotOrderSideEnum.sell
                  ? qty * price - matchQty * matchedPrice
                  : matchQty * matchedPrice - qty * price
              profitBase +=
                pnlBase +
                pnlQuote /
                  (side === BotOrderSideEnum.buy ? price : matchedPrice)
              profitQuote +=
                pnlQuote +
                pnlBase * (side === BotOrderSideEnum.buy ? price : matchedPrice)
              if (side === 'BUY') {
                amountBaseSell = matchQty
                amountQuoteSell = matchQty * matchedPrice
              }
              if (side === 'SELL') {
                amountBaseBuy = matchQty
                amountQuoteBuy = matchQty * matchedPrice
              }
            }
          }
        }
      }
    }
    const totalQuote =
      profitQuote - (comQuote === 0 ? comBase * price : comQuote)
    const usdRate = SharedData.usdRateQuote.get(minigrid.symbol.pair) ?? 1
    const precisionBase =
      SharedData.precisionBase.get(minigrid.symbol.pair) ?? 8
    const precisionQuote =
      SharedData.precisionQuote.get(minigrid.symbol.pair) ?? 8
    const precision = SharedData.precision.get(minigrid.symbol.pair) ?? 8
    profitUsdt = totalQuote * usdRate
    const transaction: BacktestingTransaction = {
      _id: v4(),
      updateTime: filledTime ?? 0,
      side,
      amountBaseBuy: math.convertFromExponential(
        math.round(amountBaseBuy, precisionBase),
        precisionBase,
      ),
      amountQuoteBuy: math.convertFromExponential(
        math.round(amountQuoteBuy, precisionQuote),
        precisionQuote,
      ),
      amountBaseSell: math.convertFromExponential(
        math.round(amountBaseSell, precisionBase),
        precisionBase,
      ),
      amountQuoteSell: math.convertFromExponential(
        math.round(amountQuoteSell, precisionQuote),
        precisionQuote,
      ),
      priceSell: math.convertFromExponential(
        math.round(
          side === BotOrderSideEnum.sell ? price : matchedPrice,
          symbol.priceAssetPrecision,
        ),
        symbol.priceAssetPrecision,
      ),
      priceBuy: math.convertFromExponential(
        math.round(
          side === BotOrderSideEnum.buy ? price : matchedPrice,
          symbol.priceAssetPrecision,
        ),
        symbol.priceAssetPrecision,
      ),
      profit: math.convertFromExponential(
        math.round(
          SharedData.profitBase ? profitBase - comBase : profitQuote - comQuote,
          precision + 3,
        ),
        precision + 3,
      ),
      profitUsd: math.round(profitUsdt, 2),
      baseAsset: symbol.baseAsset.name,
      quoteAsset: symbol.quoteAsset.name,
      profitAsset: SharedData.futures
        ? SharedData.coinm
          ? symbol.baseAsset.name
          : symbol.quoteAsset.name
        : SharedData.profitBase
          ? symbol.baseAsset.name
          : symbol.quoteAsset.name,
      index: SharedData.transactionIndex,
      idBuy: o.side === BotOrderSideEnum.buy ? o.id : matchedId,
      idSell: o.side === BotOrderSideEnum.buy ? matchedId : o.id,
      executor: o.id,
      cummulativeProfitBase: 0,
      cummulativeProfitQuote: 0,
      cummulativeProfitUsdt: 0,
      freeProfit: 0,
      freeProfitUsd: 0,
      amountFreeBaseBuy: 0,
      amountFreeBaseSell: 0,
      amountFreeQuoteBuy: 0,
      amountFreeQuoteSell: 0,
    }
    SharedData.transactionIndex++
    const findDeal = DealManager.getDeals('open', minigrid.symbol.pair).find(
      (d) => d.id === minigrid.dealId,
    )

    if (findDeal) {
      findDeal.transactions.push(transaction)
      findDeal.minigrids = findDeal.minigrids.map((mg) =>
        mg.id === minigrid.id ? minigrid : mg,
      )
      DealManager.setDeal(findDeal, 'open', minigrid.symbol.pair)
    }

    return {
      profitBase: profitBase - comBase,
      profitQuote: profitQuote - comQuote,
      profitUsdt,
    }
  }

  static async processGridOrders(
    d: Deal,
    b: FullBar,
  ): Promise<{ deal: Deal; closePrice: number; tpOrder?: FullGrid }> {
    if (!SharedData.combo) {
      return { deal: d, closePrice: 0 }
    }
    let allOrders: FullGrid[] = []
    const mIds: string[] = []
    for (const m of d.minigrids.filter(
      (mg) => mg.status === 'open' && mg.symbol.pair === b.symbol,
    )) {
      mIds.push(m.id)
      const botFunctions = SharedData.botFunctions.get(m.symbol.pair)
      let grids = m.activeOrders.filter((g) => g.type === DCAOrderTypeEnum.grid)
      let total = 0
      let totalUsd = 0
      const filledBuy = grids
        .filter((g) => g.side === BotOrderSideEnum.buy && g.price >= b.low)
        .sort((a, B) => B.price - a.price)
      let tpOrder: FullGrid | undefined
      for (const o of filledBuy) {
        if (tpOrder) {
          continue
        }
        o.filledTime = b.time
        m.filledOrders.push(o)
        m.notUsedFilledOrders.push(o)
        d.filledOrders.push({ ...o, dealId: d.id })
        StrategyUtils.updatePositionWithOrder(o, b.symbol)
        m.avgPrice = PriceCalculator.avgPriceAfterOrder(o, m)
        const profit = DealManager.createTransaction(o, m)
        total += SharedData.profitBase ? profit.profitBase : profit.profitQuote
        totalUsd += profit.profitUsdt
        d = DealManager.updateDealBalancesByOrder(d, o)
        const closeOrder = DealManager.getSLOrder(d, b)
        if (closeOrder.order) {
          tpOrder = closeOrder.order
        }
      }
      const lastFilledBuy = filledBuy[filledBuy.length - 1]
      if (lastFilledBuy) {
        const lastPrice = lastFilledBuy.price
        grids = DealManager.generateGridsOnPrice(
          m,
          lastPrice,
          BotOrderSideEnum.buy,
          m.symbol.pair,
        )
        m.lastPrice = lastFilledBuy.price
        m.lastSide = lastFilledBuy.side
      }
      const filledSell = grids
        .filter((g) => g.side === BotOrderSideEnum.sell && g.price <= b.high)
        .sort((a, B) => a.price - B.price)
      for (const o of filledSell) {
        if (tpOrder) {
          continue
        }
        o.filledTime = b.time
        m.filledOrders.push(o)
        m.notUsedFilledOrders.push(o)
        d.filledOrders.push({ ...o, dealId: d.id })
        StrategyUtils.updatePositionWithOrder(o, b.symbol)
        m.avgPrice = PriceCalculator.avgPriceAfterOrder(o, m)
        const profit = DealManager.createTransaction(o, m)
        total += SharedData.profitBase ? profit.profitBase : profit.profitQuote
        totalUsd += profit.profitUsdt
        d = DealManager.updateDealBalancesByOrder(d, o)
        const closeOrder = DealManager.getSLOrder(d, b)
        if (closeOrder.order) {
          tpOrder = closeOrder.order
        }
      }
      if (total !== 0) {
        SharedData.profits.push({ total, totalUsd, time: b.time })
      }
      const lastFilledSell = filledSell[filledSell.length - 1]
      if (lastFilledSell) {
        const lastPrice = lastFilledSell.price
        grids = DealManager.generateGridsOnPrice(
          m,
          lastPrice,
          BotOrderSideEnum.sell,
          m.symbol.pair,
        )
        m.lastPrice = lastFilledSell.price
        m.lastSide = lastFilledSell.side
      }
      if (filledBuy.length || filledSell.length) {
        m.activeOrders = grids
        allOrders = [...allOrders, ...grids]
        m.transactions.buy += filledBuy.length
        m.transactions.sell += filledSell.length
        d.transactionsCount.buy += filledBuy.length
        d.transactionsCount.sell += filledSell.length
        const buys = grids.filter((g) => g.side === BotOrderSideEnum.buy)
        const sells = grids.filter((g) => g.side === BotOrderSideEnum.sell)
        m.grids.buy = buys.length
        m.grids.sell = sells.length
        const balance = {
          base: sells.reduce((acc, s) => acc + s.qty, 0),
          quote: buys.reduce((acc, B) => acc + B.qty * B.price, 0),
        }
        m.currentBalances = balance
        m.assets = {
          used: balance,
          required: balance,
        }
        m.profit.total += total
        m.profit.totalUsd += totalUsd
        const closed =
          !m.lockClose &&
          (SharedData.long ? m.grids.sell === 0 : m.grids.buy === 0)
        if (closed) {
          m.status = 'close'
          m.activeOrders = []
          d.lastFilled -= 1
          d.levels.complete = Math.max(d.lastFilled, 0)
          d.levels.max = Math.max(d.lastFilled, d.levels.max)
          m.closeTime = b.time
        }

        d.profit.total += total
        d.profit.totalUsd += totalUsd
        d.minigrids = [...d.minigrids.filter((mm) => mm.id !== m.id), m]
        d.activeOrders = [
          ...d.activeOrders.filter((o) => o.minigridId !== m.id),
          ...m.activeOrders,
        ]
        if (tpOrder) {
          d = DealManager.updateDeal(d, b, false, false)
          return DealManager.closeDeal(d, b, tpOrder)
        }
        if (closed) {
          const order =
            d.filledOrders.find((o) => o.id === m.dcaOrderId) ??
            d.hiddenOrders.find((o) => o.id === m.dcaOrderId)
          if (order?.type === DCAOrderTypeEnum.bo) {
            return {
              ...DealManager.closeDeal(
                d,
                b,
                DealManager.getTP(
                  d,
                  lastFilledSell?.price ?? lastFilledBuy?.price ?? b.close,
                )[0],
              ),
              closePrice:
                lastFilledSell?.price ?? lastFilledBuy?.price ?? b.close,
            }
          }
          if (order) {
            d = DealManager.updateDealUsage(d)
            d = DealManager.updateDealVolume(d)
            d.activeOrders.push({
              ...order,
              filledTime: undefined,
              id: botFunctions?.utils.id(20) ?? '',
            })
            d.ordersHistory = d.ordersHistory.map((o) =>
              o.minigridId === m.id && !o.filledTime
                ? { ...o, filledTime: b.time }
                : { ...o },
            )
            d.ordersHistory.push({
              ...order,
              startTime: b.time,
              filledTime: undefined,
              dealId: d.id,
            })
            d.ordersHistory = d.ordersHistory.filter((o) =>
              o.filledTime ? (d.finishedOrdersHistory.push(o), false) : true,
            )
          }
        }
      }
    }
    if (allOrders.length) {
      d.ordersHistory = d.ordersHistory.map((o) => {
        if (
          mIds.includes(o.minigridId ?? '') &&
          o.type === DCAOrderTypeEnum.grid &&
          !o.filledTime
        ) {
          if (
            !allOrders.find(
              (g) =>
                g.price === o.price && g.side === o.side && g.qty === o.qty,
            )
          ) {
            o.filledTime = b.time
          }
        }
        return o
      })
      d.ordersHistory = [
        ...d.ordersHistory,
        ...allOrders
          .filter(
            (g) =>
              !d.ordersHistory.find(
                (oh) =>
                  g.type === DCAOrderTypeEnum.grid &&
                  !oh.filledTime &&
                  g.price === oh.price &&
                  g.side === oh.side &&
                  g.qty === oh.qty,
              ),
          )
          .map((o) => ({ ...o, startTime: b.time, dealId: d.id })),
      ].filter((o) =>
        o.filledTime ? (d.finishedOrdersHistory.push(o), false) : true,
      )
    }
    d = DealManager.updateDeal(d, b, false, false)
    return { deal: d, closePrice: 0 }
  }

  static filterTP(d: Deal, b: FullBar): { deal: Deal; order?: FullGrid } {
    if (SharedData.combo) {
      return { deal: d }
    }
    const botFunctions = SharedData.botFunctions.get(b.symbol)
    const symbol = SharedData.symbols.get(b.symbol)
    if (!botFunctions || !symbol) {
      return { deal: d }
    }
    if (botFunctions.isTrailingTp) {
      return { deal: d }
    }
    const filledTp = d.activeOrders
      .filter((o) => o.type === DCAOrderTypeEnum.tp)
      .filter(SharedData.filterFn.filledTp(b))
    for (const tp of filledTp) {
      StrategyUtils.updatePositionWithOrder(tp, b.symbol)
    }
    if (
      SharedData.settings.useMultiTp &&
      SharedData.settings.multiTp &&
      SharedData.settings.multiTp.length &&
      filledTp.length
    ) {
      const lastTp = filledTp.sort((a, bb) =>
        SharedData.long ? bb.price - a.price : a.price - bb.price,
      )[0]
      d.filledOrders = [
        ...d.filledOrders,
        ...filledTp.map((ftp) => ({ ...ftp, filledTime: b.time })),
      ].map((o) => ({ ...o, dealId: d.id }))
      d.activeOrders = [
        ...d.activeOrders.filter(
          (ao) =>
            !filledTp.map((ftp) => ftp.id).includes(ao.id) &&
            ao.type &&
            ![DCAOrderTypeEnum.dca].includes(ao.type),
        ),
      ]
      for (const tp of filledTp) {
        if (
          tp.tpSlTarget &&
          !(d.tpSlTargetFilled ?? []).includes(tp.tpSlTarget)
        ) {
          d.tpSlTargetFilled = [...(d.tpSlTargetFilled ?? []), tp.tpSlTarget]
        }
      }

      const newTpOrders = DealManager.getTP(d)
      d.activeOrders = [
        ...d.activeOrders.filter(DealManager.filterTpOrders()),
        ...newTpOrders,
      ]
      d.ordersHistory = [
        ...d.ordersHistory.map((oh) => {
          if (oh.filledTime) {
            return oh
          }
          for (const ftp of filledTp) {
            if (ftp.price === oh.price && ftp.type === oh.type) {
              oh.filledTime = b.time
            }
          }
          return oh
        }),
      ]
      const filledBase = filledTp.reduce((acc, o) => acc + o.qty, 0)
      const filledQuote = filledTp.reduce((acc, o) => acc + o.qty * o.price, 0)
      d.currentBalance.base = SharedData.long
        ? d.currentBalance.base - filledBase
        : d.currentBalance.base + filledBase
      d.currentBalance.quote = SharedData.long
        ? d.currentBalance.quote + filledQuote
        : d.currentBalance.quote - filledQuote

      const allFilled = SharedData.long
        ? math.lte(
            d.currentBalance.base * d.avgPrice,
            symbol.quoteAsset.minAmount,
          ) && math.lte(d.currentBalance.base, symbol.baseAsset.minAmount)
        : math.lte(d.currentBalance.quote, symbol.quoteAsset.minAmount) &&
          math.lte(
            d.currentBalance.quote / d.avgPrice,
            symbol.baseAsset.minAmount,
          )

      return { deal: d, order: allFilled ? lastTp : undefined }
    }

    return { deal: d, order: filledTp[0] }
  }

  static checkCloseTimer(d: Deal, b: FullBar) {
    if (
      SharedData.settings.closeByTimer &&
      SharedData.settings.closeByTimerUnits &&
      SharedData.settings.useTp
    ) {
      const closeTime =
        d.startTime +
        (SharedData.settings.closeByTimerValue ?? 1) *
          (SharedData.settings.closeByTimerUnits === CooldownUnits.seconds
            ? 1000
            : SharedData.settings.closeByTimerUnits === CooldownUnits.minutes
              ? 60 * 1000
              : SharedData.settings.closeByTimerUnits === CooldownUnits.hours
                ? 60 * 60 * 1000
                : 24 * 60 * 60 * 1000)
      if (closeTime <= b.time) {
        const order = DealManager.getTP(d, b.open, true, false, closeTime)[0]
        StrategyUtils.updatePositionWithOrder(order, b.symbol)
        return order
      }
    }
    return
  }
  static checkValue(b: FullBar, d: Deal) {
    if (d.changed) {
      return d
    }
    const botFunctions = SharedData.botFunctions.get(d.symbol.pair)
    if (!botFunctions) {
      return d
    }
    if (botFunctions.isTrailingSl /* || botFunctions.isTrailingTp */) {
      return d
    }
    if (
      SharedData.settings.moveSL &&
      typeof SharedData.settings.moveSLTrigger !== 'undefined' &&
      typeof SharedData.settings.moveSLValue !== 'undefined' &&
      (SharedData.settings.dealCloseConditionSL === CloseConditionEnum.tp ||
        !d.moveSlActivated)
    ) {
      const trigger = +SharedData.settings.moveSLTrigger / 100
      const value = +SharedData.settings.moveSLValue / 100
      const last = SharedData.long ? b.low : b.high
      const { avgPrice } = d
      const diff = SharedData.long
        ? last - (avgPrice ?? last)
        : (avgPrice ?? last) - last
      const perc = diff / (avgPrice ?? 0)
      if (
        !isNaN(perc) &&
        isFinite(perc) &&
        perc - SharedData.userFee * 2 >= trigger
      ) {
        d.changed = true
        d.slPerc = value
        d.moveSlActivated = true
        const slOrder = DealManager.getSlHistoryLine(d, b.time)
        d = DealManager.replaceSlHistoryLine(d, slOrder, b.time)
      }
    }
    return d
  }
  static prepareDeals(deals: Deal[]): PreparedDeal[] {
    if (SharedData.fullResult) {
      return deals
    }
    return deals.map((d) => ({
      symbol: d.symbol,
      transactionsCount: d.transactionsCount,
      transactions: d.transactions.map((t) => ({
        _id: t._id,
        updateTime: t.updateTime,
        side: t.side,
        amountBaseBuy: t.amountBaseBuy,
        amountQuoteBuy: t.amountQuoteBuy,
        amountBaseSell: t.amountBaseSell,
        amountQuoteSell: t.amountQuoteSell,
        priceBuy: t.priceBuy,
        priceSell: t.priceSell,
        profit: t.profit,
        profitUsd: t.profitUsd,
        baseAsset: t.baseAsset,
        quoteAsset: t.quoteAsset,
        profitAsset: t.profitAsset,
        index: t.index,
      })),
      minigrids: d.minigrids.map((m) => ({
        id: m.id,
        status: m.status,
        initialPrice: m.initialPrice,
        lastPrice: m.lastPrice,
        profit: m.profit,
        avgPrice: m.avgPrice,
        createTime: m.createTime,
        updateTime: m.updateTime,
        closeTime: m.closeTime,
        transactions: m.transactions,
        settings: {
          profitCurrency: m.settings.profitCurrency,
        },
      })),
      id: d.id,
      filledOrders: d.filledOrders.map((o) => ({
        price: o.price,
        side: o.side,
        id: o.id,
        filledTime: o.filledTime,
        startTime: o.startTime,
        dealId: o.dealId,
      })),
      ordersHistory: [...d.ordersHistory, ...d.finishedOrdersHistory].map(
        (o) => ({
          price: o.price,
          side: o.side,
          id: o.id,
          filledTime: o.filledTime,
          startTime: o.startTime,
          dealId: o.dealId,
          avgLine: o.avgLine,
        }),
      ),
      status: d.status,
      startTime: d.startTime,
      closedTime: d.closedTime,
      profit: d.profit,
      usage: d.usage,
      levels: d.levels,
      duration: d.duration,
      splitDuration: d.splitDuration,
      number: d.number,
      avgPrice: d.avgPrice,
      startPrice: d.startPrice,
      liquidationPrice: d.liquidationPrice,
      closePrice: d.closePrice,
      volume: d.volume,
      equity: d.equity,
      equityInAsset: d.equityInAsset,
    }))
  }
}
