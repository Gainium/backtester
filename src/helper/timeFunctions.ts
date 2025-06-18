/* eslint-disable no-redeclare */
/**
 * Time and Date Utility Functions
 *
 * Provides comprehensive time manipulation and formatting utilities
 * for handling timestamps, timezone conversions, and date formatting
 * in trading and backtesting applications.
 *
 * Key Features:
 * - Timezone-aware date conversions
 * - UTC timestamp generation
 * - Flexible date formatting
 * - Local time zone handling
 *
 * @fileoverview Time manipulation and formatting utilities
 */

/**
 * Converts a time string to UTC timestamp
 *
 * Takes a time string and converts it to a UTC Date object,
 * ensuring consistent timezone handling for backtesting data.
 *
 * @param time - Time string in any valid Date constructor format
 * @returns UTC Date object
 *
 * @example
 * ```typescript
 * const utcTime = timeToTimestamp('2023-01-01 15:30:00');
 * ```
 */
export const timeToTimestamp = (time: string) => {
  const d = new Date(time)
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    ),
  )
}

/**
 * Converts UTC time to local time string for a specific timezone
 *
 * @param originalTime - Original time string
 * @param timezone - Target timezone (e.g., 'America/New_York', 'Europe/London')
 * @returns Local time string formatted for the specified timezone
 *
 * @example
 * ```typescript
 * const localTime = timeToLocal('2023-01-01 15:30:00 UTC', 'America/New_York');
 * ```
 */
export const timeToLocal = (
  originalTime: string,
  timezone?: string | undefined,
) => {
  return new Date(originalTime)
    .toLocaleString('en-US', { timeZone: timezone })
    .split(',')[0]
}

/**
 * Converts date to specific timezone
 *
 * Handles both string and Date input, converting to the specified timezone
 * while maintaining the correct local time representation.
 *
 * @param date - Date string or Date object to convert
 * @param timeZone - Target timezone (null for UTC)
 * @returns Date object adjusted for the specified timezone
 */
export const convertDate = (date: string | Date, timeZone: string | null) => {
  return typeof date === 'string'
    ? new Date(
        new Date(date).toLocaleString('en-US', {
          timeZone: timeZone || undefined,
        }),
      )
    : new Date(
        date.toLocaleString('en-US', {
          timeZone: timeZone || undefined,
        }),
      )
}

/**
 * Pads a number to ensure it has at least 2 digits
 *
 * Helper function for date formatting that ensures consistent
 * two-digit representation for months, days, hours, etc.
 *
 * @param num - Number to pad
 * @returns String with leading zero if needed
 */
const padTo2Digits = (num: number) => {
  return num.toString().padStart(2, '0')
}

/**
 * Formats a Date object as MM/DD/YYYY string
 *
 * @param date - Date object to format
 * @returns Formatted date string in MM/DD/YYYY format
 *
 * @example
 * ```typescript
 * formatDate(new Date('2023-01-01')); // "01/01/2023"
 * ```
 */
export const formatDate = (date: Date) => {
  return [
    padTo2Digits(date.getMonth() + 1),
    padTo2Digits(date.getDate()),
    date.getFullYear(),
  ].join('/')
}

/**
 * Gets the date for a specific week of the year
 *
 * Calculates the actual date for a given week number in a year,
 * with support for different week start days (Monday vs Sunday).
 *
 * @param week - Week string in format "YYYY-WW" (e.g., "2023-25")
 * @param weekStart - Week start day: 'm' for Monday, 's' for Sunday (default: 'm')
 * @param returnDate - Whether to return Date object or formatted string
 * @returns Date object or formatted date string
 *
 * @example
 * ```typescript
 * getDateOfWeek('2023-25'); // "06/19/2023"
 * getDateOfWeek('2023-25', 'm', true); // Date object
 * ```
 */
export function getDateOfWeek(week: string, weekStart?: string): string
export function getDateOfWeek(
  week: string,
  weekStart?: string,
  returnDate?: true,
): Date
export function getDateOfWeek(
  week: string,
  weekStart = 'm',
  returnDate = false,
) {
  const [y, w] = week.split('-').map((v) => Number(v))
  const firstDay = new Date(y, 0, 0).getDay()
  let d = (w + 1) * 7 - firstDay
  if (weekStart === 's') d -= 1
  const date = new Date(y, 0, d)
  if (returnDate) {
    return date
  }
  return formatDate(date)
}

/**
 * Gets the first date of a given month
 *
 * @param month - Month string in format "YYYY-MM" (e.g., "2023-06")
 * @returns Date object representing the first day of the month
 */
export const getDateOfMonth = (month: string) => {
  const [y, m] = `${month}`.split('-').map((v) => Number(v))

  return new Date(y, m - 1, 1)
}

/**
 * Calculates timezone offset for a given timezone and date
 *
 * Determines the time difference between UTC and the specified timezone
 * for accurate time conversions in backtesting.
 *
 * @param timeZone - Target timezone identifier
 * @param date - Reference date for offset calculation (default: current date)
 * @returns Offset in milliseconds
 */
export const getTimezoneOffset = (
  timeZone: string | undefined,
  date = new Date(),
) => {
  const tz = date
    .toLocaleString('en', { timeZone, timeStyle: 'long' })
    .split(' ')
    .slice(-1)[0]
  const dateString = date.toString()
  const offset =
    Date.parse(`${dateString} UTC`) - Date.parse(`${dateString} ${tz}`)

  return offset
}

/**
 * Converts milliseconds to human-friendly time representation
 *
 * Breaks down a time duration in milliseconds into days, hours,
 * minutes, and seconds for readable display.
 *
 * @param time - Time duration in milliseconds
 * @returns Object with time components (d, h, min, s) as strings
 *
 * @example
 * ```typescript
 * friendlyTime(90061000); // { d: "1", h: "1", min: "1", s: "" }
 * friendlyTime(5000); // { d: "", h: "", min: "", s: "5" }
 * ```
 */
export const friendlyTime = (time: number) => {
  const res = {
    d: '',
    h: '',
    min: '',
    s: '',
  }

  if (time > 0) {
    let count: number
    count = Math.floor(time / (24 * 60 * 60 * 1000))
    if (count >= 1) {
      res.d = `${count}`
    }
    count = Math.floor(time / (60 * 60 * 1000))
    if (count >= 1) {
      res.h = `${count % 24}`
    }
    count = Math.floor(time / (60 * 1000))
    if (count >= 1) {
      res.min = `${count % 60}`
    }
    if (res.d === '' && res.h === '' && res.min === '') {
      res.s = `${Math.floor(time / 1000)}`
    }
    return res
  }
  if (time === 0) {
    return { ...res, s: '0' }
  }
  return res
}
