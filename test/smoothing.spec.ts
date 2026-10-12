import { describe, it } from 'mocha'
import { expect } from 'chai'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as lib from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import {
  getSmoothingMode,
  lineOperands,
  withSmoothing,
} from '../src/dca/strategy/ti/smoothing'
import {
  ExchangeIntervals,
  IndicatorAction,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  MAEnum,
  RangeType,
  SmoothingCompareEnum,
  StartConditionEnum,
} from '../src/types'
import type { DCABotSettings, FullBar, IndicatorHistory } from '../src/types'
import {
  FROM,
  HOUR,
  fingerprint,
  one,
  path,
  run,
} from './helpers/singlePositionHarness'

/**
 * Oscillator smoothing (smoothing / smoothingLength / smoothingCompare) on
 * every in-scope oscillator.
 *
 * The golden files under `test/fixtures/smoothing-off/` were generated from
 * backtester 1.13.0 (commit f5ed36b), before the feature existed, on the same
 * oscillator classes (indicators 1.4.0 classes, unchanged in 1.5.0). They pin
 * the behaviour of a bot whose smoothing is missing or off. Regenerate only
 * from a commit that predates a deliberate engine change (`UPDATE_GOLDEN=1`).
 */

const GOLDEN_DIR = join(__dirname, 'fixtures', 'smoothing-off')

const { cu, cd, gt, lt, bw } = IndicatorStartConditionEnum
const start = IndicatorAction.startDeal
type Extra = Record<string, unknown>

/** Price wave with a varying volume, so VO and MFI move too. */
const bars: FullBar[] = Array.from({ length: 700 }, (_, i) => {
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
    volume: 1000 + 400 * Math.sin(i / 7) + 250 * Math.sin(i / 3),
    symbol: one.pair,
  }
})

/**
 * Every in-scope oscillator: the bot-settings fields the engine reads, and
 * the equivalent library config (used as the independent reference).
 */
const SCOPE: { name: string; settings: Extra; config: lib.IndicatorConfig }[] =
  [
    {
      name: 'rsi',
      settings: { type: IndicatorEnum.rsi, indicatorLength: 14 },
      config: { type: lib.IndicatorEnum.rsi, interval: 14 },
    },
    {
      name: 'cci',
      settings: { type: IndicatorEnum.cci, indicatorLength: 20 },
      config: { type: lib.IndicatorEnum.cci, interval: 20 },
    },
    {
      name: 'mfi',
      settings: { type: IndicatorEnum.mfi, indicatorLength: 14 },
      config: { type: lib.IndicatorEnum.mfi, interval: 14 },
    },
    {
      name: 'wr',
      settings: { type: IndicatorEnum.wr, indicatorLength: 14 },
      config: { type: lib.IndicatorEnum.wr, interval: 14 },
    },
    {
      name: 'uo',
      settings: {
        type: IndicatorEnum.uo,
        indicatorLength: 14,
        uoFast: 7,
        uoMiddle: 14,
        uoSlow: 28,
      },
      config: { type: lib.IndicatorEnum.uo, fast: 7, middle: 14, slow: 28 },
    },
    {
      name: 'mom',
      settings: {
        type: IndicatorEnum.mom,
        indicatorLength: 10,
        momSource: 'close',
      },
      config: { type: lib.IndicatorEnum.mom, interval: 10, source: 'close' },
    },
    {
      name: 'ao',
      settings: { type: IndicatorEnum.ao, indicatorLength: 14 },
      config: { type: lib.IndicatorEnum.ao },
    },
    {
      name: 'adx',
      settings: { type: IndicatorEnum.adx, indicatorLength: 14 },
      config: { type: lib.IndicatorEnum.adx, interval: 14 },
    },
    {
      name: 'bbpb',
      settings: {
        type: IndicatorEnum.bbpb,
        indicatorLength: 20,
        bbwMa: MAEnum.sma,
        bbwMaLength: 20,
        bbwMult: 2,
      },
      config: {
        type: lib.IndicatorEnum.bbpb,
        interval: 20,
        bbwMa: lib.MAEnum.sma,
        bbwMaLength: 20,
        bbwMult: 2,
      },
    },
    {
      name: 'kcpb',
      settings: {
        type: IndicatorEnum.kcpb,
        indicatorLength: 20,
        kcMa: MAEnum.ema,
        bbwMult: 2,
        kcRange: RangeType.atr,
        kcRangeLength: 20,
      },
      config: {
        type: lib.IndicatorEnum.kcpb,
        interval: 20,
        ma: lib.MAEnum.ema,
        multiplier: 2,
        range: lib.RangeType.atr,
        rangeLength: 20,
      },
    },
    {
      name: 'bbw',
      settings: {
        type: IndicatorEnum.bbw,
        indicatorLength: 20,
        bbwMa: MAEnum.sma,
        bbwMaLength: 20,
        bbwMult: 2,
      },
      config: {
        type: lib.IndicatorEnum.bbw,
        interval: 20,
        bbwMa: lib.MAEnum.sma,
        bbwMaLength: 20,
        bbwMult: 2,
      },
    },
    {
      name: 'vo',
      settings: { type: IndicatorEnum.vo, voShort: 5, voLong: 10 },
      config: { type: lib.IndicatorEnum.vo, voShort: 5, voLong: 10 },
    },
    {
      name: 'mar',
      settings: {
        type: IndicatorEnum.mar,
        mar1type: MAEnum.ema,
        mar1length: 20,
        mar2type: MAEnum.price,
        mar2length: 20,
      },
      config: {
        type: lib.IndicatorEnum.mar,
        mar1type: lib.MAEnum.ema,
        mar1length: 20,
        mar2type: lib.MAEnum.price,
        mar2length: 20,
      },
    },
  ]

