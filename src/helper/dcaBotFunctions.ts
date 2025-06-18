import {
  BotOrderSideEnum,
  StrategyEnum,
  OrderSizeTypeEnum,
  DCAOrderTypeEnum,
  GridBreakpoint,
  CloseConditionEnum,
  TerminalDealTypeEnum,
  DCAConditionEnum,
  IndicatorAction,
  BotMarginTypeEnum,
  DynamicArPrices,
  ScaleDcaTypeEnum,
  IndicatorSection,
  DCAVolumeType,
  DcaVolumeRequiredChangeRef,
} from '../types'
import BotUtils from './botUtils'
import { checkNumber } from './utils'

import type { DCABotSettings, Symbols, DCAGrid, Asset, Sizes } from '../types'

/**
 * @fileoverview DCA (Dollar Cost Averaging) Bot Functions Handler
 *
 * This class provides comprehensive functionality for DCA trading bots, including:
 * - Order generation and validation for DCA strategies
 * - Take profit and stop loss calculations
 * - Grid order management and dynamic sizing
 * - Indicator-based conditions and custom logic
 * - Multi-TP (take profit) configurations
 * - Volume and size calculations for different order types
 * - Risk management and breakpoint handling
 *
 * The DCA strategy involves placing multiple buy orders at decreasing price levels
 * to average down the entry price. This class handles all the complex calculations
 * needed for backtesting and live trading DCA bots.
 *
 * @performance Critical performance considerations:
 * - Order generation can be expensive for large grid counts
 * - Indicator calculations may impact performance
 * - Precision handling is crucial for accurate backtesting
 *
 * @author Gainium Development Team
 * @since 1.0.0
 */
class DCABotFunctions {
  /** Mathematical utilities for calculations */
  math: BotUtils['math']

  /** DCA bot configuration settings */
  settings: DCABotSettings

  /** Trading symbol information and constraints */
  symbol: Symbols

  /** General bot utilities instance */
  utils: BotUtils

  /** User's trading fee percentage */
  userFee: number

  /**
   * Creates a new DCA Bot Functions instance
   *
   * @param settings - DCA bot configuration including strategy parameters
   * @param symbol - Trading symbol with precision and minimum amount constraints
   * @param userFee - User's trading fee as a decimal (e.g., 0.001 for 0.1%)
   * @param tradesBacktest - Optional flag for backtesting mode
   *
   * @example
   * ```typescript
   * const dcaBot = new DCABotFunctions(
   *   {
   *     useDca: true,
   *     dcaOrdersCount: 5,
   *     dcaOrderSizeType: OrderSizeTypeEnum.percent,
   *     // ... other settings
   *   },
   *   symbolInfo,
   *   0.001
   * );
   * ```
   */
  constructor(
    settings: DCABotSettings,
    symbol: Symbols,
    userFee: number,
    tradesBacktest?: boolean,
  ) {
    this.settings = settings
    this.symbol = symbol
    this.utils = new BotUtils(tradesBacktest)
    this.math = this.utils.math
    this.userFee = userFee
  }

  /**
   * Updates bot settings with partial configuration
   *
   * @param settings - Partial settings object to merge with existing settings
   *
   * @example
   * ```typescript
   * dcaBot.sett = { dcaOrdersCount: 10, tpPerc: 2.5 };
   * ```
   */
  set sett(settings: Partial<DCABotSettings>) {
    this.settings = {
      ...this.settings,
      ...settings,
    }
  }

  /**
   * Gets current bot settings
   *
   * @returns Complete DCA bot settings object
   */
  get sett() {
    return this.settings
  }

  /**
   * Updates trading symbol information
   *
   * @param symbol - New symbol information with updated constraints
   */
  set sym(symbol: Symbols) {
    this.symbol = symbol
  }

  /**
   * Updates both settings and symbol in a single operation
   *
   * @param data - Object containing both settings and symbol updates
   *
   * @example
   * ```typescript
   * dcaBot.all = {
   *   settings: updatedSettings,
   *   symbol: updatedSymbol
   * };
   * ```
   */
  set all(data: { settings: DCABotSettings; symbol: Symbols }) {
    this.settings = data.settings
    this.symbol = data.symbol
  }

  /**
   * Determines if trailing take profit is enabled and properly configured
   *
   * @returns True if all trailing TP conditions are met:
   *   - Take profit is enabled
   *   - TP percentage is valid
   *   - Trailing TP is enabled
   *   - Trailing TP percentage is valid
   *   - Multi-TP is disabled (trailing incompatible with multi-TP)
   *
   * @example
   * ```typescript
   * if (dcaBot.isTrailingTp) {
   *   // Apply trailing take profit logic
   * }
   * ```
   */
  get isTrailingTp() {
    const { trailingTp, trailingTpPerc, tpPerc, useTp, useMultiTp } =
      this.settings
    return (
      useTp &&
      checkNumber(tpPerc) &&
      trailingTp &&
      checkNumber(trailingTpPerc) &&
      !useMultiTp
    )
  }

