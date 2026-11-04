import { describe, it } from 'mocha'
import { expect } from 'chai'

import HedgeBacktesting from '../src/hedge'
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
} from '../src/types'
import { base, mkSymbol } from './helpers/singlePositionHarness'

/**
 * Spec 013. With the hedge TP/SL on, each leg must see its own bars in
 * time order, whatever timeframe or warm-up the other leg uses.
 */

const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 10)
const TO = FROM + 20 * 24 * HOUR

const one = mkSymbol('AAA_USDT', 'AAA')

const resolutionToInterval = new Map(
  Object.entries(tvIntervalMap).map(([interval, res]) => [
    res,
    interval as ExchangeIntervals,
  ]),
)

const price = (t: number) => {
  const k = t / HOUR
  return (
    100 + 12 * Math.sin(k / 23) + 4 * Math.sin(k / 5) + 2 * Math.sin(k / 97)
  )
}

const load = async (
  _pair: string,
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
    const open = price(t)
    const close = price(t + step)
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

const rsi = (
  interval: ExchangeIntervals,
  value: string,
  condition: IndicatorStartConditionEnum,
  uuid: string,
) => ({
  type: IndicatorEnum.rsi,
  indicatorLength: 7,
  indicatorValue: value,
  indicatorCondition: condition,
  indicatorInterval: interval,
  indicatorAction: IndicatorAction.startDeal,
  groupId: 'g',
  uuid,
})

const input = (
  strategy: StrategyEnum,
  interval: ExchangeIntervals,
  indicators: ReturnType<typeof rsi>[],
) =>
  ({
    exchange: ExchangeEnum.binance,
    symbols: [one],
    interval,
    userFee: 0.001,
    prices: [{ symbol: one.pair, price: 100 }],
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }],
    from: FROM,
    to: TO,
    settings: {
      ...base,
      strategy,
      pair: [one.pair],
      startCondition: StartConditionEnum.ti,
      useDca: true,
      ordersCount: 4,
      step: '1.9',
      useTp: false,
      useSl: false,
      maxNumberOfOpenDeals: '1',
      indicatorGroups: [
        {
          id: 'g',
          logic: IndicatorsLogicEnum.or,
          action: IndicatorAction.startDeal,
        },
      ],
      indicators,
    } as unknown as DCABotSettings,
    fullResult: true,
  }) as unknown as DCABacktestingInput

type Run = {
  long: DCABacktestingResult
  short: DCABacktestingResult
  seen: { long: number[]; short: number[] }
}

async function run(
  long: DCABacktestingInput,
  short: DCABacktestingInput,
): Promise<Run> {
  const bt = new HedgeBacktesting({
    longSettings: long,
    shortSettings: short,
    sharedSettings: {
      useTp: true,
      tpPerc: '1.2',
      useSl: false,
      slPerc: '-25',
    } as never,
  })
  bt.loadData = load as never
  const seen = { long: [] as number[], short: [] as number[] }
  for (const leg of ['long', 'short'] as const) {
    const inner = (bt as never as Record<string, { processBar: never }>)[
      `${leg}Backtester`
    ] as unknown as {
      processBar: (bar: FullBar, c: boolean) => Promise<void>
    }
    const original = inner.processBar.bind(inner)
    inner.processBar = async (bar, c) => {
      seen[leg].push(bar.time)
      return original(bar, c)
    }
  }
  const r = await bt.test()
  return { long: r!.longResult, short: r!.shortResult, seen }
}

const backwardSteps = (times: number[]) =>
  times.filter((t, i) => i > 0 && t < times[i - 1]).length

const assertSane = (r: Run, maxDca: number) => {
  expect(backwardSteps(r.seen.long), 'long processBar went back').to.equal(0)
  expect(backwardSteps(r.seen.short), 'short processBar went back').to.equal(0)
  for (const leg of [r.long, r.short]) {
    for (const d of leg.deals) {
      if (d.closedTime !== undefined) {
        expect(d.closedTime).to.be.at.least(d.startTime)
      }
      expect(d.levels.complete).to.be.at.most(maxDca + 1)
    }
  }
}

describe('Hedge TP/SL walks each leg in time order (spec 013)', () => {
  it('§1.1 long 1h (RSI 2h) + short 15m (RSI 15m): bars only go forward', async () => {
    const r = await run(
      input(StrategyEnum.long, ExchangeIntervals.oneH, [
        rsi(ExchangeIntervals.twoH, '30', IndicatorStartConditionEnum.lt, 'l'),
      ]),
      input(StrategyEnum.short, ExchangeIntervals.oneH, [
        rsi(
          ExchangeIntervals.fifteenM,
          '70',
          IndicatorStartConditionEnum.gt,
          's',
        ),
        rsi(ExchangeIntervals.twoH, '50', IndicatorStartConditionEnum.gt, 's2'),
      ]),
    )
    expect(r.short.deals.length).to.be.greaterThan(0)
    assertSane(r, 4)
  })

  it('§1.2 same timeframe, different warm-up: bars only go forward', async () => {
    const r = await run(
      input(StrategyEnum.long, ExchangeIntervals.fifteenM, [
        rsi(ExchangeIntervals.twoH, '30', IndicatorStartConditionEnum.lt, 'l'),
      ]),
      input(StrategyEnum.short, ExchangeIntervals.fifteenM, [
        rsi(
          ExchangeIntervals.fifteenM,
          '70',
          IndicatorStartConditionEnum.gt,
          's',
        ),
      ]),
    )
    expect(r.short.deals.length).to.be.greaterThan(0)
    assertSane(r, 4)
  })

  it('§1.3 every bar of each leg is processed exactly once', async () => {
    const r = await run(
      input(StrategyEnum.long, ExchangeIntervals.oneH, [
        rsi(ExchangeIntervals.twoH, '30', IndicatorStartConditionEnum.lt, 'l'),
      ]),
      input(StrategyEnum.short, ExchangeIntervals.oneH, [
        rsi(
          ExchangeIntervals.fifteenM,
          '70',
          IndicatorStartConditionEnum.gt,
          's',
        ),
      ]),
    )
    expect(new Set(r.seen.short).size).to.equal(r.seen.short.length)
    expect(new Set(r.seen.long).size).to.equal(r.seen.long.length)
    // the short leg's 15m stream covers the period at 15m resolution
    expect(r.seen.short.length).to.be.greaterThan(((TO - FROM) / HOUR) * 4 - 8)
  })
})
