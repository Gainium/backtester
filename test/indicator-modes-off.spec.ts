import { describe, it } from 'mocha'
import { expect } from 'chai'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  ExchangeIntervals,
  IndicatorAction,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  MAEnum,
  StartConditionEnum,
  TrendFilterOperatorEnum,
} from '../src/types'
import type { DCABotSettings, FullBar } from '../src/types'
import {
  FROM,
  HOUR,
  fingerprint,
  one,
  run,
} from './helpers/singlePositionHarness'

/**
 * The Moving Average trend filter and the ADX DMI mode are new settings on
 * existing indicator types. With them missing or off, a backtest must be
 * exactly what it was before they existed.
 *
 * The golden files under `test/fixtures/indicator-modes-off/` were generated
 * from backtester 1.23.0 (commit d15b0ce, `@gainium/indicators` 1.10.0),
 * before either setting existed. Regenerate only from a commit that predates
 * a deliberate engine change (`UPDATE_GOLDEN=1`).
 */

const GOLDEN_DIR = join(__dirname, 'fixtures', 'indicator-modes-off')

const { cu, cd, gt } = IndicatorStartConditionEnum
const start = IndicatorAction.startDeal
type Extra = Record<string, unknown>

/** Price wave with a varying volume, so VWMA weights differ from SMA. */
const bars: FullBar[] = Array.from({ length: 1400 }, (_, i) => {
  const p = (k: number) =>
    100 + 12 * Math.sin(k / 23) + 4 * Math.sin(k / 5) + k * 0.01
  const open = p(i - 1)
  const close = p(i)
  return {
    time: FROM + i * HOUR,
    open,
    close,
    high: Math.max(open, close) + 0.6,
    low: Math.min(open, close) - 0.6,
    volume: 1000 + 400 * Math.sin(i / 7) + 250 * Math.sin(i / 3),
    symbol: one.pair,
  }
})

const maPrice = (maType: MAEnum, length: number) => ({
  type: IndicatorEnum.ma,
  indicatorLength: length,
  maType,
  maCrossingValue: MAEnum.price,
})

const CASES: {
  name: string
  settings: Extra
  condition: IndicatorStartConditionEnum
  value?: string
  variants: [string, Extra][]
}[] = []

const MA_OFF: [string, Extra][] = [
  ['missing', {}],
  [
    'false-with-fields',
    {
      trendFilter: false,
      trendFilterLookback: 5,
      trendFilterType: TrendFilterOperatorEnum.higher,
      trendFilterValue: 0.1,
    },
  ],
  ['null', { trendFilter: null }],
]

for (const [maType, length, condition] of [
  [MAEnum.ema, 20, cu],
  [MAEnum.sma, 20, cd],
  [MAEnum.vwma, 14, cu],
  [MAEnum.hma, 16, gt],
  [MAEnum.mcginley, 14, cu],
] as const) {
  CASES.push({
    name: `ma-${maType}`,
    settings: maPrice(maType, length),
    condition,
    variants: MA_OFF,
  })
}
CASES.push({
  name: 'ma-ema-x-sma',
  settings: {
    type: IndicatorEnum.ma,
    indicatorLength: 9,
    maType: MAEnum.ema,
    maCrossingValue: MAEnum.sma,
    maCrossingLength: 21,
    maCrossingInterval: ExchangeIntervals.oneH,
    maUUID: 'u-ma2',
  },
  condition: cu,
  variants: MA_OFF,
})

const ADX_OFF: [string, Extra][] = [
  ['missing', {}],
  ['adx', { adxMode: 'adx' }],
  ['null', { adxMode: null }],
]
CASES.push(
  {
    name: 'adx-plain',
    settings: { type: IndicatorEnum.adx, indicatorLength: 14 },
    condition: cu,
    value: '50',
    variants: ADX_OFF,
  },
  {
    name: 'adx-percentile',
    settings: {
      type: IndicatorEnum.adx,
      indicatorLength: 14,
      percentile: true,
      percentileLookback: 60,
      percentilePercentage: 70,
    },
    condition: cu,
    value: '0',
    variants: ADX_OFF,
  },
  {
    name: 'adx-smoothed',
    settings: {
      type: IndicatorEnum.adx,
      indicatorLength: 14,
      smoothing: 'ema',
      smoothingLength: 9,
    },
    condition: cd,
    value: '50',
    variants: ADX_OFF,
  },
  // MAR's own trend filter shares the engine's trend-filter code path
  {
    name: 'mar-trend-filter',
    settings: {
      type: IndicatorEnum.mar,
      mar1type: MAEnum.ema,
      mar1length: 20,
      mar2type: MAEnum.price,
      mar2length: 20,
      trendFilter: true,
      trendFilterLookback: 5,
      trendFilterType: TrendFilterOperatorEnum.higher,
      trendFilterValue: 0.1,
    },
    condition: cu,
    value: '1',
    variants: [['as-is', {}]],
  },
)

const runWith = (indicator: unknown) =>
  run({
    name: 'indicator-modes-off',
    settings: {
      startCondition: StartConditionEnum.ti,
      useSl: false,
      useDca: false,
      tpPerc: '0.01',
      maxNumberOfOpenDeals: '100000',
      maxDealsPerPair: '100000',
      indicatorGroups: [
        { id: 'g-s', logic: IndicatorsLogicEnum.and, action: start },
      ],
      indicators: [indicator],
    } as Partial<DCABotSettings> & Extra,
    symbols: [one],
    bars,
  })

describe('MA trend filter / ADX DMI mode off changes nothing', () => {
  for (const c of CASES) {
    const file = join(GOLDEN_DIR, `${c.name}.json`)
    for (const [vname, v] of c.variants) {
      it(`${c.name} (${vname})`, async () => {
        const got = fingerprint(
          await runWith({
            indicatorInterval: ExchangeIntervals.oneH,
            indicatorAction: start,
            groupId: 'g-s',
            uuid: 'u-s',
            ...c.settings,
            indicatorCondition: c.condition,
            indicatorValue: c.value,
            ...v,
          }),
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
