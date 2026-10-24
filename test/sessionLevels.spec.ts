import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  SessionLevels,
  SessionLevelsResult,
  isInSession,
  sessionLevelsCondition,
} from '@gainium/indicators'

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
  SessionLevelEnum,
  SessionRuleEnum,
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
 * Session "Price levels" as a start condition: deals open exactly on the bars
 * after the indicator package's own `SessionLevels` + `sessionLevelsCondition`
 * fire, so the backtester and the live engine (which calls the same decision)
 * agree. The session window is NOT the whole day (Mon–Fri 09:30–16:00 New
 * York on 15m candles), so the candle time really drives the grouping.
 */

const M15 = 15 * 60e3
// Monday 2026-01-05 00:00 UTC (New York is on EST, UTC-5).
const FROM = Date.UTC(2026, 0, 5)
const PAIR = 'AAA_USDT'
const DAYS = [1, 2, 3, 4, 5]
const HOURS = { start: '09:30', end: '16:00', timezone: 'America/New_York' }
const LEVELS = {
  sessionDays: DAYS,
  sessionStart: HOURS.start,
  sessionEnd: HOURS.end,
  sessionTimezone: HOURS.timezone,
}

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binance,
  baseAsset: { name: 'AAA', minAmount: 0.0001, maxAmount: 1e9, step: 0.0001 },
  quoteAsset: { name: 'USDT', minAmount: 1 },
  maxOrders: 200,
  priceAssetPrecision: 4,
}

// Three weeks of 15m candles: a seeded, mean-reverting random walk.
let seed = 7
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
const path = [100]
for (let i = 1; i <= 21 * 96; i++) {
  path.push(path[i - 1] + 0.6 * rnd() + 0.01 * (100 - path[i - 1]))
}
const bars: FullBar[] = Array.from({ length: 21 * 96 }, (_, i) => {
  const open = path[i]
  const close = path[i + 1]
  return {
    time: FROM + i * M15,
    open,
    close,
    high: Math.max(open, close) + 0.3,
    low: Math.min(open, close) - 0.3,
    volume: 1000,
    symbol: PAIR,
  }
})

const base = {
  name: 'session-levels',
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

type Levels = {
  a: SessionLevelEnum
  b: SessionLevelEnum
  condition: IndicatorStartConditionEnum
}

const levelsIndicator = ({ a, b, condition }: Levels, uuid = 'u-levels') => ({
  type: IndicatorEnum.session,
  sessionRule: SessionRuleEnum.levels,
  ...LEVELS,
  sessionLevelA: a,
  sessionLevelB: b,
  indicatorCondition: condition,
  indicatorInterval: ExchangeIntervals.fifteenM,
  indicatorAction: IndicatorAction.startDeal,
  groupId: 'g',
  uuid,
})

let runNo = 0
const run = async (indicators: Record<string, unknown>[]) => {
  StrategyContextManager.setActiveContext(`session-levels-${++runNo}`)
  const bt = new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: [symbol],
    interval: ExchangeIntervals.fifteenM,
    userFee: 0.001,
    prices: [{ symbol: PAIR, price: 100 }],
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + bars.length * M15,
    settings: {
      ...base,
      startCondition: StartConditionEnum.ti,
      indicators,
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
    { bar: bars, interval: ExchangeIntervals.fifteenM },
  ])) as DCABacktestingResult
  return r.deals.map((d) => d.startTime).sort((a, b) => a - b)
}

/** Bar times on which the indicator package itself says the condition holds. */
const signalTimes = ({ a, b, condition }: Levels) => {
  const ind = new SessionLevels(DAYS, HOURS)
  let prev: SessionLevelsResult | null = null
  const out: number[] = []
  for (const bar of bars) {
    const last = ind.next(bar) as SessionLevelsResult
    if (sessionLevelsCondition(last, prev, { a, b, condition })) {
      out.push(bar.time)
    }
    prev = last
  }
  return out
}

