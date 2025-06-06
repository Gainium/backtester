/**
 * Grid Trading Trade Manager
 *
 * Manages all trading operations for the grid strategy including:
 * - Grid creation and order management
 * - Position tracking and updates
 * - Transaction recording and processing
 * - Take profit and stop loss execution
 * - Risk management and range checking
 *
 * This module handles the core trading logic and maintains the grid of buy/sell orders
 * that define the grid trading strategy behavior.
 *
 * Performance Considerations:
 * - Uses memoization for order creation (O(1) cached lookups)
 * - Grid operations are O(n) where n = number of active grids
 * - Memory usage scales with grid size and transaction history
 *
 * @fileoverview Core trading operations and grid management
 */

import {
  BacktestingTransaction,
  Bar,
  BotOrderSideEnum,
  FullGridWithTime,
  FuturesStrategyEnum,
  PositionSide,
} from 'src/types'
import { SharedData } from './SharedData'
import { v4 } from 'uuid'
import { StrategyUtils } from './StrategyUtils'
import { PriceCalculator } from './PriceCalculator'
import { MathHelper } from 'src/helper/math'

const math = new MathHelper()

/**
 * Enumeration for take profit and stop loss return values
 */
export enum TpSlReturn {
  none = 'none',
  sl = 'sl',
  tp = 'tp',
}

/**
 * Core trading operations manager for grid strategy
 *
 * Handles all aspects of trade execution, grid management, and position tracking.
 * All methods are static to work with the centralized SharedData state.
 */
export class TradeManager {
  /**
   * Create grid orders with memoization for performance
   *
   * Generates buy or sell orders for the grid strategy using cached results when possible.
   * This method is performance-critical as it's called frequently during grid updates.
   *
   * Performance: O(1) for cached results, O(n) for new calculations where n = grid size
   *
   * @param all Whether to create all possible orders or just a subset
   * @param nosplice Whether to avoid splicing operations on arrays
   * @param side Order side (buy or sell)
   * @param price Current market price for order calculation
   * @returns Array of grid orders with unique IDs
   */
  static createOrders(
    all: boolean,
    nosplice: boolean,
    side: BotOrderSideEnum,
    price: number,
  ) {
    // Create cache key for memoization
    const key = `${all}-${nosplice}-${side}-${price}`
    let orders = SharedData.memoryOrders.get(key) ?? []

    if (!orders.length) {
      // Cache miss - calculate new orders
      const botFunctionsPrice = SharedData.botFunctions.lastPrice
      SharedData.botFunctions.lastPrice = price
      orders = SharedData.botFunctions.createOrders(all, nosplice, side)
      SharedData.botFunctions.lastPrice = botFunctionsPrice
      SharedData.memoryOrders.set(key, orders)
    }

    // Return new instances with unique IDs
    return [...orders].map((o) => ({ ...o, id: v4() }))
  }

