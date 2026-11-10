import { after, before, describe, it } from 'mocha'
import { expect } from 'chai'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { CASES, makeFromFile, runFromFile } from './helpers/fileModeHarness'
import { fingerprint } from './helpers/singlePositionHarness'

/**
 * A backtest that reads its candles from the working file (`useFile: true`,
 * the server-side path) must return the same result whatever the engine does
 * about writing that file or pacing the loop over it.
 *
 * The golden files under `test/fixtures/file-mode/` were generated from
 * commit 84a404d, when every candle was appended to the file on its own and
 * the loop waited on a timer after every bar. Regenerate only from a commit
 * that predates a deliberate engine change (`UPDATE_GOLDEN=1`).
 */

const GOLDEN_DIR = join(__dirname, 'fixtures', 'file-mode')

describe('file mode — result unchanged', () => {
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
    it(c.name, async function () {
      this.timeout(60000)
      const fp = fingerprint(await runFromFile(c))
      const file = join(GOLDEN_DIR, `${c.name}.json`)
      if (process.env.UPDATE_GOLDEN) {
        mkdirSync(GOLDEN_DIR, { recursive: true })
        writeFileSync(file, JSON.stringify(fp, null, 2) + '\n')
        return
      }
      expect(existsSync(file), `missing golden ${file}`).to.equal(true)
      expect(fp).to.deep.equal(JSON.parse(readFileSync(file, 'utf8')))
      // a run that does nothing proves nothing
      expect(fp.deals).to.be.greaterThan(0)
    })
  }

  // The loop over the file hands the event loop back to the host while it
  // runs: a timer armed during the run fires before the run is over.
  it('a stop set from a timer ends the run early', async function () {
    this.timeout(60000)
    const [c] = CASES
    let bars = 0
    const bt = makeFromFile(c, {
      afterBar: () => {
        if (bars++ === 0) {
          setTimeout(() => {
            bt.stop = true
          }, 0)
        }
      },
    })
    const result = await bt.test()
    expect(result).to.equal(undefined)
    expect(bars).to.be.greaterThan(0)
    expect(bars).to.be.lessThan(c.bars.length - 1)
  })
})
