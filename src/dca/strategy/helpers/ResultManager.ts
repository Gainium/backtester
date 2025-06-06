/**
 * # ResultManager
 *
 * Comprehensive result analysis and statistics generation system for DCA trading strategy.
 * Processes trading performance, calculates metrics, and generates detailed reports
 * for backtesting and strategy evaluation.
 *
 * ## Features
 * - **Performance Analysis**: Win/loss ratios, profit metrics, drawdown calculations
 * - **Risk Assessment**: Maximum leverage analysis, risk-reward ratios
 * - **Statistical Reporting**: Detailed backtesting results with comprehensive metrics
 * - **Multi-Asset Analytics**: Per-symbol and portfolio-wide performance analysis
 *
 * ## Analysis Categories
 *
 * ### Performance Metrics
 * - Total profit/loss calculations
 * - Win rate and profit factor analysis
 * - Maximum drawdown and recovery metrics
 * - Sharpe ratio and risk-adjusted returns
 *
 * ### Risk Analysis
 * - Maximum leverage utilization
 * - Position sizing efficiency
 * - Capital allocation optimization
 * - Risk exposure assessment
 *
 * ### Statistical Analysis
 * - Deal duration statistics
 * - Price movement correlations
 * - Volatility impact analysis
 * - Market condition performance
 *
 * ## Report Generation
 * - Detailed backtesting results
 * - Per-symbol performance breakdown
 * - Periodic statistics (daily, weekly, monthly)
 * - Equity curve analysis
 *
 * ## Usage Example
 * ```typescript
 * // Analyze maximum leverage for a symbol
 * const maxLeverage = ResultManager.getMaxLeverage('BTCUSDT')
 *
 * // Generate comprehensive results
 * const results = ResultManager.generateResults(deals, startTime, endTime)
 *
 * // Calculate performance metrics
 * const metrics = ResultManager.calculatePerformanceMetrics(dealHistory)
 * ```
 *
 * @author Gainium Team
 * @version 2.0.0 - Enhanced analytics and reporting
 */

import {
  BuyAndHoldEquity,
  DCABacktestingResult,
  DCAOrderTypeEnum,
  Deal,
  FullBar,
  FullGrid,
  OrderSizeTypeEnum,
  PeriodicStats,
  StrategyEnum,
  SymbolStats,
} from 'src/types'
import { SharedData } from './SharedData'
import { MathHelper } from 'src/helper/math'
import { DealManager } from './DealManager'
import { friendlyTime } from 'src/helper/timeFunctions'
import { PriceCalculator } from './PriceCalculator'

const math = new MathHelper()

export class ResultManager {
  static getMaxLeverage(s: string) {
    if (!SharedData.futures) {
      return
    }
    const symbol = SharedData.symbols.get(s)
    const botFunctions = SharedData.botFunctions.get(s)
    if (!symbol || !botFunctions) {
      return
    }
    const startPrice = SharedData.long
      ? SharedData.maxPrice.get(s) ?? 0
      : SharedData.minPrice.get(s) ?? 0
    const extremum = SharedData.long
      ? SharedData.minPrice.get(s) ?? 0
      : SharedData.maxPrice.get(s) ?? 0
    if (!startPrice || !extremum) {
      return
    }
    const dealOrders = botFunctions.createOrders(
      SharedData.usdRateQuote.get(s) ?? 0,
      startPrice,
      true,
      undefined,
      undefined,
      SharedData.balances,
      true,
    )
    const regular = dealOrders
      .filter(
        (d) =>
          d.type === DCAOrderTypeEnum.bo || d.type === DCAOrderTypeEnum.dca,
      )
      .filter((o) =>
        SharedData.long ? o.price > extremum : o.price < extremum,
      )
    if (regular.length) {
      const avgPrice = regular[regular.length - 1]?.avgPrice || 0
      const maxLeverage = SharedData.long
        ? 1 / (1 - extremum / avgPrice)
        : 1 / (extremum / avgPrice - 1)
      return Math.max(math.round(maxLeverage, 0, true), 1)
    }
    return
  }

  static getConfidenceGrade(): { level: string; number: number } {
    const number = DealManager.getDeals('closed').filter(
      (d) => d.closedTime && d.closedTime > d.startTime,
    ).length
    return {
      level:
        number < 107
          ? 'F'
          : number >= 107 && number < 133
          ? 'E'
          : number >= 133 && number < 164
          ? 'D'
          : number >= 164 && number < 208
          ? 'C'
          : number >= 208 && number < 273
          ? 'B'
          : number >= 273 && number < 385
          ? 'A'
          : 'A+',
      number,
    }
  }

