# Test Instructions

This package currently doesn't include automated unit tests, but you can test the functionality manually or integrate it into your own test suite.

## Manual Testing

### Basic Usage Test

```javascript
const {
  default: Backtesting,
  ExchangeEnum,
  ExchangeIntervals,
} = require('@gainium/backtester')

// Create a simple backtesting instance
const backtester = new Backtesting(
  {
    exchange: ExchangeEnum.binance,
    symbols: [
      {
        pair: 'BTCUSDT',
        baseAsset: { name: 'BTC' },
        quoteAsset: { name: 'USDT' },
      },
    ],
    interval: ExchangeIntervals.fiveM,
    from: Date.now() - 86400000, // 24 hours ago
    to: Date.now(),
  },
  'test-backtest',
)

console.log('Backtester created successfully')
console.log('Exchange:', backtester.exchange)
console.log('Interval:', backtester.interval)
```

### DCA Strategy Test

```javascript
const { DCABacktesting } = require('@gainium/backtester')

// Test DCA strategy (requires additional configuration)
const dcaBacktester = new DCABacktesting({
  settings: {
    // Your DCA strategy settings
  },
  symbols: [
    {
      pair: 'BTCUSDT',
      baseAsset: { name: 'BTC' },
      quoteAsset: { name: 'USDT' },
    },
  ],
  interval: ExchangeIntervals.fiveM,
  // ... other required parameters
})
```

### Grid Strategy Test

```javascript
const { GRIDBacktesting } = require('@gainium/backtester')

// Test Grid strategy (requires additional configuration)
const gridBacktester = new GRIDBacktesting({
  settings: {
    // Your Grid strategy settings
  },
  symbols: [
    {
      pair: 'BTCUSDT',
      baseAsset: { name: 'BTC' },
      quoteAsset: { name: 'USDT' },
    },
  ],
  interval: ExchangeIntervals.fiveM,
  // ... other required parameters
})
```

## Integration Testing

To test with real data, you'll need to provide a data loading function:

```javascript
backtester.loadData = async (
  symbol,
  baseAsset,
  quoteAsset,
  resolution,
  period,
  exchange,
) => {
  // Your data loading implementation
  // Should return an array of FullBar objects
  return [
    {
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 1000,
      time: Date.now() / 1000,
    },
    // ... more bars
  ]
}

// Run the backtest
const result = await backtester._loadData()
console.log('Loaded', result.length, 'bars')
```

## Testing with Jest (Recommended)

If you want to add proper unit tests, install Jest:

```bash
npm install --save-dev jest @types/jest ts-jest
```

Create a `jest.config.js`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
}
```

Then create test files in a `tests/` directory.

## Performance Testing

For performance testing with large datasets:

```javascript
const startTime = Date.now()

// Run your backtesting code here

const endTime = Date.now()
console.log(`Backtest completed in ${endTime - startTime}ms`)
```

## Memory Usage Testing

Monitor memory usage during backtesting:

```javascript
const startMemory = process.memoryUsage()

// Run your backtesting code here

const endMemory = process.memoryUsage()
console.log('Memory usage:', {
  rss: `${
    Math.round(((endMemory.rss - startMemory.rss) / 1024 / 1024) * 100) / 100
  } MB`,
  heapTotal: `${
    Math.round(
      ((endMemory.heapTotal - startMemory.heapTotal) / 1024 / 1024) * 100,
    ) / 100
  } MB`,
  heapUsed: `${
    Math.round(
      ((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024) * 100,
    ) / 100
  } MB`,
})
```
