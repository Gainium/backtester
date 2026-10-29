import { describe, it } from 'mocha'
import { expect } from 'chai'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  BBCrossingEnum,
  DivTypeEnum,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  OBFVGRefEnum,
  OBFVGValueEnum,
  SessionLevelEnum,
  SessionRuleEnum,
  STConditionEnum,
} from '../src/types'
import type { FullBar } from '../src/types'
import { FROM, HOUR, fingerprint, one } from './helpers/singlePositionHarness'
import { runEntry, startEntry } from './helpers/signalHarness'

/**
 * 1.25.0 adds new settings to existing indicator types: the Divergence
 * pivots (divPivotLeft / divPivotRight / divRangeLower / divRangeUpper) and
 * where Session Price levels is evaluated (sessionLevelsActive). With them
 * missing, unset or at their defaults, a backtest must be exactly what it
 * was before they existed — and so must the neighbours of the new types
 * (OBFVG next to Order Blocks; BB / SuperTrend, whose multipliers are now
 * stepped in decimals by the dashboard).
 *
 * The golden files under `test/fixtures/indicator-modes-off-1.25/` were
 * generated from backtester 1.24.0 (commit c68ea0b, `@gainium/indicators`
 * 1.11.0), before either setting existed. Regenerate only from a commit that
 * predates a deliberate engine change (`UPDATE_GOLDEN=1`).
 */

const GOLDEN_DIR = join(__dirname, 'fixtures', 'indicator-modes-off-1.25')

const { cu, cd, gt, lt } = IndicatorStartConditionEnum
type Extra = Record<string, unknown>

// eight weeks of hourly candles from Thursday 2026-01-01: a seeded,
// mean-reverting random walk on a slow wave (swings, divergences, sessions)
let seed = 23
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
const closes = [100]
for (let i = 1; i <= 1400; i++) {
  closes.push(
    closes[i - 1] +
      1.0 * rnd() +
      0.03 * (100 + 7 * Math.sin(i / 31) - closes[i - 1]),
  )
}
const bars: FullBar[] = Array.from({ length: 1400 }, (_, i) => {
  const open = closes[i]
  const close = closes[i + 1]
  return {
    time: FROM + i * HOUR,
    open,
    close,
    high: Math.max(open, close) + 0.3,
    low: Math.min(open, close) - 0.3,
    volume: 1000 + 300 * Math.sin(i / 7),
    symbol: one.pair,
  }
})

const DIV_OFF: [string, Extra][] = [
  ['missing', {}],
  [
    'unset',
    {
      divPivotLeft: null,
      divPivotRight: undefined,
      divRangeLower: '',
      divRangeUpper: null,
    },
  ],
  [
    'defaults',
    { divPivotLeft: 3, divPivotRight: 1, divRangeLower: 1, divRangeUpper: 60 },
  ],
]

const SESSION_OFF: [string, Extra][] = [
  ['missing', {}],
  ['session', { sessionLevelsActive: 'session' }],
  ['null', { sessionLevelsActive: null }],
]

const AS_IS: [string, Extra][] = [['as-is', {}]]

const CASES: { name: string; settings: Extra; variants: [string, Extra][] }[] =
  [
    {
      name: 'div-any-bull',
      settings: {
        type: IndicatorEnum.div,
        divOscillators: [IndicatorEnum.rsi, IndicatorEnum.macd],
        divType: DivTypeEnum.abull,
        divMinCount: 1,
      },
      variants: DIV_OFF,
    },
    {
      name: 'div-bear',
      settings: {
        type: IndicatorEnum.div,
        divOscillators: [
          IndicatorEnum.rsi,
          IndicatorEnum.cci,
          IndicatorEnum.mfi,
        ],
        divType: DivTypeEnum.abear,
        divMinCount: 2,
      },
      variants: DIV_OFF,
    },
    {
      name: 'session-levels-monday',
      settings: {
        type: IndicatorEnum.session,
        sessionRule: SessionRuleEnum.levels,
        sessionDays: [1],
        sessionLevelA: SessionLevelEnum.price,
        sessionLevelB: SessionLevelEnum.prevMid,
        indicatorCondition: gt,
      },
      variants: SESSION_OFF,
    },
    {
      name: 'session-levels-hours',
      settings: {
        type: IndicatorEnum.session,
        sessionRule: SessionRuleEnum.levels,
        sessionDays: [1, 2, 3, 4, 5],
        sessionStart: '09:30',
        sessionEnd: '16:00',
        sessionTimezone: 'America/New_York',
        sessionLevelA: SessionLevelEnum.price,
        sessionLevelB: SessionLevelEnum.prevLow,
        indicatorCondition: lt,
      },
      variants: SESSION_OFF,
    },
    {
      name: 'obfvg-any-gt',
      settings: {
        type: IndicatorEnum.obfvg,
        obfvgValue: OBFVGValueEnum.any,
        obfvgRef: OBFVGRefEnum.middle,
        indicatorCondition: gt,
      },
      variants: AS_IS,
    },
    {
      name: 'bb-lower-cd',
      settings: {
        type: IndicatorEnum.bb,
        indicatorLength: 20,
        bbwMult: 2,
        bbCrossingValue: BBCrossingEnum.lower,
        indicatorValue: '0',
        indicatorCondition: cd,
      },
      variants: AS_IS,
    },
    {
      name: 'st-down-to-up',
      settings: {
        type: IndicatorEnum.st,
        factor: 3,
        atrLength: 10,
        stCondition: STConditionEnum.downToUp,
        indicatorCondition: cu,
      },
      variants: AS_IS,
    },
  ]

describe('Divergence pivots / Session levels active off change nothing (1.25.0)', () => {
  for (const c of CASES) {
    const file = join(GOLDEN_DIR, `${c.name}.json`)
    for (const [vname, v] of c.variants) {
      it(`${c.name} (${vname})`, async () => {
        const got = fingerprint(
          await runEntry(startEntry({ ...c.settings, ...v }), bars),
        )
        if (process.env.UPDATE_GOLDEN === '1' && vname === c.variants[0][0]) {
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
