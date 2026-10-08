import { describe, it } from 'mocha'
import { expect } from 'chai'

import {
  CooldownUnits,
  DCAOrderTypeEnum,
  DynamicPriceFilterDirectionEnum,
  DynamicPriceFilterPriceTypeEnum,
  IndicatorAction,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  StartConditionEnum,
} from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  Deal,
  NewDealApprovalContext,
} from '../src/types'
import {
  Case,
  HOUR,
  make,
  one,
  path,
  rsi,
  run,
  two,
  wave,
} from './helpers/singlePositionHarness'

/**
 * Single position per pair (1.12.0) — main-app spec 139, simulated.
 */

type Settings = Partial<DCABotSettings> & Record<string, unknown>

const sp: Settings = { singlePosition: true }

const cooldown3h: Settings = {
  useCooldown: true,
  cooldownAfterDealStart: true,
  cooldownAfterDealStartInterval: 3,
  cooldownAfterDealStartUnits: CooldownUnits.hours,
}

const under2: Settings = {
  useDynamicPriceFilter: true,
  dynamicPriceFilterDeviation: '2',
  dynamicPriceFilterDirection: DynamicPriceFilterDirectionEnum.under,
  // the position must measure from its last entry WHATEVER this says
  dynamicPriceFilterPriceType: DynamicPriceFilterPriceTypeEnum.avg,
}

const entriesOf = (d: { filledOrders: { type?: DCAOrderTypeEnum }[] }) =>
  d.filledOrders.filter(
    (o) => o.type === DCAOrderTypeEnum.bo,
  ) as (Deal['filledOrders'][number] & {
    positionEntry?: boolean
  })[]

const round4 = (n: number) => Math.round(n * 1e4) / 1e4

/** No two deals of one pair are ever open at the same time. */
function expectOnePositionPerPair(r: DCABacktestingResult) {
  const byPair = new Map<string, typeof r.deals>()
  for (const d of r.deals) {
    byPair.set(d.symbol.pair, [...(byPair.get(d.symbol.pair) ?? []), d])
  }
  for (const deals of byPair.values()) {
    const sorted = [...deals].sort((a, b) => a.startTime - b.startTime)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      expect(
        typeof prev.closedTime,
        'an earlier position of the pair closed',
      ).to.equal('number')
      expect(sorted[i].startTime).to.be.at.least(prev.closedTime as number)
    }
  }
}

