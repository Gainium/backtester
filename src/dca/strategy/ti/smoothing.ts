import { isSmoothableIndicator, resolveSmoothing } from '@gainium/indicators'
import type { SmoothedResult } from '@gainium/indicators'
import { SmoothingCompareEnum } from '../../../types'
import type { SettingsIndicators } from '../../../types'

/**
 * How an indicator entry's smoothing is evaluated:
 * - `off`: no smoothing, or not a smoothable oscillator — unchanged behaviour.
 * - `value`: conditions (cu / cd / gt / lt / bw / percentile) read the
 *   smoothed line, which the indicator already emits as `value`.
 * - `line`: the raw line is compared against the smoothed line.
 *   Percentile mode overrides `line` (evaluates as `value`).
 */
export type SmoothingMode = 'off' | 'value' | 'line'

type SmoothingSettings = Pick<
  SettingsIndicators,
  'type' | 'smoothing' | 'smoothingLength' | 'smoothingCompare' | 'percentile'
>

export const getSmoothingMode = (
  settings: SmoothingSettings,
): SmoothingMode => {
  if (
    !isSmoothableIndicator(settings.type) ||
    !resolveSmoothing(settings.smoothing, settings.smoothingLength)
  ) {
    return 'off'
  }
  if (
    !settings.percentile &&
    `${settings.smoothingCompare ?? ''}`.toLowerCase() ===
      SmoothingCompareEnum.line
  ) {
    return 'line'
  }
  return 'value'
}

/**
 * Adds the normalised smoothing fields to the indicator config built for an
 * entry — only when the entry is a smoothable oscillator with smoothing on
 * and the config is for that same indicator (a cross-oscillator builds an
 * RSI/CCI/MFI config for an `xo` entry; that is never smoothed). Otherwise
 * the config is returned untouched.
 */
export const withSmoothing = <C extends { type: unknown }>(
  settings: SmoothingSettings,
  config: C,
): C => {
  if (config.type !== settings.type || !isSmoothableIndicator(settings.type)) {
    return config
  }
  const cfg = resolveSmoothing(settings.smoothing, settings.smoothingLength)
  return cfg
    ? { ...config, smoothing: cfg.type, smoothingLength: cfg.length }
    : config
}

/**
 * Operands for `line` mode, in the engine's crossing convention: `last` /
 * `prev` are the series being tested (raw line), `value` / `prevValue` the
 * reference it is tested against (smoothed line). Returns null when a bar
 * lacks the raw reading, which then never fires.
 */
export const lineOperands = (
  lastValue: SmoothedResult,
  prevValue: SmoothedResult,
): { last: number; prev: number; value: number; prevValue: number } | null => {
  if (
    typeof lastValue?.raw !== 'number' ||
    typeof prevValue?.raw !== 'number'
  ) {
    return null
  }
  return {
    last: lastValue.raw,
    prev: prevValue.raw,
    value: lastValue.value,
    prevValue: prevValue.value,
  }
}
