/**
 * Grid Strategy Result Manager
 *
 * Handles the compilation and calculation of comprehensive backtesting results
 * for the grid trading strategy. Generates detailed performance metrics,
 * transaction analysis, and risk statistics.
 *
 * Key Responsibilities:
 * - Transaction processing and analysis
 * - Performance metric calculations (returns, Sharpe ratio, drawdown, etc.)
 * - Buy-and-hold comparison analysis
 * - Risk and volatility calculations
 * - Comprehensive result report generation
 *
 * Performance Considerations:
 * - Processes large transaction arrays efficiently
 * - Caches calculations where possible
 * - Optimized for both full and summary result modes
 *
 * @fileoverview Comprehensive result calculation and analysis for grid strategy
 */

import { MathHelper } from '../../../helper/math'
import {
  BacktestingTransaction,
  Bar,
  BotOrderSideEnum,
  BuyAndHoldEquity,
  ExchangeIntervals,
  GridBacktestingResult,
  PositionSide,
  PreparedTransaction,
} from '../../../types'
import { SharedData } from './SharedData'
import { PriceCalculator } from './PriceCalculator'
import { TradeManager } from './TradeManager'
import { friendlyTime } from '../../../helper/timeFunctions'

const math = new MathHelper()

/**
 * Comprehensive result calculation and analysis manager
 *
 * Processes trading data and generates detailed backtesting results including
 * performance metrics, risk analysis, and comparative statistics.
 */
export class ResultManager {
  /**
   * Prepare transaction data for result analysis
   *
   * Processes raw transaction data and prepares it for analysis, optionally
   * filtering to essential fields for performance when full results aren't needed.
   *
   * @param transaction Array of raw backtesting transactions
   * @returns Array of prepared transactions for analysis
   */
  static prepareTransactions(
    transaction: BacktestingTransaction[],
  ): PreparedTransaction[] {
    if (SharedData.fullResult) {
      return transaction
    }
    // Return minimal transaction data for performance
    return transaction.map((t) => ({
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
    }))
  }
  static getBuyAndHold(firstData: Bar, lastData: Bar) {
    const firstPrice = firstData?.close
    const lastPrice = lastData?.close
    const buyAndHoldUsage = +SharedData.settings.budget
    const buyAndHoldUsageEquity =
      +SharedData.settings.budget *
      (SharedData.profitBase && !SharedData.coinm ? 1 / firstPrice : 1)
    const buyAndHold =
      firstPrice && lastPrice
        ? (buyAndHoldUsage / firstPrice) * lastPrice - buyAndHoldUsage
        : 0
    const buyAndHoldEquity: BuyAndHoldEquity[] = []
    const lowestData = SharedData.data
    if (lowestData.length > 2) {
      const data: Bar[] = []
      const steps = Math.min(Math.floor(lowestData.length / 2), 500)
      const step = Math.floor(lowestData.length / steps)
      for (const i of [...Array(steps).keys()]) {
        const d = lowestData[i * step]
        if (
          d &&
          buyAndHoldEquity.filter((bh) => bh.time === d.time).length === 0
        ) {
          data.push(d)
        }
      }
      buyAndHoldEquity.push({
        value: math.round(buyAndHoldUsageEquity, 4),
        time: firstData.time,
      })
      for (const d of data) {
        const lp = d.close
        const bh = math.round(
          firstPrice && lp ? (buyAndHoldUsageEquity / firstPrice) * lp : 0,
          3,
        )
        buyAndHoldEquity.push({ value: bh, time: d.time })
      }
    }
    return {
      buyAndHold,
      buyAndHoldUsage,
      buyAndHoldEquity: buyAndHoldEquity.sort((a, b) => a.time - b.time),
    }
  }

