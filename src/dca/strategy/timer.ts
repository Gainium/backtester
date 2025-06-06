import { Strategy, StrategyInterface } from './main'
import type { StrategyInput } from './main'
import type { DCABotSettings, FullBar, TradeResponse } from '../../types'
import { SharedData } from './helpers/SharedData'
import { DealManager } from './helpers/DealManager'

/**
 * Time format validation for hodlAt setting (HH:MM or H:MM)
 */
const TIME_FORMAT_REGEX = /^([0-1]?\d|2[0-3]):([0-5]?\d)$/

/**
 * Timer-based DCA Strategy
 *
 * This strategy opens deals at specific times as defined in the bot settings.
 * It's designed for time-based DCA approaches where deals should be opened
 * at predetermined intervals or specific times of day.
 *
 * Key features:
 * - Time-based deal opening using `hodlAt` setting
 * - Timezone-aware scheduling
 * - Support for recurring time-based entries (hourly or daily)
 * - Automatic deal management with timer resets
 * - Multi-deal support per symbol
 *
 * Configuration requirements:
 * - `hodlAt`: Time in "HH:MM" format (e.g., "14:30" for 2:30 PM)
 * - `hodlDay`: Number of days/hours between deals
 * - `hodlHourly`: Optional flag for hourly intervals instead of daily
 * - `maxDealsPerPair`: Maximum concurrent deals per symbol (when useMulti enabled)
 *
 * @example Basic daily timer
 * ```typescript
 * const strategy = new TimerStrategy({
 *   settings: {
 *     ...botSettings,
 *     hodlAt: '14:30', // Open deals at 2:30 PM
 *     hodlDay: 1 // Daily interval
 *   },
 *   symbols: symbolData,
 *   data: marketData,
 *   timezone: 'America/New_York'
 * });
 *
 * await strategy.test();
 * ```
 *
 * @example Hourly timer with multiple deals
 * ```typescript
 * const strategy = new TimerStrategy({
 *   settings: {
 *     ...botSettings,
 *     hodlAt: '09:00',
 *     hodlDay: 4, // Every 4 hours
 *     hodlHourly: true,
 *     useMulti: true,
 *     maxDealsPerPair: 3
 *   },
 *   symbols: symbolData,
 *   data: marketData
 * });
 * ```
 */
class TimerStrategy extends Strategy implements StrategyInterface {
  public readonly settings: DCABotSettings

  /** Timezone for time-based calculations */
  private readonly timezone?: string

  /**
   * Creates a new Timer strategy instance.
   *
   * @param input - Strategy configuration including settings, symbols, market data, and timezone
   * @throws {Error} If hodlAt setting is missing or has invalid format
   */
  constructor(input: StrategyInput) {
    super(input)
    this.settings = input.settings
    this.validateSettings()
    this.processBar = this.processBar.bind(this)
    this.timezone = this.resolveTimezone(input.timezone)
  }

  /**
   * Validates Timer strategy settings for required fields and formats.
   *
   * @throws {Error} If hodlAt is missing or has invalid time format
   * @private
   */
  private validateSettings(): void {
    if (!this.settings.hodlAt) {
      throw new Error(
        'Timer strategy requires hodlAt setting (time in HH:MM format)',
      )
    }

    if (!TIME_FORMAT_REGEX.test(this.settings.hodlAt)) {
      throw new Error(
        `Invalid hodlAt format: "${this.settings.hodlAt}". Expected HH:MM format (e.g., "14:30")`,
      )
    }

    if (this.settings.hodlDay && isNaN(+this.settings.hodlDay)) {
      throw new Error(
        `Invalid hodlDay value: "${this.settings.hodlDay}". Must be a number`,
      )
    }
  }

  /**
   * Resolves timezone from input or system default.
   *
   * @param inputTimezone - Timezone provided in input
   * @returns Resolved timezone string or undefined
   * @private
   */
  private resolveTimezone(inputTimezone?: string | null): string | undefined {
    return (
      inputTimezone ??
      (typeof Intl !== 'undefined' && Intl.DateTimeFormat
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined)
    )
  }