  /**
   * Determines if trailing stop loss is enabled and properly configured
   *
   * @returns True if all trailing SL conditions are met:
   *   - Stop loss is enabled
   *   - Trailing SL is enabled
   *   - SL percentage is valid
   *
   * @example
   * ```typescript
   * if (dcaBot.isTrailingSl) {
   *   // Apply trailing stop loss logic
   * }
   * ```
   */
  get isTrailingSl() {
    const { trailingSl, slPerc, useSl } = this.settings
    return useSl && trailingSl && checkNumber(slPerc)
  }

  /**
   * Creates a complete set of DCA orders including base order, DCA orders, and TP/SL orders
   *
   * This is the core method that generates all orders for a DCA trading strategy.
   * It handles complex order sizing, dynamic pricing, indicator conditions, and
   * multi-take-profit configurations.
   *
   * @param usdPrice - Current USD price for USD-based sizing calculations
   * @param inputLatestPrice - Current market price for the trading pair
   * @param all - Whether to return all orders regardless of active order limits
   * @param precOrderSize - Precise order size override (0 = use settings)
   * @param breakpoints - Grid breakpoints for custom price levels
   * @param balances - Current account balances for percentage-based sizing
   * @param outsideSl - Whether position is outside stop loss range
   * @param tpSlTargetFilled - Array of already filled TP/SL target IDs
   * @param _updatedComboAdjustments - Flag for combo strategy adjustments
   * @param fixSl - Fixed stop loss price override (0 = use settings)
   * @param fixTp - Fixed take profit price override (0 = use settings)
   * @param fixSize - Fixed order size override (0 = use settings)
   * @param dcaArValues - Dynamic AR (Average Range) values for scaling
   * @param sizes - Additional size adjustments for base/quote assets
   *
   * @returns Array of DCA grid orders with prices, quantities, and order types
   *
   * @performance This method performs extensive calculations and validations.
   * For large grid counts or complex indicator conditions, consider caching
   * results where possible.
   *
   * @example
   * ```typescript
   * const orders = dcaBot.createOrders(
   *   50000,  // USD price
   *   40000,  // Current BTC price
   *   false,  // Not all orders
   *   0,      // No size override
   *   [],     // No breakpoints
   *   balances,
   *   false,  // Not outside SL
   *   [],     // No filled targets
   *   true,   // Updated adjustments
   *   0, 0, 0, // No fixed values
   *   []      // No AR values
   * );
   * ```
   */
  createOrders(
    usdPrice: number,
    inputLatestPrice: number,
    all = false,
    precOrderSize = 0,
    breakpoints: GridBreakpoint[] = [],
    balances: Asset[] | null = [],
    outsideSl = false,
    tpSlTargetFilled: string[] = [],
    _updatedComboAdjustments = true,
    fixSl = 0,
    fixTp = 0,
    fixSize = 0,
    dcaArValues: DynamicArPrices[] = [],
    sizes?: Sizes,
  ): DCAGrid[] {
    const { settings, symbol } = this
    const baseOrderSize = fixSize || parseFloat(settings.baseOrderSize)
    const _orderSize = parseFloat(settings.orderSize)
    const tpPerc = parseFloat(settings.tpPerc) / 100
    const slPerc = parseFloat(settings.slPerc) / 100
    const precision = this.utils.getBaseAssetPrecision(symbol)
    const step = parseFloat(settings.step) / 100
    const stepScale = parseFloat(settings.stepScale)
    const minimumDeviation = parseFloat(settings.minimumDeviation ?? '0') / 100
    const volumeScale = parseFloat(settings.volumeScale)
    let minOpenDeal = parseFloat(settings.minOpenDeal || '0')
    let maxOpenDeal = parseFloat(settings.maxOpenDeal || '0')
    minOpenDeal = isNaN(minOpenDeal) ? 0 : minOpenDeal
    maxOpenDeal = isNaN(maxOpenDeal) ? 0 : maxOpenDeal
    const {
      activeOrdersCount,
      useTp: _useTp,
      dealCloseCondition,
      useSmartOrders,
      useSl: _useSl,
      dealCloseConditionSL,
      coinm,
    } = settings
    const scaleAr =
      (settings?.dcaCondition === DCAConditionEnum.percentage ||
        !settings?.dcaCondition) &&
      [ScaleDcaTypeEnum.adr, ScaleDcaTypeEnum.atr].includes(
        settings?.scaleDcaType ?? ScaleDcaTypeEnum.percentage,
      ) &&
      settings?.useDca
    const { orderSizeType: _orderSizeType } = settings
    const orderSizeType = fixSize
      ? settings.futures
        ? settings.coinm
          ? OrderSizeTypeEnum.base
          : OrderSizeTypeEnum.quote
        : settings.strategy === StrategyEnum.long
          ? OrderSizeTypeEnum.quote
          : OrderSizeTypeEnum.base
      : _orderSizeType
    const useTp = _useTp && dealCloseCondition === CloseConditionEnum.tp
    const useArTp =
      _useTp && dealCloseCondition === CloseConditionEnum.dynamicAr
    const useSl = _useSl && dealCloseConditionSL === CloseConditionEnum.tp
    const useArSl =
      _useSl && dealCloseConditionSL === CloseConditionEnum.dynamicAr
    const latestPrice = this.math.round(
      inputLatestPrice,
      symbol.priceAssetPrecision,
    )
    if (
      settings.useStaticPriceFilter &&
      ((minOpenDeal !== 0 && latestPrice <= minOpenDeal) ||
        (maxOpenDeal !== 0 && latestPrice >= maxOpenDeal))
    ) {
      return []
    }
    let baseQty =
      orderSizeType === OrderSizeTypeEnum.usd
        ? this.math.round(
            baseOrderSize / (usdPrice * latestPrice),
            precision,
            true,
          )
        : orderSizeType === OrderSizeTypeEnum.base
          ? this.math.round(baseOrderSize + (sizes?.base ?? 0), precision, true)
          : orderSizeType === OrderSizeTypeEnum.quote
            ? this.math.round(
                (baseOrderSize * (coinm ? symbol.quoteAsset.minAmount : 1)) /
                  latestPrice +
                  (sizes?.base ?? 0),
                precision,
                true,
              )
            : this.math.round(
                symbol.quoteAsset.minAmount
                  ? symbol.quoteAsset.minAmount / latestPrice
                  : symbol.baseAsset.minAmount,
                precision,
                true,
              )
    let qtyToUse = 0
    if (
      orderSizeType === OrderSizeTypeEnum.percFree ||
      orderSizeType === OrderSizeTypeEnum.percTotal
    ) {
      const findBalance = (balances ?? []).find(
        (b) =>
          b.asset ===
          (settings.futures
            ? settings.coinm
              ? symbol.baseAsset.name
              : symbol.quoteAsset.name
            : settings.terminalDealType === TerminalDealTypeEnum.import
              ? settings.strategy === StrategyEnum.long
                ? symbol.baseAsset.name
                : symbol.quoteAsset.name
              : settings.strategy === StrategyEnum.short
                ? symbol.baseAsset.name
                : symbol.quoteAsset.name),
      )
      qtyToUse = findBalance
        ? orderSizeType === OrderSizeTypeEnum.percFree
          ? +findBalance.free
          : +findBalance.locked + +findBalance.free
        : 0
      if (settings.futures) {
        qtyToUse *=
          settings.marginType !== BotMarginTypeEnum.inherit
            ? (settings.leverage ?? 1)
            : 1
      }
      baseQty = this.math.round(
        Math.max(
          symbol.quoteAsset.minAmount
            ? symbol.quoteAsset.minAmount / latestPrice
            : symbol.baseAsset.minAmount,
          (qtyToUse * (baseOrderSize / 100)) /
            (settings.futures
              ? settings.coinm
                ? 1
                : latestPrice
              : settings.terminalDealType === TerminalDealTypeEnum.import
                ? settings.strategy === StrategyEnum.long
                  ? 1
                  : latestPrice
                : settings.strategy === StrategyEnum.short
                  ? 1
                  : latestPrice),
        ),
        precision,
        true,
      )
    }
    const long = settings.strategy === StrategyEnum.long
    const ordersSide = long ? BotOrderSideEnum.buy : BotOrderSideEnum.sell
    let tpPrice = this.math.round(
      fixTp ||
        latestPrice *
          (1 + (settings.strategy === StrategyEnum.long ? 1 : -1) * tpPerc),
      symbol.priceAssetPrecision,
    )
    if (tpPrice === latestPrice) {
      tpPrice = this.math.round(
        latestPrice +
          (settings.strategy === StrategyEnum.long ? 1 : -1) *
            Number(`${1}e-${symbol.priceAssetPrecision}`),
        symbol.priceAssetPrecision,
      )
    }
    if (useArTp) {
      const indicator = settings.indicators.find(
        (ind) =>
          ind.indicatorAction === IndicatorAction.closeDeal &&
          ind.section !== IndicatorSection.sl,
      )
      if (indicator) {
        let value = dcaArValues.find((d) => d.id === indicator.uuid)?.value
        if (value && !isNaN(value) && isFinite(value)) {
          value *= +(indicator.dynamicArFactor || '1')
          tpPrice = this.math.round(
            latestPrice +
              value * (settings.strategy === StrategyEnum.long ? 1 : -1),

            symbol?.priceAssetPrecision ?? 8,
          )
        }
      }
    }
    const baseOrder: DCAGrid = {
      qty: baseQty,
      price: latestPrice,
      type: DCAOrderTypeEnum.bo,
      side: ordersSide,
      id: this.utils.id(20),
      priceDeviation: '0%',
      avgPrice: latestPrice,
      requiredPrice: useTp ? tpPrice : undefined,
      levelNumber: 0,
    }
    if (baseOrder.qty < symbol.baseAsset.minAmount) {
      baseOrder.qty = this.math.round(
        symbol.baseAsset.minAmount,
        precision,
        false,
        true,
      )
    }
    if (baseOrder.price * baseOrder.qty < symbol.quoteAsset.minAmount) {
      baseOrder.qty = this.math.round(
        symbol.quoteAsset.minAmount / baseOrder.price,
        precision,
        false,
        true,
      )
    }
    if (settings.coinm) {
      const cont =
        (baseOrder.price * baseOrder.qty) / symbol.quoteAsset.minAmount
      if (cont < 1) {
        baseOrder.qty = this.math.round(
          symbol.quoteAsset.minAmount / baseOrder.price,
          precision,
          false,
          true,
        )
      } else if (cont % 1 > Number.EPSILON) {
        baseOrder.qty = this.math.round(
          (this.math.round(cont, 0) * symbol.quoteAsset.minAmount) /
            baseOrder.price,
          precision,
          false,
          true,
        )
      }
    }
    const mod = baseOrder.qty % symbol.baseAsset.step
    if (mod > Number.EPSILON) {
      baseOrder.qty = this.math.round(
        baseOrder.qty - mod + symbol.baseAsset.step,
        precision,
        false,
        true,
      )
    }
    baseOrder.base = baseOrder.qty
    baseOrder.quote = this.math.round(
      baseOrder.qty * latestPrice,
      symbol.priceAssetPrecision,
    )
    const tpOrder: DCAGrid = {
      qty: baseOrder.qty,
      price: tpPrice,
      type: DCAOrderTypeEnum.tp,
      side:
        settings.strategy === StrategyEnum.long
          ? BotOrderSideEnum.sell
          : BotOrderSideEnum.buy,
      id: this.utils.id(20),
    }
    if (
      tpOrder.price * tpOrder.qty < symbol.quoteAsset.minAmount &&
      !settings.futures
    ) {
      tpOrder.qty = this.math.round(
        symbol.quoteAsset.minAmount / tpOrder.price,
        precision,
        false,
        true,
      )
    }
    let tpOrders = [tpOrder]
    if (settings.useMultiTp) {
      let restQty = tpOrder.qty
      let end = false
      tpOrders = []
      ;[...(settings.multiTp ?? [])]
        .sort((a, b) => +a.target - +b.target)
        .map((tp) => {
          if (end) {
            return null
          }
          let price = this.math.round(
            latestPrice *
              (1 +
                (settings.strategy === StrategyEnum.long ? 1 : -1) *
                  (+tp.target / 100)),
            symbol.priceAssetPrecision,
          )
          if (price === latestPrice) {
            price = this.math.round(
              latestPrice +
                (settings.strategy === StrategyEnum.long ? 1 : -1) *
                  Number(`${1}e-${symbol.priceAssetPrecision}`),
              symbol.priceAssetPrecision,
            )
          }
          let qty = this.math.round(
            baseOrder.qty * (+tp.amount / 100),
            precision,
            true,
          )
          if (qty > restQty) {
            qty = this.math.round(restQty, precision, true)
          }
          if (qty < symbol.baseAsset.minAmount) {
            qty = this.math.round(symbol.baseAsset.minAmount, precision, true)
          }
          if (price * qty < symbol.quoteAsset.minAmount && !settings.futures) {
            qty = this.math.round(
              symbol.quoteAsset.minAmount / price,
              precision,
              true,
            )
          }

          const modQty = this.math.remainder(qty, symbol.baseAsset.step)
          if (modQty !== 0) {
            qty = this.math.round(
              qty - modQty + symbol.baseAsset.step,
              precision,
              true,
            )
          }
          restQty -= qty
          if (
            restQty < symbol.baseAsset.minAmount ||
            restQty * price < symbol.quoteAsset.minAmount ||
            restQty < 0
          ) {
            end = true
            qty =
              restQty > 0 && restQty > symbol.baseAsset.step
                ? this.math.round(qty + restQty, precision, true)
                : qty
          }

          return {
            ...tpOrder,
            qty,
            price,
            id: this.utils.id(20),
            label: `TP order ${
              (settings.multiTp ?? []).findIndex((fi) => tp.uuid === fi.uuid) +
              1
            }`,
            tpSlTarget: tp.uuid,
          }
        })
        .forEach((o) => {
          if (o) {
            tpOrders.push(o)
          }
        })
    }

    if (settings.profitCurrency === 'base') {
      const qty = this.math.round(
        (baseOrder.qty * latestPrice) / tpOrder.price,
        precision,
      )
      tpOrder.qty =
        settings.strategy === StrategyEnum.long
          ? Math.min(tpOrder.qty, qty)
          : Math.max(tpOrder.qty, qty)
    }
    const gridStep = latestPrice * step
    const minGridStep =
      settings.dcaCondition === DCAConditionEnum.percentage &&
      (settings.scaleDcaType === ScaleDcaTypeEnum.atr ||
        settings.scaleDcaType === ScaleDcaTypeEnum.adr)
        ? latestPrice * minimumDeviation
        : 0
    let orders: DCAGrid[] = []
    if (settings.useDca) {
      const ordersCount =
        settings.dcaCondition === DCAConditionEnum.indicators
          ? settings.indicators.filter(
              (i) => i.indicatorAction === IndicatorAction.startDca,
            ).length
          : settings.dcaCondition === DCAConditionEnum.custom
            ? (settings.dcaCustom ?? []).length
            : parseInt(`${settings.ordersCount}`)
      const useVolumeChange =
        settings.dcaVolumeBaseOn === DCAVolumeType.change &&
        settings.useTp &&
        settings.dealCloseCondition === CloseConditionEnum.tp &&
        settings.tpPerc &&
        !settings.useMultiTp &&
        !settings.trailingTp &&
        ![OrderSizeTypeEnum.percFree, OrderSizeTypeEnum.percTotal].includes(
          orderSizeType,
        )
      const volumeChangeValue =
        +(settings.dcaVolumeRequiredChange ?? tpPerc * 100) *
        (long ? 1 + Math.min(0.02, tpPerc) : 1 - Math.min(0.02, tpPerc))
      let maxVolumeSize = +(settings.dcaVolumeMaxValue ?? '-1')
      if (maxVolumeSize < 0) {
        maxVolumeSize = Infinity
      }
      for (let i = 1; i <= ordersCount; i++) {
        if (scaleAr && !dcaArValues.length) {
          continue
        }
        const stepVal =
          settings.dcaCondition === DCAConditionEnum.indicators ||
          settings.dcaCondition === DCAConditionEnum.custom
            ? 1
            : stepScale ** (i - 1)
        const volumeVal =
          settings.dcaCondition === DCAConditionEnum.indicators ||
          settings.dcaCondition === DCAConditionEnum.custom ||
          useVolumeChange
            ? 1
            : volumeScale ** (i - 1)
        let price = this.math.round(
          (i === 1 ? latestPrice : orders[orders.length - 1].price) -
            (settings.strategy === StrategyEnum.long ? 1 : -1) *
              gridStep *
              stepVal,
          symbol.priceAssetPrecision,
        )
        if (settings.dcaCondition === DCAConditionEnum.indicators) {
          const indicatorValue =
            +(
              settings.indicators.filter(
                (ind) => ind.indicatorAction === IndicatorAction.startDca,
              )[i - 1]?.minPercFromLast ?? '100'
            ) / 100
          price = this.math.round(
            (i === 1 ? latestPrice : orders[orders.length - 1].price) *
              (settings.strategy === StrategyEnum.long
                ? 1 - indicatorValue
                : 1 + indicatorValue),

            symbol.priceAssetPrecision,
          )
        }
        if (settings.dcaCondition === DCAConditionEnum.custom) {
          const dcaCustomValue =
            +((settings.dcaCustom ?? [])[i - 1]?.step ?? '1') / 100
          price = this.math.round(
            (i === 1 ? latestPrice : orders[orders.length - 1].price) *
              (settings.strategy === StrategyEnum.long
                ? 1 - dcaCustomValue
                : 1 + dcaCustomValue),

            symbol.priceAssetPrecision,
          )
        }
        if (scaleAr) {
          const indicator = settings.indicators.find(
            (ind) => ind.indicatorAction === IndicatorAction.startDca,
          )
          if (indicator) {
            let value = dcaArValues.find((d) => d.id === indicator.uuid)?.value
            if (value && !isNaN(value) && isFinite(value)) {
              const stepAr = i < 2 ? 1 : stepScale ** (i - 2)
              value *= +(indicator.dynamicArFactor || '1') * stepAr
              const lastPrice =
                i === 1 ? latestPrice : (orders[orders.length - 1]?.price ?? 0)
              price = this.math.round(
                lastPrice +
                  value * (settings.strategy === StrategyEnum.long ? -1 : 1),
                symbol.priceAssetPrecision,
              )
              const priceMinDeviation = minGridStep
                ? this.math.round(
                    lastPrice +
                      (settings.strategy === StrategyEnum.long ? -1 : 1) *
                        minGridStep *
                        stepVal,
                    symbol.priceAssetPrecision,
                  )
                : 0
              if (priceMinDeviation) {
                price =
                  settings.strategy === StrategyEnum.long
                    ? Math.min(price, priceMinDeviation)
                    : Math.max(price, priceMinDeviation)
              }
            }
          } else {
            continue
          }
        }
        if (i === 1) {
          if (price === baseOrder.price) {
            price = this.math.round(
              baseOrder.price +
                (settings.strategy === StrategyEnum.long ? -1 : 1) *
                  Number(`${1}e-${symbol.priceAssetPrecision}`),
              symbol.priceAssetPrecision,
            )
          }
        }
        if (i > 1) {
          if (price === orders[orders.length - 1].price) {
            price = this.math.round(
              orders[orders.length - 1].price +
                (settings.strategy === StrategyEnum.long ? -1 : 1) *
                  Number(`${1}e-${symbol.priceAssetPrecision}`),
              symbol.priceAssetPrecision,
            )
          }
        }
        if (price <= 0) {
          break
        }
        const findBreakpoint = breakpoints
          .sort((a, b) => (long ? b.price - a.price : a.price - b.price))
          .find((b) => b.price === price)
        if (findBreakpoint) {
          price = this.math.round(
            findBreakpoint.displacedPrice,
            symbol.priceAssetPrecision,
          )
        }
        let orderSize = _orderSize
        if (
          settings.dcaCondition === DCAConditionEnum.indicators &&
          !useVolumeChange
        ) {
          orderSize =
            +(
              settings.indicators.filter(
                (ind) => ind.indicatorAction === IndicatorAction.startDca,
              )[i - 1]?.orderSize ?? '0'
            ) || _orderSize
        }
        if (
          settings.dcaCondition === DCAConditionEnum.custom &&
          !useVolumeChange
        ) {
          orderSize =
            +((settings.dcaCustom ?? [])[i - 1]?.size ?? '0') || _orderSize
        }
        if (useVolumeChange) {
          const quote =
            baseOrder.price * baseOrder.qty +
            orders.reduce((acc, v) => acc + v.price * v.qty, 0)
          const base = baseOrder.qty + orders.reduce((acc, v) => acc + v.qty, 0)
          if (
            settings.dcaVolumeRequiredChangeRef ===
            DcaVolumeRequiredChangeRef.avg
          ) {
            const newAvg =
              price * (1 + (volumeChangeValue / 100) * (long ? 1 : -1))
            orderSize = (newAvg * base - quote) / (price - newAvg)
          } else {
            const c =
              ((volumeChangeValue / 100 + 1) * price) /
              (1 + tpPerc * (long ? 1 : -1))
            orderSize = (c * base - quote) / (price - c)
          }
          if (orderSizeType === OrderSizeTypeEnum.quote) {
            orderSize *= price
          }
          orderSize = Math.min(maxVolumeSize, orderSize)
        }
        let qty =
          orderSizeType === OrderSizeTypeEnum.usd
            ? this.math.round(orderSize / (usdPrice * latestPrice), precision)
            : orderSizeType === OrderSizeTypeEnum.quote
              ? this.math.round(
                  ((orderSize * (coinm ? symbol.quoteAsset.minAmount : 1)) /
                    price) *
                    volumeVal +
                    (sizes?.dca?.[i - 1] ?? 0),
                  precision,
                )
              : orderSizeType === OrderSizeTypeEnum.base
                ? this.math.round(
                    orderSize * volumeVal + (sizes?.dca?.[i - 1] ?? 0),
                    precision,
                  )
                : orderSizeType === OrderSizeTypeEnum.percFree ||
                    orderSizeType === OrderSizeTypeEnum.percTotal
                  ? precOrderSize !== 0
                    ? this.math.round(precOrderSize * volumeVal, precision)
                    : this.math.round(
                        ((qtyToUse * (+orderSize / 100)) /
                          (settings.futures
                            ? settings.coinm
                              ? 1
                              : price
                            : settings.terminalDealType ===
                                TerminalDealTypeEnum.import
                              ? settings.strategy === StrategyEnum.long
                                ? 1
                                : price
                              : settings.strategy === StrategyEnum.short
                                ? 1
                                : price)) *
                          volumeVal,
                        precision,
                      )
                  : this.math.round(
                      Math.max(
                        symbol.quoteAsset.minAmount
                          ? symbol.quoteAsset.minAmount / latestPrice
                          : symbol.baseAsset.minAmount,
                        (qtyToUse * orderSize) / 100 / latestPrice,
                      ),
                      precision,
                    )
        if (qty < symbol.baseAsset.minAmount) {
          qty = symbol.baseAsset.minAmount
        }
        if (price * qty < symbol.quoteAsset.minAmount) {
          qty = this.math.round(
            symbol.quoteAsset.minAmount / price,
            precision,
            false,
            true,
          )
        }
        if (settings.coinm) {
          const cont = (price * qty) / symbol.quoteAsset.minAmount
          if (cont < 1) {
            qty = this.math.round(
              symbol.quoteAsset.minAmount / price,
              precision,
              false,
              true,
            )
          } else if (cont % 1 > Number.EPSILON) {
            qty = this.math.round(
              (this.math.round(cont, 0) * symbol.quoteAsset.minAmount) / price,
              precision,
              false,
              true,
            )
          }
        }
        const modQty = qty % symbol.baseAsset.step
        if (modQty !== 0) {
          qty = this.math.round(
            qty - modQty + symbol.baseAsset.step,
            precision,
            false,
            true,
          )
        }
        const base =
          baseOrder.qty + orders.reduce((acc, v) => acc + v.qty, 0) + qty
        const quote =
          baseOrder.price * baseOrder.qty +
          orders.reduce((acc, v) => acc + v.price * v.qty, 0) +
          qty * price
        const avgPrice = this.math.round(
          quote / base,
          symbol.priceAssetPrecision,
        )
        orders.push({
          qty,
          price,
          type: DCAOrderTypeEnum.dca,
          side: ordersSide,
          id: this.utils.id(20),
          priceDeviation: `${this.math.round(
            ((latestPrice - price) / latestPrice) * 100,
            0,
          )}%`,
          avgPrice,
          requiredPrice: useTp
            ? this.math.round(
                avgPrice * (1 + tpPerc),
                symbol.priceAssetPrecision,
              )
            : undefined,
          note:
            price < 0
              ? `This order won't be placed, because price deviation more than 100%`
              : qty * price < symbol.quoteAsset.minAmount
                ? `This order won't be placed, because order amount is less than min allowed by the exchange: ${symbol.quoteAsset.minAmount} ${symbol.quoteAsset.name}`
                : '',
          base: this.math.round(base, precision),
          quote: this.math.round(quote, symbol.priceAssetPrecision),
          levelNumber: i,
        })
      }
      if (!all && useSmartOrders) {
        orders = [
          ...orders
            .sort((a, b) =>
              settings.strategy === StrategyEnum.long
                ? b.price - a.price
                : a.price - b.price,
            )
            .slice(0, parseInt(`${activeOrdersCount}`)),
        ]
      }
    }
    const useOutsideSl =
      this.settings.useSl &&
      !this.settings.moveSL &&
      this.settings.dealCloseConditionSL === CloseConditionEnum.tp &&
      !this.settings.useMultiSl &&
      !this.settings.trailingSl
    let finalBreakeven = orders.length
      ? (orders[orders.length - 1].avgPrice ?? latestPrice)
      : latestPrice

    const slOrder: DCAGrid = {
      ...tpOrder,
      price: this.math.round(
        fixSl ||
          finalBreakeven *
            (1 +
              (settings.strategy === StrategyEnum.long ? 1 : -1) * slPerc +
              this.userFee * 2),
        symbol?.priceAssetPrecision ?? 8,
      ),
      type: DCAOrderTypeEnum.sl,
      id: this.utils.id(20),
    }
    if (useArSl) {
      const indicator = settings.indicators.find(
        (ind) =>
          ind.indicatorAction === IndicatorAction.closeDeal &&
          ind.section === IndicatorSection.sl,
      )
      if (indicator) {
        let value = dcaArValues.find((d) => d.id === indicator.uuid)?.value
        if (value && !isNaN(value) && isFinite(value)) {
          value *= +(indicator.dynamicArFactor || '1')
          slOrder.price = this.math.round(
            latestPrice +
              value * (settings.strategy === StrategyEnum.long ? -1 : 1),

            symbol?.priceAssetPrecision ?? 8,
          )
        }
      }
    }
    if (orders.length && useOutsideSl && outsideSl && !fixSl) {
      let i = 0
      for (const o of orders) {
        const order = orders[i]
        finalBreakeven = order.avgPrice ?? latestPrice
        slOrder.price = this.math.round(
          useArSl
            ? slOrder.price
            : finalBreakeven *
                (1 +
                  (settings.strategy === StrategyEnum.long ? 1 : -1) * slPerc +
                  this.userFee * 2),
          symbol?.priceAssetPrecision ?? 8,
        )
        const leftOrders = orders.filter(
          (_o) =>
            _o.id !== o.id &&
            o.type === DCAOrderTypeEnum.dca &&
            (long
              ? o.price > _o.price && _o.price > slOrder.price
              : o.price < _o.price && _o.price < slOrder.price),
        )
        if (leftOrders.length === 0) {
          break
        }
        i++
      }
    }
    let slOrders = [slOrder]
    if (settings.useMultiSl) {
      let restQty = slOrder.qty
      let end = false
      slOrders = []
      ;[...(settings.multiSl ?? [])]
        .sort((a, b) => +b.target - +a.target)
        .filter((tp) => !(tpSlTargetFilled ?? []).includes(tp.uuid))
        .map((tp) => {
          if (end) {
            return null
          }
          let price = this.math.round(
            latestPrice *
              (1 +
                (settings.strategy === StrategyEnum.long ? 1 : -1) *
                  (+tp.target / 100)),
            symbol.priceAssetPrecision,
          )
          if (price === latestPrice) {
            price = this.math.round(
              latestPrice +
                (settings.strategy === StrategyEnum.long ? 1 : -1) *
                  Number(`${1}e-${symbol.priceAssetPrecision}`),
              symbol.priceAssetPrecision,
            )
          }
          let qty = this.math.round(
            baseOrder.qty * (+tp.amount / 100),
            precision,
            true,
          )
          if (qty > restQty) {
            qty = this.math.round(restQty, precision, true)
          }
          if (qty < symbol.baseAsset.minAmount) {
            qty = this.math.round(symbol.baseAsset.minAmount, precision, true)
          }
          if (price * qty < symbol.quoteAsset.minAmount && !settings.futures) {
            qty = this.math.round(
              symbol.quoteAsset.minAmount / price,
              precision,
              true,
            )
          }

          const modQty = this.math.remainder(qty, symbol.baseAsset.step)
          if (modQty !== 0) {
            qty = this.math.round(
              qty - modQty + symbol.baseAsset.step,
              precision,
              true,
            )
          }
          restQty -= qty

          if (
            restQty < symbol.baseAsset.minAmount ||
            restQty * price < symbol.quoteAsset.minAmount ||
            restQty < 0
          ) {
            end = true
            qty =
              restQty > 0 && restQty > symbol.baseAsset.step
                ? this.math.round(qty + restQty, precision, true)
                : qty
          }

          return {
            ...slOrder,
            qty,
            price,
            id: this.utils.id(20),
            label: `SL order ${
              (settings.multiSl ?? []).findIndex((fi) => tp.uuid === fi.uuid) +
              1
            }`,
            tpSlTarget: tp.uuid,
          }
        })
        .forEach((o) => {
          if (o) {
            slOrders.push(o)
          }
        })
    }
    const result = [...orders, baseOrder, ...tpOrders, ...slOrders]
      .filter(
        (o) =>
          (!useTp && !fixTp && !useArTp
            ? o.type !== DCAOrderTypeEnum.tp
            : true) &&
          (!useSl && !fixSl && !useArSl
            ? o.type !== DCAOrderTypeEnum.sl
            : true),
      )
      .flat()
      .sort((a, b) =>
        settings.strategy === StrategyEnum.long
          ? b.price - a.price
          : a.price - b.price,
      )
    if ((useOutsideSl && outsideSl) || useArSl) {
      const slLevel = result
        .filter((o) => o.type === DCAOrderTypeEnum.sl)
        .sort((a, b) =>
          long ? b.price - a.price : a.price - b.price,
        )[0]?.price
      if (slLevel) {
        return result.filter((r) => {
          return r.type === DCAOrderTypeEnum.dca
            ? long
              ? r.price > slLevel
              : r.price < slLevel
            : true
        })
      }
    }
    return result
  }

