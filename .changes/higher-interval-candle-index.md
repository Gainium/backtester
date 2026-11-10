---
bump: patch
section: Changed
---
- A DCA / combo backtest run from candles in memory with indicators on a higher interval no longer copies and filters that interval's candles of every pair at each step; they are indexed per pair once. Results are unchanged, multi-pair runs with higher-interval indicators are noticeably faster
