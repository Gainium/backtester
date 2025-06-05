import { Strategy, StrategyInput } from './main'

/**
 * Arguments tuple type for strategy constructors
 */
type StrategyArgs = [StrategyInput]

/**
 * Interface for strategy constructors that can be bound to a factory
 */
interface BoundStrategyType<T> extends Function {
  new (...args: StrategyArgs): T
}

/**
 * Creates a factory function for strategy instantiation
 *
 * This utility function provides a convenient way to create strategy instances
 * without having to use the `new` keyword directly. It's particularly useful
 * for functional programming patterns and dependency injection.
 *
 * @template T - The strategy type that extends the base Strategy class
 * @param TargetStrategy - The strategy constructor to wrap in a factory
 * @returns Factory function that creates instances of the target strategy
 *
 * @example
 * ```typescript
 * const createASAP = createStrategyFactory(ASAPStrategy);
 * const strategy = createASAP(strategyInput);
 * ```
 */
export default function createStrategyFactory<T extends Strategy>(
  TargetStrategy: BoundStrategyType<T>,
) {
  return (...args: StrategyArgs) => new TargetStrategy(...args)
}
