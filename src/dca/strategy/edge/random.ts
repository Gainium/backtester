import { Strategy, StrategyInterface } from '../main'

import type { StrategyInput } from '../main'

import {
  CloseConditionEnum,
  CooldownUnits,
  TradeResponse,
  timeIntervalMap,
  FullBar,
} from '../../../types'

/**
 * Edge Random Strategy - A random entry strategy for testing and edge case analysis
 *
 * This strategy randomly selects entry points from historical data to test
 * edge cases and provide baseline performance metrics. It's useful for:
 * - Benchmarking other strategies against random entries
 * - Testing system robustness with random market entries
 * - Analyzing edge cases in market conditions
 *
 * @example
 * ```typescript
 * const strategy = new EdgeRandomStrategy({
 *   symbols: [{ pair: 'BTCUSDT', baseAsset: { name: 'BTC' }, quoteAsset: { name: 'USDT' } }],
 *   settings: { maxNumberOfOpenDeals: '5' }
 * });
 * await strategy.preTest();
 * await strategy.test();
 * ```
 */
class EdgeRandomStrategy extends Strategy implements StrategyInterface {
  // Configuration constants for better maintainability and performance
  private static readonly DEFAULT_INTERVAL = 100
  private static readonly MAX_START_TIMES = 300
  private static readonly DATA_DIVISION_FACTOR = 2

  /**
   * Set of timestamps when trades should be initiated
   * Using Set for O(1) lookup performance instead of Array's O(n)
   */
  private readonly startTimes: Set<number> = new Set()

  /**
   * Creates a new EdgeRandomStrategy instance
   *
   * @param input - Strategy configuration input
   */
  constructor(input: StrategyInput) {
    super(input)
    // Binding not needed unless passed as callback - removed for performance
  }

  /**
   * Runs the strategy test against all available data
   * Processes each bar in the dataset sequentially
   *
   * @returns Promise that resolves when test is complete
   */
  public async test(): Promise<void> {
    const primaryData = Strategy.data[0]
    if (!primaryData?.bar) {
      return
    }

    for (const bar of primaryData.bar) {
      await this.processBar(false, bar)
    }
  }

  /**
   * Pre-test setup - generates random entry points for the strategy
   * Optimized algorithm for better performance and memory usage
   *
   * @returns Promise that resolves when pre-test setup is complete
   */
  public async preTest(): Promise<void> {
    const data = Strategy.data.find((d) => d.interval === Strategy.interval)
    if (!data?.bar || !Strategy.previousResult) {
      return
    }

    const barCount = data.bar.length
    if (barCount <= EdgeRandomStrategy.DEFAULT_INTERVAL) {
      return // Not enough data
    }

    // Calculate optimal parameters based on data size
    const step = Math.min(
      Math.max(
        1,
        Math.floor(barCount / EdgeRandomStrategy.DATA_DIVISION_FACTOR),
      ),
      EdgeRandomStrategy.DEFAULT_INTERVAL,
    )

    const timeToClose = Math.floor(
      (timeIntervalMap[Strategy.interval] * step) / 1000,
    )

    const maxIndex = Math.max(1, barCount - EdgeRandomStrategy.DEFAULT_INTERVAL)
    const maxStartTimes = Math.min(
      Math.max(
        1,
        Math.floor(maxIndex / EdgeRandomStrategy.DATA_DIVISION_FACTOR),
      ),
      EdgeRandomStrategy.MAX_START_TIMES,
    )

    // Efficient random sampling without duplicates
    this.generateRandomStartTimes(data.bar, maxIndex, maxStartTimes)

    // Configure strategy settings for random edge testing
    this.settings = {
      ...this.settings,
      closeByTimer: true,
      closeByTimerUnits: CooldownUnits.seconds,
      closeByTimerValue: timeToClose,
      useDca: false,
      useSl: false,
      useTp: true,
      dealCloseCondition: CloseConditionEnum.webhook,
      maxNumberOfOpenDeals: '-1',
      baseOrderSize: `${Strategy.previousResult.usage.avgRealUsage}`,
    }
  }

  /**
   * Efficiently generates random start times using Fisher-Yates sampling
   * Avoids the inefficient do-while loop for better performance
   *
   * @param bars - Array of price bars to sample from
   * @param maxIndex - Maximum index to sample from
   * @param count - Number of random times to generate
   */
  private generateRandomStartTimes(
    bars: FullBar[],
    maxIndex: number,
    count: number,
  ): void {
    // Create array of valid indices
    const availableIndices = Array.from({ length: maxIndex }, (_, i) => i)

    // Fisher-Yates shuffle for first 'count' elements
    for (let i = 0; i < Math.min(count, availableIndices.length); i++) {
      const randomIndex =
        Math.floor(Math.random() * (availableIndices.length - i)) + i

      // Swap elements
      const temp = availableIndices[i]
      availableIndices[i] = availableIndices[randomIndex]
      availableIndices[randomIndex] = temp

      // Add the selected bar time to our Set
      const selectedBar = bars[availableIndices[i]]
      if (selectedBar) {
        this.startTimes.add(selectedBar.time)
      }
    }
  }

  /**
   * Processes trade responses (no-op for this strategy)
   * Random strategy doesn't need to react to trade events
   *
   * @param _trade - Trade response (unused)
   */
  public processTrade(_trade: TradeResponse): void {
    // No trade processing needed for random strategy
  }

  /**
   * Processes each price bar and executes strategy logic
   * Optimized with early returns and simplified conditional logic
   *
   * @param _checkPortfolio - Portfolio check flag (unused)
   * @param bar - Current price bar to process
   * @returns Promise that resolves when bar processing is complete
   */
  public async processBar(
    _checkPortfolio: boolean,
    bar: FullBar,
  ): Promise<void> {
    // Early return if no deals are configured
    if (!Strategy.getDeals()) {
      return
    }

    // Start working shift if conditions are met
    if (
      Strategy.workingShift.length === 0 &&
      ((Strategy.start && bar.time >= Strategy.start) || !Strategy.start)
    ) {
      this.startWorkingShift(bar.time)
    }

    // Execute trade if this bar time was randomly selected
    if (this.startTimes.has(bar.time)) {
      this.openDeal(bar.close, bar.time, bar.high, bar.low, bar.symbol)
    }

    // Process existing deals
    await this.checkDeals(false, bar)
  }
}

export default EdgeRandomStrategy
