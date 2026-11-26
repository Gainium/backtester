// Every test run uses UTC, whatever the machine's zone.
//
// The DCA engine buckets its daily and monthly stats (CWR, Sharpe, Sortino,
// profit by period) at local midnight, so the same backtest gives different
// stats in different zones, and a golden sha256 cut in one zone fails in
// another. Loaded from .mocharc.json, so a direct `npx mocha <file>` gets it
// too, not only `npm test`.
process.env.TZ = 'UTC'
