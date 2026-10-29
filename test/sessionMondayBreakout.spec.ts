import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  IndicatorEnum as LibIndicatorEnum,
  SessionRuleEnum as LibSessionRuleEnum,
  sessionLevelsCondition,
} from '@gainium/indicators'
import type { IndicatorConfig, SessionLevelsResult } from '@gainium/indicators'

import DCABacktesting from '../src/dca'
import { StrategyContextManager } from '../src/dca/strategy/context'
import {
  ExchangeEnum,
  ExchangeIntervals,
  IndicatorAction,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  SessionLevelEnum,
  SessionLevelsActiveEnum,
  SessionRuleEnum,
  StartConditionEnum,
} from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
} from '../src/types'
import { expectedStarts, libSeries, startEntry } from './helpers/signalHarness'
import { HOUR, base, one } from './helpers/singlePositionHarness'
import btc from './fixtures/btcusdt-1h-2026-03-08-to-03-17.json'

/**
 * The Monday range broken on the first hour after Monday: BTCUSDT 1h
 * (Binance), Monday 2026-03-16 high 74,909.08; the last Monday candle
 * (23:00) closes 74,884.67 inside the session, Tue 2026-03-17 00:00 closes
 * 75,318.48. From indicators 1.14.0 the crossing fires on Tue 00:00, so the
 * deal opens on Tue 01:00 — before, no crossing could fire on the first
 * candle after the session, and that week had no deal at all.
 */

const bars: FullBar[] = (btc as number[][]).map(
  ([time, open, high, low, close]) => ({
    time,
    open,
    high,
    low,
    close,
    volume: 1000,
    symbol: one.pair,
  }),
)
const FROM = bars[0].time
const iso = (t: number) => new Date(t).toISOString()

let runNo = 0
const startTimes = async (indicator: unknown): Promise<string[]> => {
  StrategyContextManager.setActiveContext(`monday-breakout-${++runNo}`)
  const bt = new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: [one],
    interval: ExchangeIntervals.oneH,
    userFee: 0.001,
    prices: [{ symbol: one.pair, price: bars[0].open }],
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + bars.length * HOUR,
    combo: false,
    settings: {
      ...base,
      pair: [one.pair],
      startCondition: StartConditionEnum.ti,
      useSl: false,
      useDca: false,
      tpPerc: '0.01',
      maxNumberOfOpenDeals: '100000',
      maxDealsPerPair: '100000',
      indicatorGroups: [
        {
          id: 'g-s',
          logic: IndicatorsLogicEnum.and,
          action: IndicatorAction.startDeal,
        },
      ],
      indicators: [indicator],
    } as unknown as DCABotSettings,
    fullResult: true,
  } as never)
  const r = (await bt.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return [...new Set(r.deals.map((d) => iso(d.startTime)))].sort()
}

const series = libSeries<SessionLevelsResult>(
  {
    type: LibIndicatorEnum.session,
    sessionRule: LibSessionRuleEnum.levels,
    sessionDays: [1],
  } as IndicatorConfig,
  bars,
)

const mondayRange = (active?: SessionLevelsActiveEnum) =>
  startEntry({
    type: IndicatorEnum.session,
    sessionRule: SessionRuleEnum.levels,
    sessionDays: [1],
    sessionLevelsActive: active,
    sessionLevelA: SessionLevelEnum.price,
    sessionLevelB: SessionLevelEnum.prevHigh,
    indicatorCondition: IndicatorStartConditionEnum.cu,
  })

describe('Monday range breakout on Tuesday 00:00 (BTCUSDT 2026-03-17)', () => {
  for (const active of [
    SessionLevelsActiveEnum.outside,
    SessionLevelsActiveEnum.always,
  ]) {
    it(`${active}: the deal opens on Tue 01:00, the bar after the breakout`, async () => {
      const got = await startTimes(mondayRange(active))
      const want = expectedStarts<SessionLevelsResult>(series, (l, p) =>
        sessionLevelsCondition(l, p, {
          a: SessionLevelEnum.price,
          b: SessionLevelEnum.prevHigh,
          condition: IndicatorStartConditionEnum.cu,
          active,
        }),
      ).map((bar) => iso(FROM + bar * HOUR))
      expect(got).to.deep.equal(want)
      expect(got.filter((t) => t >= '2026-03-16')).to.deep.equal([
        '2026-03-17T01:00:00.000Z',
      ])
    })
  }

  it('session (default): no deal outside Monday', async () => {
    for (const active of [undefined, SessionLevelsActiveEnum.session]) {
      const got = await startTimes(mondayRange(active))
      for (const t of got) {
        // the signal bar (one before the deal's) is a Monday
        expect(new Date(Date.parse(t) - HOUR).getUTCDay(), t).to.equal(1)
      }
      expect(got).to.not.include('2026-03-17T01:00:00.000Z')
    }
  })
})