describe('single position per pair (1.12.0)', () => {
  it('ASAP + cooldown: entries every cooldown from the LAST entry, one deal per pair, no safety orders', async () => {
    const r = await run({
      name: 'asap-cooldown',
      symbols: [one],
      bars: wave(one.pair, 400),
      settings: { ...sp, ...cooldown3h, useSl: false },
    })
    expectOnePositionPerPair(r)
    const withEntries = r.deals.filter((d) => (d.positionEntries ?? 0) > 2)
    expect(
      withEntries.length,
      'positions took several entries',
    ).to.be.greaterThan(0)
    for (const d of r.deals) {
      const entries = entriesOf(d)
      expect(d.positionEntries).to.equal(entries.length)
      expect(
        d.filledOrders.filter((o) => o.type === DCAOrderTypeEnum.dca),
        'safety orders are off',
      ).to.have.length(0)
      expect(entries.slice(1).every((o) => o.positionEntry)).to.equal(true)
      for (let i = 1; i < entries.length; i++) {
        // counted from the previous entry, not from the deal start
        expect(
          (entries[i].filledTime as number) -
            (entries[i - 1].filledTime as number),
        ).to.be.at.least(3 * HOUR)
      }
    }
    // the per-deal statistics count a position once
    const numerical = (r as unknown as { numerical: { all: number } }).numerical
    expect(numerical.all).to.equal(r.deals.length)
    // peak capital grows with entries
    const biggest = [...r.deals].sort(
      (a, b) => (b.positionEntries ?? 0) - (a.positionEntries ?? 0),
    )[0]
    expect(biggest.usage.max.quote).to.be.closeTo(
      100 * (biggest.positionEntries as number),
      0.05 * (biggest.positionEntries as number),
    )
  })

  it('ASAP + dynamic filter: the reference is the last entry fill, not the average', async () => {
    // entry 1 at 100; 97.5 is 2.5% under → entry 2. 96.5 and 96 are under the
    // AVERAGE by more than 2% but not under the last entry (95.55) → nothing.
    // 95 → entry 3. 94 is not 2% under 95 → nothing.
    const r = await run({
      name: 'asap-dynamic',
      symbols: [one],
      bars: path(one.pair, [100, 99, 97.5, 96.5, 96, 95, 94]),
      userFee: 0,
      settings: { ...sp, ...under2, useSl: false, tpPerc: '10' },
    })
    expect(r.deals).to.have.length(1)
    const [d] = r.deals
    expect(entriesOf(d).map((o) => o.price)).to.deep.equal([100, 97.5, 95])
    expect(d.positionEntries).to.equal(3)
  })

  it('maxPositionEntries caps a position (counting the base order)', async () => {
    const r = await run({
      name: 'asap-cap',
      symbols: [one],
      bars: wave(one.pair, 400),
      settings: { ...sp, ...cooldown3h, useSl: false, maxPositionEntries: '3' },
    })
    expectOnePositionPerPair(r)
    const max = Math.max(...r.deals.map((d) => d.positionEntries ?? 0))
    expect(max).to.equal(3)
    for (const d of r.deals) {
      expect(entriesOf(d).length).to.be.at.most(3)
    }
    // the modelled budget provisions the whole position
    const usage = (r as unknown as { usage: { maxTheoreticalUsage: number } })
      .usage
    expect(usage.maxTheoreticalUsage).to.be.at.least(299)
  })

  it('rebuilds the take profit for the whole position after each entry, with the fee adjustment', async () => {
    const seen: {
      entries: number
      avg: number
      tp: number
      tpQty: number
      qty: number
    }[] = []
    const c: Case = {
      name: 'asap-tp',
      symbols: [one],
      // 98.5 reaches the rebuilt take profit (≈ 98.51) of the 3-entry position
      bars: path(one.pair, [100, 97.5, 95, 95.2, 97, 98.6, 98.4]),
      userFee: 0.0004,
      settings: { ...sp, ...under2, useSl: false, tpPerc: '1' },
    }
    const bt = make(c, {
      afterBar: () => {
        const d = bt.hostOpenDeals()[0]
        if (!d) return
        const tp = d.activeOrders.filter((o) => o.type === DCAOrderTypeEnum.tp)
        const fills = entriesOf(d)
        const qty = fills.reduce((a, o) => a + o.qty, 0)
        expect(tp).to.have.length(1)
        seen.push({
          entries: d.positionEntries as number,
          avg: fills.reduce((a, o) => a + o.qty * o.price, 0) / qty,
          tp: tp[0].price,
          tpQty: tp[0].qty,
          qty,
        })
      },
    })
    const r = (await bt.test([
      { bar: c.bars, interval: '1h' as never },
    ])) as DCABacktestingResult
    // per bar: the first position grows 1 → 2 → 3, then the re-opened one
    const grown = seen.filter(
      (s, i) => i === 0 || s.entries !== seen[i - 1].entries,
    )
    expect(grown.map((s) => s.entries)).to.deep.equal([1, 2, 3, 1])
    for (const s of grown) {
      expect(s.tpQty).to.be.closeTo(s.qty, 1e-9)
      // TP = average × (1 + 2 × fee) × (1 + tpPerc), as the bot engine places it
      expect(s.tp).to.equal(round4(s.avg * 1.0008 * 1.01))
      expect(s.tp / s.avg).to.be.closeTo(1.0108, 1e-4)
    }
    // the 3-entry position closes at its rebuilt take profit and ASAP re-opens
    r.deals.sort((a, b) => a.startTime - b.startTime)
    expect(r.deals.length).to.equal(2)
    const [first, second] = r.deals
    expect(first.status).to.equal('closed')
    expect(first.positionEntries).to.equal(3)
    expect(first.closePrice).to.equal(grown[2].tp)
    expect(second.startTime).to.equal(first.closedTime)
    expect(second.startPrice).to.equal(first.closePrice)
    // no entry on the bar it re-opened, nor on the next (98.4 is not 2% under)
    expect(second.positionEntries).to.equal(1)
  })

  it('multi-TP re-splits over the grown position', async () => {
    const c: Case = {
      name: 'asap-multi-tp',
      symbols: [one],
      bars: path(one.pair, [100, 97.5, 97.4]),
      userFee: 0.001,
      settings: {
        ...sp,
        ...under2,
        useSl: false,
        useMultiTp: true,
        multiTp: [
          { uuid: 't1', target: '1', amount: '50' },
          { uuid: 't2', target: '3', amount: '50' },
        ],
      },
    }
    const r = await run(c)
    const d = r.deals[0] as unknown as Deal
    expect(d.positionEntries).to.equal(2)
    const tps = d.activeOrders.filter((o) => o.type === DCAOrderTypeEnum.tp)
    const qty = entriesOf(d).reduce((a, o) => a + o.qty, 0)
    expect(tps).to.have.length(2)
    expect(tps.reduce((a, o) => a + o.qty, 0)).to.be.closeTo(qty, 2e-4)
    expect(tps.map((o) => o.price)).to.deep.equal([
      round4(d.avgPrice * 1.01 * 1.002),
      round4(d.avgPrice * 1.03 * 1.002),
    ])
  })

  it('an entry resets a trailing take profit best price', async () => {
    const snapshots: { entries: number; bestPrice?: number; mode?: string }[] =
      []
    const c: Case = {
      name: 'asap-ttp',
      symbols: [one],
      bars: path(one.pair, [100, 101.5, 101.6]),
      userFee: 0,
      settings: {
        ...sp,
        useSl: false,
        tpPerc: '1',
        trailingTp: true,
        trailingTpPerc: '0.5',
        useDynamicPriceFilter: true,
        dynamicPriceFilterDeviation: '1',
        dynamicPriceFilterDirection: DynamicPriceFilterDirectionEnum.over,
      },
    }
    const bt = make(c, {
      afterBar: () => {
        const d = bt.hostOpenDeals()[0]
        if (d) {
          snapshots.push({
            entries: d.positionEntries as number,
            bestPrice: d.bestPrice,
            mode: d.trailingMode,
          })
        }
      },
    })
    await bt.test([{ bar: c.bars, interval: '1h' as never }])
    const afterEntry = snapshots.find((s) => s.entries === 2)
    expect(afterEntry, 'the rising bar added an entry').to.not.equal(undefined)
    // the trail was armed on that bar, and the entry re-based it
    expect(afterEntry?.mode).to.equal('ttp')
    expect(afterEntry?.bestPrice).to.equal(0)
  })

  it('multi-pair: one position per pair, maxNumberOfOpenDeals counts positions, maxDealsPerPair ignored', async () => {
    const bars = [...wave(one.pair, 400), ...wave(two.pair, 400, 40, 50)].sort(
      (a, b) => a.time - b.time || a.symbol.localeCompare(b.symbol),
    )
    const multi = (maxDeals: string): Case => ({
      name: `multi-${maxDeals}`,
      symbols: [one, two],
      bars,
      settings: {
        ...sp,
        ...cooldown3h,
        cooldownAfterDealStartOption: 'symbol',
        useSl: false,
        pair: [one.pair, two.pair],
        useMulti: true,
        maxNumberOfOpenDeals: maxDeals,
        maxDealsPerPair: '3',
      } as Settings,
    })
    const r1 = await run(multi('1'))
    expectOnePositionPerPair(r1)
    // one position for the whole bot: never two open at once
    const all = [...r1.deals].sort((a, b) => a.startTime - b.startTime)
    for (let i = 1; i < all.length; i++) {
      expect(all[i].startTime).to.be.at.least(all[i - 1].closedTime as number)
    }
    expect(all.some((d) => (d.positionEntries ?? 0) > 1)).to.equal(true)

    const r2 = await run(multi('2'))
    expectOnePositionPerPair(r2)
    const pairs = new Set(r2.deals.map((d) => d.symbol.pair))
    expect(pairs.size).to.equal(2)
    const overlap = r2.deals.some((a) =>
      r2.deals.some(
        (b) =>
          a.symbol.pair !== b.symbol.pair &&
          a.startTime < (b.closedTime ?? Infinity) &&
          b.startTime < (a.closedTime ?? Infinity),
      ),
    )
    expect(overlap, 'both pairs hold a position at some time').to.equal(true)
    for (const p of pairs) {
      expect(
        r2.deals.some(
          (d) => d.symbol.pair === p && (d.positionEntries ?? 0) > 1,
        ),
        `${p} took entries`,
      ).to.equal(true)
    }
  })

  it('indicator start: a signal on a pair with a position adds an entry at the next bar open; the host sees an entry', async () => {
    const asked: NewDealApprovalContext[] = []
    const c: Case = {
      name: 'ti-start',
      symbols: [one],
      bars: wave(one.pair, 400),
      settings: {
        ...sp,
        useSl: false,
        startCondition: StartConditionEnum.ti,
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
      },
    }
    const r = await run(c, {
      approveNewDeal: (ctx) => {
        asked.push(ctx)
        return true
      },
    })
    expectOnePositionPerPair(r)
    const opens = new Map(c.bars.map((b) => [b.time, b.open]))
    const withEntries = r.deals.filter((d) => (d.positionEntries ?? 0) > 1)
    expect(withEntries.length).to.be.greaterThan(0)
    for (const d of r.deals) {
      const entries = entriesOf(d)
      expect(d.positionEntries).to.equal(entries.length)
      const times = entries.map((o) => o.filledTime as number)
      expect(new Set(times).size, 'one entry per bar').to.equal(times.length)
      for (const o of entries) {
        expect(o.price).to.equal(round4(opens.get(o.filledTime as number)!))
      }
    }
    const entryAsks = asked.filter((a) => a.positionEntry)
    expect(entryAsks.length).to.be.greaterThan(0)
    const ids = new Set(r.deals.map((d) => d.id))
    expect(entryAsks.every((a) => a.dealId && ids.has(a.dealId))).to.equal(true)
    expect(asked.filter((a) => !a.positionEntry).length).to.equal(
      r.deals.length,
    )
  })

  it('a refused entry adds nothing', async () => {
    const r = await run(
      {
        name: 'refused',
        symbols: [one],
        bars: wave(one.pair, 300),
        settings: { ...sp, ...cooldown3h, useSl: false },
      },
      { approveNewDeal: (ctx) => !ctx.positionEntry },
    )
    expect(r.deals.length).to.be.greaterThan(1)
    expect(r.deals.every((d) => d.positionEntries === 1)).to.equal(true)
  })

  it('timer start: each tick on a pair with a position is an entry at the bar open', async () => {
    const c: Case = {
      name: 'timer',
      symbols: [one],
      bars: wave(one.pair, 120),
      timezone: 'UTC',
      settings: {
        ...sp,
        useSl: false,
        startCondition: StartConditionEnum.timer,
        hodlAt: '00:00',
        hodlDay: '1',
        hodlHourly: true,
      },
    }
    const r = await run(c)
    expectOnePositionPerPair(r)
    const opens = new Map(c.bars.map((b) => [b.time, b.open]))
    expect(r.deals.some((d) => (d.positionEntries ?? 0) > 1)).to.equal(true)
    for (const d of r.deals) {
      for (const o of entriesOf(d).slice(1)) {
        expect(o.price).to.equal(round4(opens.get(o.filledTime as number)!))
      }
    }
  })

  it('is deterministic: two runs give the same result', async () => {
    const c: Case = {
      name: 'determinism',
      symbols: [one],
      bars: wave(one.pair, 300),
      settings: { ...sp, ...cooldown3h, ...under2 },
    }
    const strip = (r: DCABacktestingResult) =>
      JSON.stringify(r, (k, v) =>
        ['id', 'dealId', 'loadingDataTime', 'processingDataTime'].includes(k)
          ? undefined
          : v,
      )
    expect(strip(await run(c))).to.equal(strip(await run(c)))
  })
})
