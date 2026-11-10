import { createHash } from 'crypto'

import DCABacktesting from '../../src/dca'
import InternalIndicator from '../../src/dca/strategy/ti/indicatorLoader'
import { StrategyContextManager } from '../../src/dca/strategy/context'
import {
  BBCrossingEnum,
  CloseConditionEnum,
  DCAConditionEnum,
  ExchangeEnum,
  ExchangeIntervals,
  IndicatorAction,
  IndicatorEnum,
  IndicatorSection,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  MAEnum,
  StartConditionEnum,
  timeIntervalMap,
  tvIntervalMap,
} from '../../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  Symbols,
} from '../../src/types'
import {
  base,
  FROM,
  HOUR,
  mkSymbol,
  one,
  two,
  wave,
} from './singlePositionHarness'

/**
 * Indicator-driven cases for the golden check of the per-bar indicator
 * bookkeeping: several indicator types at once, two timeframes (1h bars with
 * 4h indicators), several pairs, AND / OR groups, an MA crossing (which
 * registers a helper child), a kept condition, close and DCA by indicator.
 * Every case runs both ways the engine reads candles: from memory (the
 * browser, and hosts that pass bars) and from the working file (server-side).
 */

export const three = mkSymbol('CCC_USDT', 'CCC')

const { lt, gt, cu, cd } = IndicatorStartConditionEnum
const { startDeal, closeDeal, startDca } = IndicatorAction
const { oneH, fourH } = ExchangeIntervals

type Extra = Record<string, unknown>

const ind = (
  id: string,
  group: string,
  action: IndicatorAction,
  settings: Extra,
) =>
  ({
    indicatorInterval: oneH,
    indicatorAction: action,
    groupId: group,
    uuid: `u-${id}`,
    ...settings,
  }) as never

const rsi = (length: number, condition: string, value: string): Extra => ({
  type: IndicatorEnum.rsi,
  indicatorLength: length,
  indicatorCondition: condition,
  indicatorValue: value,
})

const group = (
  id: string,
  logic: IndicatorsLogicEnum,
  action: IndicatorAction,
  section?: IndicatorSection,
) => ({ id, logic, action, ...(section ? { section } : {}) })

/** Candles of `interval` built from 1h bars (per pair, in time order). */
export const aggregate = (
  bars: FullBar[],
  interval: ExchangeIntervals,
): FullBar[] => {
  const size = timeIntervalMap[interval]
  const out = new Map<string, FullBar>()
  for (const b of bars) {
    const time = Math.floor(b.time / size) * size
    const key = `${b.symbol}@${time}`
    const c = out.get(key)
    if (!c) {
      out.set(key, { ...b, time })
      continue
    }
    c.high = Math.max(c.high, b.high)
    c.low = Math.min(c.low, b.low)
    c.close = b.close
    c.volume = (c.volume ?? 0) + (b.volume ?? 0)
  }
  return [...out.values()]
}

/** The order the engine's own loader hands bars over in. */
const byTime = (bars: FullBar[]) =>
  [...bars].sort((a, b) =>
    a.time === b.time
      ? `${a.symbol}`.localeCompare(`${b.symbol}`)
      : a.time - b.time,
  )

export type IndicatorCase = {
  name: string
  settings: Partial<DCABotSettings> & Extra
  symbols: Symbols[]
  /** 1h bars of every pair */
  bars: FullBar[]
  /** higher intervals the indicators read */
  intervals: ExchangeIntervals[]
  /** hand some higher-interval bars over out of time order (memory only) */
  unordered?: boolean
  /**
   * 1h bars start this many bars late, so the higher intervals have history
   * from before the first bar of the run (as a host's warm-up request gives)
   */
  lead?: number
}

const waves = (symbols: Symbols[], n: number) =>
  symbols.flatMap((s, i) => wave(s.pair, n, i * 11, 100 - i * 30))

const ti: Extra = {
  startCondition: StartConditionEnum.ti,
  useSl: false,
  tpPerc: '1.5',
}

