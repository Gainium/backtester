import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import HedgeBacktesting from '../src/hedge'
import { StrategyContextManager } from '../src/dca/strategy/context'
import {
  ExchangeEnum,
  ExchangeIntervals,
  IndicatorAction,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  StartConditionEnum,
  StrategyEnum,
  timeIntervalMap,
  tvIntervalMap,
} from '../src/types'
import type {
  DCABacktestingInput,
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  PeriodParams,
  Symbols,
} from '../src/types'
import { base, mkSymbol } from './helpers/singlePositionHarness'

/**
 * Spec 012. With the hedge TP/SL off, each hedge leg must trade exactly
 * like the same DCA bot backtested on its own, when both load their
 * candles through the loader (the dashboard path).
 */

const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 10)
const TO = FROM + 20 * 24 * HOUR

const one = mkSymbol('AAA_USDT', 'AAA')
const two = mkSymbol('BBB_USDT', 'BBB')

const resolutionToInterval = new Map(
  Object.entries(tvIntervalMap).map(([interval, res]) => [
    res,
    interval as ExchangeIntervals,
  ]),
)

/** A deterministic price path per pair, sampled at any interval. */
const price = (pair: string, t: number) => {
  const k = t / HOUR + (pair === one.pair ? 0 : 37)
  return (
    100 + 12 * Math.sin(k / 23) + 4 * Math.sin(k / 5) + 2 * Math.sin(k / 97)
  )
}

/** Loader: every bar of the interval inside [from, to], like the exchange. */
const load = async (
  pair: string,
  _base: string,
  _quote: string,
  resolution: string,
  period: PeriodParams,
) => {
  const interval = resolutionToInterval.get(resolution)
  if (!interval) {
    throw new Error(`unknown resolution ${resolution}`)
  }
  const step = timeIntervalMap[interval]
  const bars: Omit<FullBar, 'symbol'>[] = []
  for (
    let t = Math.ceil((period.from * 1000) / step) * step;
    t <= period.to * 1000;
    t += step
  ) {
    const open = price(pair, t)
    const close = price(pair, t + step)
    bars.push({
      time: t,
      open,
      close,
      high: Math.max(open, close) + 0.3,
      low: Math.min(open, close) - 0.3,
      volume: 1000,
    })
  }
  return bars
}

// RSI(7) on 4h above 30 starts a deal: a condition that reads 28h of
// history before its first value, so a leg loaded without the warm-up
// cannot start a deal on the first day.
const settings = (strategy: StrategyEnum) =>
  ({
    ...base,
    strategy,
    pair: [one.pair, two.pair],
    startCondition: StartConditionEnum.ti,
    useDca: false,
    useSl: false,
    tpPerc: '1.5',
    // one open deal across both pairs: the pairs compete for the slot, so
    // the leg's bars must be read in time order across pairs
    maxNumberOfOpenDeals: '1',
    indicatorGroups: [
      {
        id: 'g',
        logic: IndicatorsLogicEnum.and,
        action: IndicatorAction.startDeal,
      },
    ],
    indicators: [
      {
        type: IndicatorEnum.rsi,
        indicatorLength: 7,
        indicatorValue: '30',
        indicatorCondition: IndicatorStartConditionEnum.gt,
        indicatorInterval: ExchangeIntervals.fourH,
        indicatorAction: IndicatorAction.startDeal,
        groupId: 'g',
        uuid: 'u-rsi-4h',
      },
    ],
  }) as unknown as DCABotSettings

const input = (strategy: StrategyEnum, symbols: Symbols[]) =>
  ({
    exchange: ExchangeEnum.binance,
    symbols,
    interval: ExchangeIntervals.oneH,
    userFee: 0.001,
    prices: symbols.map((s) => ({ symbol: s.pair, price: 100 })),
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }],
    from: FROM,
    to: TO,
    settings: { ...settings(strategy), pair: symbols.map((s) => s.pair) },
    fullResult: true,
  }) as unknown as DCABacktestingInput

const dealList = (r: DCABacktestingResult) =>
  r.deals.map((d) => `${d.symbol.pair} ${d.startTime}`).sort()

async function standalone(): Promise<DCABacktestingResult> {
  StrategyContextManager.setActiveContext('hedge-warmup-standalone')
  const bt = new DCABacktesting(input(StrategyEnum.short, [one, two]))
  bt.loadData = load as never
  return (await bt.test()) as DCABacktestingResult
}

async function hedgeShortLeg(): Promise<DCABacktestingResult> {
  const bt = new HedgeBacktesting({
    longSettings: input(StrategyEnum.long, [one, two]),
    shortSettings: input(StrategyEnum.short, [one, two]),
    sharedSettings: {
      useTp: false,
      tpPerc: '2',
      useSl: false,
      slPerc: '-2',
    } as never,
  })
  bt.loadData = load as never
  const r = await bt.test()
  return r!.shortResult
}

describe('Hedge leg data matches a standalone DCA backtest (spec 012)', () => {
  it('§1.1 the short leg opens the same deals as the DCA bot alone', async () => {
    const dca = await standalone()
    const leg = await hedgeShortLeg()
    expect(dca.deals.length).to.be.greaterThan(0)
    expect(dealList(leg)).to.deep.equal(dealList(dca))
  })
})
