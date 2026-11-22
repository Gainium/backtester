import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import { StrategyContextManager } from '../src/dca/strategy/context'
import {
  BotOrderSideEnum,
  ExchangeEnum,
  ExchangeIntervals,
  StrategyEnum,
} from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  PreparedDeal,
} from '../src/types'
import {
  FROM,
  HOUR,
  base,
  fingerprint,
  one,
  path,
  wave,
} from './helpers/singlePositionHarness'

/*
 * budget cap: `enforceBalances` turns the passed balances into a hard
 * budget. Without it nothing changes; with it no order is filled that the
 * free budget cannot pay for.
 */

type Opts = {
  bars: FullBar[]
  settings?: Partial<DCABotSettings> & Record<string, unknown>
  balances?: { asset: string; free: string; locked: string }[]
  enforceBalances?: boolean
}

let runNo = 0

// fixed timezone so the runs do not depend on the machine they run on
const withTestTimezone = async <T>(tz: string, job: () => Promise<T>) => {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    return await job()
  } finally {
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  }
}

const runBt = (o: Opts): Promise<DCABacktestingResult> =>
  withTestTimezone('Etc/GMT-8', async () => {
    StrategyContextManager.setActiveContext(`budget-cap-${++runNo}`)
    const bt = new DCABacktesting({
      exchange: ExchangeEnum.binance,
      symbols: [one],
      interval: ExchangeIntervals.oneH,
      userFee: 0.001,
      prices: [{ symbol: one.pair, price: 100 }],
      balances: o.balances ?? [{ asset: 'USDT', free: '1000000', locked: '0' }],
      from: FROM,
      to: FROM + o.bars.length * HOUR,
      combo: false,
      settings: {
        ...base,
        pair: [one.pair],
        maxNumberOfOpenDeals: '5',
        maxDealsPerPair: '5',
        ...o.settings,
      } as DCABotSettings,
      fullResult: true,
      ...(o.enforceBalances !== undefined
        ? { enforceBalances: o.enforceBalances }
        : {}),
    } as never)
    const r = (await bt.test([
      { bar: o.bars, interval: ExchangeIntervals.oneH },
    ])) as DCABacktestingResult
    r.deals.sort((a, b) => a.startTime - b.startTime)
    return r
  })

/**
 * Most the open deals ever held of the asset they spend (quote for a long,
 * base for a short), minus the profit realised in that asset up to then.
 */
const peakHeld = (deals: PreparedDeal[], long: boolean) => {
  const ev: [number, number][] = []
  for (const d of deals) {
    const spend = long ? BotOrderSideEnum.buy : BotOrderSideEnum.sell
    let held = 0
    for (const f of d.filledOrders) {
      if (f.side !== spend) continue
      // the full result keeps each fill's qty
      const qty = (f as { qty?: number }).qty
      expect(qty, 'fill qty in the full result').to.be.a('number')
      const amt = long ? (qty as number) * f.price : (qty as number)
      held += amt
      ev.push([f.filledTime ?? d.startTime, amt])
    }
    if (d.status === 'closed' && d.closedTime) {
      // held comes back; quote profit (long) adds to the budget
      ev.push([d.closedTime, -held - (long ? d.profit.total : 0)])
    }
  }
  // releases before fills at the same time
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let cur = 0
  let peak = 0
  for (const [, v] of ev) {
    cur += v
    peak = Math.max(peak, cur)
  }
  return peak
}

const fall = path(
  one.pair,
  Array.from({ length: 300 }, (_, i) => 100 * (1 - 0.003 * i)),
)
const swing = wave(one.pair, 1200)

