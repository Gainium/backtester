import { describe, it } from 'mocha'
import { expect } from 'chai'
import * as lib from '@gainium/indicators'
import { dmiCondition } from '@gainium/indicators'
import type { ADXResult } from '@gainium/indicators'

import {
  ADXModeEnum,
  IndicatorEnum,
  IndicatorStartConditionEnum,
} from '../src/types'
import {
  Extra,
  expectedStarts,
  libSeries,
  startBars,
  startEntry,
  waveBars,
} from './helpers/signalHarness'

/**
 * ADX in DMI mode as a start condition: +DI against −DI. Deals open exactly
 * on the bars after the indicators package's own ADX (with the DI lines) +
 * `dmiCondition` fire; `indicatorValue` is not read.
 */

const bars = waveBars(900)
const { cu, cd, gt, lt } = IndicatorStartConditionEnum

const dmi = (extra: Extra) =>
  startEntry({
    type: IndicatorEnum.adx,
    indicatorLength: 14,
    adxMode: ADXModeEnum.dmi,
    ...extra,
  })

describe('ADX DMI mode start condition', () => {
  for (const condition of [cu, cd, gt, lt]) {
    it(`+DI ${condition} -DI`, async () => {
      const got = await startBars(dmi({ indicatorCondition: condition }), bars)
      const ind = new lib.ADX(14, false, undefined, undefined, true)
      const want = expectedStarts<ADXResult>(
        bars.map((b) => ind.next(b) as ADXResult | null),
        (l, p) => dmiCondition(l, p, { condition }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
    })
  }

  it('ignores indicatorValue', async () => {
    const a = await startBars(dmi({ indicatorCondition: cu }), bars)
    const b = await startBars(
      dmi({ indicatorCondition: cu, indicatorValue: '25' }),
      bars,
    )
    const c = await startBars(
      dmi({ indicatorCondition: cu, indicatorValue: '1e9' }),
      bars,
    )
    expect(b).to.deep.equal(a)
    expect(c).to.deep.equal(a)
  })

  it('with smoothing and percentile, reads the unsmoothed DI lines', async () => {
    const extra = {
      smoothing: 'ema',
      smoothingLength: 9,
      percentile: true,
      percentileLookback: 60,
      percentilePercentage: 70,
    }
    const got = await startBars(dmi({ indicatorCondition: cd, ...extra }), bars)
    const want = expectedStarts<ADXResult>(
      libSeries<ADXResult>(
        {
          type: lib.IndicatorEnum.adx,
          interval: 14,
          dmi: true,
          ...extra,
        } as lib.IndicatorConfig,
        bars,
      ),
      (l, p) => dmiCondition(l, p, { condition: cd }),
    )
    expect(got.length, 'the case opens deals').to.be.greaterThan(1)
    expect(got).to.deep.equal(want)
  })

  it('differs from the ADX line condition', async () => {
    const adx = await startBars(
      startEntry({
        type: IndicatorEnum.adx,
        indicatorLength: 14,
        indicatorCondition: cu,
        indicatorValue: '50',
      }),
      bars,
    )
    const di = await startBars(
      dmi({ indicatorCondition: cu, indicatorValue: '50' }),
      bars,
    )
    expect(di).to.not.deep.equal(adx)
  })
})
