import { describe, it } from 'mocha'
import { expect } from 'chai'
import { Candle, CANDLE_WARMUP, candleCondition } from '@gainium/indicators'
import type { CandleResult } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import {
  CandleColorEnum,
  CandleSourceEnum,
  CandleTriggerEnum,
  IndicatorEnum,
} from '../src/types'
import type { FullBar } from '../src/types'
import {
  expectedStarts,
  startBars,
  startEntry,
  waveBars,
} from './helpers/signalHarness'

/**
 * Candle colour as a start condition: deals open exactly on the bars after
 * the indicators package's own `Candle` + `candleCondition` fire, for the
 * regular candle and Heikin Ashi, a streak and the start of a run.
 */

// every 13th candle is a doji (close = open): it breaks every streak
const bars: FullBar[] = waveBars(1400).map((b, i) =>
  i % 13 === 0
    ? {
        ...b,
        close: b.open,
        high: b.open + 0.6,
        low: b.open - 0.6,
      }
    : b,
)

/** The package's own Candle over the bars. */
const series = (source: CandleSourceEnum) => {
  const ind = new Candle(source)
  return bars.map((b) => ind.next(b))
}

const { regular, heikinAshi } = CandleSourceEnum
const { green, red } = CandleColorEnum
const { streak, start } = CandleTriggerEnum

const cases: [
  CandleSourceEnum | undefined,
  CandleColorEnum | undefined,
  number | undefined,
  CandleTriggerEnum | undefined,
][] = [
  [regular, green, 3, streak],
  [regular, red, 2, start],
  [regular, red, 4, streak],
  [heikinAshi, green, 4, start],
  [heikinAshi, red, 2, streak],
  [heikinAshi, green, 6, streak],
  // all missing: Heikin Ashi, green, 1, streak
  [undefined, undefined, undefined, undefined],
]

describe('Candle colour start condition', () => {
  for (const [source, color, count, trigger] of cases) {
    it(`${source ?? 'default source'} ${color ?? 'default colour'} x${count ?? 'default'} ${trigger ?? 'default trigger'}`, async () => {
      const got = await startBars(
        startEntry({
          type: IndicatorEnum.candle,
          candleSource: source,
          candleColor: color,
          candleCount: count,
          candleTrigger: trigger,
        }),
        bars,
      )
      const want = expectedStarts<CandleResult>(
        series(source ?? heikinAshi),
        (l, p) => candleCondition(l, p, { color, count, trigger }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(3)
      expect(got).to.deep.equal(want)
    })
  }

  it('start fires once per run, streak on every candle of it', async () => {
    const entry = (trigger: CandleTriggerEnum) =>
      startEntry({
        type: IndicatorEnum.candle,
        candleSource: regular,
        candleColor: green,
        candleCount: 2,
        candleTrigger: trigger,
      })
    const s = await startBars(entry(start), bars)
    const k = await startBars(entry(streak), bars)
    expect(k.length).to.be.greaterThan(s.length)
    // every start bar is also a streak bar
    expect(s.filter((b) => !k.includes(b))).to.deep.equal([])
  })

  it('never fires on a doji', async () => {
    for (const source of [regular, heikinAshi]) {
      for (const color of [green, red]) {
        const got = await startBars(
          startEntry({
            type: IndicatorEnum.candle,
            candleSource: source,
            candleColor: color,
            candleCount: 1,
          }),
          bars,
        )
        const ref = series(source)
        // the signal bar is the one before the deal's bar
        expect(got.filter((b) => ref[b - 1]?.color === 0)).to.deep.equal([])
      }
    }
    // the regular source sees the dojis: no signal on any 13th bar
    const got = await startBars(
      startEntry({
        type: IndicatorEnum.candle,
        candleSource: regular,
        candleColor: red,
      }),
      bars,
    )
    expect(got.filter((b) => (b - 1) % 13 === 0)).to.deep.equal([])
  })

  it('warms up as the package does', () => {
    const ind = new InternalIndicator({
      type: IndicatorEnum.candle,
      source: heikinAshi,
    })
    expect(CANDLE_WARMUP).to.equal(81)
    // CANDLE_WARMUP, doubled like every loader window
    expect(ind.length).to.equal(2 * 81)
  })
})