describe('budget cap (enforceBalances)', () => {
  it('absent or false changes nothing', async () => {
    const plain = fingerprint(await runBt({ bars: swing }))
    const off = fingerprint(
      await runBt({ bars: swing, enforceBalances: false }),
    )
    expect(off).to.deep.equal(plain)
  })

  it('a budget that is never reached changes no deal', async () => {
    const plain = await runBt({ bars: swing })
    const capped = await runBt({ bars: swing, enforceBalances: true })
    expect(capped.deals.length).to.equal(plain.deals.length)
    expect(capped.financial.netProfitTotal).to.equal(
      plain.financial.netProfitTotal,
    )
    expect((capped.messages ?? []).join(' ')).not.to.contain('Budget limit')
  })

  it('a long never holds more quote than budget plus realised profit', async () => {
    const budget = 400
    for (const bars of [fall, swing]) {
      const plain = await runBt({ bars })
      const capped = await runBt({
        bars,
        enforceBalances: true,
        balances: [{ asset: 'USDT', free: `${budget}`, locked: '0' }],
      })
      expect(peakHeld(plain.deals, true)).to.be.greaterThan(budget)
      // fills pay the fee on top, so the order value alone stays below
      expect(peakHeld(capped.deals, true)).to.be.at.most(budget + 1e-6)
      const msg = (capped.messages ?? []).join(' ')
      expect(msg).to.contain('Budget limit')
      // retries count as attempts; distinct orders never exceed them
      const m = msg.match(/(\d+) DCA order attempt\(s\) \((\d+) distinct/)
      expect(m, msg).to.not.equal(null)
      expect(+m![2]).to.be.at.most(+m![1])
    }
  })

  it('a short never sells more base than budget', async () => {
    const budget = 4 // AAA, about 400 USDT at the start
    const settings = {
      strategy: StrategyEnum.short,
      profitCurrency: 'quote',
    } as unknown as Partial<DCABotSettings>
    const rising = path(
      one.pair,
      Array.from({ length: 300 }, (_, i) => 100 * (1 + 0.003 * i)),
    )
    const plain = await runBt({
      bars: rising,
      settings,
      balances: [{ asset: 'AAA', free: '1000000', locked: '0' }],
    })
    const capped = await runBt({
      bars: rising,
      settings,
      enforceBalances: true,
      balances: [{ asset: 'AAA', free: `${budget}`, locked: '0' }],
    })
    expect(peakHeld(plain.deals, false)).to.be.greaterThan(budget)
    expect(peakHeld(capped.deals, false)).to.be.at.most(budget + 1e-9)
    expect((capped.messages ?? []).join(' ')).to.contain('Budget limit')
  })

  it('profit % is measured against the budget', async () => {
    const capped = await runBt({
      bars: swing,
      enforceBalances: true,
      balances: [{ asset: 'USDT', free: '400', locked: '0' }],
    })
    expect(capped.financial.initialBalanceUsd).to.be.closeTo(400, 1e-6)
  })

  // spec 016 §6: the result carries the counts as numbers, not only as text
  it('reports the budget and refused counts on the result', async () => {
    const plain = await runBt({ bars: fall })
    expect(plain.budgetLimit, 'no budget, no field').to.equal(undefined)

    const roomy = await runBt({ bars: swing, enforceBalances: true })
    expect(roomy.budgetLimit).to.deep.equal({
      asset: 'USDT',
      budget: 1000000,
      dealsSkipped: 0,
      dcaRefused: 0,
      dcaRefusedAttempts: 0,
    })

    const capped = await runBt({
      bars: fall,
      enforceBalances: true,
      balances: [{ asset: 'USDT', free: '400', locked: '0' }],
    })
    const b = capped.budgetLimit!
    expect(b.asset).to.equal('USDT')
    expect(b.budget).to.equal(400)
    expect(b.dcaRefused).to.be.greaterThan(0)
    expect(b.dcaRefused).to.be.at.most(b.dcaRefusedAttempts)
    const msg = (capped.messages ?? []).join(' ')
    expect(msg).to.contain(`${b.dealsSkipped} deal start attempt(s)`)
    expect(msg).to.contain(`${b.dcaRefusedAttempts} DCA order attempt(s)`)
    expect(msg).to.contain(`(${b.dcaRefused} distinct`)
  })

  // spec 016 §1: futures and combo ignore the flag
  it('a futures bot ignores the flag', async () => {
    const settings = { futures: true, leverage: 1 } as never
    const balances = [{ asset: 'USDT', free: '400', locked: '0' }]
    const plain = fingerprint(await runBt({ bars: fall, settings, balances }))
    const capped = await runBt({
      bars: fall,
      settings,
      enforceBalances: true,
      balances,
    })
    expect(capped.budgetLimit).to.equal(undefined)
    expect(fingerprint(capped)).to.deep.equal(plain)
  })
})
