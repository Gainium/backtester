import { describe, it } from 'mocha'
import { expect } from 'chai'
import { PC, priceChangeCondition } from '@gainium/indicators'
import type { PCResult } from '@gainium/indicators'

import { IndicatorEnum, PCCompareEnum } from '../src/types'
import type { FullBar } from '../src/types'
import { expectedStarts, startBars, startEntry } from './helpers/signalHarness'
import { FROM, HOUR, one } from './helpers/singlePositionHarness'

/**
 * Price Change range as a start condition: deals open exactly on the bars
 * after the indicators package's own `PC` + `priceChangeCondition` fire, for
 * every compare mode on the up and the down move.
 */

// Hourly candles whose open→high and open→low moves spread over 0..8 %, so
// every bound of every case below is crossed many times.
let seed = 31
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const bars: FullBar[] = []
let price = 100
for (let i = 0; i < 1200; i++) {
  const open = price
  const up = rnd() * 0.08
  const down = rnd() * 0.08
  const high = open * (1 + up)
  const low = open * (1 - down)
  const close = low + (high - low) * rnd()
  bars.push({
    time: FROM + i * HOUR,
    open,
    high,
    low,
    close,
    volume: 1000,
    symbol: one.pair,
  })
  price = close
}

type Case = {
  pcValue?: string
  pcValue2?: string
  pcCompare?: PCCompareEnum
}

/** The package's own PC over the bars, at the room's threshold. */
const series = (pcValue?: string) => {
  const t = Math.abs(+(pcValue ?? '5'))
  const ind = new PC(t, t)
  return bars.map((b) => ind.next(b))
}

const want = (c: Case) =>
  expectedStarts<PCResult>(series(c.pcValue), (l) =>
    priceChangeCondition(l, {
      value: c.pcValue,
      value2: c.pcValue2,
      compare: c.pcCompare,
    }),
  )

const got = (c: Case) =>
  startBars(startEntry({ type: IndicatorEnum.pc, ...c }), bars)

const { gt, lt, bw } = PCCompareEnum

const cases: Case[] = [
  {},
  { pcValue: '2' },
  { pcValue: '2', pcCompare: gt },
  { pcValue: '2', pcCompare: lt },
  { pcValue: '2', pcValue2: '5', pcCompare: bw },
  { pcValue: '5', pcValue2: '2', pcCompare: bw },
  { pcValue: '-2', pcCompare: gt },
  { pcValue: '-2', pcCompare: lt },
  { pcValue: '-2', pcValue2: '-5', pcCompare: bw },
  { pcValue: '0.5', pcValue2: '1.25', pcCompare: bw },
]

describe('Price Change range start condition', () => {
  for (const c of cases) {
    it(JSON.stringify(c), async () => {
      const g = await got(c)
      expect(g.length, 'the case opens deals').to.be.greaterThan(10)
      expect(g).to.deep.equal(want(c))
    })
  }

  it('counts nest: gt 2 ⊇ bw 2–5, gt 2 ∩ lt 2 = ∅, bw order-free', async () => {
    const g2 = await got({ pcValue: '2', pcCompare: gt })
    const l2 = await got({ pcValue: '2', pcCompare: lt })
    const b25 = await got({ pcValue: '2', pcValue2: '5', pcCompare: bw })
    const b52 = await got({ pcValue: '5', pcValue2: '2', pcCompare: bw })
    expect(b52).to.deep.equal(b25)
    for (const b of b25) expect(g2).to.include(b)
    for (const b of l2) expect(g2).to.not.include(b)
    expect(g2.length).to.be.greaterThan(b25.length)
  })

  it('bw never opens a deal after a bar whose move is outside (lo, hi)', async () => {
    const ref = series('-2')
    const g = await got({ pcValue: '-2', pcValue2: '-5', pcCompare: bw })
    expect(g.length).to.be.greaterThan(10)
    for (const b of g) {
      const m = ref[b - 1]!.downPct!
      expect(m, `bar ${b - 1}`).to.be.greaterThan(2)
      expect(m, `bar ${b - 1}`).to.be.lessThan(5)
    }
  })

  it('bw with mixed signs or no second value never opens a deal', async () => {
    expect(
      await got({ pcValue: '2', pcValue2: '-5', pcCompare: bw }),
    ).to.deep.equal([])
    expect(await got({ pcValue: '2', pcCompare: bw })).to.deep.equal([])
  })
})
