import { after, before, describe, it } from 'mocha'
import { expect } from 'chai'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  CASES,
  runFromFile,
  runFromMemory,
  withFeedLog,
} from './helpers/indicatorGoldenHarness'
import { fingerprint } from './helpers/singlePositionHarness'

/**
 * How the engine keeps track of its indicators from bar to bar (which entry
 * holds the newest values, which pending status is due, which
 * higher-interval candles belong to the current bar) must not show in the
 * result, nor in the candles each indicator is fed.
 *
 * The golden files under `test/fixtures/indicator-bookkeeping/` were
 * generated before that bookkeeping was reworked, when the indicator list
 * was rebuilt on every value, every status list was re-filtered on every bar
 * and the higher-interval candles of all pairs were copied and filtered at
 * each step. Regenerate only from a commit that predates a deliberate engine
 * change (`UPDATE_GOLDEN=1`).
 */

const GOLDEN_DIR = join(__dirname, 'fixtures', 'indicator-bookkeeping')

describe('indicator bookkeeping — result unchanged', () => {
  // periodic stats are cut on the host's calendar; pin it so the golden
  // files hold on any machine
  let prevTz: string | undefined
  before(() => {
    prevTz = process.env.TZ
    process.env.TZ = 'UTC'
  })
  after(() => {
    if (prevTz === undefined) delete process.env.TZ
    else process.env.TZ = prevTz
  })

  for (const c of CASES) {
    for (const [mode, run] of [
      ['memory', runFromMemory],
      ['file', runFromFile],
    ] as const) {
      // the working file is always sorted by time
      if (mode === 'file' && c.unordered) continue
      it(`${c.name} (${mode})`, async function () {
        this.timeout(60000)
        const { result, fed } = await withFeedLog(() => run(c))
        const fp = {
          ...fingerprint(result),
          indicatorsEvents: (result.indicatorsEvents ?? []).length,
          fed,
        }
        const file = join(GOLDEN_DIR, `${c.name}.${mode}.json`)
        if (process.env.UPDATE_GOLDEN) {
          mkdirSync(GOLDEN_DIR, { recursive: true })
          writeFileSync(file, JSON.stringify(fp, null, 2) + '\n')
          return
        }
        expect(existsSync(file), `missing golden ${file}`).to.equal(true)
        expect(fp).to.deep.equal(JSON.parse(readFileSync(file, 'utf8')))
        // a run in which no indicator ever fires proves nothing
        expect(fp.deals).to.be.greaterThan(0)
        expect(fp.indicatorsEvents).to.be.greaterThan(0)
        expect(fp.fed.candles).to.be.greaterThan(0)
      })
    }
  }
})
