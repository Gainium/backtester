import { describe, it } from 'mocha'
import { expect } from 'chai'
import { VWAP, vwapCondition } from '@gainium/indicators'
import type { VWAPResult } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import {
  IndicatorEnum,
  IndicatorStartConditionEnum,
  VWAPAnchorEnum,
  VWAPLineEnum,
} from '../src/types'
import {
  expectedStarts,
  startBars,
  startEntry,
  waveBars,
} from './helpers/signalHarness'

/**
 * Anchored VWAP as a start condition: deals open exactly on the bars after
 * the indicators package's own `VWAP` + `vwapCondition` fire, so the
 * backtester and the live engine (which calls the same decision) agree. The
 * candle open time drives the anchor periods.
 */

const bars = waveBars(1400)
const { cu, cd, gt, lt } = IndicatorStartConditionEnum

/** The package's own VWAP over the bars (each bar carries its open time). */
const series = (anchor: VWAPAnchorEnum) => {
  const ind = new VWAP(anchor)
  return bars.map((b) => ind.next({ ...b, volume: b.volume ?? 0 }))
}

const cases: [
  IndicatorStartConditionEnum,
  VWAPAnchorEnum,
  VWAPLineEnum | undefined,
  number | string | undefined,
][] = [
  [cu, VWAPAnchorEnum.day, VWAPLineEnum.vwap, undefined],
  [cd, VWAPAnchorEnum.day, undefined, undefined],
  [cu, VWAPAnchorEnum.day, VWAPLineEnum.upper, 0.5],
  [cd, VWAPAnchorEnum.week, VWAPLineEnum.lower, '0.5'],
  [gt, VWAPAnchorEnum.week, VWAPLineEnum.upper, undefined],
  [lt, VWAPAnchorEnum.month, VWAPLineEnum.vwap, undefined],
]

describe('VWAP start condition', () => {
  for (const [condition, anchor, line, mult] of cases) {
    it(`${condition} ${line ?? 'vwap (default)'} x${mult ?? '1 (default)'}, ${anchor} anchor`, async () => {
      const got = await startBars(
        startEntry({
          type: IndicatorEnum.vwap,
          vwapAnchor: anchor,
          vwapLine: line,
          vwapBandMultiplier: mult,
          indicatorCondition: condition,
        }),
        bars,
      )
      const want = expectedStarts<VWAPResult>(series(anchor), (l, p) =>
        vwapCondition(l, p, {
          line: line ?? VWAPLineEnum.vwap,
          bandMultiplier: mult ?? 1,
          condition,
        }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }

  it('a missing anchor is the day anchor', async () => {
    const entry = (extra: Record<string, unknown>) =>
      startEntry({ type: IndicatorEnum.vwap, indicatorCondition: cu, ...extra })
    const day = await startBars(entry({ vwapAnchor: VWAPAnchorEnum.day }), bars)
    expect(await startBars(entry({}), bars)).to.deep.equal(day)
    expect(
      await startBars(entry({ vwapAnchor: VWAPAnchorEnum.week }), bars),
    ).to.not.deep.equal(day)
  })

  it('feeds the candle open time and warms up as the package does', () => {
    const ind = new InternalIndicator({
      type: IndicatorEnum.vwap,
      vwapAnchor: VWAPAnchorEnum.week,
    })
    // VWAP_WARMUP.week, doubled like every loader window
    expect(ind.length).to.equal(2 * 2017)
    const got: unknown[] = []
    for (const b of bars) {
      ind.updateValue(
        { o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 },
        b.time,
        () => undefined,
      )
      got.push(ind.currentData.at(-1)?.value)
    }
    const ref = series(VWAPAnchorEnum.week).filter((r) => r !== null)
    expect(ref.length).to.be.greaterThan(100)
    expect(got.at(-1)).to.deep.equal(ref.at(-1))
  })
})
