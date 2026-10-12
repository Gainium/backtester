import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import {
  CooldownStopTriggerEnum,
  CooldownUnits,
  ExchangeEnum,
  ExchangeIntervals,
} from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  Symbols,
} from '../src/types'

/**
 * `cooldownAfterDealStopTrigger` narrows which closes start the cooldown after
 * deal stop: every close (`any`, the default), stop-loss closes only (`sl`),
 * or losing closes only (`loss`). A conditional cooldown is measured from the
 * last close that matched it, so a winning close inside the window does not
 * lift it early.
 */

const PAIR = 'BTC-USDT'
const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)
const COOLDOWN_HOURS = 24

const bars: FullBar[] = Array.from({ length: 1500 }, (_, i) => {
  const time = FROM + i * HOUR
  const close = 100 + 6 * Math.sin(i / 9) + 3 * Math.sin(i / 2.3)
  const open = 100 + 6 * Math.sin((i - 1) / 9) + 3 * Math.sin((i - 1) / 2.3)
  return {
    time,
    open,
    close,
    high: Math.max(open, close) + 0.2,
    low: Math.min(open, close) - 0.2,
    volume: 1000,
    symbol: PAIR,
  } as FullBar
})

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.paperBinance,
  baseAsset: { name: 'BTC', minAmount: 0, maxAmount: 1e6, step: 0.001 },
  quoteAsset: { name: 'USDT', minAmount: 0 },
  maxOrders: 200,
  priceAssetPrecision: 2,
}

const baseSettings = {
  pair: [PAIR],
  name: 'cooldown-stop-trigger',
  strategy: 'LONG',
  profitCurrency: 'quote',
  dcaCondition: 'percentage',
  scaleDcaType: 'percentage',
  startCondition: 'ASAP',
  startOrderType: 'MARKET',
  baseOrderSize: '1000',
  orderSize: '1000',
  orderSizeType: 'quote',
  orderFixedIn: 'quote',
  ordersCount: 1,
  activeOrdersCount: 1,
  step: '5',
  volumeScale: '1',
  stepScale: '1',
  minimumDeviation: '0',
  useDca: false,
  useTp: true,
  tpPerc: '3',
  dealCloseCondition: 'tp',
  useSl: true,
  slPerc: '-3',
  dealCloseConditionSL: 'tp',
  closeDealType: 'closeByMarket',
  closeOrderType: 'MARKET',
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
  type: 'regular',
  futures: false,
  indicatorGroups: [],
  indicators: [],
} as unknown as DCABotSettings

const cooldown = (trigger?: CooldownStopTriggerEnum) =>
  ({
    useCooldown: true,
    cooldownAfterDealStop: true,
    cooldownAfterDealStopInterval: COOLDOWN_HOURS,
    cooldownAfterDealStopUnits: CooldownUnits.hours,
    cooldownAfterDealStopTrigger: trigger,
  }) as Partial<DCABotSettings>

const run = async (settings: Partial<DCABotSettings>) => {
  const backtest = new DCABacktesting({
    settings: { ...baseSettings, ...settings },
    userFee: 0.001,
    makerFee: 0.001,
    takerFee: 0.001,
    prices: [],
    balances: [],
    interval: ExchangeIntervals.oneH,
    from: FROM,
    to: FROM + bars.length * HOUR,
    slippage: 0,
    exchange: ExchangeEnum.paperBinance,
    combo: false,
    symbols: [symbol],
  } as never)
  const result = (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return [...result.deals].sort((a, b) => a.startTime - b.startTime)
}

type ClosedDeal = Awaited<ReturnType<typeof run>>[number]

const isSl = (d: ClosedDeal) =>
  d.profit.total < 0 && d.closePrice !== undefined && d.closePrice < d.avgPrice

/** Hours between each closed deal and the start of the deal after it. */
const gapsAfter = (deals: ClosedDeal[]) =>
  deals.slice(0, -1).map((d, i) => ({
    deal: d,
    gapHours: (deals[i + 1].startTime - (d.closedTime ?? 0)) / HOUR,
  }))

describe('cooldown after deal stop — trigger', () => {
  it('fixture produces both winning and stop-loss deals', async () => {
    const deals = await run({})
    expect(deals.filter((d) => d.profit.total > 0).length).to.be.greaterThan(3)
    expect(deals.filter(isSl).length).to.be.greaterThan(3)
  })

  it('a missing trigger keeps the old behaviour: every close cools down', async () => {
    const legacy = await run(cooldown())
    const any = await run(cooldown(CooldownStopTriggerEnum.any))
    expect(legacy.map((d) => d.startTime)).to.deep.equal(
      any.map((d) => d.startTime),
    )
    for (const { gapHours } of gapsAfter(any)) {
      expect(gapHours).to.be.at.least(COOLDOWN_HOURS)
    }
  })

  it('loss: cools down after losing deals only', async () => {
    const deals = await run(cooldown(CooldownStopTriggerEnum.loss))
    const gaps = gapsAfter(deals)
    for (const { deal, gapHours } of gaps) {
      if (deal.profit.total < 0) {
        expect(gapHours, `after losing deal ${deal.number}`).to.be.at.least(
          COOLDOWN_HOURS,
        )
      }
    }
    // a winning close re-enters straight away (ASAP)
    expect(
      gaps.some(({ deal, gapHours }) => deal.profit.total > 0 && gapHours < 2),
    ).to.equal(true)
    expect(deals.length).to.be.greaterThan(
      (await run(cooldown(CooldownStopTriggerEnum.any))).length,
    )
  })

  it('sl: cools down after stop-loss closes only', async () => {
    const deals = await run(cooldown(CooldownStopTriggerEnum.sl))
    const gaps = gapsAfter(deals)
    for (const { deal, gapHours } of gaps) {
      if (isSl(deal)) {
        expect(gapHours, `after SL deal ${deal.number}`).to.be.at.least(
          COOLDOWN_HOURS,
        )
      }
    }
    expect(
      gaps.some(({ deal, gapHours }) => !isSl(deal) && gapHours < 2),
    ).to.equal(true)
  })
})