  /**
   * Calculate breakeven price for current position
   *
   * Determines the price at which the current position would break even,
   * accounting for all fees and the current grid configuration.
   *
   * @returns Breakeven price or 0 if position is closed
   */
  static breakevenPrice() {
    if (SharedData.botClosedAndSell) {
      return 0
    }
    const firstPrice = SharedData.firstBarPrice
    const currentGrids = [
      ...TradeManager.createOrders(
        true,
        false,
        BotOrderSideEnum.buy,
        firstPrice,
      ),
    ]
    let currentBase = SharedData.initialBalancesByAsset.base
    let currentQuote = SharedData.initialBalancesByAsset.quote
    if (SharedData.profitBase) {
      currentBase += SharedData.freeTotalProfit
    }
    if (!SharedData.profitBase) {
      currentQuote += SharedData.freeTotalProfit
    }
    const currentValue = currentBase * firstPrice + currentQuote
    const initialValue =
      firstPrice * SharedData.initialBalancesByAsset.base +
      SharedData.initialBalancesByAsset.quote
    let quote = currentQuote
    let base = currentBase
    let avgPrice = firstPrice
    for (const g of currentGrids.filter((cg) =>
      currentValue > initialValue
        ? cg.side === BotOrderSideEnum.buy
        : currentValue < initialValue
        ? cg.side === BotOrderSideEnum.sell
        : false,
    )) {
      const currentGridsOnPrice = [
        ...TradeManager.createOrders(true, false, g.side, g.price),
      ]
      const newBase =
        currentGridsOnPrice
          .filter((gr) => gr.side === BotOrderSideEnum.sell)
          .reduce((acc, v) => acc + v.qty, 0) +
        (SharedData.profitBase ? SharedData.freeTotalProfit : 0)
      const newQuote =
        currentGridsOnPrice
          .filter((gr) => gr.side === BotOrderSideEnum.buy)
          .reduce((acc, v) => acc + v.qty * v.price, 0) +
        (!SharedData.profitBase ? SharedData.freeTotalProfit : 0)
      if (
        (currentValue > initialValue &&
          newBase * g.price + newQuote > initialValue) ||
        (currentValue < initialValue &&
          newBase * g.price + newQuote < initialValue)
      ) {
        quote = newQuote
        base = newBase
      } else {
        break
      }
    }
    avgPrice = (initialValue - quote) / base
    if (avgPrice === Infinity || avgPrice === -Infinity) {
      avgPrice = 0
    }
    if (isNaN(avgPrice) || SharedData.totalProfit === 0) {
      avgPrice = firstPrice
    }
    if (avgPrice < 0) {
      avgPrice = 0
    }
    return avgPrice
  }

  static tpSl(lastPrice: number): TpSlReturn {
    if (SharedData.settings.tpSl || SharedData.settings.sl) {
      const {
        slLowPrice,
        tpTopPrice,
        tpPerc,
        slPerc,
        tpSlCondition,
        slCondition,
        tpSl,
        sl,
      } = SharedData.settings
      const { initialBalancesByAsset, currentBalancesByAsset } = SharedData
      const initialPriceStart = SharedData.firstBarPrice
      if (
        tpSlCondition === 'priceReached' &&
        tpTopPrice &&
        tpSl &&
        SharedData.isShort
      ) {
        if (lastPrice <= +tpTopPrice) {
          return TpSlReturn.tp
        }
      } else if (
        slCondition === 'priceReached' &&
        slLowPrice &&
        sl &&
        SharedData.isShort
      ) {
        if (lastPrice <= +slLowPrice) {
          return TpSlReturn.sl
        }
      } else if (
        tpSlCondition === 'priceReached' &&
        tpTopPrice &&
        tpSl &&
        !SharedData.isShort
      ) {
        if (lastPrice >= +tpTopPrice) {
          return TpSlReturn.tp
        }
      } else if (
        slCondition === 'priceReached' &&
        slLowPrice &&
        sl &&
        !SharedData.isShort
      ) {
        if (lastPrice <= +slLowPrice) {
          return TpSlReturn.sl
        }
      } else if (
        (tpSlCondition === 'valueChanged' &&
          tpPerc &&
          initialPriceStart &&
          tpSl) ||
        (slCondition === 'valueChanged' && slPerc && initialPriceStart && sl)
      ) {
        const initialValue =
          initialBalancesByAsset.base * initialPriceStart +
          initialBalancesByAsset.quote
        if (SharedData.futures) {
          const current = SharedData.position
          const diff =
            current.side === PositionSide.LONG
              ? lastPrice - current.entryPrice
              : current.entryPrice - lastPrice
          const perc = current.entryPrice !== 0 ? diff / current.entryPrice : 0
          const val = current.qty * perc * lastPrice
          const valueChange = val + SharedData.totalProfit
          const totalPerc =
            (valueChange / (initialValue / SharedData.leverage)) * 100
          if (
            tpSlCondition === 'valueChanged' &&
            tpPerc &&
            initialPriceStart &&
            tpSl
          ) {
            if (totalPerc >= +tpPerc) {
              return TpSlReturn.tp
            }
          }
          if (
            slCondition === 'valueChanged' &&
            slPerc &&
            initialPriceStart &&
            sl
          ) {
            if (totalPerc <= +slPerc) {
              return TpSlReturn.sl
            }
          }
        } else {
          const currentValue =
            currentBalancesByAsset.base * lastPrice +
            currentBalancesByAsset.quote
          const diff = ((currentValue - initialValue) / initialValue) * 100
          if (
            tpSlCondition === 'valueChanged' &&
            tpPerc &&
            initialPriceStart &&
            tpSl
          ) {
            if (diff >= +tpPerc) {
              return TpSlReturn.tp
            }
          }
          if (
            slCondition === 'valueChanged' &&
            slPerc &&
            initialPriceStart &&
            sl
          ) {
            if (diff <= +slPerc) {
              return TpSlReturn.sl
            }
          }
        }
      }
    }
    return TpSlReturn.none
  }

