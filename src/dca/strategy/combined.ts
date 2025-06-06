import { Strategy, StrategyInterface } from './main'
import type { StrategyInput } from './main'
import type {
  ExchangeIntervals,
  FullBar,
  SavedBar,
  TradeResponse,
} from '../../types'
import { timeIntervalMap, DirName } from '../../types'
import { FileReader } from '../../helper/fileReader'
import { DataProcessor } from '../../helper/dataProcessor'
import { SharedData } from './helpers/SharedData'
import { PortfolioManager } from './helpers/PortfolioManager'
import { MathHelper } from 'src/helper/math'

const math = new MathHelper()

/**
 * CombinedStrategy orchestrates multiple strategies, running them in parallel
 * and coordinating their execution across different timeframes and data sources.
 *
 * This strategy can process data from both files and memory, making it suitable
 * for both backtesting with historical data files and real-time strategy execution.
 *
 * @example
 * ```typescript
 * const combined = new CombinedStrategy(
 *   input,
 *   'historical-data',
 *   (input) => new MyStrategy1(input),
 *   (input) => new MyStrategy2(input)
 * );
 * await combined.test(startTime, endTime, progressCallback);
 * ```
 */
class CombinedStrategy extends Strategy implements StrategyInterface {
  /** Array of strategy instances to be executed in parallel */
  private strategies: StrategyInterface[] = []

  /** Current iteration counter for progress tracking */
  private i = 0

  /** Total number of items to process for progress calculation */
  private total = 0

  /** Step size for progress updates */
  private step = 0

  /** Base filename for data file operations */
  private fileName: string

  /**
   * Creates a new CombinedStrategy instance with multiple child strategies.
   *
   * @param input - Strategy configuration and settings
   * @param fileName - Base filename for CSV data files (without extension)
   * @param strategies - Factory functions that create strategy instances
   */
  constructor(
    input: StrategyInput,
    fileName: string,
    ...strategies: ((args: StrategyInput) => StrategyInterface)[]
  ) {
    Strategy.resetData()
    super(input)
    this.strategies = strategies.map((s) => s(input))
    this.fileName = fileName

    // Configure strategy execution mode
    SharedData.fullResult = input.fullResult
    SharedData.useFile =
      input.useFile &&
      Boolean(
        typeof process !== 'undefined' &&
          process.versions &&
          process.versions.node,
      )
  }

  /**
   * Executes the combined strategy test across all configured strategies.
   *
   * This method orchestrates the entire backtesting process, handling both
   * file-based and memory-based data sources, and coordinating execution
   * across multiple timeframes.
   *
   * @param _start - Start timestamp (may be overridden by Strategy.start)
   * @param end - End timestamp for the test period
   * @param updateProgress - Optional callback for progress updates
   * @param total - Optional total size override for progress calculation
   */
  public async test(
    _start: number,
    end: number,
    updateProgress?: (value: number, text: string) => void,
    total?: number,
  ): Promise<void> {
    const { lowest, start, step } = this.prepareTestParameters(_start, end)

    if (!lowest) {
      return
    }

    await this.initializeTest(lowest)

    if (SharedData.useFile) {
      await this.processFileBasedData(
        start,
        end,
        step,
        lowest,
        updateProgress,
        total,
      )
    } else {
      await this.processMemoryBasedData(start, step, lowest, updateProgress)
    }
  }

  /**
   * Prepares and validates test parameters, extracting configuration
   * from strategy data and calculating execution steps.
   */
  private prepareTestParameters(_start: number, end: number) {
    const data = [...SharedData.data].sort(
      (a, b) => timeIntervalMap[a.interval] - timeIntervalMap[b.interval],
    )
    const [lowest] = data
    const start = SharedData.start || _start
    let step = start !== 0 && end !== 0 ? (end - start) / 100 : 0

    if (step < timeIntervalMap[lowest?.interval ?? 'INTERVAL_1M']) {
      step = timeIntervalMap[lowest?.interval ?? 'INTERVAL_1M']
    }

    return { lowest, start, step }
  }