const PCT = {
  percentile: true,
  percentileLookback: 60,
  percentilePercentage: 70,
}

/** The library oscillator's own series over `b` (null while warming up). */
const series = (
  config: lib.IndicatorConfig,
  b: FullBar[] = bars,
): (lib.SmoothedResult | null)[] => {
  const ind = lib.createIndicator(config)
  return b.map((bar) => {
    lib.feedCandle(ind, {
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume ?? 0,
    })
    return ind.result ? { ...ind.result } : null
  })
}

/** Median of the raw series, as a threshold string the engine parses back. */
const median = (config: lib.IndicatorConfig): string => {
  const v = series(config)
    .filter((r): r is lib.SmoothedResult => r !== null)
    .map((r) => r.value)
    .sort((a, b) => a - b)
  return `${+v[Math.floor(v.length / 2)].toPrecision(6)}`
}

const entry = (
  s: Extra,
  condition: IndicatorStartConditionEnum,
  value: string | undefined,
  extra: Extra = {},
) =>
  ({
    indicatorInterval: ExchangeIntervals.oneH,
    indicatorAction: start,
    groupId: 'g-s',
    uuid: 'u-s',
    ...s,
    indicatorCondition: condition,
    indicatorValue: value,
    ...extra,
  }) as never

/** Every signal opens its own deal, which closes almost at once. */
const everySignal = {
  startCondition: StartConditionEnum.ti,
  useSl: false,
  useDca: false,
  tpPerc: '0.01',
  maxNumberOfOpenDeals: '100000',
  maxDealsPerPair: '100000',
  indicatorGroups: [
    { id: 'g-s', logic: IndicatorsLogicEnum.and, action: start },
  ],
}

const runWith = (indicator: unknown, b: FullBar[] = bars) =>
  run({
    name: 'smoothing',
    settings: {
      ...everySignal,
      indicators: [indicator],
    } as Partial<DCABotSettings> & Extra,
    symbols: [one],
    bars: b,
  })

const startBars = async (
  indicator: unknown,
  b: FullBar[] = bars,
): Promise<number[]> => {
  const r = await runWith(indicator, b)
  return [...new Set(r.deals.map((d) => (d.startTime - FROM) / HOUR))].sort(
    (a, x) => a - x,
  )
}

type Pt = { last: number; ref: number }

/**
 * Independent expectation of the engine's signal bars: the engine evaluates
 * the newest emitted result against the previous one once three exist, and
 * a signal on bar k opens the deal on bar k + 1.
 */
const expectedStarts = (
  s: (Pt | null)[],
  fires: (l: Pt, p: Pt) => boolean,
  lastBar: number,
): number[] => {
  const emitted: { bar: number; v: Pt }[] = []
  s.forEach((v, bar) => {
    if (v) emitted.push({ bar, v })
  })
  const out: number[] = []
  for (let k = 2; k < emitted.length; k++) {
    if (fires(emitted[k].v, emitted[k - 1].v) && emitted[k].bar + 1 < lastBar) {
      out.push(emitted[k].bar + 1)
    }
  }
  return out
}

/** Raw series of `config` and EMA(len) of it, built separately. */
const rawAndEma = (config: lib.IndicatorConfig, len: number, b = bars) => {
  const e = new lib.EMA(len)
  return series(config, b).map((r) => {
    if (!r) return null
    const s = e.next(r.value)
    return s === null ? null : { raw: r.value, s }
  })
}