  static closeBot(price: number, time: number, action: TpSlReturn) {
    SharedData.botClosed = true
    SharedData.grids = []
    SharedData.smartGrids = []
    StrategyUtils.closeWorkingShift(time)
    SharedData.lastPrice = price
    if (
      (SharedData.settings.slAction === 'stopAndSell' &&
        action === TpSlReturn.sl) ||
      (SharedData.settings.tpSlAction === 'stopAndSell' &&
        action === TpSlReturn.tp)
    ) {
      if (SharedData.futures) {
        const current = SharedData.position
        const diff =
          ((price - current.entryPrice) *
            (current.side === PositionSide.LONG ? 1 : -1)) /
          current.entryPrice
        const profit = SharedData.coinm
          ? current.qty * diff
          : current.qty * current.entryPrice * diff
        SharedData.totalProfit += profit
        SharedData.totalProfitUsd +=
          profit * (SharedData.coinm ? price : 1) * SharedData.usdRateQuote
        SharedData.currentBalances =
          SharedData.initialBalances + SharedData.totalProfit
        SharedData.currentBalancesUsd =
          SharedData.currentBalances *
          (SharedData.coinm ? price : 1) *
          SharedData.usdRateQuote
        SharedData.botClosed = true
        SharedData.positionStats.count += 1
        SharedData.position = SharedData.emptyPositon
        return
      }
      SharedData.botClosedAndSell = true
      SharedData.currentBalancesByAsset = {
        base: SharedData.futures
          ? SharedData.coinm
            ? SharedData.currentBalancesByAsset.base
            : 0
          : SharedData.profitBase
          ? SharedData.currentBalancesByAsset.base +
            SharedData.currentBalancesByAsset.quote / price
          : 0,
        quote: SharedData.futures
          ? SharedData.coinm
            ? 0
            : SharedData.currentBalancesByAsset.quote
          : SharedData.profitBase
          ? 0
          : SharedData.currentBalancesByAsset.base * price +
            SharedData.currentBalancesByAsset.quote,
      }
    }
    SharedData.currentBalances = SharedData.futures
      ? SharedData.coinm
        ? SharedData.currentBalancesByAsset.base
        : SharedData.currentBalancesByAsset.quote
      : SharedData.profitBase
      ? SharedData.currentBalancesByAsset.base +
        SharedData.currentBalancesByAsset.quote / price
      : SharedData.currentBalancesByAsset.base * price +
        SharedData.currentBalancesByAsset.quote
    SharedData.currentBalancesUsd =
      SharedData.currentBalances * SharedData.usdRate
  }

