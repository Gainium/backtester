import { describe, it } from 'mocha'
import { expect } from 'chai'
import { KDJ, kdjCondition } from '@gainium/indicators'
import type { KDJResult } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import {
  IndicatorEnum,
  IndicatorStartConditionEnum,
  KDJCompareToEnum,
  KDJLineEnum,
  StochRangeEnum,
} from '../src/types'
import {
  Extra,
  expectedStarts,
  startBars,
  startEntry,
  waveBars,
} from './helpers/signalHarness'

/**
 * KDJ as a start condition: deals open exactly on the bars after the
 * indicators package's own `KDJ` + `kdjCondition` fire, with the settings
 * passed to the decision as stored (Stochastic's zone keys included).
 */

const bars = waveBars(900)
const { cu, cd, gt, lt } = IndicatorStartConditionEnum

const series = (n = 9, k = 3, d = 3) => {
  const ind = new KDJ(n, k, d)
  return bars.map((b) => ind.next(b))
}

type Case = {
  name: string
  settings: Extra
  length?: [number, number, number]
}

const cases: Case[] = [
  {
    name: 'K crosses up D (defaults)',
    settings: { indicatorCondition: cu },
  },
  {
    name: 'J crosses down K, KDJ(14, 5, 4)',
    settings: {
      kdjLength: 14,
      kdjKSmooth: 5,
      kdjDSmooth: 4,
      kdjLine: KDJLineEnum.j,
      kdjCompareTo: KDJCompareToEnum.k,
      indicatorCondition: cd,
    },
    length: [14, 5, 4],
  },
  {
    name: 'J below a custom level',
    settings: {
      kdjLine: KDJLineEnum.j,
      kdjCompareTo: KDJCompareToEnum.custom,
      indicatorValue: '10',
      indicatorCondition: lt,
    },
  },
  {
    name: 'D crosses up a custom level',
    settings: {
      kdjLine: KDJLineEnum.d,
      kdjCompareTo: KDJCompareToEnum.custom,
      indicatorValue: '50',
      indicatorCondition: cu,
    },
  },
  {
    name: 'K crosses up D in the lower zone',
    settings: {
      indicatorCondition: cu,
      stochRange: StochRangeEnum.lower,
      stochUpper: '30',
      stochLower: '70',
    },
  },
  {
    name: 'K above D in either zone',
    settings: {
      indicatorCondition: gt,
      stochRange: StochRangeEnum.both,
      stochUpper: '70',
      stochLower: '30',
    },
  },
]

describe('KDJ start condition', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const got = await startBars(
        startEntry({ type: IndicatorEnum.kdj, ...c.settings }),
        bars,
      )
      const s = c.settings
      const want = expectedStarts<KDJResult>(
        series(...(c.length ?? [])),
        (l, p) =>
          kdjCondition(l, p, {
            line: (s.kdjLine as string) ?? KDJLineEnum.k,
            compareTo: (s.kdjCompareTo as string) ?? KDJCompareToEnum.d,
            level: s.indicatorValue as string,
            condition: s.indicatorCondition as string,
            zone: s.stochRange as string,
            stochUpper: s.stochUpper as string,
            stochLower: s.stochLower as string,
          }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }

  it('the zone filter constrains', async () => {
    const plain = await startBars(
      startEntry({ type: IndicatorEnum.kdj, indicatorCondition: cu }),
      bars,
    )
    const zoned = await startBars(
      startEntry({ type: IndicatorEnum.kdj, ...cases[4].settings }),
      bars,
    )
    expect(zoned.length).to.be.lessThan(plain.length)
    expect(plain).to.include.members(zoned)
  })

  it('warms up as the package does', () => {
    const kdj = (n: number, k: number, d: number) =>
      new InternalIndicator({
        type: IndicatorEnum.kdj,
        kdjLength: n,
        kdjKSmooth: k,
        kdjDSmooth: d,
      }).length
    // n - 1 + kdjSettleBars(k, d) (63 for 9/3/3) + 4, doubled
    expect(kdj(9, 3, 3)).to.equal(2 * (new KDJ(9, 3, 3).warmup + 4))
    expect(new KDJ(9, 3, 3).warmup).to.equal(63)
    expect(kdj(14, 5, 4)).to.equal(2 * (new KDJ(14, 5, 4).warmup + 4))
  })
})
