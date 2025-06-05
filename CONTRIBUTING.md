# Contributing to Gainium Backtester

We love your input! We want to make contributing to Gainium Backtester as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## 🚀 Development Process

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

### Pull Requests Process

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

## 🏗️ Setting Up Development Environment

### Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- Git

### Installation

```bash
# Clone your fork
git clone https://github.com/your-username/backtester.git
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
├── index.ts          # Main entry point and data management
├── types.ts          # TypeScript definitions and enums
├── dca/              # DCA strategy implementation
│   ├── index.ts      # DCA backtesting engine
│   └── strategy/     # DCA strategy algorithms
├── grid/             # Grid strategy implementation
│   ├── index.ts      # Grid backtesting engine
│   └── strategy/     # Grid strategy algorithms
└── helper/           # Utility functions
    ├── math.ts       # Mathematical calculations
    ├── price.ts      # Price-related utilities
    ├── botUtils.ts   # Bot-specific helpers
    └── utils.ts      # General utilities
```

## 📝 Code Style

We use ESLint and Prettier to maintain consistent code style.

### Linting

```bash
# Check for linting errors
npm run lint

# Fix auto-fixable linting errors
npm run lint:fix
```

### Formatting

```bash
# Check formatting
npm run format:check

# Auto-format code
npm run format
```

### Code Style Guidelines

- Use TypeScript for all new code
- Follow existing patterns and conventions
- Write meaningful commit messages
- Use descriptive variable and function names
- Add JSDoc comments for public APIs
- Prefer explicit types over `any`

## 🧪 Testing

Currently, the project uses manual testing. We welcome contributions to add automated testing.

### Manual Testing

Test your changes with:

```typescript
import { DCABacktesting } from './src/dca'
import { GridBacktesting } from './src/grid'

// Test with sample data
const testData = [
  {
    time: 1640995200000,
    open: 47000,
    high: 47500,
    low: 46500,
    close: 47200,
    volume: 100,
  },
  // Add more test candles
]

// Test DCA functionality
const dcaBacktester = new DCABacktesting({
  settings: {
    /* your test settings */
  },
  // ... other required parameters
})

const results = await dcaBacktester.test(testData)
console.log('DCA Results:', results)
```

## 🐛 Reporting Bugs

We use GitHub issues to track bugs. Report a bug by [opening a new issue](https://github.com/Gainium/backtester/issues).

### Bug Report Template

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

### Example Bug Report

```
**Bug Summary:**
DCA backtesting throws error when using RSI start condition

**Steps to Reproduce:**
1. Create DCA settings with RSI start condition
2. Set RSI buy threshold to 30
3. Run backtest with sample data
4. Error occurs during execution

**Expected Behavior:**
Backtest should complete successfully with RSI-based entry signals

**Actual Behavior:**
TypeError: Cannot read property 'value' of null

**Environment:**
- Node.js version: 18.0.0
- Package version: 1.0.0
- Operating System: macOS 13.0
```

## 💡 Feature Requests

We welcome feature requests! Please [open an issue](https://github.com/Gainium/backtester/issues) with:

- Clear description of the feature
- Use case and motivation
- Possible implementation approach
- Any relevant examples or references

## 🔧 Contributing to Specific Areas

### Adding New Trading Strategies

1. Create a new directory under `src/` (e.g., `src/scalping/`)
2. Implement the strategy following the existing pattern
3. Add TypeScript types in `types.ts`
4. Export the strategy in `index.ts`
5. Update README.md with usage examples

### Improving Performance

- Profile your changes with real-world data
- Consider memory usage, especially for large datasets
- Maintain backward compatibility
- Document performance improvements

### Adding Technical Indicators

The backtester integrates with `@gainium/indicators`. For new indicators:

1. First contribute to the [indicators repository](https://github.com/Gainium/indicators)
2. Update the indicators dependency
3. Add integration code in the appropriate strategy

## 📋 Code Review Process

The core team looks at Pull Requests on a regular basis. After feedback has been given we expect responses within two weeks. After two weeks we may close the pull request if it isn't showing any activity.

### Review Criteria

- Code quality and style
- Performance impact
- Documentation completeness
- Backward compatibility
- Test coverage (when applicable)

## 🏷️ Versioning

We use [SemVer](http://semver.org/) for versioning:

- **MAJOR** version for incompatible API changes
- **MINOR** version for backward-compatible functionality additions
- **PATCH** version for backward-compatible bug fixes

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🤔 Questions?

Don't hesitate to ask! You can:

- [Open an issue](https://github.com/Gainium/backtester/issues)
- Join our [Discord community](https://discord.gg/gainium)
- Email us at: opensource@gainium.io

## 🙏 Recognition

Contributors will be recognized in our:

- README.md file
- Release notes
- Gainium community channels

Thank you for contributing to Gainium Backtester! 🚀
