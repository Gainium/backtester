---
bump: minor
section: Added
---
- DCA backtests can treat the passed balance as a hard budget (`enforceBalances`): deals and DCA orders the free budget cannot pay for are skipped, and the result reports the skipped counts in `budgetLimit`
