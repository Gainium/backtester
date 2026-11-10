---
bump: patch
section: Changed
---
- A DCA / combo backtest that reads its candles from the working file no longer waits on a timer after every candle; it yields to the host once per 1,000 candles instead. Results are unchanged, long runs finish much sooner
