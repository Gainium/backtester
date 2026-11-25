---
bump: patch
section: Fixed
---
- On pairs not quoted in USDT (for example BTC/USDC), base-currency profit in a DCA, combo or grid backtest is converted to USD at the pair's own price in the test instead of the current BASE/USDT market price
