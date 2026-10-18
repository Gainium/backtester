import { Strategy, StrategyInterface } from './main'

import type { StrategyInput } from './main'

import type { DCABotSettings, FullBar, TradeResponse } from '../../types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The weekday of `time` in `timeZone` (runtime zone when unset), 0 = Sunday. */
export const timerWeekday = (time: number, timeZone?: string): number =>
  WEEKDAYS.indexOf(
    new Date(time).toLocaleDateString('en-US', { timeZone, weekday: 'short' }),
  )

/** The selected weekdays, or null when every day is allowed. */
export const allowedTimerWeekdays = (
  weekdays?: number[] | null,
): Set<number> | null => {
  const days = (weekdays ?? []).filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  )
  return days.length && days.length < 7 ? new Set(days) : null
}

class TimerStrategy extends Strategy implements StrategyInterface {
  public settings: DCABotSettings

  private timezone?: string

  constructor(input: StrategyInput) {
    super(input)
    this.settings = input.settings
    this.processBar = this.processBar.bind(this)
    this.timezone =
      input.timezone ??
      (Intl ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined)
  }

  public async test(): Promise<void> {
    /* const firstTime = Strategy.data[0].bar[0].time
    Strategy.next = new Date(
      `${new Date(firstTime).toDateString()} ${this.settings.hodlAt}`,
    ).getTime()
    if (Strategy.next < firstTime) {
      const tempDate = new Date(Strategy.next)
      tempDate.setDate(tempDate.getDate() + 1)
      Strategy.next = tempDate.getTime()
    } */
    for (const b of Strategy.data[0].bar) {
      await this.processBar(false, b)
    }
  }

  public async preTest(): Promise<void> {
    void 0
  }

  public processTrade(trade: TradeResponse): void {
    let next = Strategy.next.get(trade.symbol)
    if (!next) {
      next = 0
    }
    if (
      Strategy.workingShift.length === 0 &&
      ((Strategy.start && trade.timestamp >= Strategy.start) || !Strategy.start)
    ) {
      this.startWorkingShift(trade.timestamp)
    }
    if (next === 0) {
      const firstTime = trade.timestamp
      next = new Date(
        `${new Date(firstTime).toDateString()} ${this.settings.hodlAt}`,
      ).getTime()
      if (next < firstTime) {
        const tempDate = new Date(next)
        tempDate.setDate(tempDate.getDate() + 1)
        next = tempDate.getTime()
      }
    }
    if (trade.timestamp === next) {
      const weekdays = allowedTimerWeekdays(this.settings.hodlWeekdays)
      if (!weekdays || weekdays.has(timerWeekday(next, this.timezone))) {
        this.openDeal(
          +trade.price,
          trade.timestamp,
          +trade.price,
          +trade.price,
          trade.symbol,
        )
      }
      const date = new Date(next)
      date.setDate(date.getDate() + +this.settings.hodlDay)
      for (
        let i = 0;
        weekdays && i < 7 && !weekdays.has(timerWeekday(+date, this.timezone));
        i++
      ) {
        date.setDate(date.getDate() + 1)
      }
      next = date.getTime()
    }
    this.checkDeals(false, {
      open: +trade.price,
      high: +trade.price,
      low: +trade.price,
      close: +trade.price,
      time: trade.timestamp,
      symbol: trade.symbol,
    })
    Strategy.next.set(trade.symbol, next)
  }

  private getTimezoneOffset(timeZone: string | undefined, date = new Date()) {
    const tz = date
      .toLocaleString('en', { timeZone, timeStyle: 'long' })
      .split(' ')
      .slice(-1)[0]
    const dateString = date.toString()
    const currentTz = new Date()
      .toLocaleString('en', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeStyle: 'long',
      })
      .split(' ')
      .slice(-1)[0]
    const offset =
      Date.parse(`${dateString} ${currentTz}`) -
      Date.parse(`${dateString} ${tz}`)
    console.log(offset, currentTz, tz, dateString)
    return offset
  }

  public async processBar(
    checkPortfolio: boolean,
    bar: FullBar,
  ): Promise<void> {
    Strategy.lastPrice.set(bar.symbol, bar.close)
    let next = Strategy.next.get(bar.symbol)
    if (!next) {
      next = 0
    }
    if (
      Strategy.workingShift.length === 0 &&
      ((Strategy.start && bar.time >= Strategy.start) || !Strategy.start)
    ) {
      this.startWorkingShift(bar.time)
    }
    if (next === 0) {
      const firstTime = bar.time
      const time = new Date(
        `${new Date(firstTime).toDateString()} ${this.settings.hodlAt}`,
      ).getTime()
      next = this.timezone ? time - this.getTimezoneOffset(this.timezone) : time
      if (next < firstTime) {
        const tempDate = new Date(next)
        tempDate.setDate(tempDate.getDate() + 1)
        next = tempDate.getTime()
      }
    }
    if (bar.time === next) {
      const weekdays = allowedTimerWeekdays(this.settings.hodlWeekdays)
      const allowed =
        !weekdays || weekdays.has(timerWeekday(next, this.timezone))
      const date = new Date(next)
      if (this.settings.hodlHourly) {
        // elapsed hours, like the live bot: setHours steps the local clock
        // label and skips the repeated hour at the autumn DST change
        date.setTime(next + +this.settings.hodlDay * 3600000)
      } else {
        date.setDate(date.getDate() + +this.settings.hodlDay)
      }
      const maxPerSymbol =
        this.settings.useMulti &&
        Strategy.multi &&
        this.settings.maxDealsPerPair &&
        +this.settings.maxDealsPerPair !== 0 &&
        !isNaN(+this.settings.maxDealsPerPair)
          ? +this.settings.maxDealsPerPair
          : 1
      if (allowed) {
        for (const _ of [...Array(maxPerSymbol).keys()]) {
          this.openDeal(bar.open, bar.time, bar.high, bar.low, bar.symbol)
        }
      }
      // a run on a day that is not selected moves to the next selected one:
      // an hourly timer to the first hour of it, a daily one to its set time
      for (
        let i = 0;
        weekdays &&
        i < 7 * 24 &&
        !weekdays.has(timerWeekday(+date, this.timezone));
        i++
      ) {
        if (this.settings.hodlHourly) {
          date.setTime(+date + 3600000)
        } else {
          date.setDate(date.getDate() + 1)
        }
      }
      next = date.getTime()
    }
    Strategy.next.set(bar.symbol, next)
    await this.checkDeals(checkPortfolio, bar)
  }
}

export default TimerStrategy
