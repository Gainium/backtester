import { describe, it } from 'mocha'
import { expect } from 'chai'

import { BotMarginTypeEnum, StrategyEnum } from '../src/types'
import { one, path, run } from './helpers/singlePositionHarness'

/**
 * spec 011 — a 1x futures short is liquidated when the price doubles. Its
 * margin is its whole notional, so the exchange closes it at about −100%.
 * Before the fix the 1x short liquidation price was entry / fee (2000× entry
 * at a 0.05% fee), so the deal was never liquidated and ran to −150% here.
 */

// flat at 100 for the entry, then a straight climb to 250 (or a fall to 40)
const climb = (to: number) =>
  path(one.pair, [
    100,
    100,
    ...Array.from({ length: 60 }, (_, i) => 100 + ((to - 100) * (i + 1)) / 60),
  ])

const futures = (strategy: StrategyEnum, leverage: number, to: number) =>
  run({
    name: `liq-${strategy}-${leverage}x`,
    symbols: [one],
    bars: climb(to),
    userFee: 0.0005,
    settings: {
      strategy,
      futures: true,
      marginType: BotMarginTypeEnum.isolated,
      leverage,
      useTp: false,
      useSl: false,
      useDca: false,
    },
  })

describe('futures 1x short liquidation (spec 011)', () => {
  it('§1.1 a 1x short is liquidated at 2× its entry, at −100%', async () => {
    const r = await futures(StrategyEnum.short, 1, 250)
    const d = r.deals[0]
    expect(d.status).to.equal('closed')
    expect(d.liquidationPrice).to.be.closeTo(d.avgPrice * 2, 1e-6)
    expect(d.closePrice).to.be.closeTo(d.avgPrice * 2, 1e-6)
    expect(d.profit.perc).to.be.closeTo(-100, 0.5)
  })

  it('§1.3 a 1x long is not liquidated by a 60% fall', async () => {
    const r = await futures(StrategyEnum.long, 1, 40)
    const d = r.deals[0]
    expect(d.status).to.equal('open')
    expect(d.liquidationPrice).to.equal(undefined)
  })

  it('§1.3 a 3x short still liquidates at entry × (1 + 1/3)', async () => {
    const r = await futures(StrategyEnum.short, 3, 250)
    const d = r.deals[0]
    expect(d.status).to.equal('closed')
    expect(d.liquidationPrice).to.be.closeTo(d.avgPrice * (1 + 1 / 3), 1e-6)
  })
})
