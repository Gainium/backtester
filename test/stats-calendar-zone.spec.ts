import { describe, it, afterEach } from 'mocha'
import { expect } from 'chai'

import GRIDBacktesting from '../src/grid'
import * as calendar from '../src/helper/calendar'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type { DCABacktestingResult, Settings, Symbols } from '../src/types'
import {
  FROM,
  HOUR,
  normalise,
  one,
  run,
  wave,
} from './helpers/singlePositionHarness'

/**
 * The day / month / year stats (CWR, Sharpe, Sortino, profit by period,
 * periodic stats) are bucketed in the backtest's `timezone`, or UTC — never
 * in the zone of the machine that runs it. main-app's server worker and a
 * browser in another zone must report the same stats for the same input.
 *
 * test/setup/utc.js pins TZ=UTC for the suite; these cases move the host zone
 * themselves and put it back.
 */

const HOST_ZONES = [
  'UTC',
  'Asia/Singapore',
  'America/New_York',
  'Pacific/Chatham',
]

const withHostZone = async <T>(zone: string, fn: () => Promise<T>) => {
  process.env.TZ = zone
  try {
    return await fn()
  } finally {
    process.env.TZ = 'UTC'
  }
}

afterEach(() => {
  process.env.TZ = 'UTC'
})

/** 100 days of 1h bars: > 90 working days, so profit by period is monthly */
const LONG = wave(one.pair, 2400)
/** 20 days: profit by period is daily */
const SHORT = wave(one.pair, 480)

const dca = (bars: typeof LONG, timezone?: string) =>
  run({
    name: 'calendar-zone',
    settings: {},
    symbols: [one],
    bars,
    timezone,
  })

const stats = (r: DCABacktestingResult) =>
  JSON.stringify(
    normalise(
      JSON.parse(
        JSON.stringify({
          ratios: (r as unknown as { ratios: unknown }).ratios,
          periodicStats: (r as unknown as { periodicStats: unknown })
            .periodicStats,
          financial: r.financial,
          deals: r.deals,
        }),
      ),
    ),
  )

describe('stats calendar — independent of the host zone', () => {
  for (const [label, bars] of [
    ['daily buckets', SHORT],
    ['monthly buckets', LONG],
  ] as const) {
    it(`DCA, no timezone input (${label}): every host zone gives the UTC result`, async () => {
      const results: string[] = []
      for (const zone of HOST_ZONES) {
        results.push(
          await withHostZone(zone, async () => stats(await dca(bars))),
        )
      }
      for (const r of results) expect(r).to.equal(results[0])
    })

    it(`DCA, timezone input (${label}): every host zone gives that zone's result`, async () => {
      const results: string[] = []
      for (const zone of HOST_ZONES) {
        results.push(
          await withHostZone(zone, async () =>
            stats(await dca(bars, 'Asia/Tokyo')),
          ),
        )
      }
      for (const r of results) expect(r).to.equal(results[0])
      // and Tokyo days are not UTC days: the input is really used
      expect(results[0]).to.not.equal(stats(await dca(bars)))
    })
  }

  it('DCA periodic stats start on the input zone’s month / year boundaries', async () => {
    const r = (await withHostZone('America/New_York', () =>
      dca(LONG, 'Asia/Tokyo'),
    )) as unknown as {
      periodicStats: { period: string; startTime: number }[]
    }
    const tokyo = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hourCycle: 'h23',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
    expect(r.periodicStats.length).to.be.greaterThan(2)
    for (const p of r.periodicStats) {
      expect(tokyo.format(p.startTime), p.period).to.equal('1, 00:00')
    }
  })

  it('an invalid timezone input falls back to UTC', async () => {
    expect(stats(await dca(SHORT, 'Not/AZone'))).to.equal(
      stats(await dca(SHORT)),
    )
  })

  it('grid profit by period: every host zone gives the same buckets', async () => {
    const symbol: Symbols = {
      pair: one.pair,
      exchange: ExchangeEnum.binance,
      baseAsset: { minAmount: 0.001, maxAmount: 1e9, step: 0.001, name: 'AAA' },
      quoteAsset: { minAmount: 1, name: 'USDT' },
      maxOrders: 200,
      priceAssetPrecision: 4,
    } as never
    const gridRun = async () => {
      const bt = new GRIDBacktesting({
        exchange: ExchangeEnum.binance,
        symbols: [symbol],
        interval: ExchangeIntervals.oneH,
        userFee: 0.001,
        prices: [{ symbol: one.pair, price: SHORT[0].close }],
        settings: {
          topPrice: 120,
          lowPrice: 80,
          levels: 41,
          gridStep: '1',
          budget: 10000,
          useOrderInAdvance: false,
          prioritize: 'level',
          profitCurrency: 'quote',
          orderFixedIn: 'quote',
          sellDisplacement: 0,
          gridType: 'arithmetic',
          tpSl: false,
          sl: false,
          useStartPrice: false,
          leverage: 1,
          futures: false,
          coinm: false,
          newProfit: true,
          strategy: 'LONG',
          feeOrder: true,
          ordersInAdvance: 40,
          startPrice: '',
          skipBalanceCheck: true,
          pair: one.pair,
          name: 'calendar-zone grid',
        } as unknown as Settings,
        fullResult: true,
      } as never)
      const r = (await bt.test(SHORT)) as never as {
        ratios: { profitByPeriod: number[] }
      }
      return r.ratios.profitByPeriod
    }
    const results: number[][] = []
    for (const zone of HOST_ZONES) {
      results.push(await withHostZone(zone, gridRun))
    }
    expect(results[0].length, 'one bucket per day').to.be.greaterThan(15)
    expect(
      results[0].some((p) => p !== 0),
      'the grid trades',
    ).to.equal(true)
    for (const r of results) expect(r).to.deep.equal(results[0])
  })
})

