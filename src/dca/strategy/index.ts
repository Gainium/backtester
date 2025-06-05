import {
  BotStartTypeEnum,
  CloseConditionEnum,
  DCAConditionEnum,
  IndicatorEnum,
  ScaleDcaTypeEnum,
  StartConditionEnum,
  EdgeBacktestEnum,
} from '../../types'
import createStrategyFactory from './factory'
import ASAPStrategy from './asap'
import TIStrategy from './ti'
import TimerStrategy from './timer'
import EdgeRandomStrategy from './edge/random'

import type { DCABotSettings } from '../../types'

/**
 * Strategy selection logic for DCA (Dollar Cost Averaging) bots.
 *
 * This module determines which trading strategies should be active based on the bot's
 * configuration settings. It supports multiple strategy types including technical indicators,
 * timer-based, ASAP, and edge testing strategies.
 *
 * @module DCAStrategySelector
 */

/**
 * Type for strategy factory functions returned by this module
 */
type StrategyFactory = ReturnType<typeof createStrategyFactory>

/**
 * Checks if the bot uses technical indicators for take profit conditions
 */
function usesTechnicalIndicatorsForTakeProfit(
  settings: DCABotSettings,
): boolean {
  return (
    (settings.dealCloseCondition === CloseConditionEnum.techInd ||
      settings.dealCloseCondition === CloseConditionEnum.dynamicAr) &&
    settings.useTp &&
    settings.startCondition !== StartConditionEnum.ti
  )
}

/**
 * Checks if the bot uses technical indicators for stop loss conditions
 */
function usesTechnicalIndicatorsForStopLoss(settings: DCABotSettings): boolean {
  return (
    (settings.dealCloseConditionSL === CloseConditionEnum.techInd ||
      settings.dealCloseCondition === CloseConditionEnum.dynamicAr) &&
    settings.useSl &&
    settings.startCondition !== StartConditionEnum.ti
  )
}

/**
 * Checks if the bot uses technical indicators for DCA (Dollar Cost Averaging) conditions
 */
function usesTechnicalIndicatorsForDCA(settings: DCABotSettings): boolean {
  return (
    (settings.dcaCondition === DCAConditionEnum.indicators ||
      ((settings.dcaCondition === DCAConditionEnum.percentage ||
        !settings.dcaCondition) &&
        [ScaleDcaTypeEnum.adr, ScaleDcaTypeEnum.atr].includes(
          settings.scaleDcaType ?? ScaleDcaTypeEnum.percentage,
        ))) &&
    settings.useDca &&
    settings.startCondition !== StartConditionEnum.ti
  )
}

/**
 * Checks if the bot uses technical indicators for bot controller start conditions
 */
function usesTechnicalIndicatorsForBotController(
  settings: DCABotSettings,
): boolean {
  return Boolean(
    (settings.useBotController &&
      settings.botStart === BotStartTypeEnum.indicators &&
      settings.startCondition !== StartConditionEnum.ti) ||
      (settings.useBotController &&
        settings.botActualStart === BotStartTypeEnum.indicators &&
        settings.startCondition !== StartConditionEnum.ti),
  )
}

/**
 * Checks if the bot uses risk/reward calculations requiring technical indicators
 */
function usesRiskRewardWithIndicators(settings: DCABotSettings): boolean {
  return Boolean(
    settings.useRiskReward && settings.startCondition !== StartConditionEnum.ti,
  )
}

/**
 * Checks if the bot has valid indicators configured (excluding unrealized PnL)
 */
function hasValidIndicators(settings: DCABotSettings): boolean {
  return (
    settings.indicators.filter((i) => i.type !== IndicatorEnum.unpnl).length > 0
  )
}

/**
 * Determines if the Technical Indicator (TI) strategy should be included
 *
 * The TI strategy is added when the bot uses technical indicators for any of:
 * - Take profit conditions
 * - Stop loss conditions
 * - DCA scaling conditions
 * - Bot controller start conditions
 * - Risk/reward calculations
 *
 * @param settings - DCA bot configuration settings
 * @returns True if TI strategy should be included
 */
function shouldIncludeTechnicalIndicatorStrategy(
  settings: DCABotSettings,
): boolean {
  return (
    (usesTechnicalIndicatorsForTakeProfit(settings) ||
      usesTechnicalIndicatorsForStopLoss(settings) ||
      usesTechnicalIndicatorsForDCA(settings) ||
      usesTechnicalIndicatorsForBotController(settings) ||
      usesRiskRewardWithIndicators(settings)) &&
    hasValidIndicators(settings)
  )
}

/**
 * Selects the primary strategy based on start condition and edge testing configuration
 */
function selectPrimaryStrategies(
  settings: DCABotSettings,
  edge?: EdgeBacktestEnum,
): StrategyFactory[] {
  // Edge testing strategies override all others
  if (edge === EdgeBacktestEnum.random) {
    return [createStrategyFactory(EdgeRandomStrategy)]
  }

  // Strategy selection based on start condition
  switch (settings.startCondition) {
    case StartConditionEnum.ti:
      return [createStrategyFactory(TIStrategy)]
    case StartConditionEnum.timer:
      return [createStrategyFactory(TimerStrategy)]
    default:
      return [createStrategyFactory(ASAPStrategy)]
  }
}

/**
 * Gets the appropriate trading strategies based on DCA bot settings.
 *
 * This function analyzes the bot configuration and returns an array of strategy
 * factories that should be used for backtesting or live trading. The selection
 * logic considers:
 *
 * - Edge testing configurations (random strategies for testing)
 * - Start conditions (technical indicators, timer-based, or immediate)
 * - Technical indicator usage across different bot features
 * - Bot controller and risk management settings
 *
 * @param settings - DCA bot configuration object
 * @param edge - Optional edge testing mode for strategy validation
 * @returns Array of strategy factory functions
 *
 * @example
 * ```typescript
 * const strategies = getStrategyBySettings(dcaSettings);
 * const combinedStrategy = new CombinedStrategy(input, 'data-file', ...strategies);
 * ```
 */
const getStrategyBySettings = (
  settings: DCABotSettings,
  edge?: EdgeBacktestEnum,
): StrategyFactory[] => {
  // Start with primary strategies based on configuration
  const strategies = selectPrimaryStrategies(settings, edge)

  // Add Technical Indicator strategy if needed for additional features
  if (shouldIncludeTechnicalIndicatorStrategy(settings)) {
    strategies.push(createStrategyFactory(TIStrategy))
  }

  return strategies
}

export type { StrategyInterface } from './main'

export default getStrategyBySettings