  static openPosition(d: Bar) {
    if (SharedData.initialOpen) {
      return
    }
    if (!SharedData.futures) {
      return
    }
    if (SharedData.futuresStrategy === FuturesStrategyEnum.neutral) {
      return
    }
    SharedData.initialOpen = true
    SharedData.botFunctions.lastPrice = d.close
    const grids = TradeManager.createOrders(
      true,
      false,
      SharedData.futuresStrategy === FuturesStrategyEnum.long
        ? BotOrderSideEnum.sell
        : BotOrderSideEnum.buy,
      d.close,
    )
    const amount = grids
      .filter(
        (g) =>
          g.side ===
          (SharedData.futuresStrategy === FuturesStrategyEnum.long
            ? BotOrderSideEnum.sell
            : BotOrderSideEnum.buy),
      )
      .reduce((acc, g) => acc + g.qty, 0)
    const side =
      SharedData.futuresStrategy === FuturesStrategyEnum.long
        ? PositionSide.LONG
        : PositionSide.SHORT
    SharedData.position = {
      qty: amount,
      entryPrice: d.close,
      liquidationPrice: PriceCalculator.getLiquidationPrice(d.close, side),
      side,
    }
  }

  static checkPosition(b: Bar) {
    if (!SharedData.futures) {
      return
    }
    const current = SharedData.position
    const long = current.side === PositionSide.LONG
    const price = long ? b.low : b.high
    const close = long
      ? current.liquidationPrice > price
      : current.liquidationPrice < price
    if (close) {
      const profit = SharedData.coinm
        ? -current.qty / SharedData.leverage
        : -(current.entryPrice * current.qty) / SharedData.leverage
      SharedData.totalProfit += profit
      SharedData.totalProfitUsd +=
        profit * (SharedData.coinm ? price : 1) * SharedData.usdRateQuote
      SharedData.currentBalances =
        SharedData.initialBalances + SharedData.totalProfit
      SharedData.currentBalancesUsd =
        SharedData.currentBalances *
        (SharedData.coinm ? price : 1) *
        SharedData.usdRateQuote
      SharedData.botClosed = true
      SharedData.positionStats.count += 1
      SharedData.position = SharedData.emptyPositon
    }
  }

  static checkInRange(price: number, time: number) {
    const { topPrice, lowPrice } = SharedData.settings
    let result = true
    result = price >= +lowPrice && price <= +topPrice
    if (
      !result &&
      SharedData.workingShift.length > 0 &&
      !SharedData.rangeStatus
    ) {
      StrategyUtils.closeWorkingShift(time)
      SharedData.rangeStatus = true
    }
    if (result && SharedData.rangeStatus) {
      SharedData.rangeStatus = false
      SharedData.workingShift.push({ start: time })
      SharedData.workingShift = StrategyUtils.trimWorkingShift(
        SharedData.workingShift,
      )
    }
    return result
  }

