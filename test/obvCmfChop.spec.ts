import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  CHOP,
  CMF,
  DIV,
  OBV,
  obvCondition,
  obvWarmup,
} from '@gainium/indicators'
import type {
  DIVResult,
  DIVUsableOscillators,
  OBVResult,
} from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import { MathHelper } from '../src/helper/math'
import {
  DivTypeEnum,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  MAEnum,
} from '../src/types'
import type { FullBar } from '../src/types'
import {
  Extra,
  expectedStarts,
  startBars,
  startEntry,
  waveBars,
} from './helpers/signalHarness'

/**
 * OBV, Chaikin Money Flow and Choppiness Index as start conditions: deals
 * open exactly on the bars after the indicators package's own class fires —
 * OBV through the package's `obvCondition` (OBV against its own average),
 * CMF / CHOP through the engine's value comparison against indicatorValue
 * (MFI's). Expected bars are computed here by feeding the package's classes.
 */

const bars = waveBars(1500)
const { cu, cd, gt, lt } = IndicatorStartConditionEnum
const math = new MathHelper()

const ohlcv = (b: FullBar) => ({
  open: b.open,
  high: b.high,
  low: b.low,
  close: b.close,
  volume: b.volume ?? 0,
})

/** The package's OBV, fed bar by bar (null while its average warms up). */
const obvSeries = (maType?: string, maLength?: number) => {
  const ind = new OBV(maType, maLength)
  return bars.map((b) => {
    const r = ind.next(ohlcv(b))
    return r === null ? null : { ...r }
  })
}

const cmfSeries = (n = 20) => {
  const ind = new CMF(n)
  return bars.map((b) => ind.next(ohlcv(b)))
}

const chopSeries = (n = 14) => {
  const ind = new CHOP(n)
  return bars.map((b) => ind.next({ high: b.high, low: b.low, close: b.close }))
}

/**
 * The engine's comparison of a line with a fixed level (`last` / `prev` the
 * line, `value` the level): cu / cd crossings, gt / lt on the newest bar.
 */
const levelFires =
  (condition: IndicatorStartConditionEnum, level: number) =>
  (l: { value: number }, p: { value: number }) => {
    const last = l.value
    const prev = p.value
    switch (condition) {
      case cu:
        return math.lt(level, last) && math.gte(level, prev)
      case cd:
        return math.gt(level, last) && math.lte(level, prev)
      case gt:
        return math.gt(last, level)
      case lt:
        return math.lt(last, level)
      default:
        return false
    }
  }