  /**
   * Initializes the test environment and strategy state.
   */
  private async initializeTest(lowest: { interval: ExchangeIntervals }) {
    SharedData.lowestInterval = lowest.interval
    SharedData.interval = lowest.interval
    await this.preTest()
  }

  /**
   * Processes data from CSV files using the FileReader utility.
   */
  private async processFileBasedData(
    start: number,
    end: number,
    step: number,
    lowest: { interval: ExchangeIntervals },
    updateProgress?: (value: number, text: string) => void,
    total?: number,
  ): Promise<void> {
    const filePath = this.getDataFilePath()
    const fileReader = new FileReader()

    if (!fileReader.isFileSystemAvailable()) {
      console.warn('File system operations not available in this environment')
      return
    }

    const size = total || this.calculateFileDataSize(start, end, lowest)
    const current: Map<string, number> = new Map()
    const last: Map<string, SavedBar> = new Map()

    const dataProcessor = new DataProcessor()

    try {
      for await (const line of fileReader.readLines(filePath)) {
        if (SharedData._stop) {
          return
        }

        const bar = dataProcessor.parseCSVLine(line)
        if (!bar) {
          continue
        }

        const shouldCheckPortfolio = this.shouldCheckPortfolio(
          bar,
          current,
          start,
        )

        if (shouldCheckPortfolio) {
          current.set(bar.symbol, (current.get(bar.symbol) || start) + step)
        }

        await this.processBar(
          shouldCheckPortfolio,
          bar,
          bar.interval,
          updateProgress,
          size,
        )

        if (SharedData.lowestInterval === bar.interval) {
          last.set(bar.symbol, bar)
        }

        await this.yieldControl()
      }

      await this.finalizePortfolioCheck(last)
    } catch (error) {
      console.error('Error processing file data:', error)
      throw error
    }
  }

  /**
   * Processes data from memory using the lowest interval data.
   */
  private async processMemoryBasedData(
    start: number,
    step: number,
    lowest: { bar: FullBar[]; interval: ExchangeIntervals },
    updateProgress?: (value: number, text: string) => void,
  ): Promise<void> {
    const current: Map<string, number> = new Map()
    const last: Map<string, FullBar> = new Map()

    for (const bar of lowest.bar) {
      if (SharedData._stop) {
        return
      }

      const shouldCheckPortfolio = this.shouldCheckPortfolioForMemoryData(
        bar,
        current,
        start,
      )

      if (shouldCheckPortfolio) {
        current.set(bar.symbol, (current.get(bar.symbol) || start) + step)
      }

      last.set(bar.symbol, bar)

      await this.processBar(
        shouldCheckPortfolio,
        bar,
        lowest.interval,
        updateProgress,
        lowest.bar.length,
      )
    }

    await this.finalizePortfolioCheck(last)
  }

  /**
   * Determines if portfolio should be checked for a given bar (file-based data).
   */
  private shouldCheckPortfolio(
    bar: SavedBar,
    current: Map<string, number>,
    start: number,
  ): boolean {
    const _current = current.get(bar.symbol) || start
    return (
      SharedData.lowestInterval === bar.interval &&
      (_current === start || bar.time >= _current)
    )
  }

  /**
   * Determines if portfolio should be checked for a given bar (memory-based data).
   */
  private shouldCheckPortfolioForMemoryData(
    bar: FullBar,
    current: Map<string, number>,
    start: number,
  ): boolean {
    const _current = current.get(bar.symbol) || start
    return _current === start || bar.time >= _current
  }

  /**
   * Gets the full path to the data file.
   */
  private getDataFilePath(): string {
    const path = require('path')
    const dir = path.join(__dirname, `../../${DirName}`)
    return `${dir}/${this.fileName}.csv`
  }