  /**
   * Create and initialize grid orders at specified price level
   *
   * This is a core method that:
   * 1. Creates new grid orders based on current price and side
   * 2. Updates grid arrays (grids and smartGrids)
   * 3. Calculates and updates balance information
   * 4. Initializes grid configuration if first time
   *
   * Performance: O(n) where n = number of grids due to filtering operations
   *
   * @param price Current market price to center grids around
   * @param side Order side (buy or sell) that triggered grid creation
   */
  static createGrids(price: number, side: BotOrderSideEnum) {
    // Update bot functions with current price
    SharedData.botFunctions.lastPrice = price

    // Create new grid orders
    const grids = [...TradeManager.createOrders(true, false, side, price)]
    SharedData.grids = grids
    SharedData.smartGrids = grids

    // Use advanced order management if enabled
    if (SharedData.settings.useOrderInAdvance) {
      SharedData.smartGrids = TradeManager.createOrders(
        false,
        false,
        side,
        price,
      )
    }

    // Initialize grid configuration on first creation
    if (SharedData.initialGrids.length === 0) {
      SharedData.initialGrids = SharedData.botFunctions.getPrices()
    }

    // Calculate base asset requirements from sell orders
    const base = SharedData.grids
      .filter((g) => SharedData.futures || g.side === BotOrderSideEnum.sell)
      .reduce((acc, v) => acc + v.qty, 0)

    // Calculate quote asset requirements from buy orders
    const quote = SharedData.grids
      .filter((g) => SharedData.futures || g.side === BotOrderSideEnum.buy)
      .reduce((acc, v) => acc + v.price * v.qty, 0)

    // Initialize balances on first grid creation
    if (SharedData.initialBalances === 0) {
      SharedData.initialBalances = SharedData.futures
        ? SharedData.coinm
          ? base
          : quote
        : SharedData.profitBase
        ? quote / price + base
        : base * price + quote
      SharedData.initialBalancesUsd =
        SharedData.initialBalances *
        (SharedData.firstUsdRate || SharedData.usdRate)
      SharedData.initialBalancesByAsset = {
        base: SharedData.futures ? (SharedData.coinm ? base : 0) : base,
        quote: SharedData.futures ? (SharedData.coinm ? 0 : quote) : quote,
      }
    }

    // Update current balances
    SharedData.currentBalances = SharedData.futures
      ? SharedData.coinm
        ? SharedData.initialBalancesByAsset.base + SharedData.totalProfit
        : SharedData.initialBalancesByAsset.quote + SharedData.totalProfit
      : (SharedData.profitBase ? quote / price + base : base * price + quote) +
        SharedData.freeTotalProfit
    SharedData.currentBalancesUsd =
      SharedData.currentBalances *
      (SharedData.lastUsdRate || SharedData.usdRate)
    SharedData.currentBalancesByAsset = {
      base: SharedData.futures
        ? SharedData.coinm
          ? base + SharedData.totalProfit
          : 0
        : base + (SharedData.profitBase ? SharedData.freeTotalProfit : 0),
      quote: SharedData.futures
        ? SharedData.coinm
          ? 0
          : quote + SharedData.totalProfit
        : quote + (SharedData.profitBase ? 0 : SharedData.freeTotalProfit),
    }
  }

