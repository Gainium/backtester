# Changelog

All notable changes to the Gainium Backtester project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Open source preparation optimizations
- Comprehensive README.md with usage examples
- Contributing guidelines
- Modern TypeScript configuration aligned with indicators module
- Simplified package.json exports structure
- Updated dependencies to latest versions

### Changed

- Modernized build configuration
- Aligned with @gainium/indicators project structure
- Improved package.json metadata for better npm discoverability

### Removed

- Unnecessary complex export paths
- Outdated development dependencies
- Internal-only build scripts

## [1.0.0] - 2024-01-01

### Added

- Initial release of Gainium Backtester
- DCA (Dollar Cost Averaging) strategy backtesting engine
- Grid trading strategy backtesting engine
- Integration with @gainium/indicators library
- Comprehensive technical indicator support
- Real-time data processing capabilities
- External sorting for large datasets
- TypeScript support with full type definitions
- Performance analytics and metrics
- Multi-pair backtesting support
- Custom strategy framework

### Features

- **DCA Strategy Engine**

  - Configurable base and safety orders
  - Volume and step scaling options
  - Multiple entry/exit conditions
  - Risk management with stop loss
  - Take profit optimization
  - RSI, MACD, Bollinger Bands integration

- **Grid Strategy Engine**

  - Arithmetic and geometric grids
  - Dynamic grid adjustment
  - Configurable grid levels and gaps
  - Profit optimization algorithms
  - Range-bound trading logic

- **Technical Analysis Integration**

  - 45+ technical indicators via @gainium/indicators
  - Custom indicator configurations
  - Real-time signal processing
  - Historical data analysis

- **Performance Analytics**

  - Net profit calculations (absolute & percentage)
  - Win rate and trade statistics
  - Maximum drawdown analysis
  - Sharpe ratio and risk metrics
  - Capital utilization tracking
  - Deal frequency analysis

- **Data Management**
  - CSV data import/export
  - External sorting for memory efficiency
  - Caching mechanisms
  - Multi-timeframe support
  - Symbol management

### Infrastructure

- TypeScript-first architecture
- Modular strategy design
- Extensible framework
- Production-ready performance
- Memory-optimized algorithms

---

## Development Notes

### Version Numbering

- **MAJOR.MINOR.PATCH** format following SemVer
- Breaking changes increment MAJOR version
- New features increment MINOR version
- Bug fixes increment PATCH version

### Release Process

1. Update version in package.json
2. Add entry to CHANGELOG.md
3. Create git tag
4. Build and publish to npm
5. Update GitHub release notes

### Upgrade Guide

When upgrading between major versions, please check the [migration guide](./docs/MIGRATION.md) for breaking changes and upgrade instructions.
