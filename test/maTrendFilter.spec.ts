import { describe, it } from 'mocha'
import { expect } from 'chai'
import * as lib from '@gainium/indicators'
import { lineCondition, trendFilterCondition } from '@gainium/indicators'
import type { MATrendResult } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import {
  IndicatorEnum,
  IndicatorStartConditionEnum,
  MAEnum,
  TrendFilterOperatorEnum,
} from '../src/types'
import {
  expectedStarts,
  libSeries,
  startBars,
  startEntry,
  waveBars,
} from './helpers/signalHarness'

/**
 * The Moving Average trend filter as a start condition: the MA's own
 * condition (the MA against the close, evaluated on the plain MA value exactly
 * as without the filter) ANDed with `trendFilterCondition` on the package's
 * `MATrendFilter` result.
 */

const bars = waveBars(1200)
const { cu, cd, gt } = IndicatorStartConditionEnum
const { lower, higher, between } = TrendFilterOperatorEnum

type Row = MATrendResult & { price: number }

const series = (
  maType: MAEnum,
  length: number,
  lookback: number,
  value: number,
  type: TrendFilterOperatorEnum,
): (Row | null)[] =>
  libSeries<MATrendResult>(
    {
      type: lib.IndicatorEnum.ma,
      maType: maType as unknown as lib.MAEnum,
      interval: length,
      trendFilter: true,
      trendFilterLookback: lookback,
      trendFilterValue: value,
      trendFilterType: type as unknown as lib.TrendFilterOperatorEnum,
    },
    bars,
  ).map((r, i) => (r === null ? null : { ...r, price: bars[i].close }))

const cases: [
  MAEnum,
  number,
  IndicatorStartConditionEnum,
  number,
  number,
  TrendFilterOperatorEnum,
][] = [
  [MAEnum.ema, 20, cu, 5, 0.1, higher],
  [MAEnum.sma, 20, cd, 10, 0.5, lower],
  [MAEnum.vwma, 14, cu, 3, 0.2, between],
  [MAEnum.mcginley, 14, gt, 5, 0.1, higher],
]

const entry = (
  maType: MAEnum,
  length: number,
  condition: IndicatorStartConditionEnum,
  extra: Record<string, unknown> = {},
) =>
  startEntry({
    type: IndicatorEnum.ma,
    indicatorLength: length,
    maType,
    maCrossingValue: MAEnum.price,
    indicatorCondition: condition,
    ...extra,
  })

describe('MA trend filter start condition', () => {
  for (const [maType, length, condition, lookback, value, type] of cases) {
    it(`${maType}(${length}) ${condition} price, trend ${type} ${value}% over ${lookback}`, async () => {
      const filter = {
        trendFilter: true,
        trendFilterLookback: lookback,
        trendFilterValue: value,
        trendFilterType: type,
      }
      const got = await startBars(
        entry(maType, length, condition, filter),
        bars,
      )
      const want = expectedStarts<Row>(
        series(maType, length, lookback, value, type),
        // the engine's MA side: the MA is `last`, the close the line
        (l, p) =>
          lineCondition(condition, l.value, l.price, p.value, p.price) &&
          trendFilterCondition(l, { trendFilterType: type }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(want)
      // the gate only removes signals of the MA's own condition
      const plain = await startBars(entry(maType, length, condition), bars)
      expect(got.length).to.be.lessThan(plain.length)
      expect(plain).to.include.members(got)
    })
  }

  it('incomplete filter settings never pass, as MAR', async () => {
    const got = await startBars(
      entry(MAEnum.ema, 20, cu, {
        trendFilter: true,
        trendFilterType: higher,
      }),
      bars,
    )
    expect(got).to.deep.equal([])
  })

  it('warms up the lookback on top of the MA', () => {
    const len = (extra: Record<string, unknown>) =>
      new InternalIndicator({
        type: IndicatorEnum.ma,
        maType: MAEnum.ema,
        interval: 20,
        ...extra,
      }).length
    expect(len({})).to.equal(2 * (20 + 300))
    expect(
      len({
        trendFilter: true,
        trendFilterLookback: 7,
        trendFilterValue: 1,
        trendFilterType: higher,
      }),
    ).to.equal(2 * (20 + 300 + 7))
  })
})
