---
bump: patch
section: Fixed
---
- Test suite: golden results are the same on every machine. Mocha runs in UTC (the DCA stats bucket days at local midnight, so goldens cut in one zone failed in another), and the golden candle generators use a sine rounded to 1e-9 (V8's Math.sin differs in the last bit between x64 and arm64). Goldens regenerated; only their sha256 changes, deal counts, profit and drawdown are identical. No engine or result change
