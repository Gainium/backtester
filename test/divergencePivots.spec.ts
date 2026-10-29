import { describe, it } from 'mocha'
import { expect } from 'chai'
import { IndicatorEnum as LibIndicatorEnum } from '@gainium/indicators'
import type { DIVResult, IndicatorConfig } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import { DivTypeEnum, IndicatorEnum } from '../src/types'
import type { FullBar } from '../src/types'
import {
  expectedStarts,
  libSeries,
  startBars,
  startEntry,
} from './helpers/signalHarness'
import { FROM, HOUR, one } from './helpers/singlePositionHarness'

/**
 * Divergence with the pivot / range settings (divPivotLeft, divPivotRight,
 * divRangeLower, divRangeUpper): they reach the indicators package's DIV,
 * and deals open exactly on the bars after that DIV + the backtester's
 * divergence decision fire. Without them the DIV is built as before
 * (3 / 1 / 1 / 60).
 */

// a seeded, mean-reverting random walk on a slow wave: many swings
let seed = 11
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
const closes = [100]
for (let i = 1; i <= 1400; i++) {
  closes.push(
    closes[i - 1] +
      1.2 * rnd() +
      0.04 * (100 + 8 * Math.sin(i / 40) - closes[i - 1]),
  )
}
const bars: FullBar[] = Array.from({ length: 1400 }, (_, i) => {
  const open = closes[i]
  const close = closes[i + 1]
  return {
    time: FROM + i * HOUR,
    open,
    close,
    high: Math.max(open, close) + 0.3,
    low: Math.min(open, close) - 0.3,
    volume: 1000 + 300 * Math.sin(i / 7),
    symbol: one.pair,
  }
})

type Pivots = {
  divPivotLeft?: number
  divPivotRight?: number
  divRangeLower?: number
  divRangeUpper?: number
}

const OSC = [IndicatorEnum.rsi, IndicatorEnum.macd, IndicatorEnum.cci]

/** The package's own DIV, given the pivots as the backtester passes them. */
const series = (p: Pivots) =>
  libSeries<DIVResult>(
    {
      type: LibIndicatorEnum.div,
      oscillators: OSC,
      leftBars: p.divPivotLeft,
      rightBars: p.divPivotRight,
      rangeLower: p.divRangeLower,
      rangeUpper: p.divRangeUpper,
    } as unknown as IndicatorConfig,
    bars,
  )

/** The backtester's divergence decision (checkIndicators' DIV branch). */
const fires = (divType: DivTypeEnum, min: number) => (r: DIVResult) =>
  ((divType === DivTypeEnum.bear || divType === DivTypeEnum.abear) &&
    r.negdivergence >= min) ||
  ((divType === DivTypeEnum.hbear || divType === DivTypeEnum.abear) &&
    r.negdivergencehidden >= min) ||
  ((divType === DivTypeEnum.bull || divType === DivTypeEnum.abull) &&
    r.posdivergence >= min) ||
  ((divType === DivTypeEnum.hbull || divType === DivTypeEnum.abull) &&
    r.posdivergencehidden >= min)

const entry = (divType: DivTypeEnum, min: number, p: Pivots) =>
  startEntry({
    type: IndicatorEnum.div,
    divOscillators: OSC,
    divType,
    divMinCount: min,
    ...p,
  })

const cases: [DivTypeEnum, number, Pivots][] = [
  [
    DivTypeEnum.abull,
    1,
    { divPivotLeft: 5, divPivotRight: 2, divRangeLower: 3, divRangeUpper: 40 },
  ],
  [DivTypeEnum.abear, 1, { divPivotLeft: 2, divPivotRight: 3 }],
  [DivTypeEnum.bull, 1, { divRangeLower: 5, divRangeUpper: 120 }],
  [DivTypeEnum.hbear, 1, { divPivotLeft: 4 }],
]

describe('Divergence pivot / range settings', () => {
  for (const [divType, min, pivots] of cases) {
    it(`${divType} min ${min} ${JSON.stringify(pivots)}`, async () => {
      const got = await startBars(entry(divType, min, pivots), bars)
      const want = expectedStarts<DIVResult>(
        series(pivots),
        fires(divType, min),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(3)
      expect(got).to.deep.equal(want)
      // the settings change the signals: they really reach the DIV
      expect(got).to.not.deep.equal(
        await startBars(entry(divType, min, {}), bars),
      )
    })
  }

  it('without them the DIV is the 3 / 1 / 1 / 60 one, as before', async () => {
    const got = await startBars(entry(DivTypeEnum.abull, 1, {}), bars)
    const want = expectedStarts<DIVResult>(
      series({
        divPivotLeft: 3,
        divPivotRight: 1,
        divRangeLower: 1,
        divRangeUpper: 60,
      }),
      fires(DivTypeEnum.abull, 1),
    )
    expect(got.length).to.be.greaterThan(3)
    expect(got).to.deep.equal(want)
    // the stored defaults and an unset field (null / '') are the same DIV
    for (const p of [
      {
        divPivotLeft: 3,
        divPivotRight: 1,
        divRangeLower: 1,
        divRangeUpper: 60,
      },
      { divPivotLeft: null, divRangeUpper: '' },
    ]) {
      expect(
        await startBars(entry(DivTypeEnum.abull, 1, p as Pivots), bars),
      ).to.deep.equal(got)
    }
  })

  it('warms up with the pivot bars, unchanged without them', () => {
    const div = (p: Record<string, number>) =>
      new InternalIndicator({
        type: IndicatorEnum.div,
        oscillators: [IndicatorEnum.rsi],
        ...p,
      }).length
    // (34 + left + right + 4) × 2
    expect(div({})).to.equal(2 * (34 + 3 + 1 + 4))
    expect(div({ leftBars: 5, rightBars: 2 })).to.equal(2 * (34 + 5 + 2 + 4))
  })
})