  /**
   * Runs the complete backtesting process for the Timer strategy.
   * Processes all available market data to simulate time-based trading performance.
   *
   * @returns Promise that resolves when backtesting is complete
   */
  public async test(): Promise<void> {
    const bars = SharedData.data?.[0]?.bar
    if (!bars?.length) {
      throw new Error('No market data available for backtesting')
    }

    for (const bar of bars) {
      await this.processBar(false, bar)
    }
  }

  /**
   * Pre-test initialization method.
   * Currently no pre-processing is required for Timer strategy.
   *
   * @returns Promise that resolves immediately
   */
  public async preTest(): Promise<void> {
    // No pre-test processing required for Timer strategy
    return Promise.resolve()
  }

  /**
   * Processes individual trade events for time-based deal opening.
   *
   * This method handles real-time trade processing and makes decisions about
   * when to open new deals based on the configured time schedule.
   *
   * @param trade - Individual trade data containing price, timestamp, and symbol info
   */
  public processTrade(trade: TradeResponse): void {
    this.initializeWorkingShiftIfNeeded(trade.timestamp)

    let nextScheduledTime = this.getOrInitializeNextScheduledTime(trade)

    if (trade.timestamp === nextScheduledTime) {
      DealManager.openDeal(
        +trade.price,
        trade.timestamp,
        +trade.price,
        +trade.price,
        trade.symbol,
      )
      nextScheduledTime = this.calculateNextScheduledTime(nextScheduledTime)
    }

    this.checkDeals(false, this.tradeToBar(trade))
    SharedData.next.set(trade.symbol, nextScheduledTime)
  }

  /**
   * Initializes working shift if conditions are met.
   *
   * @param timestamp - Current timestamp
   * @private
   */
  private initializeWorkingShiftIfNeeded(timestamp: number): void {
    const shouldStart =
      SharedData.workingShift.length === 0 &&
      ((SharedData.start && timestamp >= SharedData.start) || !SharedData.start)

    if (shouldStart) {
      this.startWorkingShift(timestamp)
    }
  }

  /**
   * Gets existing or calculates initial scheduled time for a trade.
   *
   * @param trade - Trade data with symbol and timestamp
   * @returns Next scheduled time in milliseconds
   * @private
   */
  private getOrInitializeNextScheduledTime(trade: TradeResponse): number {
    let next = SharedData.next.get(trade.symbol)

    if (!next || next === 0) {
      next = this.calculateInitialScheduledTime(trade.timestamp)
    }

    return next
  }

  /**
   * Calculates the initial scheduled time based on hodlAt setting.
   *
   * @param currentTime - Current timestamp
   * @returns Initial scheduled time in milliseconds
   * @private
   */
  private calculateInitialScheduledTime(currentTime: number): number {
    const currentDate = new Date(currentTime)
    const todayDate = currentDate.toDateString()
    let scheduledTime = new Date(
      `${todayDate} ${this.settings.hodlAt}`,
    ).getTime()

    // If scheduled time has already passed today, schedule for tomorrow
    if (scheduledTime < currentTime) {
      const nextDay = new Date(scheduledTime)
      nextDay.setDate(nextDay.getDate() + 1)
      scheduledTime = nextDay.getTime()
    }

    return scheduledTime
  }

  /**
   * Calculates the next scheduled time based on hodlDay setting.
   *
   * @param currentScheduledTime - Current scheduled time
   * @returns Next scheduled time in milliseconds
   * @private
   */
  private calculateNextScheduledTime(currentScheduledTime: number): number {
    const date = new Date(currentScheduledTime)
    const interval = +(this.settings.hodlDay || 1)

    if (this.settings.hodlHourly) {
      date.setHours(date.getHours() + interval)
    } else {
      date.setDate(date.getDate() + interval)
    }

    return date.getTime()
  }

  /**
   * Converts trade data to bar format for deal checking.
   *
   * @param trade - Trade response data
   * @returns FullBar object for deal checking
   * @private
   */
  private tradeToBar(trade: TradeResponse): FullBar {
    const price = +trade.price
    return {
      open: price,
      high: price,
      low: price,
      close: price,
      time: trade.timestamp,
      symbol: trade.symbol,
    }
  }

