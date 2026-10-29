import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  IndicatorEnum as LibIndicatorEnum,
  SessionRuleEnum as LibSessionRuleEnum,
  sessionLevelsCondition,
} from '@gainium/indicators'
import type { IndicatorConfig, SessionLevelsResult } from '@gainium/indicators'

import {
  IndicatorEnum,
  IndicatorStartConditionEnum,
  SessionLevelEnum,
  SessionLevelsActiveEnum,
  SessionRuleEnum,
} from '../src/types'
import type { FullBar } from '../src/types'
import {
  expectedStarts,
  libSeries,
  startBars,
  startEntry,
} from './helpers/signalHarness'
import { FROM, HOUR, one } from './helpers/singlePositionHarness'

/**
 * Session Price levels outside the session (`sessionLevelsActive`): the
 * Monday range recipe — Session Days = Monday, no hours, Price levels,
 * active `outside`, price crossing up the previous session high — opens
 * deals only after a Tuesday–Sunday bar, exactly on the bars after the
 * indicators package's own `SessionLevels` + `sessionLevelsCondition` fire.
 * Missing `sessionLevelsActive` keeps the old behaviour: never outside.
 */

// eight weeks of hourly candles from Thursday 2026-01-01 00:00 UTC: a seeded,
// mean-reverting random walk on a weekly wave, so Monday's high is crossed
// on other days
let seed = 5
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
const closes = [100]
for (let i = 1; i <= 24 * 7 * 8; i++) {
  closes.push(
    closes[i - 1] +
      0.8 * rnd() +
      0.02 * (100 + 6 * Math.sin(i / 27) - closes[i - 1]),
  )
}
const bars: FullBar[] = Array.from({ length: 24 * 7 * 8 }, (_, i) => {
  const open = closes[i]
  const close = closes[i + 1]
  return {
    time: FROM + i * HOUR,
    open,
    close,
    high: Math.max(open, close) + 0.2,
    low: Math.min(open, close) - 0.2,
    volume: 1000,
    symbol: one.pair,
  }
})

const MONDAY = { sessionDays: [1] }

/** The package's own SessionLevels (fed the candle open time) via its factory. */
const series = libSeries<SessionLevelsResult>(
  {
    type: LibIndicatorEnum.session,
    sessionRule: LibSessionRuleEnum.levels,
    ...MONDAY,
  } as IndicatorConfig,
  bars,
)

const { cu, cd, gt, lt } = IndicatorStartConditionEnum
const { outside, always, session } = SessionLevelsActiveEnum
const { price, prevHigh, prevLow, prevMid, curOpen } = SessionLevelEnum

const levels = (extra: Record<string, unknown>) =>
  startEntry({
    type: IndicatorEnum.session,
    sessionRule: SessionRuleEnum.levels,
    ...MONDAY,
    ...extra,
  })

const weekday = (bar: number) => new Date(FROM + bar * HOUR).getUTCDay()

const cases: [
  SessionLevelsActiveEnum | undefined,
  SessionLevelEnum,
  SessionLevelEnum,
  IndicatorStartConditionEnum,
][] = [
  // the Monday range recipe
  [outside, price, prevHigh, cu],
  [outside, price, prevLow, cd],
  [always, price, prevMid, cu],
  [always, price, prevHigh, gt],
  [session, price, prevMid, lt],
  [undefined, price, prevMid, gt],
]

describe('Session Price levels outside the session', () => {
  for (const [active, a, b, condition] of cases) {
    it(`${active ?? 'missing'}: ${a} ${condition} ${b}`, async () => {
      const got = await startBars(
        levels({
          sessionLevelsActive: active,
          sessionLevelA: a,
          sessionLevelB: b,
          indicatorCondition: condition,
        }),
        bars,
      )
      const want = expectedStarts<SessionLevelsResult>(series, (l, p) =>
        sessionLevelsCondition(l, p, { a, b, condition, active }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(3)
      expect(got).to.deep.equal(want)
    })
  }

  it('Monday range: deals only after a Tuesday–Sunday bar, several weeks', async () => {
    const got = await startBars(
      levels({
        sessionLevelsActive: outside,
        sessionLevelA: price,
        sessionLevelB: prevHigh,
        indicatorCondition: cu,
      }),
      bars,
    )
    expect(got.length).to.be.greaterThan(3)
    // the signal bar is the one before the deal's bar
    expect(got.filter((bar) => weekday(bar - 1) === 1)).to.deep.equal([])
    const weeks = new Set(got.map((bar) => Math.floor(bar / (24 * 7))))
    expect(weeks.size).to.be.greaterThan(2)
  })

  it('missing / session: never outside the session (unchanged)', async () => {
    for (const active of [undefined, session, null]) {
      const got = await startBars(
        levels({
          sessionLevelsActive: active,
          sessionLevelA: price,
          sessionLevelB: prevMid,
          indicatorCondition: gt,
        }),
        bars,
      )
      expect(got.length).to.be.greaterThan(3)
      expect(got.filter((bar) => weekday(bar - 1) !== 1)).to.deep.equal([])
    }
  })

  it('always fires both inside and outside', async () => {
    const got = await startBars(
      levels({
        sessionLevelsActive: always,
        sessionLevelA: price,
        sessionLevelB: prevMid,
        indicatorCondition: gt,
      }),
      bars,
    )
    const days = new Set(got.map((bar) => weekday(bar - 1)))
    expect(days.has(1)).to.equal(true)
    expect(days.size).to.be.greaterThan(1)
  })

  it('outside: a current-session level has no value, so never fires', async () => {
    const got = await startBars(
      levels({
        sessionLevelsActive: outside,
        sessionLevelA: price,
        sessionLevelB: curOpen,
        indicatorCondition: gt,
      }),
      bars,
    )
    expect(got).to.deep.equal([])
  })
})
