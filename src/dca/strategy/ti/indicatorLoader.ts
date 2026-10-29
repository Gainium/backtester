import {
  RSI,
  MFI,
  ADX,
  BollingerBandsWidth,
  BollingerBands,
  MACD,
  EMA,
  VWMA,
  HMA,
  SMA,
  TVTA,
  WMA,
  DEMA,
  TEMA,
  RMA,
  McGinley,
  StochasticOscillator,
  StochasticRSI,
  SupportResistance,
  QFL,
  PSAR,
  VO,
  CCI,
  AO,
  WilliamsR,
  UltimateOscillator,
  MOM,
  BBWP,
  ECD,
  MAR,
  BBPB,
  DIV,
  DIVUsableOscillators,
  SuperTrend,
  PC,
  ATR,
  PriorPivot,
  ADR,
  ATH,
  KeltnerChannel,
  KeltnerChannelPB,
  DonchianChannels,
  OBFVG,
  LongWick,
  OTELevels,
  SessionLevels,
  SmoothedIndicator,
  getSmoothingWarmup,
  isSmoothableIndicator,
  resolveSmoothing,
  unwrapSmoothed,
} from '@gainium/indicators'
import { MAEnum, IndicatorEnum, RangeType } from '../../../types'

import type {
  IndicatorHistory,
  IndicatorConfigBackTesting,
  Percentile,
  Smoothing,
} from '../../../types'

export default class InternalIndicator {
  private readonly indicator?:
    | RSI
    | MFI
    | ADX
    | BollingerBandsWidth
    | BollingerBands
    | MACD
    | EMA
    | VWMA
    | HMA
    | SMA
    | TVTA
    | WMA
    | DEMA
    | TEMA
    | RMA
    | McGinley
    | StochasticOscillator
    | StochasticRSI
    | SupportResistance
    | QFL
    | PSAR
    | VO
    | CCI
    | AO
    | WilliamsR
    | UltimateOscillator
    | MOM
    | BBWP
    | ECD
    | MAR
    | BBPB
    | DIV
    | SuperTrend
    | PC
    | ATR
    | PriorPivot
    | ADR
    | ATH
    | KeltnerChannel
    | KeltnerChannelPB
    | DonchianChannels
    | OBFVG
    | LongWick
    | OTELevels
    | SessionLevels
    | SmoothedIndicator
  private data: IndicatorHistory[] = []

  private readonly type: IndicatorEnum

  private readonly indicatorName: string

  public length = 0

