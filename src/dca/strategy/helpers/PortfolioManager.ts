import { MathHelper } from '../../../helper/math'
import { DealManager } from './DealManager'
import { PriceCalculator } from './PriceCalculator'
import { SharedData } from './SharedData'
import {
  DCAOrderTypeEnum,
  FullBar,
  PositionSide,
  StartConditionEnum,
} from '../../../types'

const math = new MathHelper()

/**
 * # PortfolioManager
 *
 * Portfolio value tracking and analysis system for DCA trading strategy.
 * Calculates real-time portfolio values, unrealized PnL, and performance metrics
 * across all active deals and asset balances.
 *
 * ## Features
 * - **Real-time Valuation**: Live portfolio value calculations with USD conversion
 * - **Multi-Asset Support**: Handles complex portfolios with multiple trading pairs
 * - **PnL Tracking**: Unrealized profit/loss calculations for open positions
 * - **Balance Management**: Tracks asset balances and allocations
 *
 * ## Calculation Methods
 *
 * ### Portfolio Valuation
 * - Asset balance valuation in USD
 * - Open position unrealized PnL
 * - Commission and fee calculations
 * - Total portfolio value aggregation
 *
 * ### Deal Analysis
 * - Individual deal contribution to portfolio
 * - Take-profit and stop-loss impact assessment
 * - Risk exposure calculations
 *
 * ## Performance Considerations
 * - **Optimization Opportunity**: Current implementation has O(n) complexity
 * - **Recommended**: Use `OptimizedPortfolioManager` for better performance
 * - **Caching**: Portfolio values can be cached for repeated calculations
 *
 * ## Usage Example
 * ```typescript
 * // Check portfolio value at specific time and price
 * PortfolioManager.checkPortfolio(timestamp, currentPrice, 'BTCUSDT')
 *
 * // Replace portfolio value with new calculation
 * PortfolioManager.replacePortfolioValue(timestamp, newValue, sharedValue)
 * ```
 *
 * @author Gainium Team
 * @version 2.0.0 - Ready for optimization upgrade
 * @see OptimizedPortfolioManager for performance-optimized version
 */
