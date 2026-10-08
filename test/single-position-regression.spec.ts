import { describe, it } from 'mocha'
import { expect } from 'chai'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  CloseConditionEnum,
  CooldownUnits,
  DynamicPriceFilterDirectionEnum,
  DynamicPriceFilterPriceTypeEnum,
  IndicatorAction,
  IndicatorSection,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  StartConditionEnum,
} from '../src/types'
import type { DCABotSettings } from '../src/types'
import {
  Case,
  fingerprint,
  one,
  rsi,
  run,
  two,
  wave,
} from './helpers/singlePositionHarness'

/**
 * Single position per pair (1.12.0) must not move a single number of a bot
 * that does not use it.
 *
 * The golden files under `test/fixtures/single-position-off/` were generated
 * from backtester 1.11.1 (commit 99858f0), before the feature existed. Each
 * case runs with `singlePosition: false` and a `maxPositionEntries` set, so
 * the new settings are present but off; the combo case runs with
 * `singlePosition: true`, which combo ignores. Regenerate only from a commit
 * that predates a deliberate engine change (`UPDATE_GOLDEN=1`).
 */

const GOLDEN_DIR = join(__dirname, 'fixtures', 'single-position-off')

const off = { singlePosition: false, maxPositionEntries: '3' }

const CASES: Case[] = [
  {
    name: 'asap-dca-tp-sl',
    settings: { ...off },
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'asap-dynamic-filter-cooldown-multi-tp',
    settings: {
      ...off,
      useDca: false,
      useSl: false,
      maxNumberOfOpenDeals: '4',
      useDynamicPriceFilter: true,
      dynamicPriceFilterDeviation: '2',
      dynamicPriceFilterDirection: DynamicPriceFilterDirectionEnum.under,
      dynamicPriceFilterPriceType: DynamicPriceFilterPriceTypeEnum.entry,
      useCooldown: true,
      cooldownAfterDealStart: true,
      cooldownAfterDealStartInterval: 3,
      cooldownAfterDealStartUnits: CooldownUnits.hours,
      useMultiTp: true,
      multiTp: [
        { uuid: 't1', target: '1', amount: '50' },
        { uuid: 't2', target: '3', amount: '50' },
      ],
    } as Partial<DCABotSettings> & Record<string, unknown>,
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'asap-trailing-tp',
    settings: {
      ...off,
      trailingTp: true,
      trailingTpPerc: '0.5',
      useSl: false,
    },
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'ti-start-tp',
    settings: {
      ...off,
      startCondition: StartConditionEnum.ti,
      useSl: false,
      indicators: [
        rsi(
          's',
          IndicatorAction.startDeal,
          IndicatorStartConditionEnum.lt,
          '40',
        ),
      ],
      indicatorGroups: [
        {
          id: 'g-s',
          logic: IndicatorsLogicEnum.and,
          action: IndicatorAction.startDeal,
        },
      ],
    } as Partial<DCABotSettings> & Record<string, unknown>,
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'ti-start-ti-close',
    settings: {
      ...off,
      startCondition: StartConditionEnum.ti,
      dealCloseCondition: CloseConditionEnum.techInd,
      useSl: false,
      indicators: [
        rsi(
          's',
          IndicatorAction.startDeal,
          IndicatorStartConditionEnum.lt,
          '40',
        ),
        rsi(
          'c',
          IndicatorAction.closeDeal,
          IndicatorStartConditionEnum.gt,
          '60',
          IndicatorSection.tp,
        ),
      ],
      indicatorGroups: [
        {
          id: 'g-s',
          logic: IndicatorsLogicEnum.and,
          action: IndicatorAction.startDeal,
        },
        {
          id: 'g-c',
          logic: IndicatorsLogicEnum.and,
          action: IndicatorAction.closeDeal,
          section: IndicatorSection.tp,
        },
      ],
    } as Partial<DCABotSettings> & Record<string, unknown>,
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'timer',
    settings: {
      ...off,
      startCondition: StartConditionEnum.timer,
      hodlAt: '00:00',
      hodlDay: '1',
      hodlHourly: true,
      maxNumberOfOpenDeals: '3',
    } as Partial<DCABotSettings> & Record<string, unknown>,
    symbols: [one],
    bars: wave(one.pair, 400),
    timezone: 'UTC',
  },
  {
    name: 'asap-multi-pair',
    settings: {
      ...off,
      pair: [one.pair, two.pair],
      useMulti: true,
      maxNumberOfOpenDeals: '2',
      maxDealsPerPair: '2',
    } as Partial<DCABotSettings> & Record<string, unknown>,
    symbols: [one, two],
    bars: [...wave(one.pair, 500), ...wave(two.pair, 500, 40, 50)].sort(
      (a, b) => a.time - b.time || a.symbol.localeCompare(b.symbol),
    ),
  },
  {
    name: 'combo-asap-setting-ignored',
    settings: {
      singlePosition: true,
      maxPositionEntries: '3',
      tpPerc: '1.5',
      slPerc: '-8',
    },
    symbols: [one],
    bars: wave(one.pair, 500),
    combo: true,
  },
]

describe('single position — off changes nothing (1.12.0)', () => {
  for (const c of CASES) {
    const file = join(GOLDEN_DIR, `${c.name}.json`)
    it(`${c.name}: identical to the engine before single position`, async () => {
      const got = fingerprint(await run(c))
      if (process.env.UPDATE_GOLDEN === '1') {
        if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true })
        writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`)
      }
      const golden = JSON.parse(readFileSync(file, 'utf8'))
      expect(got.deals, 'the case opens deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(golden)
    })
  }
})