  /**
   * Calculates timezone offset for proper time calculations.
   *
   * @param timeZone - Target timezone string
   * @param date - Date to calculate offset for (defaults to current date)
   * @returns Offset in milliseconds
   * @private
   */
  private getTimezoneOffset(
    timeZone: string | undefined,
    date = new Date(),
  ): number {
    if (!timeZone) {
      return 0
    }

    try {
      const targetTimeString = date.toLocaleString('en', {
        timeZone,
        timeStyle: 'long',
      })
      const targetTz = targetTimeString.split(' ').slice(-1)[0]

      const currentTz = new Date()
        .toLocaleString('en', {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          timeStyle: 'long',
        })
        .split(' ')
        .slice(-1)[0]

      const dateString = date.toString()
      const offset =
        Date.parse(`${dateString} ${currentTz}`) -
        Date.parse(`${dateString} ${targetTz}`)

      return offset
    } catch (error) {
      console.warn(
        `Failed to calculate timezone offset for ${timeZone}:`,
        error,
      )
      return 0
    }
  }

  /**
   * Processes market bar data for time-based deal management.
   *
   * This method analyzes each market bar and determines when to open new deals
   * based on the configured time schedule (hodlAt setting). It handles timezone
   * calculations and supports both daily and hourly recurring schedules.
   *
   * @param checkPortfolio - Whether to perform portfolio checks
   * @param bar - Market bar data containing OHLC and timestamp
   */
  public async processBar(
    checkPortfolio: boolean,
    bar: FullBar,
  ): Promise<void> {
    this.initializeWorkingShiftIfNeeded(bar.time)

    let nextScheduledTime = this.getOrInitializeNextScheduledTimeForBar(bar)

    if (bar.time === nextScheduledTime) {
      const maxDealsToOpen = this.calculateMaxDealsPerSymbol()
      this.openMultipleDeals(bar, maxDealsToOpen)
      nextScheduledTime = this.calculateNextScheduledTime(nextScheduledTime)
    }

    SharedData.next.set(bar.symbol, nextScheduledTime)
    await this.checkDeals(checkPortfolio, bar)
  }

  /**
   * Gets existing or calculates initial scheduled time for a bar with timezone support.
   *
   * @param bar - Market bar data
   * @returns Next scheduled time in milliseconds
   * @private
   */
  private getOrInitializeNextScheduledTimeForBar(bar: FullBar): number {
    let next = SharedData.next.get(bar.symbol)

    if (!next || next === 0) {
      next = this.calculateInitialScheduledTimeWithTimezone(bar.time)
    }

    return next
  }

  /**
   * Calculates initial scheduled time with timezone adjustment.
   *
   * @param currentTime - Current timestamp
   * @returns Initial scheduled time adjusted for timezone
   * @private
   */
  private calculateInitialScheduledTimeWithTimezone(
    currentTime: number,
  ): number {
    const currentDate = new Date(currentTime)
    const todayDate = currentDate.toDateString()
    let scheduledTime = new Date(
      `${todayDate} ${this.settings.hodlAt}`,
    ).getTime()

    // Apply timezone offset if configured
    if (this.timezone) {
      scheduledTime -= this.getTimezoneOffset(this.timezone)
    }

    // If scheduled time has already passed, schedule for next day
    if (scheduledTime < currentTime) {
      const nextDay = new Date(scheduledTime)
      nextDay.setDate(nextDay.getDate() + 1)
      scheduledTime = nextDay.getTime()
    }

    return scheduledTime
  }

  /**
   * Calculates maximum number of deals to open per symbol.
   *
   * @returns Number of deals to open (1 or maxDealsPerPair setting)
   * @private
   */
  private calculateMaxDealsPerSymbol(): number {
    const { useMulti, maxDealsPerPair } = this.settings

    if (!useMulti || !SharedData.multi || !maxDealsPerPair) {
      return 1
    }

    const maxDeals = +maxDealsPerPair
    return !isNaN(maxDeals) && maxDeals > 0 ? maxDeals : 1
  }

  /**
   * Opens multiple deals for a symbol at the scheduled time.
   *
   * @param bar - Market bar data
   * @param dealCount - Number of deals to open
   * @private
   */
  private openMultipleDeals(bar: FullBar, dealCount: number): void {
    for (let i = 0; i < dealCount; i++) {
      DealManager.openDeal(bar.open, bar.time, bar.high, bar.low, bar.symbol)
    }
  }
}

export default TimerStrategy
