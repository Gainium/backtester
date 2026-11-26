---
bump: patch
section: Fixed
---
- Backtest day, month and year stats (CWR, Sharpe, Sortino, profit by period, periodic stats) are bucketed in the backtest's timezone input, or UTC when none is given, instead of the zone of the machine running the backtest. The same backtest now reports the same stats on a server and in a browser. A browser that passes its own zone sees no change. Applies to DCA, combo, hedge and grid
