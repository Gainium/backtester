import { describe, it } from 'mocha'
import { expect } from 'chai'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { IndicatorEnum } from '../src/types'
import type { FullBar } from '../src/types'
import { FROM, HOUR, fingerprint, one } from './helpers/singlePositionHarness'
import { runEntry, startEntry } from './helpers/signalHarness'

/**
 * 1.26.0 adds pcCompare / pcValue2 to Price Change. With pcCompare missing,
 * null or 'gt' (and a stray pcValue2 next to it), a backtest must be exactly
 * what it was before the setting existed.
 *
 * The golden files under `test/fixtures/indicator-modes-off-1.26/` were
 * generated from backtester 1.25.0 (commit 3ca8da0, `@gainium/indicators`
 * 1.12.0), before the setting existed. Regenerate only from a commit that
 * predates a deliberate engine change (`UPDATE_GOLDEN=1`).
 */

const GOLDEN_DIR = join(__dirname, 'fixtures', 'indicator-modes-off-1.26')

type Extra = Record<string, unknown>

// six weeks of hourly candles with open→high / open→low moves of 0..6 %
let seed = 57
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const bars: FullBar[] = []
let price = 100
for (let i = 0; i < 1000; i++) {
  const open = price
  const high = open * (1 + rnd() * 0.06)
  const low = open * (1 - rnd() * 0.06)
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

const OFF: [string, Extra][] = [
  ['missing', {}],
  ['null', { pcCompare: null }],
  ['gt', { pcCompare: 'gt' }],
  ['stray-value2', { pcValue2: '1' }],
]

const CASES: { name: string; settings: Extra }[] = [
  { name: 'pc-default', settings: { type: IndicatorEnum.pc } },
  { name: 'pc-up-2', settings: { type: IndicatorEnum.pc, pcValue: '2' } },
  { name: 'pc-down-3', settings: { type: IndicatorEnum.pc, pcValue: '-3' } },
  { name: 'pc-up-0.5', settings: { type: IndicatorEnum.pc, pcValue: '0.5' } },
]

describe('Price Change compare off changes nothing (1.26.0)', () => {
  for (const c of CASES) {
    const file = join(GOLDEN_DIR, `${c.name}.json`)
    for (const [vname, v] of OFF) {
      it(`${c.name} (${vname})`, async () => {
        const got = fingerprint(
          await runEntry(startEntry({ ...c.settings, ...v }), bars),
        )
        if (process.env.UPDATE_GOLDEN === '1' && vname === OFF[0][0]) {
          if (!existsSync(GOLDEN_DIR)) {
            mkdirSync(GOLDEN_DIR, { recursive: true })
          }
          writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`)
        }
        expect(got.deals, 'the case opens deals').to.be.greaterThan(1)
        expect(got).to.deep.equal(JSON.parse(readFileSync(file, 'utf8')))
      })
    }
  }
})
