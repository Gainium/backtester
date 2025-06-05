import type { ExchangeIntervals, SavedBar } from '../types'

/**
 * Utility class for parsing and processing market data
 *
 * This class provides methods for parsing CSV data from backtesting files
 * and converting them into usable market bar objects.
 */
export class DataProcessor {
  /**
   * CSV header format for market data files
   */
  public static readonly CSV_HEADER = 'o;h;l;c;v;t;s;i'

  /**
   * Parses a CSV line into a SavedBar object
   *
   * @param line - A CSV line in the format: "open;high;low;close;volume;time;symbol;interval"
   * @returns A SavedBar object or null if parsing fails
   *
   * @example
   * ```typescript
   * const processor = new DataProcessor();
   * const bar = processor.parseCSVLine('100.5;101.0;99.5;100.8;1000;1638360000000;BTCUSDT;5m');
   * ```
   */
  public parseCSVLine(line: string): SavedBar | null {
    // Skip header and empty lines
    if (!line || line === DataProcessor.CSV_HEADER) {
      return null
    }

    const parts = line.split(';')
    if (parts.length !== 8) {
      console.warn(`Invalid CSV line format: ${line}`)
      return null
    }

    const [open, high, low, close, volume, time, symbol, interval] = parts

    try {
      return {
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
        time: Number(time),
        symbol: symbol,
        interval: interval as ExchangeIntervals,
      }
    } catch (error) {
      console.warn(`Failed to parse CSV line: ${line}. Error: ${error}`)
      return null
    }
  }

  /**
   * Validates that a parsed bar has valid numeric values
   *
   * @param bar - The bar to validate
   * @returns True if all numeric values are valid
   */
  public validateBar(bar: SavedBar): boolean {
    return (
      !isNaN(bar.open) &&
      !isNaN(bar.high) &&
      !isNaN(bar.low) &&
      !isNaN(bar.close) &&
      !isNaN(bar.time) &&
      (bar.volume === undefined || !isNaN(bar.volume)) &&
      bar.high >= bar.low &&
      bar.open > 0 &&
      bar.close > 0 &&
      bar.high > 0 &&
      bar.low > 0
    )
  }

  /**
   * Generator function that yields validated bars from an array of CSV lines
   *
   * @param lines - Array of CSV lines to process
   * @yields SavedBar objects for valid lines
   */
  public *processLines(lines: string[]): Generator<SavedBar, void, unknown> {
    for (const line of lines) {
      const bar = this.parseCSVLine(line)
      if (bar && this.validateBar(bar)) {
        yield bar
      }
    }
  }
}