// crossing convention of the engine (ref = reference, last = tested)
const crossUp = (l: Pt, p: Pt) => l.ref < l.last && p.ref >= p.last
const crossDown = (l: Pt, p: Pt) => l.ref > l.last && p.ref <= p.last

const OFF_VARIANTS: [string, Extra][] = [
  ['missing', {}],
  ['none', { smoothing: 'none', smoothingLength: 14 }],
  [
    'none-line',
    { smoothing: 'none', smoothingLength: 14, smoothingCompare: 'line' },
  ],
  ['null', { smoothing: null, smoothingLength: null, smoothingCompare: null }],
  ['length-0', { smoothing: 'ema', smoothingLength: 0 }],
  ['length-1001', { smoothing: 'ema', smoothingLength: 1001 }],
  ['vwma', { smoothing: 'vwma', smoothingLength: 14 }],
  ['unknown', { smoothing: 'kama', smoothingLength: 14 }],
]

describe('oscillator smoothing', () => {
  describe('smoothing off changes nothing', () => {
    for (const osc of SCOPE) {
      for (const [pname, pct] of [
        ['plain', {}],
        ['percentile', PCT],
      ] as const) {
        const file = join(GOLDEN_DIR, `${osc.name}-${pname}.json`)
        for (const [vname, v] of OFF_VARIANTS) {
          it(`${osc.name} (${pname}, ${vname})`, async () => {
            const got = fingerprint(
              await runWith(
                entry(osc.settings, cu, median(osc.config), { ...pct, ...v }),
              ),
            )
            if (process.env.UPDATE_GOLDEN === '1' && vname === 'missing') {
              if (!existsSync(GOLDEN_DIR)) {
                mkdirSync(GOLDEN_DIR, { recursive: true })
              }
              writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`)
            }
            expect(got.deals, 'the case opens deals').to.be.greaterThan(1)
            expect(got).to.deep.equal(JSON.parse(readFileSync(file, 'utf8')))
          })
        }
      }
    }

    it('out-of-scope types ignore the fields', async () => {
      const on = {
        smoothing: 'ema',
        smoothingLength: 9,
        smoothingCompare: 'line',
      }
      const cases: unknown[][] = [
        // MA crossing price
        [
          {
            type: IndicatorEnum.ma,
            indicatorLength: 20,
            maType: MAEnum.ema,
            maCrossingValue: MAEnum.price,
          },
          cu,
          '0',
        ],
        // Stochastic K/D cross
        [
          {
            type: IndicatorEnum.stoch,
            indicatorLength: 14,
            rsiValue: 'k',
            rsiValue2: 'd',
          },
          cu,
          '0',
        ],
        // cross-oscillator built on RSI
        [
          {
            type: IndicatorEnum.xo,
            indicatorLength: 14,
            xOscillator1: IndicatorEnum.rsi,
            xOscillator2: IndicatorEnum.mfi,
            xOscillator2length: 14,
            xOscillator2Interval: ExchangeIntervals.oneH,
            xoUUID: 'xo-ref',
          },
          cu,
          '0',
        ],
      ]
      for (const [s, cond, value] of cases) {
        const a = fingerprint(
          await runWith(
            entry(
              s as Extra,
              cond as IndicatorStartConditionEnum,
              value as string,
            ),
          ),
        )
        const b = fingerprint(
          await runWith(
            entry(
              s as Extra,
              cond as IndicatorStartConditionEnum,
              value as string,
              on,
            ),
          ),
        )
        expect(b, (s as Extra).type as string).to.deep.equal(a)
      }
    })
  })

  describe('mode resolution', () => {
    const s = (extra: Extra) => ({ type: IndicatorEnum.cci, ...extra }) as never
    it('off unless an in-scope type, an allowed MA and a valid length', () => {
      expect(getSmoothingMode(s({}))).to.equal('off')
      for (const [, v] of OFF_VARIANTS) {
        expect(getSmoothingMode(s(v))).to.equal('off')
      }
      for (const type of [
        IndicatorEnum.macd,
        IndicatorEnum.stoch,
        IndicatorEnum.xo,
        IndicatorEnum.atr,
      ]) {
        expect(
          getSmoothingMode({
            type,
            smoothing: 'ema',
            smoothingLength: 9,
          } as never),
        ).to.equal('off')
      }
      for (const osc of SCOPE) {
        expect(
          getSmoothingMode({
            ...osc.settings,
            smoothing: 'ema',
            smoothingLength: 9,
          } as never),
        ).to.equal('value')
      }
    })
    it("defaults to 'value'; 'line' only without percentile", () => {
      const on = { smoothing: 'EMA', smoothingLength: 9 }
      expect(getSmoothingMode(s(on))).to.equal('value')
      expect(getSmoothingMode(s({ ...on, smoothingCompare: null }))).to.equal(
        'value',
      )
      expect(
        getSmoothingMode(
          s({ ...on, smoothingCompare: SmoothingCompareEnum.line }),
        ),
      ).to.equal('line')
      expect(
        getSmoothingMode(
          s({
            ...on,
            smoothingCompare: SmoothingCompareEnum.line,
            percentile: true,
          }),
        ),
      ).to.equal('value')
    })
    it('withSmoothing adds normalised fields only for that oscillator, when on', () => {
      const cfg = { type: IndicatorEnum.cci, interval: 20 }
      expect(withSmoothing(s({}), cfg)).to.equal(cfg)
      expect(
        withSmoothing(s({ smoothing: 'none', smoothingLength: 3 }), cfg),
      ).to.equal(cfg)
      expect(
        withSmoothing(s({ smoothing: 'TEMA', smoothingLength: 3 }), cfg),
      ).to.deep.equal({ ...cfg, smoothing: 'tema', smoothingLength: 3 })
      // an xo entry builds an RSI config: never smoothed
      const xoRsi = { type: IndicatorEnum.rsi, interval: 14 }
      expect(
        withSmoothing(
          {
            type: IndicatorEnum.xo,
            smoothing: 'ema',
            smoothingLength: 3,
          } as never,
          xoRsi,
        ),
      ).to.equal(xoRsi)
    })
    it('line operands: raw is tested against the smoothed line', () => {
      expect(
        lineOperands({ value: 55, raw: 60 }, { value: 54, raw: 50 }),
      ).to.deep.equal({ last: 60, prev: 50, value: 55, prevValue: 54 })
      expect(
        lineOperands({ value: 55 } as never, { value: 54, raw: 50 }),
      ).to.equal(null)
    })
  })

  describe('indicator loader', () => {
    for (const osc of SCOPE) {
      it(`${osc.name}: emits the smoothed line as value and the raw one as raw`, () => {
        const smoothing = { smoothing: 'sma', smoothingLength: 10 }
        const loader = new InternalIndicator({
          ...osc.config,
          ...smoothing,
        } as never)
        const off = new InternalIndicator(osc.config as never)
        const want = series({
          ...osc.config,
          ...smoothing,
        } as lib.IndicatorConfig)
        const sma = new lib.SMA(10)
        const raw = series(osc.config)
        let compared = 0
        bars.forEach((b, k) => {
          let got: IndicatorHistory[] = []
          loader.updateValue(
            { o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 },
            b.time,
            (d) => (got = d),
          )
          const s = raw[k] ? sma.next(raw[k]!.value) : null
          if (s !== null && got.length) {
            const v = got[got.length - 1].value as lib.SmoothedResult
            expect(v.value).to.equal(s)
            expect(v.raw).to.equal(raw[k]!.value)
            expect(v).to.deep.equal(want[k])
            compared++
          }
        })
        expect(compared).to.be.greaterThan(550)
        expect(loader.length - off.length).to.equal(2 * 10)
      })
    }
  })

  describe("compare 'value' — conditions read the smoothed line", () => {
    for (const osc of SCOPE) {
      it(`${osc.name}: cu median fires where EMA(9) of the line crosses it`, async () => {
        const threshold = +median(osc.config)
        const s = rawAndEma(osc.config, 9).map((v) =>
          v ? { last: v.s, ref: threshold } : null,
        )
        const want = expectedStarts(s, crossUp, bars.length)
        const got = await startBars(
          entry(osc.settings, cu, `${threshold}`, {
            smoothing: 'ema',
            smoothingLength: 9,
          }),
        )
        expect(want.length).to.be.greaterThan(2)
        expect(got).to.deep.equal(want)
        const raw = await startBars(entry(osc.settings, cu, `${threshold}`))
        expect(got).to.not.deep.equal(raw)
      })
    }

    for (const name of ['rsi', 'cci', 'mfi', 'wr']) {
      it(`${name}: percentile ranks the smoothed line`, async () => {
        const osc = SCOPE.find((o) => o.name === name)!
        const smoothed = series({
          ...osc.config,
          ...PCT,
          smoothing: 'ema',
          smoothingLength: 9,
        } as lib.IndicatorConfig)
        // engine: no percentile yet => every operand 0 => never fires
        const s = smoothed.map((r) =>
          !r
            ? null
            : r.percentile === undefined
              ? { last: 0, ref: 0 }
              : { last: r.value, ref: r.percentile },
        )
        const want = expectedStarts(s, crossUp, bars.length)
        const got = await startBars(
          entry(osc.settings, cu, '0', {
            ...PCT,
            smoothing: 'ema',
            smoothingLength: 9,
          }),
        )
        expect(want.length).to.be.greaterThan(2)
        expect(got).to.deep.equal(want)
        const raw = await startBars(entry(osc.settings, cu, '0', PCT))
        expect(got).to.not.deep.equal(raw)
      })
    }
  })

  describe("compare 'line' — raw line against the smoothed line", () => {
    const line = {
      smoothing: 'ema',
      smoothingLength: 9,
      smoothingCompare: 'line',
    }
    for (const osc of SCOPE) {
      it(`${osc.name}: cu / cd / gt / lt compare the raw line with its EMA`, async () => {
        const s = rawAndEma(osc.config, 9).map((v) =>
          v ? { last: v.raw, ref: v.s } : null,
        )
        // indicatorValue is ignored in this mode
        expect(
          await startBars(entry(osc.settings, cu, '1e9', line)),
        ).to.deep.equal(expectedStarts(s, crossUp, bars.length))
        expect(
          await startBars(entry(osc.settings, cd, '-1e9', line)),
        ).to.deep.equal(expectedStarts(s, crossDown, bars.length))
        expect(
          await startBars(entry(osc.settings, gt, undefined, line)),
        ).to.deep.equal(expectedStarts(s, (l) => l.last > l.ref, bars.length))
        expect(
          await startBars(entry(osc.settings, lt, undefined, line)),
        ).to.deep.equal(expectedStarts(s, (l) => l.last < l.ref, bars.length))
        expect(
          expectedStarts(s, crossUp, bars.length).length,
        ).to.be.greaterThan(5)
      })
    }

    it('bw never fires', async () => {
      for (const name of ['rsi', 'cci', 'mfi']) {
        const osc = SCOPE.find((o) => o.name === name)!
        expect(
          await startBars(
            entry(osc.settings, bw, '-1e9', {
              ...line,
              indicatorValue2: '1e9',
            }),
          ),
        ).to.deep.equal([])
      }
    })

    it('percentile overrides line', async () => {
      for (const name of ['rsi', 'cci', 'mfi']) {
        const osc = SCOPE.find((o) => o.name === name)!
        const asLine = await startBars(
          entry(osc.settings, cu, '0', { ...line, ...PCT }),
        )
        const asValue = await startBars(
          entry(osc.settings, cu, '0', {
            ...line,
            ...PCT,
            smoothingCompare: 'value',
          }),
        )
        expect(asValue.length).to.be.greaterThan(0)
        expect(asLine).to.deep.equal(asValue)
      }
    })

    it('hand-built RSI series: crossings land on the computed bars', async () => {
      // a steady slide (RSI pinned at 0, so raw == smoothed), a 15-bar
      // rally from bar 80, then the slide again from bar 95
      const closes = Array.from({ length: 200 }, (_, i) =>
        i < 80
          ? 100 - 0.1 * i
          : i < 95
            ? 92 + 1.5 * (i - 79)
            : 114.5 - 0.1 * (i - 94),
      )
      const b = path(one.pair, closes)
      const rsi = SCOPE[0]
      const s = rawAndEma(rsi.config, 5, b).map((v) =>
        v ? { last: v.raw, ref: v.s } : null,
      )
      const line5 = { ...line, smoothingLength: 5 }
      const ups = await startBars(entry(rsi.settings, cu, '0', line5), b)
      const downs = await startBars(entry(rsi.settings, cd, '0', line5), b)
      expect(ups).to.deep.equal(expectedStarts(s, crossUp, b.length))
      expect(downs).to.deep.equal(expectedStarts(s, crossDown, b.length))
      // equal lines are not a cross; the first rally bar (80) is, and the
      // deal opens on the next bar. After the rally the raw RSI stays above
      // its lagging EMA(5) for one down bar (95: 96.11 vs 95.68) and drops
      // under it on bar 96 (95.36 vs 95.57), so that deal opens on 97.
      expect(ups).to.deep.equal([81])
      expect(downs).to.deep.equal([97])
    })
  })
})
