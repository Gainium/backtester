import {
  ExchangeEnum,
  ExchangeIntervals,
  tvIntervalMap,
  timeIntervalMap,
  DirName,
} from './types'
import { MathHelper } from './helper/math'
import type {
  Symbols,
  BacktestingInput,
  PeriodParams,
  ResolutionString,
  LoadDataFn,
  FullBar,
  SavedBar,
} from './types'
import { v4 } from 'uuid'

/**
 * Save file function type for persisting backtesting data
 */
type SaveFileFn = (
  fileName: string,
  data: FullBar[],
  interval?: ExchangeIntervals,
  sort?: boolean,
  updateProgress?: (value: number, text: string) => void,
  random?: boolean,
) => Promise<void>

let saveFile: SaveFileFn | undefined

// Check if we're in a Node.js environment (not browser)
if (
  typeof process !== 'undefined' &&
  process.versions &&
  process.versions.node
) {
  const deserializer = (x: string): SavedBar => {
    if (x === 'o;h;l;c;v;t;s;i') {
      return {
        open: -1,
        high: 0,
        low: 0,
        close: 0,
        volume: 0,
        time: 0,
        symbol: '',
        interval: ExchangeIntervals.oneM,
      }
    }
    const [open, high, low, close, volume, time, symbol, _interval] =
      x.split(';')
    return {
      open: +open,
      high: +high,
      low: +low,
      close: +close,
      volume: +volume,
      time: +time,
      symbol: symbol,
      interval: _interval as ExchangeIntervals,
    }
  }
  const serializer = (d: SavedBar) => {
    if (d.open === -1) {
      return 'o;h;l;c;v;t;s;i'
    }
    return `${d.open};${d.high};${d.low};${d.close};${d.volume};${d.time};${d.symbol};${d.interval}`
  }
  const fs = require('fs')
  const esort = require('external-sorting').default
  const path = require('path')
  const dir = path.join(__dirname, DirName)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  saveFile = async (
    fileName: string,
    data: FullBar[],
    interval?: ExchangeIntervals,
    sort?: boolean,
    updateProgress?: (value: number, text: string) => void,
    random = false,
  ) => {
    const file = `${dir}/${fileName}.csv`

    const sortedFile = `${dir}/${fileName}-sorted.csv`
    if (data.length) {
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, 'o;h;l;c;v;t;s;i\n')
      }
      for (const d of data) {
        fs.appendFileSync(
          file,
          `${d.open};${d.high};${d.low};${d.close};${d.volume};${d.time};${d.symbol};${interval}\n`,
        )
      }
    }

    if (sort) {
      const tempDir = `${dir}/${v4()}`
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }
      if (updateProgress) {
        updateProgress(0, `Start sorting of ${file}`)
      }
      let skip = false
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, 'o;h;l;c;v;t;s;i\n')
        skip = true
      }
      if (!skip) {
        const sortOptions = {
          deserializer,
          serializer,
          tempDir,
          maxHeap: 10000,
        }
        await esort({
          ...sortOptions,
          input: fs.createReadStream(file),
          output: fs.createWriteStream(sortedFile),
        }).asc([
          (obj: SavedBar) => obj.time,
          (obj: SavedBar) =>
            random
              ? Math.random() - 0.5
              : [...obj.symbol.toLowerCase()].map((c) => parseInt(c, 36)),
          (obj: SavedBar) => timeIntervalMap[obj.interval],
        ])
        fs.unlinkSync(file)
        fs.renameSync(sortedFile, file)
      }
      fs.rmSync(tempDir, { recursive: true, force: true })
      if (updateProgress) {
        updateProgress(0, `End sorting of ${file}`)
      }
      if (skip) {
        throw 'No data downloaded, refund backtest'
      }
    }
  }
} else {
  saveFile = async () => {
    console.warn('File operations are not supported in browser environment')
  }
}

/**
 * Core backtesting engine for trading strategies
 *
 * This class provides the foundation for backtesting trading algorithms
 * against historical market data. It supports multiple exchanges, time intervals,
 * and data persistence options.
 *
 * @example
 * ```typescript
 * const backtester = new Backtesting({
 *   exchange: ExchangeEnum.binance,
 *   symbols: [{ pair: 'BTCUSDT', baseAsset: { name: 'BTC' }, quoteAsset: { name: 'USDT' } }],
 *   interval: ExchangeIntervals.fiveM,
 *   from: Date.now() - 86400000, // 24 hours ago
 *   to: Date.now()
 * }, 'my-backtest');
 * ```
 */
class Backtesting {
  /** The exchange being used for backtesting */
  public exchange: ExchangeEnum

  /** Time period configuration for the backtest */
  public period: PeriodParams

  /** Map of trading symbols with their configurations */
  protected readonly symbols: Map<string, Symbols> = new Map()

  /** Time interval for candlestick data */
  public interval: ExchangeIntervals

  /** Number of candles to look back */
  private readonly counBack: number = 10000

  /** Math utility helper */
  protected readonly math: MathHelper = new MathHelper()

  /** Start time for the backtest period */
  public from?: number