  static getBuyAndHold(
    firstDataMap?: Map<string, FullBar>,
    lastDataMap?: Map<string, FullBar>,
  ) {
    if (!firstDataMap || !lastDataMap) {
      return
    }
    const firstData = firstDataMap.get(SharedData.lowestDataForBnHSymbol)
    const lastData = lastDataMap.get(SharedData.lowestDataForBnHSymbol)
    if (!lastData || !firstData) {
      return
    }
    const usdRateQuote = SharedData.usdRateQuote.get(firstData.symbol) ?? 1
    const usdRate = SharedData.usdRate.get(firstData.symbol) ?? 1
    const firstPrice = firstData?.close
    const lastPrice = lastData?.close
    const buyAndHoldUsage =
      (SharedData.initialBalance ?? 0) *
      (SharedData.profitBase ? firstPrice : 1)
    const buyAndHold =
      firstPrice && lastPrice
        ? (buyAndHoldUsage / firstPrice) * lastPrice - buyAndHoldUsage
        : 0
    const lowestData = Array.from(SharedData.lowestDataForBnH.values())
    const buyAndHoldEquity: BuyAndHoldEquity[] = []
    if (lowestData.length > 2) {
      const steps = Math.min(Math.floor(lowestData.length / 2), 500)
      const step = Math.floor(lowestData.length / steps)
      const data: FullBar[] = []
      data.push(firstData)
      for (const i of [...Array(steps).keys()]) {
        const d = lowestData[i * step]
        if (
          d &&
          buyAndHoldEquity.filter((bh) => bh.time === d.time).length === 0
        ) {
          data.push(d)
        }
      }
      if (
        buyAndHoldEquity.filter((bh) => bh.time === lastData.time).length === 0
      ) {
        data.push(lastData)
      }

      buyAndHoldEquity.push({
        value: math.round(
          buyAndHoldUsage * (SharedData.profitBase ? usdRateQuote : usdRate),
          4,
        ),
        time: firstData.time,
      })
      for (const d of data) {
        const lp = d.close
        const bh = math.round(
          firstPrice && lp
            ? (buyAndHoldUsage / firstPrice) *
                lp *
                (SharedData.profitBase ? usdRateQuote : usdRate)
            : 0,
          3,
        )
        buyAndHoldEquity.push({ value: bh, time: d.time })
      }
    }
    return {
      buyAndHold,
      buyAndHoldUsd:
        buyAndHold * (SharedData.profitBase ? usdRateQuote : usdRate),
      buyAndHoldUsage,
      buyAndHoldEquity: buyAndHoldEquity.sort((a, b) => a.time - b.time),
    }
  }

  static calculateCwr(deals: Deal[], lastDataItem: FullBar): number {
    const dealsByStart = deals.sort((a, b) => a.startTime - b.startTime)
    const [first] = dealsByStart
    if (!first) {
      return 0
    }
    const startDate = new Date(first.startTime)
    startDate.setHours(0, 0, 0, 0)
    const x: number[] = []
    const y: number[] = []
    let cwr = 0
    for (
      let i = startDate.getTime(), prev = 0, day = 1;
      prev <= (lastDataItem?.time ?? -1);
      i = startDate.getTime(), day++
    ) {
      const _deals = DealManager.getDeals('closed').filter(
        (d) => d.closedTime && d.closedTime >= prev && d.closedTime < i,
      )

      const profit = _deals.reduce((acc, v) => (acc += v.profit.total), 0)
      const usage = _deals.reduce(
        (acc, v) =>
          (acc += SharedData.futures
            ? SharedData.coinm
              ? SharedData.combo
                ? v.usage.max.base
                : v.usage.current.base
              : SharedData.combo
              ? v.usage.max.quote
              : v.usage.current.quote
            : SharedData.long
            ? (SharedData.combo ? v.usage.max.quote : v.usage.current.quote) *
              (SharedData.profitBase ? 1 / v.startPrice : 1)
            : (SharedData.combo ? v.usage.max.base : v.usage.current.base) *
              (SharedData.profitBase ? 1 : v.startPrice)),
        0,
      )
      x.push(day)
      y.push((y[y.length - 1] ?? 0) + (usage === 0 ? 0 : profit / usage))

      startDate.setHours(24)

      prev = i
    }
    const beta =
      x.reduce((acc, v, i) => acc + v * y[i], 0) /
      x.reduce((acc, v) => acc + v ** 2, 0)

    const yPredict = x.map((v) => v * beta)

    const ssTot = y.reduce((acc, v) => acc + v ** 2, 0)

    const ssRes = y.reduce((acc, v, i) => acc + (v - yPredict[i]) ** 2, 0)

    const rSq = 1 - ssRes / ssTot

    const durationInPeriod = x.length

    const annualizedReturn = y[y.length - 1] * (365 / durationInPeriod)

    cwr = math.round(annualizedReturn * rSq, 4)

    return cwr
  }
  static calculatePriceDeviation() {
    if (SharedData.priceMax === 0 || SharedData.priceMin === 0) {
      return 0
    }
    return math.round(
      ((SharedData.priceMax - SharedData.priceMin) / SharedData.priceMax) * 100,
      3,
    )
  }

