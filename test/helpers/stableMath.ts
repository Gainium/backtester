/**
 * `Math.sin` for golden test inputs, identical on every CPU.
 *
 * V8's `Math.sin` (like `cos`, `exp`, `log`, `pow`) is not bit-identical
 * between x64 and arm64: the last bit of some results differs. Candles built
 * from it differ by that bit too, and a golden sha256 cut on an arm64 machine
 * then fails on an x64 one (the CI runner) although the engine did exactly the
 * same thing. Rounding to 1e-9 removes that bit, so every
 * machine feeds the engine the same candles. Use this, not `Math.sin`, in any
 * generator whose output reaches a golden.
 */
export const sin = (x: number): number => Math.round(Math.sin(x) * 1e9) / 1e9