describe('calendar helper', () => {
  // A browser passes its own zone; its boundaries must be the ones
  // Date#setHours(0, 0, 0, 0) gave it before, DST days included.
  const old = {
    startOfDay: (t: number) => new Date(t).setHours(0, 0, 0, 0),
    nextDay: (t: number) => {
      const d = new Date(t)
      d.setHours(24)
      return +d
    },
    startOfMonth: (t: number) => {
      const d = new Date(t)
      d.setDate(1)
      d.setHours(0, 0, 0, 0)
      return +d
    },
    nextMonth: (t: number) => {
      const d = new Date(t)
      d.setDate(1)
      d.setMonth(d.getMonth() + 1)
      return +d
    },
    startOfYear: (t: number) => {
      const d = new Date(t)
      d.setDate(1)
      d.setHours(0, 0, 0, 0)
      d.setMonth(0)
      return +d
    },
  }
  for (const zone of [
    'UTC',
    'Europe/Madrid',
    'America/New_York',
    'Australia/Lord_Howe',
    'Asia/Kolkata',
    'America/Sao_Paulo',
  ]) {
    it(`${zone}: same boundaries as the host-local Date math in that zone`, () => {
      process.env.TZ = zone
      // every 7h over two years: crosses every DST change in both directions
      for (
        let t = FROM - 400 * 24 * HOUR;
        t < FROM + 400 * 24 * HOUR;
        t += 7 * HOUR
      ) {
        const day = calendar.startOfDay(t, zone)
        expect(day, `startOfDay ${t}`).to.equal(old.startOfDay(t))
        expect(calendar.nextDay(day, zone), `nextDay ${day}`).to.equal(
          old.nextDay(day),
        )
        const month = calendar.startOfMonth(t, zone)
        expect(month, `startOfMonth ${t}`).to.equal(old.startOfMonth(t))
        expect(calendar.nextMonth(month, zone), `nextMonth ${month}`).to.equal(
          old.nextMonth(month),
        )
        expect(calendar.startOfYear(t, zone), `startOfYear ${t}`).to.equal(
          old.startOfYear(t),
        )
      }
    })
  }
})