  /**
   * Generates stop loss orders with temporary settings adjustments
   *
   * This method creates stop loss orders by temporarily modifying bot settings
   * to enable SL functionality if needed, then restores original settings.
   * It's primarily used for calculating SL orders with different parameters
   * than the current bot configuration.
   *
   * @param usdPrice - Current USD price for USD-based calculations
   * @param slPerc - Stop loss percentage to use (decimal, e.g., 0.05 for 5%)
   * @param breakeven - Breakeven price for SL calculation
   * @param all - Whether to generate all orders regardless of limits
   * @param precOrderSize - Precise order size override
   * @param breakpoints - Grid breakpoints for custom price levels
   * @param balances - Current account balances
   * @param outsideSl - Whether position is outside stop loss range
   * @param tpSlTargetFilled - Array of already filled TP/SL target IDs
   *
   * @returns Array of stop loss orders only (filtered from complete order set)
   *
   * @note This method temporarily modifies bot settings and restores them
   * after order generation. It ensures SL orders are generated even if
   * the bot is not configured for stop losses.
   *
   * @example
   * ```typescript
   * const slOrders = dcaBot.getSLOrder(
   *   50000,   // USD price
   *   0.05,    // 5% stop loss
   *   40000,   // Breakeven price
   *   false,   // Not all orders
   *   0,       // No size override
   *   [],      // No breakpoints
   *   balances,
   *   false,   // Not outside SL
   *   []       // No filled targets
   * );
   * ```
   */
  getSLOrder(
    usdPrice: number,
    slPerc: number,
    breakeven: number,
    all = false,
    precOrderSize = 0,
    breakpoints: GridBreakpoint[] = [],
    balances: Asset[] | null = [],
    outsideSl = false,
    tpSlTargetFilled: string[] = [],
  ) {
    let unsetTP = false
    let closeCondition = this.settings.dealCloseCondition
    let changeSl = false
    let unsetSl = false
    let closeConditionSl = this.settings.dealCloseConditionSL
    const sl = this.settings.slPerc
    if (+this.settings.slPerc !== slPerc) {
      this.settings.slPerc = `${slPerc}`
      changeSl = true
    }
    if (!this.settings.useTp) {
      unsetTP = true
      this.settings.useTp = true
      if (closeCondition !== CloseConditionEnum.tp) {
        closeCondition = this.settings.dealCloseCondition
        this.settings.dealCloseCondition = CloseConditionEnum.tp
      }
    }
    if (!this.settings.useSl) {
      unsetSl = true
      this.settings.useSl = true
      if (closeCondition !== CloseConditionEnum.tp) {
        closeConditionSl = this.settings.dealCloseConditionSL
        this.settings.dealCloseConditionSL = CloseConditionEnum.tp
      }
    }
    const orders = this.createOrders(
      usdPrice,
      breakeven,
      all,
      precOrderSize,
      breakpoints,
      balances,
      outsideSl,
      tpSlTargetFilled,
    )
    const slOrders = orders.filter((o) => o.type === DCAOrderTypeEnum.sl)
    if (unsetTP) {
      this.settings.useTp = false
      if (closeCondition !== this.settings.dealCloseCondition) {
        this.settings.dealCloseCondition = closeCondition
      }
    }
    if (unsetSl) {
      this.settings.useSl = false
      if (closeConditionSl !== this.settings.dealCloseConditionSL) {
        this.settings.dealCloseConditionSL = closeConditionSl
      }
    }
    if (changeSl) {
      this.settings.slPerc = sl
    }
    return slOrders
  }
}

/**
 * @exports DCABotFunctions
 * Main class for DCA (Dollar Cost Averaging) bot functionality.
 *
 * This class encapsulates all the complex logic needed for DCA trading strategies
 * including order generation, risk management, and dynamic pricing calculations.
 * It integrates with various market conditions, indicators, and user preferences
 * to create optimal trading grids for backtesting and live trading.
 */
export default DCABotFunctions
