/**
 * Basic example usage of @gainium/backtester
 *
 * This file demonstrates the core functionality of the backtesting library.
 */

import Backtesting, {
  ExchangeEnum,
  ExchangeIntervals,
  type FullBar,
  type LoadDataFn,
} from '../src/index'

// Example: Basic Backtesting Setup
async function basicBacktestExample() {
  console.log('🚀 Starting basic backtest example...')

  // Create a simple symbol configuration (minimum required fields)
  const symbols = [
    {
      pair: 'BTCUSDT',
      exchange: ExchangeEnum.binance,
      baseAsset: {
        name: 'BTC',
        minAmount: 0.001,
        maxAmount: 100,
        step: 0.001,
      },
      quoteAsset: {
        name: 'USDT',
        minAmount: 10,
      },
      maxOrders: 10,
      priceAssetPrecision: 2,
    },
  ]

  // Create backtester instance with minimum required configuration
  const backtester = new Backtesting(
    {
      exchange: ExchangeEnum.binance,
      symbols,
      interval: ExchangeIntervals.fiveM,
      from: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
      to: Date.now(),
      trades: true,
      useFile: false, // Disable file operations for this example
      userFee: 0.001, // 0.1% trading fee
      prices: [], // Empty prices array
      settings: {}, // Empty settings object
    },
    'example-backtest',
  )

  // Example data loading function
  const loadData: LoadDataFn = async (
    symbol,
    _baseAsset,
    _quoteAsset,
    _resolution,
    period,
    _exchange,
    index = 0,
    total = 1,
  ) => {
    console.log(`📊 Loading data for ${symbol} (${index + 1}/${total})`)

    // Generate mock OHLCV data for demonstration
    const mockData: FullBar[] = []
    const startTime = period.from
    const endTime = period.to
    const intervalMs = 5 * 60 * 1000 // 5 minutes in ms

    for (let time = startTime; time < endTime; time += intervalMs / 1000) {
      const price = 50000 + Math.sin(time / 10000) * 5000 + Math.random() * 1000
      mockData.push({
        open: price,
        high: price + Math.random() * 500,
        low: price - Math.random() * 500,
        close: price + (Math.random() - 0.5) * 200,
        volume: Math.random() * 1000000,
        time: Math.floor(time),
        symbol: symbol, // Include required symbol field
      })
    }

    return mockData
  }

  // Set the data loading function
  backtester.loadData = loadData

  try {
    // Load the data
    const data = await backtester._loadData()
    console.log(`✅ Loaded ${data.length} candles`)

    // Calculate period information
    const period = backtester.calculatePeriod(ExchangeIntervals.fiveM)
    console.log('📅 Period:', {
      from: new Date(period.from * 1000).toISOString(),
      to: new Date(period.to * 1000).toISOString(),
      countBack: period.countBack,
    })

    console.log('🎯 Basic backtest example completed successfully!')
  } catch (error) {
    console.error('❌ Error in basic backtest:', error)
  }
}

// Example: Multiple Time Intervals
async function multiIntervalExample() {
  console.log('⏰ Starting multi-interval example...')

  const backtester = new Backtesting(
    {
      exchange: ExchangeEnum.binance,
      symbols: [
        {
          pair: 'ADAUSDT',
          exchange: ExchangeEnum.binance,
          baseAsset: {
            name: 'ADA',
            minAmount: 1,
            maxAmount: 100000,
            step: 1,
          },
          quoteAsset: {
            name: 'USDT',
            minAmount: 10,
          },
          maxOrders: 10,
          priceAssetPrecision: 4,
        },
      ],
      interval: ExchangeIntervals.fifteenM,
      userFee: 0.001,
      prices: [],
      settings: {},
    },
    'multi-interval',
  )

  // Test different intervals
  const intervals = [
    ExchangeIntervals.fiveM,
    ExchangeIntervals.fifteenM,
    ExchangeIntervals.oneH,
    ExchangeIntervals.fourH,
  ]

  for (const interval of intervals) {
    try {
      const period = backtester.calculatePeriod(interval)
      console.log(`📊 Calculated period for ${interval}:`, {
        from: new Date(period.from * 1000).toISOString(),
        to: new Date(period.to * 1000).toISOString(),
      })
    } catch (error) {
      console.error(`❌ Error calculating period for ${interval}:`, error)
    }
  }

  console.log('✅ Multi-interval example completed!')
}

// Example: Performance Monitoring
async function performanceExample() {
  console.log('⚡ Starting performance monitoring example...')

  const startTime = Date.now()
  const startMemory = process.memoryUsage()

  // Create a backtester instance (for performance monitoring)
  new Backtesting(
    {
      exchange: ExchangeEnum.binance,
      symbols: [
        {
          pair: 'BNBUSDT',
          exchange: ExchangeEnum.binance,
          baseAsset: {
            name: 'BNB',
            minAmount: 0.01,
            maxAmount: 1000,
            step: 0.01,
          },
          quoteAsset: {
            name: 'USDT',
            minAmount: 10,
          },
          maxOrders: 10,
          priceAssetPrecision: 2,
        },
      ],
      interval: ExchangeIntervals.oneM,
      userFee: 0.001,
      prices: [],
      settings: {},
    },
    'performance-test',
  )

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 100))

  const endTime = Date.now()
  const endMemory = process.memoryUsage()

  console.log('📊 Performance metrics:', {
    executionTime: `${endTime - startTime}ms`,
    memoryUsage: {
      rss: `${
        Math.round(((endMemory.rss - startMemory.rss) / 1024 / 1024) * 100) /
        100
      } MB`,
      heapUsed: `${
        Math.round(
          ((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024) * 100,
        ) / 100
      } MB`,
    },
  })

  console.log('✅ Performance monitoring completed!')
}

// Run all examples
async function runAllExamples() {
  console.log('🎬 Running @gainium/backtester examples...\n')

  try {
    await basicBacktestExample()
    console.log('')

    await multiIntervalExample()
    console.log('')

    await performanceExample()
    console.log('')

    console.log('🎉 All examples completed successfully!')
  } catch (error) {
    console.error('💥 Error running examples:', error)
    process.exit(1)
  }
}

// Export for use in other files
export {
  basicBacktestExample,
  multiIntervalExample,
  performanceExample,
  runAllExamples,
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples()
}