export const buildCases = (n: number): IndicatorCase[] => [
  {
    // two start groups joined by OR: (RSI 1h AND EMA x SMA) OR (BB lower OR
    // RSI 4h, the 4h one kept for 2 bars); closed by a 1h RSI
    name: 'groups-two-timeframes',
    settings: {
      ...ti,
      useTp: true,
      dealCloseCondition: CloseConditionEnum.techInd,
      maxNumberOfOpenDeals: '2',
      startDealLogic: IndicatorsLogicEnum.or,
      indicators: [
        ind('a1', 'g-a', startDeal, rsi(14, lt, '48')),
        ind('a2', 'g-a', startDeal, {
          type: IndicatorEnum.ma,
          indicatorLength: 9,
          maType: MAEnum.ema,
          maCrossingValue: MAEnum.sma,
          maCrossingLength: 21,
          maCrossingInterval: fourH,
          maUUID: 'u-a2-ma',
          indicatorCondition: lt,
        }),
        ind('b1', 'g-b', startDeal, {
          type: IndicatorEnum.bb,
          indicatorLength: 20,
          bbwMult: 2,
          bbCrossingValue: BBCrossingEnum.lower,
          indicatorValue: '0',
          indicatorCondition: cd,
        }),
        ind('b2', 'g-b', startDeal, {
          ...rsi(7, lt, '35'),
          indicatorInterval: fourH,
          keepConditionBars: '2',
        }),
        ind('c1', 'g-c', closeDeal, {
          ...rsi(14, gt, '58'),
          section: IndicatorSection.tp,
        }),
      ],
      indicatorGroups: [
        group('g-a', IndicatorsLogicEnum.and, startDeal),
        group('g-b', IndicatorsLogicEnum.or, startDeal),
        group('g-c', IndicatorsLogicEnum.and, closeDeal, IndicatorSection.tp),
      ],
    },
    symbols: [one, two],
    bars: waves([one, two], n),
    intervals: [fourH],
  },
  {
    // three pairs competing for two slots; a start needs a 4h RSI and two 1h
    // indicators at once, one of them kept for 3 bars
    name: 'three-pairs-4h-and-1h',
    settings: {
      ...ti,
      maxNumberOfOpenDeals: '2',
      indicators: [
        ind('h', 'g', startDeal, {
          ...rsi(7, gt, '40'),
          indicatorInterval: fourH,
        }),
        ind('l1', 'g', startDeal, rsi(10, cu, '45')),
        ind('l2', 'g', startDeal, {
          type: IndicatorEnum.ma,
          indicatorLength: 20,
          maType: MAEnum.sma,
          maCrossingValue: MAEnum.price,
          indicatorCondition: gt,
          keepConditionBars: '3',
        }),
      ],
      indicatorGroups: [group('g', IndicatorsLogicEnum.and, startDeal)],
    },
    symbols: [one, two, three],
    bars: waves([one, two, three], n),
    intervals: [fourH],
  },
  {
    // safety orders placed by an indicator, deal started by a 4h one
    name: 'dca-by-indicator',
    settings: {
      ...ti,
      tpPerc: '3',
      dcaCondition: DCAConditionEnum.indicators,
      indicators: [
        ind('s', 'g-s', startDeal, {
          ...rsi(7, lt, '45'),
          indicatorInterval: fourH,
        }),
        ind('d', 'g-d', startDca, {
          ...rsi(14, lt, '40'),
          minimumDeviation: '0',
        }),
      ],
      indicatorGroups: [
        group('g-s', IndicatorsLogicEnum.and, startDeal),
        group('g-d', IndicatorsLogicEnum.and, startDca),
      ],
    },
    symbols: [one, two],
    bars: waves([one, two], n),
    intervals: [fourH],
    lead: 202,
  },
]

/** 1,900 one-hour bars per pair (475 four-hour ones). */
export const CASES: IndicatorCase[] = [
  ...buildCases(1900),
  // higher-interval bars that are not in time order still give one answer
  {
    ...buildCases(700)[1],
    name: 'three-pairs-4h-out-of-order',
    unordered: true,
    lead: 101,
  },
  // two entries stored under one id (a copied indicator): the engine keys
  // its list by id, so what it does with them is part of the result too
  {
    name: 'two-entries-one-id',
    settings: {
      ...ti,
      startDealLogic: IndicatorsLogicEnum.or,
      indicators: [
        ind('x', 'g-a', startDeal, rsi(14, lt, '45')),
        ind('x', 'g-b', startDeal, {
          ...rsi(7, lt, '40'),
          indicatorInterval: fourH,
        }),
      ],
      indicatorGroups: [
        group('g-a', IndicatorsLogicEnum.and, startDeal),
        group('g-b', IndicatorsLogicEnum.and, startDeal),
      ],
    },
    symbols: [one, two],
    bars: waves([one, two], 700),
    intervals: [fourH],
  },
]

