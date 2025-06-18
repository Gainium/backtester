import Backtesting from './base'

// Re-export the base class and commonly used types and enums from types module
export default Backtesting
export {
  ExchangeEnum,
  ExchangeIntervals,
  IndicatorEnum,
  type BacktestingInput,
  type FullBar,
  type LoadDataFn,
  type PeriodParams,
  type Symbols,
  type ResolutionString,
  type SavedBar,
} from './types'

// Re-export strategy classes
export { default as DCABacktesting } from './dca/index'
export { default as GRIDBacktesting } from './grid/index'