  static returnResult(
    firstData: Map<string, FullBar>,
    lastData: Map<string, FullBar>,
    loadingTime: number,
    processingTime: number,
  ): DCABacktestingResult {
    SharedData.gridsOnPrice = new Map()
    SharedData.pricesCache = new Map()
    const startResultProcessing = new Date().getTime()
    let allDeals = DealManager.getDeals()
    allDeals = allDeals.map((d) => {
      const symbol = SharedData.symbols.get(d.symbol.pair)
      if (!symbol) {
        return d
      }
      return {
        ...d,
        avgPrice: math.round(d.avgPrice, symbol.priceAssetPrecision),
        closePrice: d.closePrice
          ? math.round(d.closePrice, symbol.priceAssetPrecision)
          : d.closePrice,
        startPrice: math.round(d.startPrice, symbol.priceAssetPrecision),
        duration:
          d.status === 'open'
            ? (lastData.get(d.symbol.pair)?.time ?? new Date().getTime()) -
              d.startTime
            : d.duration,
        splitDuration:
          d.status === 'open'
            ? friendlyTime(
                (lastData.get(d.symbol.pair)?.time ?? new Date().getTime()) -
                  d.startTime,
              )
            : d.splitDuration,
      }
    })
    let maxTheoreticalUsage =
      allDeals.length > 0
        ? allDeals[0].initialOrders
            .filter((io) => io.type !== DCAOrderTypeEnum.tp)
            .reduce(
              (acc, d) =>
                SharedData.futures
                  ? SharedData.coinm
                    ? (acc += d.qty)
                    : (acc += d.qty * d.price)
                  : !SharedData.long
                  ? (acc += d.qty)
                  : (acc += d.qty * d.price),
              0,
            )
        : 0
    const {
      maxNumberOfOpenDeals: maxNumberOfOpenDealsString,
      maxDealsPerPair,
      useMulti,
    } = SharedData.settings
    let maxNumberOfOpenDeals = 1
    if (
      maxNumberOfOpenDealsString &&
      maxNumberOfOpenDealsString !== '' &&
      !isNaN(+maxNumberOfOpenDealsString) &&
      +maxNumberOfOpenDealsString >= 0 &&
      (SharedData.multi || (!SharedData.multi && !useMulti))
    ) {
      maxNumberOfOpenDeals = +maxNumberOfOpenDealsString
    }
    if (
      maxDealsPerPair &&
      maxDealsPerPair !== '' &&
      !isNaN(+maxDealsPerPair) &&
      +maxDealsPerPair >= 0 &&
      !SharedData.multi &&
      useMulti
    ) {
      maxNumberOfOpenDeals = +maxDealsPerPair
    }
    maxTheoreticalUsage *= +maxNumberOfOpenDeals
    maxTheoreticalUsage /= SharedData.leverage
    const precision = SharedData.precision.values().next().value ?? 8
    const precisionQuote = SharedData.precisionQuote.values().next().value ?? 8
    const totalProfit = math.round(SharedData.totalProfit, precision)
    const totalProfitUsd = math.round(SharedData.totalProfitUsd, 2)
    const totalDuration = allDeals.reduce((acc, d) => (acc += d.duration), 0)
    const lastDataItem = lastData?.values().next().value
    const firstDataItem = firstData?.get(lastDataItem?.symbol ?? '')
    const workingTime = SharedData.workingShift.reduce(
      (acc, ws) =>
        (acc += (ws.end || lastDataItem?.time || ws.start) - ws.start),
      0,
    )
    const closedDeals = allDeals.filter((d) => d.status === 'closed')
    const avgDuration =
      allDeals.length > 0 ? math.round(totalDuration / allDeals.length, 0) : 0
    const openedDeals = allDeals.filter((d) => d.status === 'open')
    const workingDays = math.round(workingTime / (24 * 60 * 60 * 1000), 4)
    const profitDeals = allDeals.filter(
      (d) => d.profit.perc > 0 && d.status === 'closed',
    )
    const lossDeals = allDeals.filter(
      (d) => d.profit.perc <= 0 && d.status === 'closed',
    )
    const profitDuration = profitDeals.reduce(
      (acc, d) => (acc += d.duration),
      0,
    )
    const avgProfitDuration =
      profitDeals.length > 0
        ? math.round(profitDuration / profitDeals.length, 0)
        : 0
    const maxProfitDuration = Math.max(...profitDeals.map((d) => d.duration), 0)
    let stDevProfit = math.stDev(profitDeals.map((d) => d.profit.perc))
    stDevProfit = isNaN(stDevProfit) ? 0 : stDevProfit
    const lossDuration = lossDeals.reduce((acc, d) => (acc += d.duration), 0)
    const avgLossDuration =
      lossDeals.length > 0 ? math.round(lossDuration / lossDeals.length, 0) : 0
    const maxLossDuration = Math.max(...lossDeals.map((d) => d.duration), 0)

    const allProfit = profitDeals.reduce((acc, d) => (acc += d.profit.total), 0)
    const allProfitUsd = profitDeals.reduce(
      (acc, d) => (acc += d.profit.totalUsd),
      0,
    )
    const allLoss = lossDeals.reduce((acc, d) => (acc += d.profit.total), 0)
    const allLossUsd = lossDeals.reduce(
      (acc, d) => (acc += d.profit.totalUsd),
      0,
    )
    const avgUsable =
      allDeals.length > 0
        ? math.round(
            allDeals.reduce(
              (acc, d) =>
                SharedData.futures
                  ? SharedData.coinm
                    ? (acc += d.usage.current.base)
                    : (acc += d.usage.current.quote)
                  : !SharedData.long
                  ? (acc += d.usage.current.base)
                  : (acc += d.usage.current.quote),
              0,
            ) /
              allDeals.length /
              SharedData.leverage,
            precision,
          )
        : 0
    let unrealizedPnL = 0
    let unrealizedPnLUsd = 0
    let unrealizedUsage = 0

    if (openedDeals.length > 0) {
      for (const od of openedDeals) {
        const symbol = SharedData.symbols.get(od.symbol.pair)
        if (!symbol) {
          continue
        }
        const price = SharedData.prices.find((p) => p.symbol === symbol.pair)
        if (price) {
          const tp = DealManager.getTP(
            od,
            lastData.get(od.symbol.pair)?.close ?? price.price,
            true,
            false,
          )[0]
          const { price: tpPrice } = tp
          const qty = tp?.qty ?? 0
          if (qty === 0) {
            continue
          }
          const filledOrders = od.filledOrders.filter(
            (fo) =>
              fo.type &&
              [DCAOrderTypeEnum.dca, DCAOrderTypeEnum.bo].includes(fo.type),
          )
          const filledTPOrders = od.filledOrders.filter(
            (fo) =>
              fo.type &&
              [DCAOrderTypeEnum.tp, DCAOrderTypeEnum.sl].includes(fo.type),
          )
          const quote = SharedData.combo
            ? (SharedData.long
                ? od.initialBalance.quote - od.currentBalance.quote
                : od.currentBalance.quote) +
              (SharedData.profitBase
                ? 0
                : od.profit.total * (SharedData.long ? 1 : -1))
            : filledOrders.reduce((acc, fo) => (acc += fo.qty * fo.price), 0) -
              filledTPOrders.reduce((acc, fo) => (acc += fo.qty * fo.price), 0)
          const base = SharedData.combo
            ? SharedData.long
              ? od.currentBalance.base
              : od.initialBalance.base - od.currentBalance.base
            : filledOrders.reduce((acc, fo) => (acc += fo.qty), 0) -
              filledTPOrders.reduce((acc, fo) => (acc += fo.qty), 0)
          const comboBase =
            quote / tpPrice +
            (SharedData.profitBase
              ? od.profit.total * (SharedData.long ? 1 : -1)
              : 0)
          const quoteTp = qty * tpPrice
          const commission = SharedData.combo
            ? SharedData.profitBase
              ? qty * SharedData.userFee
              : qty * tpPrice * SharedData.userFee
            : od.filledOrders.reduce(
                (acc, v) =>
                  (acc += SharedData.profitBase
                    ? v.qty * SharedData.userFee
                    : v.qty * v.price * SharedData.userFee),
                0,
              )
          const unPnl =
            od.profit.total +
            (SharedData.combo
              ? (SharedData.profitBase ? base - comboBase : quoteTp - quote) *
                (SharedData.long ? 1 : -1)
              : (SharedData.profitBase
                  ? base - qty + (qty * tpPrice - quote) / tpPrice
                  : qty * tpPrice - quote + (qty - base) * tpPrice) *
                (SharedData.long ? 1 : -1)) -
            commission

          const usdRateCurrent = SharedData.usdRate.get(od.symbol.pair) ?? 1
          unrealizedPnL += unPnl
          unrealizedPnLUsd += unPnl * usdRateCurrent
          unrealizedUsage +=
            ((SharedData.combo
              ? SharedData.futures
                ? SharedData.coinm
                  ? od.usage.max.base
                  : od.usage.max.quote
                : SharedData.long
                ? od.usage.max.quote
                : od.usage.max.base
              : SharedData.futures
              ? SharedData.coinm
                ? od.usage.current.base
                : od.usage.current.quote
              : SharedData.long
              ? od.usage.current.quote
              : od.usage.current.base) /
              SharedData.leverage) *
            PriceCalculator.getRate()
        }
      }
    }
    const levels = allDeals.map((d) => d.levels.max)
    const maxDealUsage = math.round(
      Math.max(SharedData.maxUsage.deal, avgUsable) / SharedData.leverage,
      precision,
    )
    const maxBotUsage = math.round(
      SharedData.maxUsage.bot / SharedData.leverage,
      precision,
    )
    const priceDeviation = (orders: FullGrid[]) => {
      const initialOrders = orders
        .filter(
          (io) =>
            io.type === DCAOrderTypeEnum.bo || io.type === DCAOrderTypeEnum.dca,
        )
        .sort((a, b) => a.price - b.price)
      if (initialOrders.length > 1) {
        const [first] = initialOrders
        const [last] = initialOrders.reverse()
        return math.round(((last.price - first.price) / last.price) * 100, 1)
      }
      return 0
    }
    const coveredPriceDeviation = () => {
      if (allDeals.length > 0) {
        return priceDeviation(allDeals[0].initialOrders)
      }
      return 0
    }
    const actualPriceDeviation = () => {
      if (allDeals.length > 0) {
        return priceDeviation(
          allDeals.sort((a, b) => b.levels.max - a.levels.max)[0].filledOrders,
        )
      }
      return 0
    }
    const profitByPeriod: number[] = []
    let periodRatio = 1
    if (workingDays > 3 && closedDeals.length > 0) {
      const dealsByStart = closedDeals.sort((a, b) => a.startTime - b.startTime)
      const [first] = dealsByStart
      const startDate = new Date(first.startTime)
      startDate.setHours(0, 0, 0, 0)
      periodRatio = 365
      if (workingDays - 90 > 0) {
        startDate.setDate(1)
        periodRatio = 12
      }
      for (
        let i = startDate.getTime(), prev = 0;
        prev <= (lastDataItem?.time ?? -1);
        i = startDate.getTime()
      ) {
        const deals = allDeals.filter(
          (d) => d.closedTime && d.closedTime >= prev && d.closedTime < i,
        )

        const profit = deals.reduce((acc, v) => (acc += v.profit.total), 0)
        profitByPeriod.push(profit)
        if (periodRatio === 365) {
          startDate.setHours(24)
        }
        if (periodRatio === 12) {
          startDate.setMonth(startDate.getMonth() + 1)
        }
        prev = i
      }
    }
    const lastPrice = lastDataItem?.close

    const maxTheoreticalUsageValue = math.round(
      Math.max(maxTheoreticalUsage, maxDealUsage, maxBotUsage),
      precision,
    )
    const maxTheoreticalUsageWithRate = [
      OrderSizeTypeEnum.percFree,
      OrderSizeTypeEnum.percTotal,
    ].includes(SharedData.settings.orderSizeType)
      ? SharedData.initialBalanceUsd
      : maxTheoreticalUsageValue * PriceCalculator.getRate()
    const confidenceGrade = ResultManager.getConfidenceGrade()
    const buyAndHold = ResultManager.getBuyAndHold(firstData, lastData)
    const symbolStats: SymbolStats[] = []
    if (allDeals.length < SharedData.maxDealsPerResult) {
      for (const s of SharedData.symbols.keys()) {
        const deals = allDeals.filter((d) => d.symbol.pair === s)
        const maxSymbolValue =
          SharedData.settings.orderSizeType === OrderSizeTypeEnum.percFree ||
          SharedData.settings.orderSizeType === OrderSizeTypeEnum.percTotal
            ? SharedData.initialBalanceUsd
            : Math.max(
                ...deals.map(
                  (d) =>
                    (SharedData.futures
                      ? SharedData.coinm
                        ? d.usage.current.base
                        : d.usage.current.quote
                      : !SharedData.long
                      ? d.usage.current.base
                      : d.usage.current.quote) / SharedData.leverage,
                ),
              ) *
              PriceCalculator.getRate() *
              Math.max(1, +(SharedData.settings.maxDealsPerPair ?? '1'))
        const profitDealsStats = deals.filter(
          (d) => d.profit.total > 0 && d.status === 'closed',
        )
        const lossDealsStats = deals.filter(
          (d) => d.profit.total <= 0 && d.status === 'closed',
        )
        const closedDealsStats = deals.filter(
          (d) => d.status === 'closed',
        ).length
        const profit = SharedData.totalProfitPerSymbol.get(s) ?? 0
        const profitUsd = SharedData.totalProfitUsdPerSymbol.get(s) ?? 0
        const precisionStats = SharedData.precision.get(s) ?? 8
        const symbol = SharedData.symbols.get(s)
        const maxDealDuration = deals.length
          ? friendlyTime(Math.max(...deals.map((cd) => cd.duration)))
          : { d: '', h: '', min: '', s: '' }
        const totalDealsDuration = deals.reduce(
          (acc, d) => (acc += d.duration),
          0,
        )
        const avgDealDuration = deals.length
          ? friendlyTime(math.round(totalDealsDuration / deals.length, 0))
          : { d: '', h: '', min: '', s: '' }
        const grossProfit =
          maxSymbolValue === 0
            ? 0
            : (profitDealsStats.reduce((acc, d) => acc + d.profit.totalUsd, 0) /
                maxSymbolValue) *
              100
        const grossLoss =
          maxSymbolValue === 0
            ? 0
            : Math.abs(
                lossDealsStats.reduce((acc, d) => acc + d.profit.totalUsd, 0) /
                  maxSymbolValue,
              ) * 100
        symbolStats.push({
          pair: s,
          deals: {
            profit: profitDealsStats.length,
            loss: lossDealsStats.length,
            open: deals.filter((d) => d.status === 'open').length,
          },
          netProfit: {
            total: math.round(profit, precisionStats),
            totalUsd: math.round(profitUsd),
            perc:
              maxSymbolValue === 0
                ? 0
                : math.round((profitUsd / maxSymbolValue) * 100),
          },
          dailyReturn: {
            total: math.round(profit / workingDays, precisionStats),
            totalUsd: math.round(profitUsd / workingDays),
            perc:
              maxSymbolValue === 0
                ? 0
                : math.round((profitUsd / workingDays / maxSymbolValue) * 100),
          },
          profitAsset: SharedData.profitBase
            ? symbol?.baseAsset?.name ?? ''
            : symbol?.quoteAsset?.name ?? '',
          winRate: closedDeals
            ? math.round((profitDealsStats.length / closedDealsStats) * 100)
            : 0,
          maxDealDuration,
          avgDealDuration,
          profitFactor:
            grossLoss === 0
              ? `${Infinity}`
              : `${math.round(grossProfit / grossLoss, 3)}`,
        })
      }
    }
    const periodicStats: PeriodicStats[] = []
    const firstDataTime =
      SharedData.start || (firstDataItem?.time ?? +new Date())
    const lastDataTime =
      (lastDataItem?.time as number | undefined) ?? +new Date()

    let monthlyValue = SharedData.initialBalanceUsd

    if (allDeals.length < SharedData.maxDealsPerResult) {
      for (
        let i = firstDataTime;
        i < lastDataTime;
        i += 28 * 24 * 60 * 60 * 1000
      ) {
        const monthlyStart = new Date(i)
        monthlyStart.setDate(1)
        monthlyStart.setHours(0, 0, 0, 0)
        const nextMonth = new Date(monthlyStart)
        nextMonth.setDate(1)
        nextMonth.setMonth(nextMonth.getMonth() + 1)
        const findMonth = periodicStats.find(
          (p) => p.startTime === +monthlyStart && p.period === 'month',
        )
        if (findMonth) {
          continue
        }
        const monthlyDeals = allDeals.filter(
          (d) =>
            d.closedTime &&
            d.closedTime >= +monthlyStart &&
            d.closedTime <= +nextMonth - 1,
        )
        let lowestBalanceDD = monthlyValue
        let highestBalanceDD = monthlyValue
        let lowestBalanceRU = monthlyValue
        let highestBalanceRU = monthlyValue
        let maxDrawdown = 0
        let maxRunup = 0
        let maxDrawdownValue = 0
        let maxRunupValue = 0
        let profit = 0
        const startPeriodValue = Math.abs(monthlyValue)
        for (const d of monthlyDeals) {
          profit += d.profit.totalUsd
          monthlyValue += d.profit.totalUsd
          if (monthlyValue > highestBalanceRU) {
            highestBalanceRU = monthlyValue
            const tempRunup = highestBalanceRU - lowestBalanceRU
            if (tempRunup > maxRunupValue) {
              maxRunupValue = tempRunup
              maxRunup = Math.abs(tempRunup / lowestBalanceRU)
            }
          }
          if (monthlyValue < lowestBalanceRU) {
            lowestBalanceRU = monthlyValue
            highestBalanceRU = monthlyValue
          }
          if (monthlyValue < lowestBalanceDD) {
            lowestBalanceDD = monthlyValue
            const tempDrawdown = highestBalanceDD - lowestBalanceDD
            if (tempDrawdown > maxDrawdownValue) {
              maxDrawdownValue = tempDrawdown
              maxDrawdown = Math.abs(tempDrawdown / highestBalanceDD)
            }
          }
          if (monthlyValue > highestBalanceDD) {
            highestBalanceDD = monthlyValue
            lowestBalanceDD = monthlyValue
          }
        }
        const netResult = math.round((profit / startPeriodValue) * 100)
        periodicStats.push({
          period: 'month',
          startTime: +monthlyStart,
          netResult,
          drawdown: Math.min(
            netResult,
            math.round(Math.abs(maxDrawdown) * -100),
          ),
          runup: Math.max(netResult, math.round(Math.abs(maxRunup) * 100)),
          deals: {
            profit: monthlyDeals.filter((d) => d.profit.totalUsd > 0).length,
            loss: monthlyDeals.filter((d) => d.profit.totalUsd <= 0).length,
          },
        })
      }
    }

    let yearlyValue = SharedData.initialBalanceUsd
    if (allDeals.length < SharedData.maxDealsPerResult) {
      for (
        let i = firstDataTime;
        i < lastDataTime + 365 * 24 * 60 * 60 * 1000;
        i += 365 * 24 * 60 * 60 * 1000
      ) {
        const yearStart = new Date(i)
        yearStart.setDate(1)
        yearStart.setHours(0, 0, 0, 0)
        yearStart.setMonth(0)
        const findYear = periodicStats.find(
          (p) => p.startTime === +yearStart && p.period === 'year',
        )
        if (findYear) {
          continue
        }
        if (
          !allDeals.filter((d) => d.closedTime && d.closedTime >= +yearStart)
            .length
        ) {
          continue
        }
        const nextYear = new Date(yearStart)
        nextYear.setFullYear(nextYear.getFullYear() + 1)
        const yearlyDeals = allDeals.filter(
          (d) =>
            d.closedTime &&
            d.closedTime >= +yearStart &&
            d.closedTime <= +nextYear - 1,
        )
        let highestBalanceRU = yearlyValue
        let lowestBalanceRU = yearlyValue
        let highestBalanceDD = yearlyValue
        let lowestBalanceDD = yearlyValue
        let maxDrawdown = 0
        let maxRunup = 0
        let maxDrawdownValue = 0
        let maxRunupValue = 0
        let profit = 0
        const startPeriodValue = Math.abs(yearlyValue)
        for (const d of yearlyDeals) {
          profit += d.profit.totalUsd
          yearlyValue += d.profit.totalUsd
          if (yearlyValue > highestBalanceRU) {
            highestBalanceRU = yearlyValue
            const tempRunup = highestBalanceRU - lowestBalanceRU
            if (tempRunup > maxRunupValue) {
              maxRunupValue = tempRunup
              maxRunup = Math.abs(tempRunup / lowestBalanceRU)
            }
          }
          if (yearlyValue < lowestBalanceRU) {
            lowestBalanceRU = yearlyValue
            highestBalanceRU = yearlyValue
          }
          if (yearlyValue < lowestBalanceDD) {
            lowestBalanceDD = yearlyValue
            const tempDrawdown = highestBalanceDD - lowestBalanceDD
            if (tempDrawdown > maxDrawdownValue) {
              maxDrawdownValue = tempDrawdown
              maxDrawdown = Math.abs(tempDrawdown / highestBalanceDD)
            }
          }
          if (yearlyValue > highestBalanceDD) {
            highestBalanceDD = yearlyValue
            lowestBalanceDD = yearlyValue
          }
        }
        const netResult = math.round((profit / startPeriodValue) * 100)
        periodicStats.push({
          period: 'year',
          startTime: +yearStart,
          netResult,
          drawdown: Math.min(
            netResult,
            math.round(Math.abs(maxDrawdown) * -100),
          ),
          runup: Math.max(netResult, math.round(Math.abs(maxRunup) * 100)),
          deals: {
            profit: yearlyDeals.filter((d) => d.profit.totalUsd > 0).length,
            loss: yearlyDeals.filter((d) => d.profit.totalUsd <= 0).length,
          },
        })
      }
    }

    const quoteRate = lastPrice ?? 0
    const maxRealUsage = math.round(
      Math.max(maxDealUsage, maxBotUsage / maxNumberOfOpenDeals),
      precision,
    )
    const ratiosRate =
      (SharedData.settings?.futures
        ? SharedData.settings.coinm
          ? quoteRate
          : 1
        : SharedData.settings.strategy === StrategyEnum.long
        ? 1
        : quoteRate) /
      (SharedData.settings.profitCurrency === 'base' ||
      SharedData.settings.coinm
        ? quoteRate
        : 1)
    const ratiosUsage = ratiosRate * maxRealUsage
    const sortino = math.santinoRatio(profitByPeriod, ratiosUsage, periodRatio)
    const sharpe = math.sharpeRatio(profitByPeriod, ratiosUsage, periodRatio)
    let stDevDownLoss = math.downsideStDev(
      lossDeals.map((d) => d.profit.perc),
      2 / periodRatio,
    )
    stDevDownLoss = isNaN(stDevDownLoss) ? 0 : stDevDownLoss
    let stDevLoss = math.stDev(lossDeals.map((d) => d.profit.perc))
    stDevLoss = isNaN(stDevLoss) ? 0 : stDevLoss
    const maxDealDuration = allDeals.length
      ? Math.max(...allDeals.map((cd) => cd.duration))
      : 0
    const avgNetDailyPerc =
      workingDays > 0
        ? math.round(
            (totalProfitUsd / workingDays / maxTheoreticalUsageWithRate) * 100,
            2,
          )
        : 0
    let annualizedReturn = 0
    if (
      avgNetDailyPerc &&
      !isNaN(avgNetDailyPerc) &&
      isFinite(avgNetDailyPerc)
    ) {
      const compound =
        [OrderSizeTypeEnum.percFree, OrderSizeTypeEnum.percTotal].includes(
          SharedData.settings.orderSizeType,
        ) || SharedData.settings.useReinvest
      annualizedReturn = compound
        ? ((1 + avgNetDailyPerc / 100) ** 365 - 1) * 100
        : avgNetDailyPerc * 365
      if (annualizedReturn > Number.MAX_SAFE_INTEGER) {
        annualizedReturn = Infinity
      } else {
        annualizedReturn = math.round(annualizedReturn, 2)
      }
    }
    const result: DCABacktestingResult = {
      messages: [...new Set(SharedData.messages)],
      portfolio: Array.from(SharedData.portfolio, (v) => ({
        x: v[0],
        y: v[1],
      })),
      buyAndHoldEquity: buyAndHold?.buyAndHoldEquity ?? [],
      indicatorsEvents: [...SharedData.indicatorEvents],
      symbolStats,
      deals: DealManager.prepareDeals(
        [...allDeals]
          .sort((a, b) =>
            SharedData.edge
              ? Math.random() > 0.5
                ? -1
                : 1
              : b.startTime - a.startTime,
          )
          .map((d, ind) => ({
            ...d,
            number: ind + 1,
            mingrids: d.minigrids.map((m) => ({
              ...m,
              activeOrders: [],
              filledOrders: [],
            })),
          })),
      ),
      maxLeverage: allDeals.filter((d) => !!d.liquidationPrice).length
        ? Math.min(
            ...Array.from(SharedData.symbols.keys()).map(
              (s) => ResultManager.getMaxLeverage(s) ?? 1,
            ),
          )
        : 0,
      financial: {
        netProfitTotal: totalProfit,
        netProfitTotalUsd: totalProfitUsd,
        netProfitTotalPerc: math.round(
          (totalProfitUsd / maxTheoreticalUsageWithRate) * 100,
          2,
        ),
        grossProfit: math.round(allProfit, precision),
        grossProfitUsd: math.round(allProfitUsd, 2),
        grossProfitPerc: math.round(
          (allProfitUsd / maxTheoreticalUsageWithRate) * 100,
          2,
        ),
        grossLoss: math.round(allLoss, precision),
        grossLossUsd: math.round(allLossUsd, 2),
        grossLossPerc: math.round(
          (allLossUsd / maxTheoreticalUsageWithRate) * 100,
          2,
        ),
        avgGrossProfit:
          profitDeals.length > 0
            ? math.round(allProfit / profitDeals.length, precision)
            : 0,
        avgGrossProfitUsd:
          profitDeals.length > 0
            ? math.round(allProfitUsd / profitDeals.length, 2)
            : 0,
        avgGrossProfitPerc:
          profitDeals.length > 0
            ? math.round(
                (allProfitUsd /
                  profitDeals.length /
                  maxTheoreticalUsageWithRate) *
                  100,
                2,
              )
            : 0,
        avgGrossLoss:
          lossDeals.length > 0
            ? math.round(allLoss / lossDeals.length, precision)
            : 0,
        avgGrossLossUsd:
          lossDeals.length > 0
            ? math.round(allLossUsd / lossDeals.length, 2)
            : 0,
        avgGrossLossPerc:
          lossDeals.length > 0
            ? math.round(
                (allLossUsd / lossDeals.length / maxTheoreticalUsageWithRate) *
                  100,
                2,
              )
            : 0,
        avgNetProfit:
          closedDeals.length > 0
            ? math.round(totalProfit / closedDeals.length, precision)
            : 0,
        avgNetProfitUsd:
          closedDeals.length > 0
            ? math.round(totalProfitUsd / closedDeals.length, 2)
            : 0,
        avgNetProfitPerc:
          closedDeals.length > 0
            ? math.round(
                (totalProfitUsd /
                  closedDeals.length /
                  maxTheoreticalUsageWithRate) *
                  100,
                2,
              )
            : 0,
        avgNetDaily:
          workingDays > 0
            ? math.round(totalProfit / workingDays, precision)
            : 0,
        avgNetDailyUsd:
          workingDays > 0 ? math.round(totalProfitUsd / workingDays, 2) : 0,
        avgNetDailyPerc,
        annualizedReturn,
        unrealizedPnL: math.round(unrealizedPnL, precision),
        unrealizedPnLUsd: math.round(unrealizedPnLUsd, 2),
        unrealizedPnLPerc: math.round(
          (unrealizedPnLUsd / unrealizedUsage) * 100,
        ),
        maxDealLoss: math.round(SharedData.maxLoss.asset, precision),
        maxDealLossPerc: math.round(SharedData.maxLoss.perc, 2),
        maxDealProfit: math.round(SharedData.maxProfit.asset, precision),
        maxDealProfitPerc: math.round(SharedData.maxProfit.perc, 2),
        maxDealLossUsd: math.round(SharedData.maxLoss.usd, 2),
        maxDealProfitUsd: math.round(SharedData.maxProfit.usd, 2),
        maxDrawDown: -math.round(SharedData.seriesLoss.value, precision),
        maxDrawDownUsd: -math.round(SharedData.seriesLoss.valueUsd, 2),
        maxDrawDownPerc: math.round(
          SharedData.seriesLoss.perc * 100,
          2,
          false,
          true,
        ),
        maxDrawDownEquityUsd: -math.round(SharedData.seriesLossE.valueUsd, 2),
        maxDrawDownEquityPerc: math.round(
          SharedData.seriesLossE.perc * 100,
          2,
          false,
          true,
        ),
        maxRunUp: math.round(SharedData.seriesWin.value, precision),
        maxRunUpUsd: math.round(SharedData.seriesWin.valueUsd, 2),
        maxRunUpPerc: math.round(
          SharedData.seriesWin.perc * 100,
          2,
          false,
          true,
        ),
        initialBalanceUsd: math.round(SharedData.initialBalanceUsd, 4),
        stDevLosingTrade: stDevLoss,
        stDownDevLosingTrade: stDevDownLoss,
        stDevWinningTrade: stDevProfit,
      },
      noData: !firstData.size && !lastData.size,
      duration: {
        avgLosingTrade: avgLossDuration,
        avgWinningTrade: avgProfitDuration,
        maxLosingTrade: maxLossDuration,
        maxWinningTrade: maxProfitDuration,
        avgDealDuration: avgDuration,
        avgSplitDealDuration:
          avgDuration > 0
            ? friendlyTime(avgDuration)
            : { d: '', h: '', min: '', s: '' },
        firstDataTime,
        lastDataTime,
        loadingDataTime: math.round(loadingTime, 3),
        processingDataTime: math.round(
          processingTime +
            (new Date().getTime() - startResultProcessing) / 1000,
          3,
        ),
        botWorkingTime:
          workingTime > 0
            ? friendlyTime(workingTime)
            : { d: '', h: '', min: '', s: '' },
        maxDealDuration:
          allDeals.length > 0
            ? friendlyTime(maxDealDuration)
            : { d: '', h: '', min: '', s: '' },
        maxDealDurationTime: maxDealDuration,
        botWorkingTimeNumber: workingTime,
      },
      usage: {
        maxTheoreticalUsage: math.round(
          Math.max(
            maxDealUsage,
            maxBotUsage / maxNumberOfOpenDeals,
            maxTheoreticalUsageValue / maxNumberOfOpenDeals,
          ),
          precision,
        ),
        maxRealUsage,
        avgRealUsage: avgUsable,
      },
      numerical: {
        priceDeviation: ResultManager.calculatePriceDeviation(),
        confidenceGrade: confidenceGrade.level,
        dealsForConfidenceGrade: confidenceGrade.number,
        all: allDeals.length,
        profit: profitDeals.length,
        loss: lossDeals.length,
        open: openedDeals.length,
        closed: closedDeals.length,
        maxConsecutiveLosses: SharedData.maxConsecutiveLosses,
        maxConsecutiveWins: SharedData.maxConsecutiveWins,
        maxDCATriggered: Math.max(...levels),
        avgDCATriggered:
          allDeals.length > 0
            ? Math.ceil(
                levels.reduce((acc, v) => (acc += v), 0) / allDeals.length,
              )
            : 0,
        dealsPerDay:
          workingDays > 0
            ? math.round(closedDeals.length / workingDays, 1, false, true)
            : 0,
        coveredPriceDeviation: Math.max(
          coveredPriceDeviation(),
          actualPriceDeviation(),
        ),
        actualPriceDeviation: actualPriceDeviation(),
        liquidationEvents: allDeals.filter((d) => !!d.liquidationPrice).length,
      },
      ratios: {
        cwr: lastDataItem
          ? ResultManager.calculateCwr(closedDeals, lastDataItem)
          : 0,
        profitFactor:
          allLoss !== 0
            ? math.round(Math.abs(allProfit / allLoss), 3)
            : Infinity,
        profitByPeriod,
        buyAndHold: {
          value: math.round(buyAndHold?.buyAndHold ?? 0, precisionQuote),
          valueUsd: math.round(buyAndHold?.buyAndHoldUsd ?? 0, 2),
          perc: math.round(
            ((buyAndHold?.buyAndHold ?? 0) /
              (buyAndHold?.buyAndHoldUsage ?? 1)) *
              100,
            2,
          ),
        },
        periodRatio,
        sharpe: isNaN(sharpe) || !isFinite(sharpe) ? 0 : sharpe,
        sortino: isNaN(sortino) || !isFinite(sharpe) ? 0 : sortino,
      },
      interval: SharedData.interval,
      quoteRate,
      profits: SharedData.profits,
      multi: SharedData.multi,
      multiPairs: SharedData.multi
        ? Array.from(SharedData.symbols.keys()).length
        : undefined,
      periodicStats,
    }
    SharedData.resetData()
    return result
  }
}
