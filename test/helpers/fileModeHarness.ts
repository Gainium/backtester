import DCABacktesting from '../../src/dca'
import { StrategyContextManager } from '../../src/dca/strategy/context'
import {
  ExchangeEnum,
  ExchangeIntervals,
  IndicatorAction,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  StartConditionEnum,
} from '../../src/types'
import type {
  DCABacktestHooks,
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
} from '../../src/types'
import {
  base,
  Case,
  FROM,
  HOUR,
  one,
  rsi,
  two,
  wave,
} from './singlePositionHarness'

/**
 * Runs a case the way a server-side host does: `useFile: true`, candles
 * handed over by a load function, written to the working file, sorted and
 * read back bar by bar.
 */

let runNo = 0

export function makeFromFile(
  c: Case,
  hooks?: DCABacktestHooks,
): DCABacktesting {
  StrategyContextManager.setActiveContext(`file-mode-${++runNo}`)
  const bySymbol = new Map<string, FullBar[]>()
  for (const b of c.bars) {
    bySymbol.set(b.symbol, [...(bySymbol.get(b.symbol) ?? []), b])
  }
  const bt = new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: c.symbols,
    interval: ExchangeIntervals.oneH,
    userFee: c.userFee ?? 0.001,
    prices: c.symbols.map((s) => ({ symbol: s.pair, price: 100 })),
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + (c.bars.length / c.symbols.length) * HOUR,
    combo: !!c.combo,
    timezone: c.timezone,
    settings: {
      ...base,
      pair: c.symbols.map((s) => s.pair),
      ...c.settings,
    } as DCABotSettings,
    fullResult: true,
    useFile: true,
    ...(hooks ? { hooks } : {}),
  } as never)
  bt.loadData = async (pair) =>
    (bySymbol.get(pair) ?? []).map(
      ({ time, open, high, low, close, volume }) => ({
        time,
        open,
        high,
        low,
        close,
        volume,
      }),
    )
  return bt
}

export async function runFromFile(c: Case): Promise<DCABacktestingResult> {
  const r = (await makeFromFile(c).test()) as DCABacktestingResult
  r.deals.sort((a, b) => a.startTime - b.startTime)
  return r
}

// More bars than one write chunk and one loop pause, so both paths run.
const N = 3300

export const CASES: Case[] = [
  {
    name: 'asap-dca-tp-sl',
    settings: {},
    symbols: [one],
    bars: wave(one.pair, N),
  },
  {
    name: 'asap-two-pairs',
    settings: { maxNumberOfOpenDeals: '2' },
    symbols: [one, two],
    bars: [...wave(one.pair, N), ...wave(two.pair, N, 11, 40)],
  },
  {
    name: 'rsi-start',
    settings: {
      startCondition: StartConditionEnum.ti,
      indicators: [
        rsi(
          'a',
          IndicatorAction.startDeal,
          IndicatorStartConditionEnum.lt,
          '40',
        ),
      ],
      indicatorGroups: [
        {
          id: 'g-a',
          logic: IndicatorsLogicEnum.and,
          action: IndicatorAction.startDeal,
        },
      ],
    } as Partial<DCABotSettings> & Record<string, unknown>,
    symbols: [one],
    bars: wave(one.pair, N),
  },
  {
    name: 'combo',
    settings: { gridLevel: '4' },
    symbols: [one],
    bars: wave(one.pair, N),
    combo: true,
  },
]