/** Every 40th bar swapped with the same pair's next one, `step` further on. */
const swapSome = (bars: FullBar[], step: number) => {
  for (let k = 0; k + step < bars.length; k += 40) {
    ;[bars[k], bars[k + step]] = [bars[k + step], bars[k]]
  }
  return bars
}

const lowest = (c: IndicatorCase) =>
  c.lead ? c.bars.filter((b) => b.time >= FROM + c.lead! * HOUR) : c.bars

let runNo = 0

const make = (c: IndicatorCase, useFile: boolean): DCABacktesting => {
  StrategyContextManager.setActiveContext(`indicator-golden-${++runNo}`)
  return new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: c.symbols,
    interval: oneH,
    userFee: 0.001,
    prices: c.symbols.map((s) => ({ symbol: s.pair, price: 100 })),
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + (c.bars.length / c.symbols.length) * HOUR,
    combo: false,
    settings: {
      ...base,
      pair: c.symbols.map((s) => s.pair),
      ...c.settings,
    } as DCABotSettings,
    fullResult: true,
    ...(useFile ? { useFile: true } : {}),
  } as never)
}

const sorted = (r: DCABacktestingResult) => {
  r.deals.sort((a, b) =>
    a.startTime === b.startTime
      ? `${a.symbol}`.localeCompare(`${b.symbol}`)
      : a.startTime - b.startTime,
  )
  return r
}

/** Bars handed over in memory, one entry per interval. */
export async function runFromMemory(
  c: IndicatorCase,
): Promise<DCABacktestingResult> {
  const data = [
    { bar: byTime(lowest(c)), interval: oneH },
    ...c.intervals.map((interval) => {
      const bar = byTime(aggregate(c.bars, interval))
      return {
        bar: c.unordered ? swapSome(bar, c.symbols.length) : bar,
        interval,
      }
    }),
  ]
  return sorted((await make(c, false).test(data)) as DCABacktestingResult)
}

/** Bars loaded per pair and interval, through the working file. */
export async function runFromFile(
  c: IndicatorCase,
): Promise<DCABacktestingResult> {
  const bt = make(c, true)
  const byResolution = new Map<string, FullBar[]>([
    [tvIntervalMap[oneH], lowest(c)],
    ...c.intervals.map(
      (i) => [tvIntervalMap[i], aggregate(c.bars, i)] as [string, FullBar[]],
    ),
  ])
  bt.loadData = async (pair, _base, _quote, resolution) =>
    (byResolution.get(resolution) ?? [])
      .filter((b) => b.symbol === pair)
      .map(({ time, open, high, low, close, volume }) => ({
        time,
        open,
        high,
        low,
        close,
        volume,
      }))
  return sorted((await bt.test()) as DCABacktestingResult)
}

/**
 * Runs `fn` and fingerprints every candle handed to every indicator, in
 * order: which indicator (numbered by first use), the candle's time and its
 * values. A result can survive a candle fed twice, skipped or out of order;
 * this cannot.
 */
export async function withFeedLog<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; fed: { candles: number; sha256: string } }> {
  const hash = createHash('sha256')
  const seen = new WeakMap<object, number>()
  let indicators = 0
  let candles = 0
  const original = InternalIndicator.prototype.updateValue
  InternalIndicator.prototype.updateValue = function (value, time, cb) {
    let n = seen.get(this)
    if (n === undefined) {
      n = indicators++
      seen.set(this, n)
    }
    candles++
    hash.update(
      `${n};${time};${value.o};${value.h};${value.l};${value.c};${value.v}|`,
    )
    return original.call(this, value, time, cb)
  }
  try {
    const result = await fn()
    return { result, fed: { candles, sha256: hash.digest('hex') } }
  } finally {
    InternalIndicator.prototype.updateValue = original
  }
}