describe('OBV start condition', () => {
  const cases: { name: string; settings: Extra; ma?: [string, number] }[] = [
    {
      name: 'OBV crosses up its average (defaults: sma 20)',
      settings: { indicatorCondition: cu },
    },
    {
      name: 'OBV crosses down its EMA 10',
      settings: { indicatorCondition: cd, obvMaType: 'ema', obvMaLength: 10 },
      ma: ['ema', 10],
    },
    {
      name: 'OBV above its KAMA 14',
      settings: { indicatorCondition: gt, obvMaType: 'kama', obvMaLength: 14 },
      ma: ['kama', 14],
    },
    {
      name: 'OBV below its LSMA 30',
      settings: { indicatorCondition: lt, obvMaType: 'lsma', obvMaLength: 30 },
      ma: ['lsma', 30],
    },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      const got = await startBars(
        startEntry({ type: IndicatorEnum.obv, ...c.settings }),
        bars,
      )
      const want = expectedStarts<OBVResult>(
        obvSeries(c.ma?.[0], c.ma?.[1]),
        (l, p) =>
          obvCondition(l, p, {
            condition: c.settings.indicatorCondition as string,
          }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }

  it('ignores indicatorValue (no level for OBV)', async () => {
    const plain = await startBars(
      startEntry({ type: IndicatorEnum.obv, indicatorCondition: cu }),
      bars,
    )
    const withValue = await startBars(
      startEntry({
        type: IndicatorEnum.obv,
        indicatorCondition: cu,
        indicatorValue: '1000000',
      }),
      bars,
    )
    expect(withValue).to.deep.equal(plain)
  })

  it('unusable settings build no indicator and open nothing', async () => {
    for (const s of [
      { obvMaType: MAEnum.mcginley },
      { obvMaType: MAEnum.vwma },
      { obvMaLength: 0 },
      { obvMaLength: 1001 },
    ]) {
      const got = await startBars(
        startEntry({ type: IndicatorEnum.obv, indicatorCondition: gt, ...s }),
        bars,
      )
      expect(got, JSON.stringify(s)).to.deep.equal([])
    }
  })

  it('warms up as the package does', () => {
    const len = (obvMaType?: string, obvMaLength?: number) =>
      new InternalIndicator({
        type: IndicatorEnum.obv,
        obvMaType,
        obvMaLength,
      }).length
    expect(len()).to.equal(2 * (obvWarmup(MAEnum.sma as never, 20) + 4))
    expect(len('EMA', 10)).to.equal(2 * (obvWarmup('ema' as never, 10) + 4))
    expect(len('kama', 14)).to.equal(2 * (obvWarmup('kama' as never, 14) + 4))
    // unusable: the default's count stands in
    expect(len('mcginley', 14)).to.equal(len())
  })
})

describe('Chaikin Money Flow start condition', () => {
  const cases: { settings: Extra; n?: number }[] = [
    { settings: { indicatorCondition: cu, indicatorValue: '0' } },
    {
      settings: {
        indicatorCondition: cd,
        indicatorValue: '0.1',
        cmfLength: 10,
      },
      n: 10,
    },
    { settings: { indicatorCondition: gt, indicatorValue: '0.15' } },
    {
      settings: {
        indicatorCondition: lt,
        indicatorValue: '-0.1',
        cmfLength: 30,
      },
      n: 30,
    },
  ]
  for (const c of cases) {
    it(JSON.stringify(c.settings), async () => {
      const got = await startBars(
        startEntry({ type: IndicatorEnum.cmf, ...c.settings }),
        bars,
      )
      const want = expectedStarts<{ value: number }>(
        cmfSeries(c.n),
        levelFires(
          c.settings.indicatorCondition as IndicatorStartConditionEnum,
          +(c.settings.indicatorValue as string),
        ),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }

  it('an unusable length opens nothing', async () => {
    const got = await startBars(
      startEntry({
        type: IndicatorEnum.cmf,
        indicatorCondition: gt,
        indicatorValue: '-1',
        cmfLength: 0,
      }),
      bars,
    )
    expect(got).to.deep.equal([])
  })

  it('warms up as the package does', () => {
    const len = (cmfLength?: number) =>
      new InternalIndicator({ type: IndicatorEnum.cmf, cmfLength }).length
    expect(len()).to.equal(2 * (20 + 4))
    expect(len(30)).to.equal(2 * (30 + 4))
  })
})

describe('Choppiness Index start condition', () => {
  const cases: { settings: Extra; n?: number }[] = [
    { settings: { indicatorCondition: cu, indicatorValue: '50' } },
    {
      settings: {
        indicatorCondition: cd,
        indicatorValue: '45',
        chopLength: 20,
      },
      n: 20,
    },
    { settings: { indicatorCondition: gt, indicatorValue: '61.8' } },
    { settings: { indicatorCondition: lt, indicatorValue: '38.2' } },
  ]
  for (const c of cases) {
    it(JSON.stringify(c.settings), async () => {
      const got = await startBars(
        startEntry({ type: IndicatorEnum.chop, ...c.settings }),
        bars,
      )
      const want = expectedStarts<{ value: number }>(
        chopSeries(c.n),
        levelFires(
          c.settings.indicatorCondition as IndicatorStartConditionEnum,
          +(c.settings.indicatorValue as string),
        ),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }

  it('length 1 is refused: opens nothing', async () => {
    const got = await startBars(
      startEntry({
        type: IndicatorEnum.chop,
        indicatorCondition: gt,
        indicatorValue: '0',
        chopLength: 1,
      }),
      bars,
    )
    expect(got).to.deep.equal([])
  })

  it('warms up as the package does', () => {
    const len = (chopLength?: number) =>
      new InternalIndicator({ type: IndicatorEnum.chop, chopLength }).length
    expect(len()).to.equal(2 * (14 + 1 + 4))
    expect(len(30)).to.equal(2 * (30 + 1 + 4))
  })
})

describe('Divergence with OBV / CMF oscillators', () => {
  /** The backtester's divergence decision (checkIndicators' DIV branch). */
  const bullish = (r: DIVResult) => r.posdivergence >= 1
  const bearish = (r: DIVResult) => r.negdivergence >= 1

  const divSeries = (osc: DIVUsableOscillators[]) => {
    const ind = new DIV(osc, 3, 1, 1, 60)
    return bars.map((b) => {
      const r = ind.next(ohlcv(b))
      return r === null || r === undefined ? null : { ...r }
    })
  }

  for (const [osc, divType, fires] of [
    [[IndicatorEnum.obv], DivTypeEnum.bull, bullish],
    [[IndicatorEnum.obv, IndicatorEnum.cmf], DivTypeEnum.bear, bearish],
  ] as const) {
    it(`${osc.join('+')} ${divType}`, async () => {
      const got = await startBars(
        startEntry({
          type: IndicatorEnum.div,
          divOscillators: osc,
          divType,
          divMinCount: 1,
        }),
        bars,
      )
      const want = expectedStarts<DIVResult>(
        divSeries(osc.map((o) => o.toLowerCase()) as DIVUsableOscillators[]),
        (l) => fires(l),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }
})
