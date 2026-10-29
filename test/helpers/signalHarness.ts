import * as lib from '@gainium/indicators'

import {
  ExchangeIntervals,
  IndicatorAction,
  IndicatorsLogicEnum,
  StartConditionEnum,
} from '../../src/types'
import type { DCABotSettings, FullBar } from '../../src/types'
import { FROM, HOUR, one, run } from './singlePositionHarness'

/**
 * Shared fixtures for the start-condition specs of indicators whose decision
 * is exported by `@gainium/indicators` (VWAP, KDJ, ADX DMI mode, MA trend
 * filter): the backtest's deal starts are compared with the bars on which the
 * package's own class + decision fire.
 */

export type Extra = Record<string, unknown>

/**
 * Hourly bars from FROM (2026-01-01 00:00 UTC, a Thursday): a two-frequency
 * price wave with a slow drift, and a volume that varies, so volume-weighted
 * math differs from its unweighted counterpart.
 */
export const waveBars = (n: number): FullBar[] =>
  Array.from({ length: n }, (_, i) => {
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

/** A start-deal entry on 1h candles with `settings` on top. */
export const startEntry = (settings: Extra) =>
  ({
    indicatorInterval: ExchangeIntervals.oneH,
    indicatorAction: IndicatorAction.startDeal,
    groupId: 'g-s',
    uuid: 'u-s',
    ...settings,
  }) as never

/** Every signal opens its own deal, which closes almost at once. */
export const runEntry = (indicator: unknown, bars: FullBar[]) =>
  run({
    name: 'signal',
    settings: {
      startCondition: StartConditionEnum.ti,
      useSl: false,
      useDca: false,
      tpPerc: '0.01',
      maxNumberOfOpenDeals: '100000',
      maxDealsPerPair: '100000',
      indicatorGroups: [
        {
          id: 'g-s',
          logic: IndicatorsLogicEnum.and,
          action: IndicatorAction.startDeal,
        },
      ],
      indicators: [indicator],
    } as Partial<DCABotSettings> & Extra,
    symbols: [one],
    bars,
  })

/** Bar indices on which the backtest opened a deal. */
export const startBars = async (
  indicator: unknown,
  bars: FullBar[],
): Promise<number[]> => {
  const r = await runEntry(indicator, bars)
  return [...new Set(r.deals.map((d) => (d.startTime - FROM) / HOUR))].sort(
    (a, b) => a - b,
  )
}

/** The library's own result per bar (null while warming up), via the factory. */
export const libSeries = <R>(
  config: lib.IndicatorConfig,
  bars: FullBar[],
): (R | null)[] => {
  const ind = lib.createIndicator(config)
  return bars.map((b) => {
    lib.feedCandle(ind, {
      o: b.open,
      h: b.high,
      l: b.low,
      c: b.close,
      v: b.volume ?? 0,
      t: b.time,
    })
    return ind.result === null ? null : ({ ...ind.result } as R)
  })
}

/**
 * The engine's expected deal-start bars: it evaluates the newest emitted
 * result against the previous one once three exist, and a signal on bar k
 * opens the deal on bar k + 1.
 */
export const expectedStarts = <R>(
  series: (R | null)[],
  fires: (last: R, prev: R) => boolean,
): number[] => {
  const emitted: { bar: number; v: R }[] = []
  series.forEach((v, bar) => {
    if (v !== null) emitted.push({ bar, v })
  })
  const out: number[] = []
  for (let k = 2; k < emitted.length; k++) {
    if (
      fires(emitted[k].v, emitted[k - 1].v) &&
      emitted[k].bar + 1 < series.length
    ) {
      out.push(emitted[k].bar + 1)
    }
  }
  return out
}
