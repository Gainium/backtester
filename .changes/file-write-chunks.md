---
bump: patch
section: Changed
---
- Candles for a file-backed backtest are written to the working file in chunks of 1,000 instead of one write per candle. The file's contents are unchanged
