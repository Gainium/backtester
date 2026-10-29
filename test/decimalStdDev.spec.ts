import { describe, it } from 'mocha'
import { expect } from 'chai'
import { BollingerBands } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import {
  BBCrossingEnum,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  MAEnum,
  STConditionEnum,
} from '../src/types'
import { fingerprint } from './helpers/singlePositionHarness'
import { runEntry, startEntry, waveBars } from './helpers/signalHarness'

/**
 * Decimal standard deviations (bbwMult on BB / BBW / BB%B, SuperTrend
 * factor): a decimal reaches the math unrounded — 2.5 backtests differently
 * from both 2 and 3 (a round or a floor would collapse it onto one of them).
 */

const bars = waveBars(1400)
const { cu, cd } = IndicatorStartConditionEnum

const cases: [string, (mult: number) => Record<string, unknown>][] = [
  [
    'BB (bbwMult)',
    (bbwMult) => ({
      type: IndicatorEnum.bb,
      indicatorLength: 20,
      bbwMult,
      bbCrossingValue: BBCrossingEnum.lower,
      // the engine evaluates a BB entry only with a value stored
      indicatorValue: '0',
      indicatorCondition: cd,
    }),
  ],
  [
    'BBW (bbwMult)',
    (bbwMult) => ({
      type: IndicatorEnum.bbw,
      indicatorLength: 20,
      bbwMult,
      indicatorValue: '0.25',
      indicatorCondition: cu,
    }),
  ],
  [
    'BB%B (bbwMult)',
    (bbwMult) => ({
      type: IndicatorEnum.bbpb,
      indicatorLength: 20,
      bbwMult,
      indicatorValue: '0.9',
      indicatorCondition: cu,
    }),
  ],
  [
    'SuperTrend (factor)',
    (factor) => ({
      type: IndicatorEnum.st,
      factor,
      atrLength: 10,
      stCondition: STConditionEnum.downToUp,
    }),
  ],
]

describe('Decimal standard deviations reach the math', () => {
  for (const [name, entry] of cases) {
    it(`${name}: 2.5 is neither 2 nor 3`, async () => {
      // one at a time: the engine's state is per active context
      const out: ReturnType<typeof fingerprint>[] = []
      for (const m of [2, 2.5, 3]) {
        out.push(fingerprint(await runEntry(startEntry(entry(m)), bars)))
      }
      const [two, twoHalf, three] = out
      expect(twoHalf.deals, 'the case opens deals').to.be.greaterThan(1)
      expect(twoHalf.sha256).to.not.equal(two.sha256)
      expect(twoHalf.sha256).to.not.equal(three.sha256)
    })
  }

  it('BB with bbwMult 2.5 emits the package BollingerBands × 2.5 bands', () => {
    const ind = new InternalIndicator({
      type: IndicatorEnum.bb,
      interval: 20,
      bbwMa: MAEnum.sma,
      bbwMaLength: 20,
      bbwMult: 2.5,
    })
    const ref = new BollingerBands(20, 2.5, MAEnum.sma, 20)
    let want: unknown = null
    for (const b of bars) {
      ind.updateValue(
        { o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 },
        b.time,
        () => undefined,
      )
      want = ref.next({ ...b, volume: b.volume ?? 0 })
    }
    const got = ind.currentData.at(-1)?.value as { result: unknown }
    expect(got.result).to.deep.equal(want)
  })
})
