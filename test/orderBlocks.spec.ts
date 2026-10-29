import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  IndicatorEnum as LibIndicatorEnum,
  OB_WARMUP,
  orderBlockCondition,
} from '@gainium/indicators'
import type { OrderBlockResult } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import {
  IndicatorEnum,
  IndicatorStartConditionEnum,
  OBLevelEnum,
  OBSideEnum,
} from '../src/types'
import {
  expectedStarts,
  libSeries,
  startBars,
  startEntry,
  waveBars,
} from './helpers/signalHarness'
import { FROM, HOUR } from './helpers/singlePositionHarness'

/**
 * Order Blocks as a start condition: deals open exactly on the bars after
 * the indicators package's own `OrderBlocks` (fed the candle open time, as
 * its factory feeds it) + `orderBlockCondition` fire, for every condition.
 */

const bars = waveBars(1400)
const { cu, cd, gt, lt } = IndicatorStartConditionEnum
const { bullish, bearish } = OBSideEnum
const { top, middle, bottom } = OBLevelEnum

/** The package's own OrderBlocks over the bars, via its factory. */
const series = (swingLength: number) =>
  libSeries<OrderBlockResult>({ type: LibIndicatorEnum.ob, swingLength }, bars)

const cases: [
  IndicatorStartConditionEnum | undefined,
  OBSideEnum | undefined,
  OBLevelEnum | undefined,
  number | undefined,
][] = [
  // all missing: bullish top, cd (the retest long), swing 5
  [undefined, undefined, undefined, undefined],
  [cd, bullish, middle, 3],
  [cu, bearish, bottom, undefined],
  [cu, bearish, middle, 3],
  [gt, bullish, middle, undefined],
  [gt, bearish, bottom, 8],
  [lt, bearish, top, undefined],
  [lt, bullish, top, 3],
]

describe('Order Blocks start condition', () => {
  for (const [condition, side, level, swing] of cases) {
    it(`${condition ?? 'cd (default)'} ${side ?? 'bullish (default)'} ${level ?? 'top (default)'}, swing ${swing ?? '5 (default)'}`, async () => {
      const got = await startBars(
        startEntry({
          type: IndicatorEnum.ob,
          obSwingLength: swing,
          obSide: side,
          obLevel: level,
          indicatorCondition: condition,
        }),
        bars,
      )
      const want = expectedStarts<OrderBlockResult>(
        series(swing ?? 5),
        (l, p) => orderBlockCondition(l, p, { side, level, condition }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(3)
      expect(got).to.deep.equal(want)
    })
  }

  it('a crossing never fires on the bar a new block replaced the old one', async () => {
    const ref = series(5)
    // (a close through a block's far edge mitigates it, so the crossings
    // that can happen are into the block: bullish top down, bearish bottom up)
    for (const [condition, side, level] of [
      [cd, bullish, top],
      [cu, bearish, bottom],
    ] as const) {
      const got = await startBars(
        startEntry({
          type: IndicatorEnum.ob,
          obSide: side,
          obLevel: level,
          indicatorCondition: condition,
        }),
        bars,
      )
      const id = (r: OrderBlockResult | null) =>
        side === bullish ? r?.bullishId : r?.bearishId
      expect(got.length).to.be.greaterThan(3)
      for (const b of got) {
        expect(id(ref[b - 1]), `bar ${b - 1}`).to.equal(id(ref[b - 2]))
      }
    }
  })

  it('feeds the candle open time (block id) and warms up as the package does', () => {
    const ind = new InternalIndicator({
      type: IndicatorEnum.ob,
      swingLength: 5,
    })
    // OB_WARMUP, doubled like every loader window
    expect(ind.length).to.equal(2 * OB_WARMUP)
    for (const b of bars) {
      ind.updateValue(
        { o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 },
        b.time,
        () => undefined,
      )
    }
    const last = ind.currentData.at(-1)?.value as OrderBlockResult
    expect(last).to.deep.equal(series(5).at(-1))
    // an id is the open time of the breaking candle, not a bar index
    const ids = [last.bullishId, last.bearishId].filter((v) => !isNaN(v))
    expect(ids.length).to.be.greaterThan(0)
    for (const v of ids) {
      expect((v - FROM) % HOUR).to.equal(0)
      expect(v).to.be.greaterThan(FROM)
    }
  })
})