export class PortfolioManager {
  static replacePortfolioValue(time: number, val: number, shared: number) {
    const current = SharedData.portfolio.get(time)
    if (current) {
      return SharedData.portfolio.set(time, current + val - shared)
    }
    return SharedData.portfolio.set(time, val)
  }
  static checkPortfolio(time: number, _price: number, symbol: string) {
    const key = `${symbol}-${time}`
    if (SharedData.portfolioTimes.has(key)) {
      return
    }
    SharedData.portfolioTimes.add(key)
    const openDeal = DealManager.getDeals('open', symbol)
    const fullSymbol = SharedData.symbols.get(symbol)
    const baseBalance =
      SharedData.balance.get(fullSymbol?.baseAsset.name ?? '') ?? 0
    const quoteBalance =
      SharedData.balance.get(fullSymbol?.quoteAsset.name ?? '') ?? 0
    const baseRate = PriceCalculator.getUsdRate(symbol, _price, 'base')
    const quoteRate = PriceCalculator.getUsdRate(symbol, _price, 'quote')
    const baseUsd = baseBalance * baseRate
    const quoteUsd = quoteBalance * quoteRate
    const rate = SharedData.profitBase ? baseRate : quoteRate
    const balanceUsd = math.round(baseUsd + quoteUsd)
    const shared = SharedData.long ? quoteUsd : baseUsd
    if (!SharedData.futures && !openDeal.length) {
      return PortfolioManager.replacePortfolioValue(time, balanceUsd, shared)
    }
    let value = 0
    if (!SharedData.futures) {
      for (const o of openDeal) {
        const price = _price
        const tp = DealManager.getTP(o, price, true, false)[0]
        const { price: tpPrice } = tp
        const qty = tp?.qty ?? 0
        if (qty === 0) {
          continue
        }
        const filledOrders = o.filledOrders.filter(
          (fo) =>
            fo.type &&
            [DCAOrderTypeEnum.dca, DCAOrderTypeEnum.bo].includes(fo.type),
        )
        const filledTPOrders = o.filledOrders.filter(
          (fo) =>
            fo.type &&
            [DCAOrderTypeEnum.tp, DCAOrderTypeEnum.sl].includes(fo.type),
        )
        const quote = SharedData.combo
          ? (SharedData.long
              ? o.initialBalance.quote - o.currentBalance.quote
              : o.currentBalance.quote) +
            (SharedData.profitBase
              ? 0
              : o.profit.total * (SharedData.long ? 1 : -1))
          : filledOrders.reduce((acc, fo) => (acc += fo.qty * fo.price), 0) -
            filledTPOrders.reduce((acc, fo) => (acc += fo.qty * fo.price), 0)
        const base = SharedData.combo
          ? SharedData.long
            ? o.currentBalance.base
            : o.initialBalance.base - o.currentBalance.base
          : filledOrders.reduce((acc, fo) => (acc += fo.qty), 0) -
            filledTPOrders.reduce((acc, fo) => (acc += fo.qty), 0)
        const comboBase =
          quote / tpPrice +
          (SharedData.profitBase
            ? o.profit.total * (SharedData.long ? 1 : -1)
            : 0)
        const quoteTp = qty * tpPrice
        const commission = SharedData.combo
          ? SharedData.profitBase
            ? qty * SharedData.userFee
            : qty * tpPrice * SharedData.userFee
          : o.filledOrders.reduce(
              (acc, v) =>
                (acc += SharedData.profitBase
                  ? v.qty * SharedData.userFee
                  : v.qty * v.price * SharedData.userFee),
              0,
            )
        const unPnl =
          o.profit.total +
          (SharedData.combo
            ? (SharedData.profitBase ? base - comboBase : quoteTp - quote) *
              (SharedData.long ? 1 : -1)
            : (SharedData.profitBase
                ? base -
                  qty +
                  ((qty * tpPrice - quote) / tpPrice) *
                    (SharedData.long ? 1 : -1)
                : qty * tpPrice -
                  quote +
                  (qty - base) * tpPrice * (SharedData.long ? 1 : -1)) *
              (SharedData.long ? 1 : -1)) -
          commission
        value += unPnl * rate
      }
      if (isNaN(value)) {
        value = 0
      }
      return PortfolioManager.replacePortfolioValue(
        time,
        math.round(value + balanceUsd),
        shared,
      )
    }
    for (const o of openDeal) {
      const price = _price
      const position = SharedData.position.get(o.symbol.pair)
      if (position) {
        const unPnL =
          (position?.side === PositionSide.LONG
            ? price * position.qty - position.entryPrice * position.qty
            : position.entryPrice * position.qty - price * position.qty) *
          quoteRate
        value += unPnL
      }
    }
    if (isNaN(value)) {
      value = 0
    }
    return PortfolioManager.replacePortfolioValue(
      time,
      math.round(value + balanceUsd),
      SharedData.coinm ? baseUsd : quoteUsd,
    )
  }
  static checkPosition(b: FullBar) {
    if (!SharedData.futures) {
      return
    }
    let current = SharedData.position.get(b.symbol)
    if (!current) {
      return
    }
    const long = current.side === PositionSide.LONG
    const price = long ? b.low : b.high
    const minPrice = SharedData.minPrice.get(b.symbol) ?? 0
    const maxPrice = SharedData.maxPrice.get(b.symbol) ?? 0
    if (minPrice === 0 || minPrice > b.low) {
      SharedData.minPrice.set(b.symbol, b.low)
    }
    if (maxPrice === 0 || maxPrice < b.high) {
      SharedData.maxPrice.set(b.symbol, b.high)
    }
    const close = long
      ? current.liquidationPrice > price
      : current.liquidationPrice < price
    if (close) {
      const allDeals = DealManager.getDeals('open', b.symbol)
      for (const d of allDeals) {
        const tp = DealManager.getTP(
          d,
          current.liquidationPrice,
          true,
          false,
        )[0]
        DealManager.closeDeal(d, b, tp, current.liquidationPrice)
        DealManager.processDealCloseFromMap(d)
      }
      current = SharedData.emptyPosition
      SharedData.position.set(b.symbol, current)
      if (SharedData.settings.startCondition === StartConditionEnum.asap) {
        DealManager.openDeal(
          current.liquidationPrice,
          b.time,
          b.high,
          b.low,
          b.symbol,
        )
      }
    }
  }

  static checkEquityDrawdown() {
    const array = Array.from(SharedData.portfolio, (v) => ({
      x: v[0],
      y: v[1],
    }))
    const last = array[SharedData.portfolio.size - 1]
    const secondToLast = array[SharedData.portfolio.size - 2]
    if (!last) {
      return
    }
    if (!secondToLast) {
      return (SharedData.seriesLossE = {
        valueUsd: 0,
        minUsd: last.y,
        maxUsd: last.y,
        perc: 0,
      })
    }
    if (last.y === secondToLast.y) {
      return
    }
    if (last.y > SharedData.seriesLossE.maxUsd) {
      return (SharedData.seriesLossE = {
        ...SharedData.seriesLossE,
        minUsd: last.y,
        maxUsd: last.y,
      })
    }
    if (last.y < SharedData.seriesLossE.maxUsd) {
      const tempValue = SharedData.seriesLossE.maxUsd - last.y
      if (tempValue > SharedData.seriesLossE.valueUsd) {
        SharedData.seriesLossE = {
          ...SharedData.seriesLossE,
          valueUsd: tempValue,
          minUsd: last.y,
          perc: tempValue / SharedData.seriesLossE.maxUsd,
        }
      }
    }
    return
  }
}
