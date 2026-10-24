import { describe, it } from 'mocha'
import { expect } from 'chai'
import { OTELevels, oteCondition } from '@gainium/indicators'

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
  OrderSizeTypeEnum,
  OrderTypeEnum,
  OTELegEnum,
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
 * OTE Levels as a start condition: deals open exactly on the bars where the
 * indicator package's own `OTELevels` + `oteCondition` fire, so the
 * backtester and the live engine (which calls the same decision) agree.
 */

const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)
const PAIR = 'AAA_USDT'

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binance,
  baseAsset: { name: 'AAA', minAmount: 0.0001, maxAmount: 1e9, step: 0.0001 },
  quoteAsset: { name: 'USDT', minAmount: 1 },
  maxOrders: 200,
  priceAssetPrecision: 4,
}

const bars: FullBar[] = Array.from({ length: 1600 }, (_, i) => {
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

  it('reads only legs of the chosen direction', async () => {
    const bull = await run(IndicatorStartConditionEnum.lt, OTELegEnum.bullish)
    const bear = await run(IndicatorStartConditionEnum.lt, OTELegEnum.bearish)
    expect(bull).to.not.deep.equal(bear)
  })
})

const base = {
  name: 'ote',
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

const settings = {
  oteLeftBars: '5',
  oteMinLegSize: '5',
  oteLevel: '0.618',
}

let runNo = 0
const run = async (
  condition: IndicatorStartConditionEnum,
  oteLeg: OTELegEnum,
) => {
  StrategyContextManager.setActiveContext(`ote-${++runNo}`)
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
          type: IndicatorEnum.ote,
          ...settings,
          oteLeg,
          indicatorCondition: condition,
          indicatorInterval: ExchangeIntervals.oneH,
          indicatorAction: IndicatorAction.startDeal,
          groupId: 'g',
          uuid: 'u-ote',
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

/** Bar times on which the indicator package itself says the condition holds. */
const signalTimes = (condition: string, leg: OTELegEnum) => {
  const ind = new OTELevels(5, 5)
  let prev = null
  const out: number[] = []
  for (const b of bars) {
    const last = ind.next(b)
    if (oteCondition(last, prev, { level: 0.618, leg, condition })) {
      out.push(b.time)
    }
    prev = last
  }
  return out
}

describe('OTE Levels start condition', () => {
  for (const [condition, leg] of [
    [IndicatorStartConditionEnum.cd, OTELegEnum.bullish],
    [IndicatorStartConditionEnum.lt, OTELegEnum.bullish],
    [IndicatorStartConditionEnum.cu, OTELegEnum.bearish],
  ] as const) {
    it(`opens deals only on ${condition} / ${leg} signal bars`, async () => {
      const deals = await run(condition, leg)
      const signals = signalTimes(condition, leg)
      expect(deals.length).to.be.greaterThan(0)
      // a signal at a bar's close opens the deal on the next bar
      for (const t of deals) {
        expect(signals, `deal at bar ${(t - FROM) / HOUR}`).to.include(t - HOUR)
      }
    })
  }

  it('reads only legs of the chosen direction', async () => {
    const bull = await run(IndicatorStartConditionEnum.lt, OTELegEnum.bullish)
    const bear = await run(IndicatorStartConditionEnum.lt, OTELegEnum.bearish)
    expect(bull).to.not.deep.equal(bear)
  })
})
