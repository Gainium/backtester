import { describe, it } from 'mocha'
import { expect } from 'chai'
import { ALMA, KAMA, LSMA } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import { MathHelper } from '../src/helper/math'
import {
  IndicatorEnum,
  IndicatorStartConditionEnum,
  MAEnum,
} from '../src/types'
import {
  expectedStarts,
  startBars,
  startEntry,
  waveBars,
} from './helpers/signalHarness'

/**
 * KAMA / ALMA / LSMA as MA types: a Moving Average start condition against
 * the price opens deals exactly on the bars after the indicators package's
 * own class and the engine's MA-vs-price comparison fire (the MA is `last`,
 * the close is `value`), as McGinley does.
 */

const bars = waveBars(2000)
const LENGTH = 14
const { cu, cd, gt, lt } = IndicatorStartConditionEnum
const math = new MathHelper()

type MaPoint = { ma: number; price: number }

const maSeries = (Ma: typeof KAMA | typeof ALMA | typeof LSMA) => {
  const ind = new Ma(LENGTH)
  return bars.map((b) => {
    const ma = ind.next(b.close)
    return ma === null || ma === undefined
      ? null
      : ({ ma, price: b.close } as MaPoint)
  })
}

const fires =
  (condition: IndicatorStartConditionEnum) => (l: MaPoint, p: MaPoint) => {
    switch (condition) {
      case cu:
        return math.lt(l.price, l.ma) && math.gte(p.price, p.ma)
      case cd:
        return math.gt(l.price, l.ma) && math.lte(p.price, p.ma)
      case gt:
        return math.gt(l.ma, l.price)
      case lt:
        return math.lt(l.ma, l.price)
      default:
        return false
    }
  }

const entry = (maType: MAEnum, condition: IndicatorStartConditionEnum) =>
  startEntry({
    type: IndicatorEnum.ma,
    maType,
    indicatorLength: LENGTH,
    maCrossingValue: MAEnum.price,
    indicatorCondition: condition,
  })

describe('KAMA / ALMA / LSMA MA start condition', () => {
  for (const condition of [cu, cd, gt, lt]) {
    it(`kama ${condition}`, async () => {
      const got = await startBars(entry(MAEnum.kama, condition), bars)
      const want = expectedStarts(maSeries(KAMA), fires(condition))
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }

  for (const [maType, Ma] of [
    [MAEnum.alma, ALMA],
    [MAEnum.lsma, LSMA],
  ] as const) {
    it(`${maType} cu`, async () => {
      const got = await startBars(entry(maType, cu), bars)
      const want = expectedStarts(maSeries(Ma), fires(cu))
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }

  it('each is a different line from EMA of the same length', async () => {
    const ema = await startBars(entry(MAEnum.ema, cd), bars)
    for (const t of [MAEnum.kama, MAEnum.alma, MAEnum.lsma]) {
      expect(await startBars(entry(t, cd), bars), t).to.not.deep.equal(ema)
    }
  })

  it('warms up as the package does', () => {
    const len = (maType: MAEnum) =>
      new InternalIndicator({ type: IndicatorEnum.ma, maType, interval: 20 })
        .length
    expect(len(MAEnum.kama)).to.equal(2 * (20 + 1000))
    expect(len(MAEnum.alma)).to.equal(2 * (20 + 300))
    expect(len(MAEnum.lsma)).to.equal(2 * (20 + 300))
  })
})
