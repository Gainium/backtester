# 🚀 Gainium Backtester

<img src="https://app.gainium.io/gainium-icon-192x192.png" alt="Gainium Logo" width="100" />

A high-performance, TypeScript-based backtesting engine specifically designed for DCA (Dollar Cost Averaging) and Grid trading strategies. Built for professional trading applications with comprehensive analytics, real-time optimization capabilities, and minimal computational overhead.

**Author:** Maksym Shamko (https://github.com/maksymshamko)  
**Organization:** Gainium (https://github.com/Gainium | https://gainium.io/)

## ✨ Features

- **🎯 Strategy-Specific**: Purpose-built for DCA and Grid trading strategies
- **⚡ High Performance**: Optimized algorithms with efficient memory management
- **📊 Comprehensive Analytics**: Detailed backtesting results with performance metrics
- **🔧 TypeScript First**: Complete type safety with extensive documentation
- **🔗 Indicators Integration**: Seamless integration with @gainium/indicators library
- **💾 Data Management**: Smart caching and external sorting for large datasets
- **📈 Real-time Ready**: Designed for live trading system integration
- **🧪 Production Tested**: Battle-tested in Gainium's professional trading platform

## 📦 Installation

```bash
# Install from npm
npm install @gainium/backtester
# or
yarn add @gainium/backtester
```

## 🔧 Quick Start

### DCA Strategy Backtesting

```typescript
import { DCABacktesting } from '@gainium/backtester/dca'
import { ExchangeIntervals } from '@gainium/backtester/types'

// Define your DCA bot settings
const dcaSettings = {
  baseOrderSize: 100,
  orderSize: 100,
  ordersCount: 5,
  step: 2.5,
  volumeScale: 1.5,
  stepScale: 1.2,
  tpPerc: 1.5,
  // ... more DCA specific settings
}

// Create backtesting instance
const backtester = new DCABacktesting({
  settings: dcaSettings,
  symbols: [{ pair: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }],
  interval: ExchangeIntervals.oneM,
  userFee: 0.1, // 0.1% trading fee
  slippage: 0.05,
  combo: false,
})

// Run backtest with price data
const candles = [
  {
    time: 1640995200000,
    open: 47000,
    high: 47500,
    low: 46500,
    close: 47200,
    volume: 100,
  },
  // ... more historical candle data
]

const results = await backtester.test(candles)

console.log('Net Profit:', results.netProfit.perc + '%')
console.log('Win Rate:', results.winRate + '%')
console.log('Total Deals:', results.totalDeals)
console.log('Max Drawdown:', results.maxDrawdown.perc + '%')
```

### Grid Strategy Backtesting

```typescript
import { GridBacktesting } from '@gainium/backtester/grid'

// Define your Grid bot settings
const gridSettings = {
  gridType: 'arithmetic', // or 'geometric'
  topPrice: 100000,
  lowPrice: 90000,
  levels: 10,
  // ... more Grid specific settings
}

// Create Grid backtesting instance
const gridBacktester = new GridBacktesting({
  settings: gridSettings,
  symbols: [{ pair: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT' }],
  interval: ExchangeIntervals.fiveM,
  userFee: 0.1,
  fullResult: true, // Get detailed results
})

const gridResults = await gridBacktester.test(candles)
console.log('Grid Strategy Results:', gridResults)
```

## 📊 Available Strategy Types

### 🔄 DCA (Dollar Cost Averaging)

- **Smart Entry/Exit**: RSI, MACD, Bollinger Bands based entries
- **Safety Orders**: Configurable scaling and step sizes
- **Take Profit**: Percentage-based or trailing stop
- **Risk Management**: Stop loss and max safety orders
- **Multi-pair**: Portfolio-wide DCA strategies

### 📐 Grid Trading

- **Grid Types**: Arithmetic and Geometric grids
- **Dynamic Grids**: Auto-adjusting based on volatility
- **Profit Taking**: Configurable grid profit margins
- **Rebalancing**: Automatic grid level adjustments
- **Range Optimization**: Finding optimal trading ranges

## 📈 Performance Metrics

The backtester provides comprehensive performance analytics:

- **Profitability**: Net profit (absolute & percentage)
- **Risk Metrics**: Maximum drawdown, Sharpe ratio
- **Trade Analysis**: Win rate, average trade duration
- **Usage Statistics**: Capital utilization, deal frequency
- **Advanced**: Profit factor, recovery factor, Calmar ratio

## 🛠️ Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/Gainium/backtester.git
cd backtester

# Install dependencies
npm install

# Build the project
npm run build

# Run linting
npm run lint

# Format code
npm run format
```

### Project Structure

```
src/
├── index.ts          # Main entry point
├── types.ts          # TypeScript definitions
├── dca/              # DCA strategy implementation
│   ├── index.ts      # DCA backtesting engine
│   └── strategy/     # DCA strategy logic
├── grid/             # Grid strategy implementation
│   ├── index.ts      # Grid backtesting engine
│   └── strategy/     # Grid strategy logic
└── helper/           # Utility functions
    ├── math.ts       # Mathematical helpers
    ├── price.ts      # Price calculations
    └── utils.ts      # General utilities
```

## 🔗 Related Projects

- **[@gainium/indicators](https://github.com/Gainium/indicators)** - Technical indicators library
- **[Gainium Platform](https://gainium.io/)** - Professional crypto trading platform

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Gainium/backtester/issues)
- **Documentation**: [GitHub Wiki](https://github.com/Gainium/backtester/wiki)
- **Community**: [Gainium Discord](https://discord.gg/gainium)

## 🌟 Acknowledgments

- Built with ❤️ by the Gainium team
- Powered by [@gainium/indicators](https://github.com/Gainium/indicators)
- Inspired by the professional trading community

---

**Made with ❤️ by [Gainium](https://gainium.io/) | Professional Crypto Trading Platform**