  /** End time for the backtest period */
  public to?: number

  /** Function to load market data */
  private loadFn?: LoadDataFn

  /** Whether to include trade data in the backtest */
  public trades?: boolean

  /** Flag to stop the backtesting process */
  public _stop = false

  /** Whether to use file-based data persistence */
  public useFile?: boolean

  /** Name for the data file */
  public fileName: string

  /**
   * Creates a new Backtesting instance
   *
   * @param config - Configuration object for the backtesting session
   * @param fileName - Name for data persistence files
   */
  constructor(
    {
      exchange,
      symbols,
      interval,
      from,
      to,
      trades,
      useFile,
    }: BacktestingInput<unknown>,
    fileName: string,
  ) {
    this.exchange = exchange
    this.interval = interval ?? ExchangeIntervals.fiveM
    symbols.forEach((s) => {
      this.symbols.set(s.pair, s)
    })
    this.from = from
    this.to = to
    this.period = this.calculatePeriod(this.interval)
    this.trades = trades
    this.useFile =
      useFile &&
      Boolean(
        typeof process !== 'undefined' &&
          process.versions &&
          process.versions.node,
      )
    this.fileName = fileName
  }

  /**
   * Sets the stop flag to halt backtesting
   *
   * @param value - Whether to stop the backtesting process
   */
  public set stop(value: boolean) {
    this._stop = value
  }

  /**
   * Calculates the time period parameters for backtesting
   *
   * @param interval - The time interval for candles
   * @param from - Optional start time override
   * @returns Period configuration object
   */
  public calculatePeriod(
    interval: ExchangeIntervals,
    from?: number,
  ): PeriodParams {
    const time = timeIntervalMap[interval]
    const now = new Date()
    if (this.from) {
      const to = this.to ? new Date(this.to) : new Date()
      const fr = new Date(this.from)
      return {
        to: to.getTime() / 1000,
        from: fr.getTime() / 1000,
        countBack: this.counBack,
        firstDataRequest: false,
      }
    }
    if (from) {
      const nowTime = now.getTime()
      const _from = new Date(from * 1000)
      const fromTime = _from.getTime()
      return {
        to: Math.ceil(nowTime / 1000),
        from: Math.ceil(fromTime / 1000),
        countBack: Math.floor((nowTime - fromTime) / time),
        firstDataRequest: false,
      }
    }
    const _from = now.getTime() - time * this.counBack
    now.setUTCHours(23, 59, 0, 0)
    const nowTime = now.getTime()
    const fromDate = new Date(_from)
    fromDate.setUTCHours(0, 0, 0, 0)
    return {
      to: Math.ceil(nowTime / 1000),
      from: Math.ceil(fromDate.getTime() / 1000),
      countBack: this.counBack,
      firstDataRequest: false,
    }
  }

  /**
   * Sets the data loading function
   *
   * @param loadFn - Function to load historical market data
   */
  set loadData(loadFn: LoadDataFn) {
    this.loadFn = loadFn
  }

  /**
   * Sorts the stored data for efficient access
   *
   * @param updateProgress - Optional progress callback
   * @param random - Whether to randomize order for equal timestamps
   */
  public async sortData(
    updateProgress?: (value: number, text: string) => void,
    random?: boolean,
  ) {
    if (this.useFile && saveFile) {
      await saveFile(this.fileName, [], undefined, true, updateProgress, random)
    }
  }

  /**
   * Loads market data for backtesting
   *
   * @param int - Time interval override
   * @param from - Start time override
   * @param periodParam - Period parameters override
   * @param index - Current batch index
   * @param total - Total number of batches
   * @param random - Whether to randomize data order
   * @returns Promise resolving to market data
   */
  public async _loadData(
    int?: ExchangeIntervals,
    from?: number,
    periodParam?: PeriodParams,
    index?: number,
    total?: number,
    random = false,
  ): Promise<FullBar[]> {
    const { symbols, interval, period } = this
    const resolution = tvIntervalMap[int ?? interval] as ResolutionString
    let periodToUse = periodParam || period
    if (int && int !== interval && !periodParam) {
      periodToUse = this.calculatePeriod(int, from)
    }
    if (this.loadFn) {
      let data: FullBar[] = []
      let si = 0
      for (const s of symbols.values()) {
        const result = await this.loadFn(
          s.pair,
          s.baseAsset.name,
          s.quoteAsset.name,
          resolution,
          periodToUse,
          this.exchange,
          (index ?? 0) * symbols.size + si,
          (total ?? 1) * symbols.size,
        )
        si++
        const fullResult = result.map((r) => ({ ...r, symbol: s.pair }))
        if (this.useFile && saveFile) {
          await saveFile(this.fileName, fullResult, int ?? interval)
        } else {
          data = data.concat(fullResult)
        }
      }
      return data.sort((a, b) => {
        if (a.time === b.time) {
          return random
            ? Math.random() > 0.5
              ? 1
              : -1
            : `${a.symbol}`.localeCompare(`${b.symbol}`)
        }
        return a.time - b.time
      })
    }
    return []
  }
}

export default Backtesting
