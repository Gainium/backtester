/**
 * Single position per pair (1.12.0) — the pure rules, mirroring the bot
 * engine's `core/src/bot/dca/singlePosition.ts` (main-app spec 139). No engine
 * state: the strategy and `DCABacktesting` call these with plain settings and
 * deals.
 */
import { DCATypeEnum } from '../../types'
import type { DCABotSettings, Deal } from '../../types'

/**
 * The setting is in force: DCA bots only. Combo ignores it (spec 139 §2.4) and
 * so do terminal deals; hedge legs have it switched off by the hedge runner.
 */
export const singlePositionActive = (
  settings: Pick<DCABotSettings, 'singlePosition' | 'type'>,
  combo: boolean,
): boolean =>
  !!settings.singlePosition && !combo && settings.type !== DCATypeEnum.terminal

/**
 * Spec 139 §2.3.1: a single-position bot runs without safety orders — the
 * engine creates every position with `useDca: false`. The bot's DCA settings
 * are kept otherwise (the engine keeps them too). Returns the input object
 * untouched when the setting is not in force.
 */
export const withSinglePositionSettings = <T extends DCABotSettings>(
  settings: T,
  combo: boolean,
): T =>
  singlePositionActive(settings, combo) && settings.useDca
    ? { ...settings, useDca: false }
    : settings

/** Spec 139 §2.2: the entry limit, or 0 for none ('' / '0' / missing). */
export const maxPositionEntriesOf = (v: unknown): number => {
  const n = Math.floor(parseFloat(`${v ?? ''}`))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Entries a position holds — missing means the base order alone. */
export const positionEntriesOf = (deal: Pick<Deal, 'positionEntries'>) => {
  const n = Number(deal.positionEntries)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** Spec 139 §3.2.2: the position is full. */
export const positionIsFull = (
  deal: Pick<Deal, 'positionEntries'>,
  maxPositionEntries: unknown,
) => {
  const max = maxPositionEntriesOf(maxPositionEntries)
  return max > 0 && positionEntriesOf(deal) >= max
}

/**
 * One entry per bar per pair: a position takes no entry on the bar it opened
 * or on a bar that already added one (the engine's "one entry in flight"
 * rule, spec 139 §3.5, in bar time).
 */
export const entryTakenThisBar = (
  deal: Pick<Deal, 'startTime' | 'lastEntryTime'>,
  time: number,
) => time <= Math.max(deal.startTime, deal.lastEntryTime ?? 0)
