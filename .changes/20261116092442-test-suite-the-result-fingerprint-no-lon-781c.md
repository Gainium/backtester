---
bump: patch
section: Fixed
---
- Test suite: the result fingerprint no longer hashes the closed-deals summary, which is computed from the deals already hashed; goldens cut before that summary existed match again, unchanged. No engine or result change