  /**
   * Calculates the expected size of file data for progress tracking.
   */
  private calculateFileDataSize(
    start: number,
    end: number,
    lowest: { interval: ExchangeIntervals },
  ): number {
    return (
      ((end - start) / timeIntervalMap[lowest.interval]) *
      SharedData.settings.pair.length
    )
  }

  /**
   * Performs final portfolio checks for remaining bars.
   */
  private async finalizePortfolioCheck(
    last: Map<string, SavedBar | FullBar>,
  ): Promise<void> {
    for (const bar of last.values()) {
      if (SharedData.portfolio.has(bar.time)) {
        continue
      }
      PortfolioManager.checkPortfolio(bar.time, bar.close, bar.symbol)
      await this.yieldControl()
    }
  }

  /**
   * Yields control to prevent blocking the event loop.
   */
  private async yieldControl(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  /**
   * Executes pre-test initialization for all child strategies.
   */
  public async preTest(): Promise<void> {
    for (const s of this.strategies) {
      if (SharedData._stop) {
        return
      }
      await s.preTest()
    }
  }

  /**
   * Processes a market data bar across all child strategies.
   *
   * @param checkPortfolio - Whether to check portfolio state for this bar
   * @param b - The market bar to process
   * @param interval - The timeframe interval of the bar
   * @param updateProgress - Optional progress update callback
   * @param _size - Optional total size for progress calculation
   */
  public async processBar(
    checkPortfolio: boolean,
    b: FullBar,
    interval: ExchangeIntervals,
    updateProgress?: (value: number, text: string) => void,
    _size?: number,
  ): Promise<void> {
    if (interval === SharedData.lowestInterval) {
      const size = _size || SharedData?.data?.[0]?.bar?.length || 0
      if (this.step === 0 && this.total === 0 && updateProgress) {
        updateProgress(
          0,
          `Processing candle on ${new Date(b.time).toUTCString()}`,
        )
      }
      if (size !== 0 && updateProgress) {
        if (this.step === 0) {
          this.step = Math.floor(size * 0.03)
        }
        if (this.total === 0) {
          this.total = size
        }

        if (math.remainder(this.i, this.step) === 0) {
          await new Promise((resolve) => setTimeout(resolve, 15))
          updateProgress(
            this.i / this.total,
            `Processing ${b.symbol} candle on ${new Date(
              b.time,
            ).toUTCString()}`,
          )
        }
        this.i++
      }
    }
    for (const s of this.strategies) {
      if (SharedData._stop) {
        return
      }
      await s.processBar(checkPortfolio, b, interval)
    }
  }

  /**
   * Legacy method for passing trade and candle data (delegates to processTrade).
   *
   * @param trade - The trade response to process
   * @param candles - Array of candle data with intervals
   */
  public passTradeCandleData(
    trade: TradeResponse,
    candles: { candle: FullBar[] | null; interval: ExchangeIntervals }[],
  ) {
    this.processTrade(trade, candles)
  }

  /**
   * Processes trade execution across all child strategies.
   *
   * @param trade - The trade response to process
   * @param candles - Array of candle data with intervals
   */
  public processTrade(
    trade: TradeResponse,
    candles: { candle: FullBar[] | null; interval: ExchangeIntervals }[],
  ): void {
    for (const s of this.strategies) {
      if (SharedData._stop) {
        return
      }
      s.processTrade(trade, candles)
    }
  }

  /**
   * Collects required intervals from all child strategies.
   *
   * @returns Array of intervals with their required lookback periods
   */
  public override getOtherIntervals(): {
    interval: ExchangeIntervals
    countBack: number
  }[] {
    const map: Map<ExchangeIntervals, number> = new Map()
    for (const s of this.strategies) {
      for (const i of s.getOtherIntervals()) {
        map.set(i.interval, Math.max(map.get(i.interval) ?? 0, i.countBack))
      }
    }
    return Array.from(map).map(([k, v]) => ({ interval: k, countBack: v }))
  }
}

export default CombinedStrategy