  static createTransaction(order: FullGridWithTime) {
    SharedData.filledOrders.push(order)
    SharedData.filledOrdersForTransaction.set(order.id, { ...order })
    const prices = SharedData.initialGrids
    prices[prices.length - 1].buy = math.round(
      +SharedData.settings.topPrice,
      SharedData.symbol.priceAssetPrecision,
    )
    const priceForGrids = SharedData.isShort
      ? +SharedData.settings.lowPrice / 2
      : +SharedData.settings.topPrice * 2
    const grids = [
      ...TradeManager.createOrders(true, true, order.side, priceForGrids),
    ]
    const { qty, price, side, id, filledTime } = order
    let comBase =
      side === BotOrderSideEnum.buy ? qty * (SharedData.userFee ?? 0) : 0
    let comQuote =
      side === BotOrderSideEnum.sell
        ? qty * price * (SharedData.userFee ?? 0)
        : 0
    let profitQuote = 0
    let matchedPrice = 0
    let matchQty = 0
    let profitBase = 0
    let profitFreeBase = 0
    let profitFreeQuote = 0
    let matchedId = ''
    let profitUsd = 0
    let freeProfitUsd = 0
    let amountBaseBuy = side === BotOrderSideEnum.sell ? 0 : qty
    let amountFreeBaseBuy = amountBaseBuy
    let amountQuoteBuy = side === BotOrderSideEnum.sell ? 0 : qty * price
    let amountFreeQuoteBuy = amountQuoteBuy
    let amountBaseSell = side === BotOrderSideEnum.buy ? 0 : qty
    let amountFreeBaseSell = amountBaseSell
    let amountQuoteSell = side === BotOrderSideEnum.buy ? 0 : qty * price
    let amountFreeQuoteSell = amountQuoteSell
    const initialPriceStart = SharedData.firstBarPrice
    if (SharedData.settings.newProfit && !SharedData.futures) {
      if (side === BotOrderSideEnum.sell && SharedData.profitBase) {
        comBase = comQuote / price
      }
      if (side === BotOrderSideEnum.buy && !SharedData.profitBase) {
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
      const match = Array.from(
        SharedData.filledOrdersForTransaction.values(),
      ).find(
        (g) =>
          g.price ===
            (side === BotOrderSideEnum.sell
              ? prices[index - 1]?.buy || 0
              : prices[index + 1]?.sell || 0) &&
          g.side !== side &&
          g.filledTime <= filledTime,
      )
      const needMatch = !SharedData.isShort
        ? side === BotOrderSideEnum.buy ||
          (initialPriceStart &&
            side === BotOrderSideEnum.sell &&
            price <= initialPriceStart)
        : side === BotOrderSideEnum.sell ||
          (initialPriceStart &&
            side === BotOrderSideEnum.buy &&
            price >= initialPriceStart)
      let matchedFreeQty = 0
      let matchedFreePrice = 0
      if (!needMatch && !match) {
        SharedData.usedOrderId.add(id)
        SharedData.filledOrdersForTransaction.delete(id)
        matchedId = 'initial price'
        matchQty = !SharedData.isShort
          ? qty
          : (qty * price) / (initialPriceStart ?? price)
        matchedPrice = initialPriceStart ?? price
        let selfFind = prices.findIndex((p) =>
          SharedData.isShort ? p.buy === price : p.sell === price,
        )
        if (selfFind === -1) {
          selfFind = prices.findIndex((p) =>
            SharedData.isShort ? p.sell === price : p.buy === price,
          )
        }
        const correspondingOrder = grids.find(
          (g) =>
            g.price ===
              (selfFind === -1 ||
              (SharedData.isShort
                ? selfFind === prices.length - 1
                : selfFind === 0)
                ? prices.find((p) =>
                    SharedData.isShort ? p.buy === price : p.sell === price,
                  )?.[SharedData.isShort ? 'sell' : 'buy']
                : prices[SharedData.isShort ? selfFind + 1 : selfFind - 1]?.[
                    SharedData.isShort ? 'sell' : 'buy'
                  ]) && g.side !== side,
        )
        if (correspondingOrder) {
          matchedFreeQty = correspondingOrder.qty
          matchedFreePrice = correspondingOrder.price
          if (
            (SharedData.profitBase && !SharedData.isShort) ||
            (!SharedData.profitBase && SharedData.isShort)
          ) {
            matchQty = correspondingOrder.qty
            matchedPrice = correspondingOrder.price
            matchedFreeQty = 0
            matchedFreePrice = 0
          }
        }
      } else if (match) {
        matchedId = match.id
        matchQty = match.qty
        matchedPrice = match.price
        SharedData.usedOrderId.add(matchedId)
        SharedData.usedOrderId.add(id)
        SharedData.filledOrdersForTransaction.delete(matchedId)
        SharedData.filledOrdersForTransaction.delete(id)
      }
      if (matchedPrice !== 0) {
        const pnlBase =
          side === BotOrderSideEnum.sell ? matchQty - qty : qty - matchQty
        const pnlQuote =
          side === BotOrderSideEnum.sell
            ? qty * price - matchQty * matchedPrice
            : matchQty * matchedPrice - qty * price
        const pnlFreeBase =
          side === BotOrderSideEnum.sell
            ? (matchedFreeQty || matchQty) - qty
            : qty - (matchedFreeQty || matchQty)
        const pnlFreeQuote =
          side === BotOrderSideEnum.sell
            ? qty * price -
              (matchedFreeQty || matchQty) * (matchedFreePrice || matchedPrice)
            : (matchedFreeQty || matchQty) *
                (matchedFreePrice || matchedPrice) -
              qty * price
        profitBase +=
          pnlBase +
          pnlQuote / (side === BotOrderSideEnum.buy ? price : matchedPrice)
        profitQuote +=
          pnlQuote +
          pnlBase * (side === BotOrderSideEnum.buy ? price : matchedPrice)
        profitFreeBase +=
          (pnlFreeBase || pnlBase) +
          (pnlFreeQuote || pnlQuote) /
            (side === BotOrderSideEnum.buy
              ? price
              : matchedFreePrice || matchedPrice)
        profitFreeQuote +=
          (pnlFreeQuote || pnlQuote) +
          (pnlFreeBase || pnlBase) *
            (side === BotOrderSideEnum.buy
              ? price
              : matchedFreePrice || matchedPrice)
        if (side === 'BUY') {
          amountBaseSell = matchQty
          amountQuoteSell = matchQty * matchedPrice
          amountFreeBaseSell = matchedFreeQty || matchQty
          amountFreeQuoteSell =
            (matchedFreeQty || matchQty) * (matchedFreePrice || matchedPrice)
        }
        if (side === 'SELL') {
          amountBaseBuy = matchQty
          amountQuoteBuy = matchQty * matchedPrice
          amountFreeBaseBuy = matchedFreeQty || matchQty
          amountFreeQuoteBuy =
            (matchedFreeQty || matchQty) * (matchedFreePrice || matchedPrice)
        }
      }
    } else {
      if (!SharedData.profitBase && !SharedData.futures) {
        if (side === BotOrderSideEnum.buy) {
          comQuote = comBase * price
        }
        if (side === BotOrderSideEnum.sell) {
          let index = prices.findIndex((p) => p.sell === price)
          if (index === -1) {
            index = prices.findIndex((p) => p.buy === price)
          }
          const buyMatch = grids.find(
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
      if (SharedData.profitBase || SharedData.futures) {
        if (side === BotOrderSideEnum.sell) {
          comBase = comQuote / price
        }
        if (side === BotOrderSideEnum.buy && SharedData.futures) {
          comQuote = comBase * price
        }
        if (!SharedData.usedOrderId.has(id)) {
          if (SharedData.futuresStrategy !== FuturesStrategyEnum.neutral) {
            const withMatch =
              (SharedData.futuresStrategy === FuturesStrategyEnum.long &&
                side === BotOrderSideEnum.sell) ||
              (SharedData.futuresStrategy === FuturesStrategyEnum.short &&
                side === BotOrderSideEnum.buy)
            SharedData.usedOrderId.add(id)
            SharedData.filledOrdersForTransaction.delete(id)
            if (withMatch) {
              matchedId = 'position price'
              matchQty = SharedData.profitBase
                ? (price * qty) / (SharedData.position.entryPrice || price)
                : qty
              matchedPrice = SharedData.position.entryPrice || price
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
          } else {
            let index = prices.findIndex(
              (p) =>
                (side === BotOrderSideEnum.sell ? p.sell : p.buy) === price,
            )
            if (index === -1) {
              index = prices.findIndex(
                (p) =>
                  (side === BotOrderSideEnum.sell ? p.buy : p.sell) === price,
              )
            }
            const match = Array.from(
              SharedData.filledOrdersForTransaction.values(),
            ).find(
              (g) =>
                g.price ===
                  (side === BotOrderSideEnum.sell
                    ? prices[index - 1]?.buy || 0
                    : prices[index + 1]?.sell || 0) &&
                g.side !== side &&
                g.filledTime < filledTime,
            )
            if (match) {
              matchedId = match.id
              SharedData.usedOrderId.add(matchedId)
              SharedData.usedOrderId.add(id)
              SharedData.filledOrdersForTransaction.delete(matchedId)
              SharedData.filledOrdersForTransaction.delete(id)
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
    const profit =
      (SharedData.profitBase ? profitBase : profitQuote) -
      (SharedData.profitBase ? comBase : comQuote)
    const freeProfit =
      (SharedData.profitBase && !SharedData.isShort) ||
      (!SharedData.profitBase && SharedData.isShort)
        ? profit
        : (SharedData.profitBase
            ? profitFreeBase || profitBase
            : profitFreeQuote || profitQuote) -
          (SharedData.profitBase ? comBase : comQuote)
    profitUsd = profit * SharedData.usdRate
    freeProfitUsd = (freeProfit || profit) * SharedData.usdRate
    SharedData.cummulativeProfit = {
      base: SharedData.profitBase
        ? SharedData.cummulativeProfit.base + profit
        : 0,
      quote: SharedData.profitBase
        ? 0
        : SharedData.cummulativeProfit.quote + profit,
      usd: SharedData.cummulativeProfit.usd + profitUsd,
    }
    const transaction: BacktestingTransaction = {
      _id: v4(),
      updateTime: filledTime,
      side,
      amountBaseBuy: math.convertFromExponential(
        math.round(amountBaseBuy, SharedData.allPrecision.base),
        SharedData.allPrecision.base,
      ),
      amountFreeBaseBuy,
      amountQuoteBuy: math.convertFromExponential(
        math.round(amountQuoteBuy, SharedData.allPrecision.quote),
        SharedData.allPrecision.quote,
      ),
      amountFreeQuoteBuy,
      amountBaseSell: math.convertFromExponential(
        math.round(amountBaseSell, SharedData.allPrecision.base),
        SharedData.allPrecision.base,
      ),
      amountFreeBaseSell,
      amountQuoteSell: math.convertFromExponential(
        math.round(amountQuoteSell, SharedData.allPrecision.quote),
        SharedData.allPrecision.quote,
      ),
      amountFreeQuoteSell,
      priceSell: math.convertFromExponential(
        math.round(
          side === BotOrderSideEnum.sell ? price : matchedPrice,
          SharedData.symbol.priceAssetPrecision,
        ),
        SharedData.symbol.priceAssetPrecision,
      ),
      priceBuy: math.convertFromExponential(
        math.round(
          side === BotOrderSideEnum.buy ? price : matchedPrice,
          SharedData.symbol.priceAssetPrecision,
        ),
        SharedData.symbol.priceAssetPrecision,
      ),
      profit: math.convertFromExponential(
        math.round(profit, SharedData.precision + 3),
        SharedData.precision + 3,
      ),
      profitUsd: math.round(profitUsd, 2),
      freeProfit,
      freeProfitUsd,
      baseAsset: SharedData.symbol.baseAsset.name,
      quoteAsset: SharedData.symbol.quoteAsset.name,
      profitAsset: SharedData.futures
        ? SharedData.coinm
          ? SharedData.symbol.baseAsset.name
          : SharedData.symbol.quoteAsset.name
        : SharedData.profitBase
        ? SharedData.symbol.baseAsset.name
        : SharedData.symbol.quoteAsset.name,
      index: SharedData.transactionIndex,
      idBuy: order.side === BotOrderSideEnum.buy ? order.id : matchedId,
      idSell: order.side === BotOrderSideEnum.buy ? matchedId : order.id,
      executor: order.id,
      cummulativeProfitBase: SharedData.cummulativeProfit.base,
      cummulativeProfitQuote: SharedData.cummulativeProfit.quote,
      cummulativeProfitUsdt: SharedData.cummulativeProfit.usd,
    }
    SharedData.transactionIndex++
    SharedData.freeTotalProfit += freeProfit
    SharedData.totalProfit += profit
    SharedData.totalProfitUsd += profitUsd
    SharedData.transactions.push(transaction)
  }

  static addAvgHistoryLine(time: number) {
    const localAvg = SharedData.pendingHistoryLine
    const price = TradeManager.breakevenPrice()
    if (localAvg?.price === price) {
      return
    }
    if (localAvg?.startTime === time) {
      localAvg.price = price
      SharedData.historyLines[SharedData.historyLines.length - 1] = localAvg
      return
    }
    if (localAvg) {
      localAvg.filledTime = time
      if (SharedData.historyLines.length) {
        SharedData.historyLines[SharedData.historyLines.length - 1] = localAvg
      } else {
        SharedData.historyLines.push(localAvg)
      }
    }
    SharedData.pendingHistoryLine = {
      startTime: time,
      avgLine: true,
      price,
      side: BotOrderSideEnum.buy,
      id: SharedData.botFunctions.utils.id(20),
    }
    SharedData.historyLines.push(SharedData.pendingHistoryLine)
  }
}
