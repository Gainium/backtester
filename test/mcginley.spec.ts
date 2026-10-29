import { describe, it } from 'mocha'
import { expect } from 'chai'
import { McGinley } from '@gainium/indicators'

import DCABacktesting from '../src/dca'
import { StrategyContextManager } from '../src/dca/strategy/context'
import {
  CloseConditionEnum,
  DCAConditionEnum,
  ExchangeEnum,
  ExchangeIntervals,
  IndicatorAction,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  MAEnum,
  OrderSizeTypeEnum,
  OrderTypeEnum,
  StartConditionEnum,
  StrategyEnum,
} from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  Symbols,
} from '../src/types'

/**
 * McGinley Dynamic as an MA type: a Moving Average start condition with
 * `maType: mcginley` opens deals exactly on the bars after the indicator
 * package's own `McGinley` and the close cross, the same as the live engine
 * (which feeds the same class through the factory).
 */

const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)
const PAIR = 'AAA_USDT'
const LENGTH = 14

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binance,
  baseAsset: { name: 'AAA', minAmount: 0.0001, maxAmount: 1e9, step: 0.0001 },
  quoteAsset: { name: 'USDT', minAmount: 1 },
  maxOrders: 200,
  priceAssetPrecision: 4,
}

const bars: FullBar[] = Array.from({ length: 1200 }, (_, i) => {
  const p = (k: number) =>
    100 + 12 * Math.sin(k / 23) + 4 * Math.sin(k / 5) + k * 0.01
  const open = p(i - 1)
  const close = p(i)
  return {
    time: FROM + i * HOUR,
    open,
    close,
    high: Math.max(open, close) + 0.6,
    low: Math.min(open, close) - 0.6,
    volume: 1000,
    symbol: PAIR,
  }
})

const base = {
  name: 'mcginley',
  pair: [PAIR],
  strategy: StrategyEnum.long,
  futures: false,
  coinm: false,
  leverage: 1,
  profitCurrency: 'quote',
  orderSizeType: OrderSizeTypeEnum.quote,
  orderFixedIn: 'quote',
  baseOrderSize: '100',
  orderSize: '100',
  startOrderType: OrderTypeEnum.market,
  dcaCondition: DCAConditionEnum.percentage,
  scaleDcaType: 'percentage',
  useDca: false,
  ordersCount: 0,
  activeOrdersCount: 0,
  step: '1.5',
  stepScale: '1',
  volumeScale: '1',
  minimumDeviation: '0',
  useTp: true,
  tpPerc: '0.3',
  useSl: false,
  slPerc: '-12',
  dealCloseCondition: CloseConditionEnum.tp,
  dealCloseConditionSL: CloseConditionEnum.tp,
  closeDealType: 'closeByMarket',
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
} as unknown as DCABotSettings

let runNo = 0
const run = async (maType: MAEnum, condition: IndicatorStartConditionEnum) => {
  StrategyContextManager.setActiveContext(`mcginley-${++runNo}`)
  const bt = new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: [symbol],
    interval: ExchangeIntervals.oneH,
    userFee: 0.001,
    prices: [{ symbol: PAIR, price: 100 }],
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + bars.length * HOUR,
    settings: {
      ...base,
      startCondition: StartConditionEnum.ti,
      indicators: [
        {
          type: IndicatorEnum.ma,
          maType,
          indicatorLength: LENGTH,
          maCrossingValue: MAEnum.price,
          indicatorCondition: condition,
          indicatorInterval: ExchangeIntervals.oneH,
          indicatorAction: IndicatorAction.startDeal,
          groupId: 'g',
          uuid: 'u-mg',
        },
      ],
      indicatorGroups: [
        {
          id: 'g',
          logic: IndicatorsLogicEnum.and,
          action: IndicatorAction.startDeal,
        },
      ],
    } as unknown as DCABotSettings,
    fullResult: true,
  } as never)
  const r = (await bt.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return r.deals.map((d) => d.startTime).sort((a, b) => a - b)
}

/**
 * Bar times where the close crosses the package's own McGinley line:
 * `cu` = the MA crosses up the price (close now below it, at or above it on
 * the bar before), `cd` the opposite — the strategy's comparison with the
 * MA as `last` and the close as `value`.
 */
const signalTimes = (condition: IndicatorStartConditionEnum) => {
  const mg = new McGinley(LENGTH)
  let prev: { ma: number; price: number } | null = null
  const out: number[] = []
  for (const b of bars) {
    const ma = mg.next(b.close)
    if (ma === null) continue
    if (prev) {
      const fired =
        condition === IndicatorStartConditionEnum.cu
          ? b.close < ma && prev.price >= prev.ma
          : b.close > ma && prev.price <= prev.ma
      if (fired) out.push(b.time)
    }
    prev = { ma, price: b.close }
  }
  return out
}

describe('McGinley Dynamic MA start condition', () => {
  for (const condition of [
    IndicatorStartConditionEnum.cu,
    IndicatorStartConditionEnum.cd,
  ]) {
    it(`opens deals only on ${condition} crossing bars`, async () => {
      const deals = await run(MAEnum.mcginley, condition)
      const signals = signalTimes(condition)
      expect(deals.length).to.be.greaterThan(0)
      // a signal at a bar's close opens the deal on the next bar
      for (const t of deals) {
        expect(signals, `deal at bar ${(t - FROM) / HOUR}`).to.include(t - HOUR)
      }
    })
  }

  it('is a different line from EMA of the same length', async () => {
    const mg = await run(MAEnum.mcginley, IndicatorStartConditionEnum.cd)
    const ema = await run(MAEnum.ema, IndicatorStartConditionEnum.cd)
    expect(mg).to.not.deep.equal(ema)
  })
})
