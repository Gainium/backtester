import { describe, it } from 'mocha'
import { expect } from 'chai'
import { Squeeze, squeezeCondition, squeezeWarmup } from '@gainium/indicators'
import type { SqueezeResult } from '@gainium/indicators'

import InternalIndicator from '../src/dca/strategy/ti/indicatorLoader'
import { IndicatorEnum, SqzMomentumEnum, SqzSignalEnum } from '../src/types'
import type { FullBar } from '../src/types'
import { expectedStarts, startBars, startEntry } from './helpers/signalHarness'
import { FROM, HOUR, one } from './helpers/singlePositionHarness'

/**
 * Squeeze Momentum as a start condition: deals open exactly on the bars after
 * the indicators package's own `Squeeze` + `squeezeCondition` fire.
 */

// A price wave whose volatility swells and fades, so the Bollinger Bands
// move in and out of the Keltner Channel (squeezes form and fire).
const bars: FullBar[] = Array.from({ length: 1400 }, (_, i) => {
  const p = (k: number) =>
    100 +
    (6 + 5 * Math.sin(k / 61)) * Math.sin(k / 9) +
    3 * Math.sin(k / 37) +
    k * 0.005
  const open = p(i - 1)
  const close = p(i)
  return {
    time: FROM + i * HOUR,
    open,
    close,
    high: Math.max(open, close) + 0.4,
    low: Math.min(open, close) - 0.4,
    volume: 1000,
    symbol: one.pair,
  }
})

type Settings = {
  sqzLength?: number
  sqzBBMult?: number
  sqzKCLength?: number
  sqzKCMult?: number
}

/** The package's own Squeeze over the bars, defaulted as the factory does. */
const series = (s: Settings) => {
  const ind = new Squeeze(
    s.sqzLength ?? 20,
    s.sqzBBMult ?? 2,
    s.sqzKCLength ?? 20,
    s.sqzKCMult ?? 1.5,
  )
  return bars.map((b) => ind.next(b))
}

const { fired, on, off, any } = SqzSignalEnum
const { positive, negative, rising, falling, crossUp, crossDown } =
  SqzMomentumEnum

const cases: [
  SqzSignalEnum | undefined,
  SqzMomentumEnum | undefined,
  Settings,
][] = [
  // all missing: fired + positive, 20 × 2 / 20 × 1.5
  [undefined, undefined, {}],
  [fired, negative, {}],
  [fired, SqzMomentumEnum.any, { sqzBBMult: 1.5 }],
  [on, rising, { sqzLength: 14, sqzKCLength: 14 }],
  [off, falling, {}],
  [any, crossUp, { sqzKCMult: 1.25 }],
  [any, crossDown, {}],
  [off, positive, { sqzBBMult: 2.5, sqzKCLength: 30, sqzKCMult: 2 }],
]

describe('Squeeze Momentum start condition', () => {
  for (const [signal, momentum, settings] of cases) {
    it(`${signal ?? 'fired (default)'} + ${momentum ?? 'positive (default)'} ${JSON.stringify(settings)}`, async () => {
      const got = await startBars(
        startEntry({
          type: IndicatorEnum.sqz,
          sqzSignal: signal,
          sqzMomentum: momentum,
          ...settings,
        }),
        bars,
      )
      const want = expectedStarts<SqueezeResult>(series(settings), (l, p) =>
        squeezeCondition(l, p, { signal, momentum }),
      )
      expect(got.length, 'the case opens deals').to.be.greaterThan(3)
      expect(got).to.deep.equal(want)
    })
  }

  it('fired never fires when the previous bar was not in a squeeze', async () => {
    const ref = series({})
    const got = await startBars(
      startEntry({
        type: IndicatorEnum.sqz,
        sqzSignal: fired,
        sqzMomentum: SqzMomentumEnum.any,
      }),
      bars,
    )
    expect(got.length).to.be.greaterThan(3)
    for (const b of got) {
      expect(ref[b - 2]?.squeeze, `bar ${b - 2}`).to.equal(1)
      expect(ref[b - 1]?.squeeze, `bar ${b - 1}`).to.not.equal(1)
    }
  })

  it('the lengths and decimal multipliers reach the math', async () => {
    const entry = (settings: Settings) =>
      startEntry({
        type: IndicatorEnum.sqz,
        sqzSignal: off,
        sqzMomentum: positive,
        ...settings,
      })
    const plain = await startBars(entry({}), bars)
    for (const s of [
      { sqzBBMult: 2.5 },
      { sqzKCMult: 1.75 },
      { sqzLength: 30 },
      { sqzKCLength: 30 },
    ]) {
      expect(
        await startBars(entry(s), bars),
        JSON.stringify(s),
      ).to.not.deep.equal(plain)
    }
  })

  it('any + any never fires', async () => {
    const got = await startBars(
      startEntry({
        type: IndicatorEnum.sqz,
        sqzSignal: any,
        sqzMomentum: SqzMomentumEnum.any,
      }),
      bars,
    )
    expect(got).to.deep.equal([])
  })

  it('warms up as the package does', () => {
    const ind = new InternalIndicator({
      type: IndicatorEnum.sqz,
      length: 14,
      bbMult: 2,
      kcLength: 30,
      kcMult: 1.5,
    })
    // squeezeWarmup = 2 × max(length, kcLength), doubled like every loader window
    expect(ind.length).to.equal(2 * squeezeWarmup(14, 30))
    expect(ind.length).to.equal(2 * 60)
  })
})