  constructor(indicatorConfig: IndicatorConfigBackTesting) {
    // Oscillator smoothing: build the oscillator without percentile, then
    // wrap it; the wrapper smooths its main line and ranks the smoothed line.
    const smoothingConfig = isSmoothableIndicator(indicatorConfig.type)
      ? resolveSmoothing(
          (indicatorConfig as Smoothing).smoothing,
          (indicatorConfig as Smoothing).smoothingLength,
        )
      : null
    const pct = indicatorConfig as Percentile
    if (smoothingConfig) {
      indicatorConfig = {
        ...indicatorConfig,
        percentile: false,
      } as IndicatorConfigBackTesting
    }
    this.indicatorName =
      indicatorConfig.type === IndicatorEnum.ma
        ? (indicatorConfig.maType ?? indicatorConfig.type)
        : indicatorConfig.type
    const add = 4
    if (indicatorConfig.type === IndicatorEnum.psar) {
      this.indicator = new PSAR(
        indicatorConfig.start,
        indicatorConfig.inc,
        indicatorConfig.max,
      )
      this.length = add
    }
    if (indicatorConfig.type === IndicatorEnum.ath) {
      this.indicator = new ATH(indicatorConfig.lookback)
      this.length = add + indicatorConfig.lookback
    }
    if (indicatorConfig.type === IndicatorEnum.st) {
      this.indicator = new SuperTrend(
        indicatorConfig.factor,
        indicatorConfig.atrPeriod,
      )
      this.length = indicatorConfig.atrPeriod + add
    }
    if (indicatorConfig.type === IndicatorEnum.dc) {
      this.indicator = new DonchianChannels(indicatorConfig.length)
      this.length = indicatorConfig.length + 1 + add
    }
    if (indicatorConfig.type === IndicatorEnum.pp) {
      this.indicator = new PriorPivot(
        indicatorConfig.ppHighLeft,
        indicatorConfig.ppHighRight,
        indicatorConfig.ppLowLeft,
        indicatorConfig.ppLowRight,
        indicatorConfig.ppMult,
      )
      this.length =
        Math.max(
          indicatorConfig.ppHighLeft + indicatorConfig.ppHighRight,
          indicatorConfig.ppLowLeft + indicatorConfig.ppLowRight,
        ) +
        add +
        1000
    }
    if (indicatorConfig.type === IndicatorEnum.pc) {
      this.indicator = new PC(indicatorConfig.pcUp, indicatorConfig.pcDown)
      this.length = 2 + add
    }
    if (indicatorConfig.type === IndicatorEnum.rsi) {
      this.indicator = new RSI(
        indicatorConfig.interval,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.atr) {
      this.indicator = new ATR(indicatorConfig.interval)
      this.length = indicatorConfig.interval + add
    }
    if (indicatorConfig.type === IndicatorEnum.adr) {
      this.indicator = new ADR(indicatorConfig.interval)
      this.length = indicatorConfig.interval + add
    }
    if (indicatorConfig.type === IndicatorEnum.mar) {
      this.indicator = new MAR(
        indicatorConfig.mar1type,
        indicatorConfig.mar1length,
        indicatorConfig.mar2type,
        indicatorConfig.mar2length,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
        indicatorConfig.trendFilter,
        indicatorConfig.trendFilterLookback,
        indicatorConfig.trendFilterValue,
        indicatorConfig.trendFilterType,
      )
      this.length =
        Math.max(indicatorConfig.mar1length, indicatorConfig.mar2length) +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        (indicatorConfig.trendFilter
          ? (indicatorConfig.trendFilterLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.ecd) {
      this.indicator = new ECD()
      this.length = 2 + add
    }
    if (indicatorConfig.type === IndicatorEnum.cci) {
      this.indicator = new CCI(
        indicatorConfig.interval,
        'hlc3',
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.div) {
      this.length =
        34 +
        (indicatorConfig.leftBars ?? 3) +
        (indicatorConfig.rightBars ?? 1) +
        add
      this.indicator = new DIV(
        indicatorConfig.oscillators.map((v) =>
          v.toLowerCase(),
        ) as DIVUsableOscillators[],
        indicatorConfig.leftBars ?? 3,
        indicatorConfig.rightBars ?? 1,
        indicatorConfig.rangeLower ?? 1,
        indicatorConfig.rangeUpper ?? 60,
      )
    }
    if (indicatorConfig.type === IndicatorEnum.ao) {
      this.indicator = new AO(
        5,
        34,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        34 +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.wr) {
      this.indicator = new WilliamsR(
        indicatorConfig.interval,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.uo) {
      this.indicator = new UltimateOscillator(
        indicatorConfig.fast,
        indicatorConfig.middle,
        indicatorConfig.slow,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        Math.max(
          indicatorConfig.fast,
          indicatorConfig.middle,
          indicatorConfig.slow,
        ) +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.mom) {
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
      this.indicator = new MOM(
        indicatorConfig.interval,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        indicatorConfig.source,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
    }
    if (indicatorConfig.type === IndicatorEnum.vo) {
      this.indicator = new VO(
        indicatorConfig.voShort,
        indicatorConfig.voLong,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        Math.max(indicatorConfig.voLong, indicatorConfig.voShort) +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.mfi) {
      this.indicator = new MFI(
        indicatorConfig.interval,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.adx) {
      this.indicator = new ADX(
        indicatorConfig.interval,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        indicatorConfig.interval * 2 +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.bbw) {
      const bb = new BollingerBands(
        indicatorConfig.interval,
        indicatorConfig.bbwMult ?? 2,
        indicatorConfig.bbwMa ?? MAEnum.sma,
        indicatorConfig.bbwMaLength ?? 20,
      )
      this.indicator = new BollingerBandsWidth(
        bb,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.bbwMaLength ?? 20) *
          (indicatorConfig.bbwMa === MAEnum.tema
            ? 3
            : indicatorConfig.bbwMa === MAEnum.dema
              ? 2
              : 1) +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.kcpb) {
      const kc = new KeltnerChannel(
        indicatorConfig.interval,
        indicatorConfig.multiplier ?? 2,
        indicatorConfig.ma ?? MAEnum.ema,
        indicatorConfig.range ?? RangeType.atr,
        indicatorConfig.rangeLength ?? 10,
      )
      this.indicator = new KeltnerChannelPB(
        kc,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.rangeLength ?? 10) +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.kc) {
      this.indicator = new KeltnerChannel(
        indicatorConfig.interval,
        indicatorConfig.multiplier ?? 2,
        indicatorConfig.ma ?? MAEnum.ema,
        indicatorConfig.range ?? RangeType.atr,
        indicatorConfig.rangeLength ?? 10,
      )
      this.length =
        indicatorConfig.interval + (indicatorConfig.rangeLength ?? 10) + add
    }
    if (indicatorConfig.type === IndicatorEnum.bbpb) {
      const bb = new BollingerBands(
        indicatorConfig.interval,
        indicatorConfig.bbwMult ?? 2,
        indicatorConfig.bbwMa ?? MAEnum.sma,
        indicatorConfig.bbwMaLength ?? 20,
      )
      this.indicator = new BBPB(
        bb,
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.bbwMaLength ?? 20) *
          (indicatorConfig.bbwMa === MAEnum.tema
            ? 3
            : indicatorConfig.bbwMa === MAEnum.dema
              ? 2
              : 1) +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.bbwp) {
      const bb = new BollingerBands(indicatorConfig.interval, 1, MAEnum.sma, 20)
      this.indicator = new BBWP(bb, indicatorConfig.lookback)
      this.length = indicatorConfig.interval + indicatorConfig.lookback + add
    }
    if (indicatorConfig.type === IndicatorEnum.bb) {
      this.indicator = new BollingerBands(
        indicatorConfig.interval,
        indicatorConfig.bbwMult ?? 2,
        indicatorConfig.bbwMa ?? MAEnum.sma,
        indicatorConfig.bbwMaLength ?? 20,
      )
      this.length =
        indicatorConfig.interval +
        (indicatorConfig.bbwMaLength ?? 20) *
          (indicatorConfig.bbwMa === MAEnum.tema
            ? 3
            : indicatorConfig.bbwMa === MAEnum.dema
              ? 2
              : 1) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.macd) {
      const maSource = indicatorConfig.maSource === MAEnum.sma ? SMA : EMA
      const maSignal = indicatorConfig.maSignal === MAEnum.sma ? SMA : EMA
      this.indicator = new MACD(
        new maSource(indicatorConfig.shortInterval),
        new maSource(indicatorConfig.longInterval),
        new maSignal(indicatorConfig.signalInterval),
        indicatorConfig.percentile,
        indicatorConfig.percentileLookback,
        indicatorConfig.percentilePercentage,
      )
      this.length =
        Math.max(indicatorConfig.longInterval + indicatorConfig.shortInterval) +
        indicatorConfig.signalInterval +
        (indicatorConfig.percentile
          ? (indicatorConfig.percentileLookback ?? 0)
          : 0) +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.ma) {
      if (indicatorConfig.maType === MAEnum.ema) {
        this.indicator = new EMA(indicatorConfig.interval)
        this.length = indicatorConfig.interval + 300
      }
      if (indicatorConfig.maType === MAEnum.sma) {
        this.indicator = new SMA(indicatorConfig.interval)
        this.length = indicatorConfig.interval + add
      }
      if (indicatorConfig.maType === MAEnum.wma) {
        this.indicator = new WMA(indicatorConfig.interval)
        this.length = indicatorConfig.interval + add
      }
      if (indicatorConfig.maType === MAEnum.hma) {
        this.indicator = new HMA(indicatorConfig.interval)
        this.length = indicatorConfig.interval * 2 + add
      }
      if (indicatorConfig.maType === MAEnum.vwma) {
        this.indicator = new VWMA(indicatorConfig.interval)
        this.length = indicatorConfig.interval + add
      }
      if (indicatorConfig.maType === MAEnum.dema) {
        this.indicator = new DEMA(indicatorConfig.interval)
        this.length = 2 * indicatorConfig.interval + add
      }
      if (indicatorConfig.maType === MAEnum.tema) {
        this.indicator = new TEMA(indicatorConfig.interval)
        this.length = 3 * indicatorConfig.interval + add
      }
      if (indicatorConfig.maType === MAEnum.rma) {
        this.indicator = new RMA(indicatorConfig.interval)
        this.length = indicatorConfig.interval + add
      }
      if (indicatorConfig.maType === MAEnum.mcginley) {
        // recursive like EMA, so the same stabilisation buffer
        this.indicator = new McGinley(indicatorConfig.interval)
        this.length = indicatorConfig.interval + 300
      }
    }
    if (indicatorConfig.type === IndicatorEnum.tv) {
      this.indicator = new TVTA(
        indicatorConfig.checkLevel,
        indicatorConfig.useAsEntryExitPoints,
      )
      this.length = 3000
    }
    if (indicatorConfig.type === IndicatorEnum.stoch) {
      this.indicator = new StochasticOscillator(
        indicatorConfig.length,
        indicatorConfig.smoothK,
        indicatorConfig.smoothD,
      )
      this.length =
        indicatorConfig.length +
        indicatorConfig.smoothK +
        indicatorConfig.smoothD +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.stochRSI) {
      this.indicator = new StochasticRSI(
        indicatorConfig.rsiLength,
        indicatorConfig.length,
        indicatorConfig.smoothK,
        indicatorConfig.smoothD,
      )
      this.length =
        indicatorConfig.rsiLength +
        indicatorConfig.length +
        indicatorConfig.smoothK +
        indicatorConfig.smoothD +
        add
    }
    if (indicatorConfig.type === IndicatorEnum.qfl) {
      this.indicator = new QFL(
        indicatorConfig.basePeriods,
        indicatorConfig.pumpPeriods,
        indicatorConfig.pump,
        indicatorConfig.baseCrack,
      )
      this.length =
        indicatorConfig.basePeriods + indicatorConfig.pumpPeriods + add
    }
    if (indicatorConfig.type === IndicatorEnum.sr) {
      this.indicator = new SupportResistance(
        indicatorConfig.leftBars,
        indicatorConfig.rightBars,
      )
      this.length = indicatorConfig.leftBars + indicatorConfig.rightBars + add
    }
    if (indicatorConfig.type === IndicatorEnum.obfvg) {
      this.indicator = new OBFVG()
      this.length = 1000
    }
    if (indicatorConfig.type === IndicatorEnum.lw) {
      this.indicator = new LongWick(
        indicatorConfig.lwThreshold ?? 2,
        indicatorConfig.lwMaxDuration ?? 1000,
      )
      this.length = 201
    }
    if (indicatorConfig.type === IndicatorEnum.ote) {
      this.indicator = new OTELevels(
        indicatorConfig.oteLeftBars ?? 10,
        indicatorConfig.oteMinLegSize ?? 1,
      )
      this.length = 1000
    }
    // Session "Price levels" (in / out sessions are clock filters, never built here)
    if (indicatorConfig.type === IndicatorEnum.session) {
      this.indicator = new SessionLevels(indicatorConfig.sessionDays ?? [], {
        start: indicatorConfig.sessionStart,
        end: indicatorConfig.sessionEnd,
        timezone: indicatorConfig.sessionTimezone,
      })
      this.length = 1500
    }
    if (smoothingConfig && this.indicator) {
      this.indicator = new SmoothedIndicator(
        this.indicator as ConstructorParameters<typeof SmoothedIndicator>[0],
        smoothingConfig,
        pct.percentile,
        pct.percentileLookback,
        pct.percentilePercentage,
      )
      this.length +=
        getSmoothingWarmup(smoothingConfig.type, smoothingConfig.length) +
        (pct.percentile ? (pct.percentileLookback ?? 0) : 0)
    }
    this.type = indicatorConfig.type
    this.length = this.length * 2
  }

  public updateValue(
    value: {
      o: number | string
      h: number | string
      l: number | string
      c: number | string
      v: number | string
    },
    time: number,
    cb: (data: IndicatorHistory[]) => void,
  ) {
    // a smoothed oscillator takes the input of the oscillator it wraps
    const kind = unwrapSmoothed(this.indicator)
    const target = this.indicator as unknown as {
      next(input: unknown): unknown
    }
    if (this.indicator && kind instanceof VO) {
      target.next(+value.v)
    }
    if (
      this.indicator &&
      (kind instanceof RSI ||
        kind instanceof MACD ||
        kind instanceof EMA ||
        kind instanceof DEMA ||
        kind instanceof TEMA ||
        kind instanceof RMA ||
        kind instanceof McGinley ||
        kind instanceof SMA ||
        kind instanceof WMA ||
        kind instanceof HMA)
    ) {
      target.next(+value.c)
    }
    if (
      this.indicator &&
      (kind instanceof ADX ||
        kind instanceof StochasticOscillator ||
        kind instanceof StochasticRSI ||
        kind instanceof WilliamsR ||
        kind instanceof UltimateOscillator ||
        kind instanceof SupportResistance ||
        kind instanceof QFL ||
        kind instanceof CCI ||
        kind instanceof PSAR ||
        kind instanceof SuperTrend ||
        kind instanceof ATR ||
        kind instanceof ADR ||
        kind instanceof PriorPivot ||
        kind instanceof ATH)
    ) {
      target.next({
        high: +value.h,
        low: +value.l,
        close: +value.c,
      })
    }
    if (
      this.indicator &&
      (kind instanceof VWMA ||
        kind instanceof MFI ||
        kind instanceof TVTA ||
        kind instanceof MAR ||
        kind instanceof BollingerBandsWidth ||
        kind instanceof KeltnerChannel ||
        kind instanceof KeltnerChannelPB ||
        kind instanceof BBWP ||
        kind instanceof BBPB ||
        kind instanceof BollingerBands ||
        kind instanceof DIV ||
        kind instanceof PC)
    ) {
      target.next({
        high: +value.h,
        low: +value.l,
        close: +value.c,
        open: +value.o,
        volume: +value.v,
      })
    }
    if (
      this.indicator &&
      (kind instanceof MOM ||
        kind instanceof ECD ||
        kind instanceof DonchianChannels ||
        kind instanceof OBFVG ||
        kind instanceof LongWick ||
        kind instanceof OTELevels)
    ) {
      target.next({
        high: +value.h,
        low: +value.l,
        close: +value.c,
        open: +value.o,
      })
    }
    // grouped into sessions by the candle's open time
    if (this.indicator && kind instanceof SessionLevels) {
      target.next({
        high: +value.h,
        low: +value.l,
        close: +value.c,
        open: +value.o,
        time,
      })
    }
    if (this.indicator && kind instanceof AO) {
      target.next({
        high: +value.h,
        low: +value.l,
      })
    }
    try {
      const result = this.indicator?.result
      if (result !== null) {
        this.data.push({
          time,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          value:
            this.type === IndicatorEnum.psar
              ? {
                  psar: result as unknown as number,
                  price: value.c,
                }
              : this.type !== IndicatorEnum.ma
                ? this.type !== IndicatorEnum.bb &&
                  this.type !== IndicatorEnum.kc
                  ? result
                  : {
                      result,
                      price: value.c,
                    }
                : {
                    ma: result as unknown as number,
                    price: value.c,
                    maType: this.indicatorName,
                  },
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          type: this.type,
        })
        if (this.data.length > 3) {
          this.data.shift()
        }
        if (this.data.length === 3) {
          cb([...this.data])
        }
      }
    } catch {
      cb([])
    }
  }

  get currentData() {
    return this.data
  }
}