  /**
   * Generate comprehensive backtesting results
   *
   * Compiles all trading data, performance metrics, and analysis into a complete
   * backtesting result report. This is the main entry point for result generation.
   *
   * Calculates:
   * - Profit/loss metrics and returns
   * - Risk metrics (Sharpe ratio, maximum drawdown, volatility)
   * - Transaction analysis and statistics
   * - Buy-and-hold comparison
   * - Time-based performance analysis
   *
   * @param firstData First price bar from the dataset
   * @param lastData Last price bar from the dataset
   * @param loadingTime Time spent loading data (ms)
   * @param processingTime Time spent processing strategy (ms)
   * @returns Complete grid backtesting result with all metrics
   */
  static returnResult(
    firstData: Bar,
    lastData: Bar,
    loadingTime: number,
    processingTime: number,
  ): GridBacktestingResult {
    const startResultProcessing = new Date().getTime()

    // Calculate core profit metrics
    const totalProfit = math.round(SharedData.totalProfit, SharedData.precision)
    const totalProfitUsd = math.round(SharedData.totalProfitUsd, 2)

    // Calculate working time statistics
    const workingTime = SharedData.workingShift.reduce(
      (acc, ws) => (acc += (ws.end || lastData?.time || ws.start) - ws.start),
      0,
    )
    const workingDays = math.round(workingTime / (24 * 60 * 60 * 1000), 4)

    // Prepare period-based analysis
    const profitByPeriod: number[] = []
    let periodRatio = 1
    if (workingDays > 3 && SharedData.transactions.length > 0) {
      const transactionsSort = SharedData.transactions.sort(
        (a, b) => a.updateTime - b.updateTime,
      )
      const [first] = transactionsSort
      const startDate = new Date(first.updateTime)
      startDate.setHours(0, 0, 0, 0)
      periodRatio = 365
      if (workingDays - 90 > 0) {
        startDate.setDate(1)
        periodRatio = 12
      }
      for (
        let i = startDate.getTime(), prev = 0;
        prev <= (lastData?.time || -1);
        i = startDate.getTime()
      ) {
        const transactionByPeriod = SharedData.transactions.filter(
          (d) => d.updateTime && d.updateTime >= prev && d.updateTime < i,
        )

        const profit = transactionByPeriod.reduce(
          (acc, v) => (acc += v.profitUsd),
          0,
        )
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
    const firstPrice = firstData?.close
    const lastPrice = lastData?.close

    const positionPnL = {
      perc: 0,
      value: 0,
    }
    if (SharedData.futures) {
      const diff = lastPrice - SharedData.position.entryPrice
      const perc =
        (diff / SharedData.position.entryPrice) *
        (SharedData.position.side === PositionSide.LONG ? 1 : -1)

      positionPnL.perc = SharedData.position.qty !== 0 ? perc : 0
      positionPnL.value = math.round(
        SharedData.position.qty *
          positionPnL.perc *
          (SharedData.coinm ? 1 : SharedData.position.entryPrice),
        8,
      )
      positionPnL.perc = math.round(positionPnL.perc * 100, 2)
    }
    PriceCalculator.setLastRate()
    const buyAndHold = ResultManager.getBuyAndHold(firstData, lastData)
    const budgetUsd =
      (SharedData.usdRateQuote *
        +SharedData.settings.budget *
        (SharedData.coinm ? firstPrice : 1)) /
      SharedData.leverage
    const sharpe = math.sharpeRatio(profitByPeriod, budgetUsd, periodRatio)
    const sortino = math.santinoRatio(profitByPeriod, budgetUsd, periodRatio)
    const avgNetDailyPerc =
      workingDays > 0
        ? math.round(
            (totalProfit / workingDays / SharedData.initialBalances) * 100,
            2,
          )
        : 0
    let annualizedReturn = 0
    if (
      avgNetDailyPerc &&
      !isNaN(avgNetDailyPerc) &&
      isFinite(avgNetDailyPerc)
    ) {
      annualizedReturn = math.round(avgNetDailyPerc * 365, 2)
      if (annualizedReturn > Number.MAX_SAFE_INTEGER) {
        annualizedReturn = Infinity
      } else {
        annualizedReturn = math.round(annualizedReturn, 2)
      }
    }
    const result: GridBacktestingResult = {
      filledOrders: SharedData.filledOrders,
      buyAndHoldEquity: buyAndHold.buyAndHoldEquity,
      values: SharedData.values.sort((a, b) => a.time - b.time),
      firstUsdRate: SharedData.firstUsdRate,
      lastUsdRate: SharedData.lastUsdRate,
      transaction: ResultManager.prepareTransactions(
        SharedData.transactions.sort((a, b) => b.index - a.index),
      ),
      noData: !firstData && !lastData,
      ordersHistory: SharedData.historyLines.map((o) =>
        SharedData.fullResult
          ? o
          : {
              price: o.price,
              side: o.side,
              id: o.id,
              filledTime: o.filledTime,
              startTime: o.startTime,
              avgLine: o.avgLine,
            },
      ),

      // @ts-ignore
      orders: [
        ...SharedData.smartGrids,
        ...SharedData.grids
          .filter(
            (g) =>
              !SharedData.smartGrids.find(
                (sg) =>
                  sg.price === g.price &&
                  sg.qty === g.qty &&
                  sg.side === g.side,
              ),
          )

          // @ts-ignore
          .map((g) => ({ ...g, side: 'GREY' }))
          .map((o) =>
            SharedData.fullResult
              ? o
              : {
                  price: o.price,
                  side: o.side,
                  id: o.id,
                  filledTime: o.filledTime,
                  startTime: o.startTime,
                  qty: o.qty,
                },
          ),
      ],
      financial: {
        freeProfitTotal: SharedData.freeTotalProfit,
        freeProfitTotalUsd: SharedData.freeTotalProfit * SharedData.usdRate,
        profitTotal: math.convertFromExponential(
          totalProfit,
          SharedData.precision,
        ),
        profitTotalUsd: totalProfitUsd,
        profitTotalPerc: math.round(
          (totalProfit / SharedData.initialBalances) * 100,
          2,
        ),
        budgetUsd,
        avgNetDaily:
          workingDays > 0
            ? math.convertFromExponential(
                math.round(totalProfit / workingDays, SharedData.precision),
                SharedData.precision,
              )
            : '0',
        avgNetDailyUsd:
          workingDays > 0 ? math.round(totalProfitUsd / workingDays, 2) : 0,
        avgNetDailyPerc,
        annualizedReturn,
        avgTransactionProfit:
          SharedData.transactions.length > 0
            ? math.convertFromExponential(
                math.round(
                  SharedData.totalProfit / SharedData.transactions.length,
                  SharedData.precision + 3,
                ),
                SharedData.precision + 3,
              )
            : '0',
        avgTransactionProfitUsd:
          SharedData.transactions.length > 0
            ? math.round(
                SharedData.totalProfitUsd / SharedData.transactions.length,
                2,
              )
            : 0,
        avgTransactionProfitPerc:
          SharedData.transactions.length > 0
            ? math.round(
                (SharedData.totalProfit /
                  SharedData.transactions.length /
                  SharedData.initialBalances) *
                  100,
                2,
              )
            : 0,
        initialBalances: math.convertFromExponential(
          math.round(SharedData.initialBalances, SharedData.precision),
          SharedData.precision,
        ),
        initialBalancesUsd: math.round(SharedData.initialBalancesUsd, 2),
        currentBalances: math.convertFromExponential(
          math.round(SharedData.currentBalances, SharedData.precision),
          SharedData.precision,
        ),
        currentBalancesUsd: math.round(SharedData.currentBalancesUsd, 2),
        valueChange: math.convertFromExponential(
          math.round(
            SharedData.currentBalances -
              SharedData.initialBalances +
              positionPnL.value,
            SharedData.precision,
          ),
          SharedData.precision,
        ),
        valueChangeUsd: math.round(
          SharedData.currentBalancesUsd -
            SharedData.initialBalancesUsd +
            positionPnL.value *
              (SharedData.coinm ? lastPrice : 1) *
              SharedData.usdRateQuote,
          2,
        ),
        valueChangePerc: math.round(
          ((SharedData.currentBalances -
            SharedData.initialBalances +
            positionPnL.value) /
            SharedData.initialBalances) *
            100,
          2,
        ),
        startPrice: math.convertFromExponential(
          math.round(firstPrice ?? 0, SharedData.allPrecision.price),
          SharedData.allPrecision.price,
        ),
        lastPrice: math.convertFromExponential(
          math.round(
            SharedData.lastPrice || lastPrice || 0,
            SharedData.allPrecision.price,
          ),
          SharedData.allPrecision.price,
        ),
        breakevenPrice: math.round(
          TradeManager.breakevenPrice(),
          SharedData.symbol.priceAssetPrecision,
        ),
        currentBalancesByAsset: {
          base: math.convertFromExponential(
            math.round(
              SharedData.currentBalancesByAsset.base,
              SharedData.allPrecision.base,
            ),
            SharedData.allPrecision.base,
          ),
          quote: math.convertFromExponential(
            math.round(
              SharedData.currentBalancesByAsset.quote,
              SharedData.allPrecision.quote,
            ),
            SharedData.allPrecision.quote,
          ),
        },
        initialBalancesByAsset: {
          base: math.convertFromExponential(
            math.round(
              SharedData.initialBalancesByAsset.base,
              SharedData.allPrecision.base,
            ),
            SharedData.allPrecision.base,
          ),
          quote: math.convertFromExponential(
            math.round(
              SharedData.initialBalancesByAsset.quote,
              SharedData.allPrecision.quote,
            ),
            SharedData.allPrecision.quote,
          ),
        },
      },
      duration: {
        firstDataTime: firstData?.time || +new Date(),
        lastDataTime: lastData?.time || +new Date(),
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
        botWorkingTimeNumber: workingTime,
      },
      numerical: {
        all: SharedData.transactions.length,
        transactionsPerDay:
          workingDays > 0
            ? math.round(SharedData.transactions.length / workingDays, 1)
            : 0,
        buy: SharedData.transactions.filter(
          (t) => t.side === BotOrderSideEnum.buy,
        ).length,
        sell: SharedData.transactions.filter(
          (t) => t.side === BotOrderSideEnum.sell,
        ).length,
      },
      ratios: {
        profitByPeriod,
        buyAndHold: {
          value: math.round(buyAndHold.buyAndHold, SharedData.precisionQuote),
          valueUsd: math.round(
            buyAndHold.buyAndHold * SharedData.usdRateQuote,
            2,
          ),
          perc: math.round(
            (buyAndHold.buyAndHold / buyAndHold.buyAndHoldUsage) * 100,
            1,
          ),
        },
        periodRatio,
        sharpe: isNaN(sharpe) || !isFinite(sharpe) ? 0 : sharpe,
        sortino: isNaN(sortino) || !isFinite(sharpe) ? 0 : sortino,
      },
      interval: SharedData.interval ?? ExchangeIntervals.fiveM,
      quoteRate: lastPrice ?? 0,
      position: {
        count: SharedData.positionStats.count,
        qty: SharedData.position.qty,
        price: SharedData.position.entryPrice,
        side: SharedData.position.side,
        pnl: positionPnL,
      },
    }
    if (!SharedData.fullResult) {
      delete result.filledOrders
    }
    return result
  }
}