const at = (t: number) => `bar ${(t - FROM) / M15}`

describe('Session Price levels start condition', () => {
  const cases: Levels[] = [
    {
      a: SessionLevelEnum.price,
      b: SessionLevelEnum.prevHigh,
      condition: IndicatorStartConditionEnum.cu,
    },
    {
      a: SessionLevelEnum.price,
      b: SessionLevelEnum.prevLow,
      condition: IndicatorStartConditionEnum.cd,
    },
    {
      a: SessionLevelEnum.price,
      b: SessionLevelEnum.curOpen,
      condition: IndicatorStartConditionEnum.lt,
    },
  ]
  for (const levels of cases) {
    it(`opens deals only after ${levels.a} ${levels.condition} ${levels.b} signal bars`, async () => {
      const deals = await run([levelsIndicator(levels)])
      const signals = signalTimes(levels)
      expect(signals.length).to.be.greaterThan(0)
      expect(deals.length).to.be.greaterThan(0)
      // a signal at a bar's close opens the deal on the next bar
      for (const t of deals) {
        expect(signals, `deal at ${at(t)}`).to.include(t - M15)
      }
    })
  }

  it('never signals outside the session window', () => {
    const signals = signalTimes({
      a: SessionLevelEnum.price,
      b: SessionLevelEnum.prevLow,
      condition: IndicatorStartConditionEnum.gt,
    })
    expect(signals.length).to.be.greaterThan(0)
    for (const t of signals) {
      expect(isInSession(t, DAYS, SessionRuleEnum.in, HOURS), at(t)).to.equal(
        true,
      )
    }
  })
})

describe('Session in / out next to Price levels', () => {
  // the clock filter: only the afternoon of the levels session
  const CLOCK = {
    sessionDays: DAYS,
    sessionStart: '13:00',
    sessionEnd: '16:00',
    sessionTimezone: 'America/New_York',
  }
  const clockHours = {
    start: CLOCK.sessionStart,
    end: CLOCK.sessionEnd,
    timezone: CLOCK.sessionTimezone,
  }
  const clockIndicator = (sessionRule?: SessionRuleEnum) => ({
    type: IndicatorEnum.session,
    ...(sessionRule ? { sessionRule } : {}),
    ...CLOCK,
    indicatorInterval: ExchangeIntervals.fifteenM,
    indicatorAction: IndicatorAction.startDeal,
    groupId: 'g',
    uuid: 'u-clock',
  })
  const inClock = (t: number, rule = SessionRuleEnum.in) =>
    isInSession(t, DAYS, rule, clockHours)
  const levels: Levels = {
    a: SessionLevelEnum.price,
    b: SessionLevelEnum.prevLow,
    condition: IndicatorStartConditionEnum.gt,
  }

  it('applies both: deals follow a levels signal and stay inside the clock session', async () => {
    const levelsOnly = await run([levelsIndicator(levels)])
    const both = await run([
      clockIndicator(SessionRuleEnum.in),
      levelsIndicator(levels),
    ])
    const signals = signalTimes(levels)
    expect(both.length).to.be.greaterThan(0)
    for (const t of both) {
      expect(signals, `deal at ${at(t)}`).to.include(t - M15)
      expect(inClock(t), `deal at ${at(t)}`).to.equal(true)
    }
    // the clock filter really removed deals the levels rule alone opens
    expect(levelsOnly.some((t) => !inClock(t))).to.equal(true)
  })

  it('keeps an in / out Session working on its own (missing rule = in)', async () => {
    for (const rule of [undefined, SessionRuleEnum.in, SessionRuleEnum.out]) {
      const deals = await run([clockIndicator(rule)])
      expect(deals.length, `rule ${rule}`).to.be.greaterThan(0)
      for (const t of deals) {
        expect(inClock(t, rule ?? SessionRuleEnum.in), at(t)).to.equal(true)
      }
    }
  })
})
