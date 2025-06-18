/**
 * Grid Strategy Utility Functions
 *
 * Provides utility functions for managing trading sessions, position updates,
 * and various helper operations for the grid trading strategy.
 *
 * Key Responsibilities:
 * - Working shift management (trading session tracking)
 * - Position updates and calculations
 * - Support functions for the main strategy logic
 *
 * @fileoverview Utility functions for grid trading strategy
 */

import { BotOrderSideEnum, FullGrid, PositionSide } from '../../../types'
import { SharedData } from './SharedData'
import { PriceCalculator } from './PriceCalculator'

/**
 * Utility functions for grid trading strategy operations
 *
 * Provides helper methods for managing trading sessions and position updates.
 * All methods are static and work with the centralized SharedData.
 */
export class StrategyUtils {
  /**
   * Close the current working shift (trading session)
   *
   * Marks the end time for the most recent trading session and updates
   * the working shift history.
   *
   * @param time Timestamp when the working shift ended
   */
  static closeWorkingShift(time: number) {
    const last = SharedData.workingShift[SharedData.workingShift.length - 1]
    if (!last.end) {
      last.end = time
      SharedData.workingShift = [
        ...SharedData.workingShift.filter((ws) => ws.start !== last.start),
        last,
      ]
    }
  }

  /**
   * Start a new working shift (trading session)
   *
   * Begins a new trading session and trims the working shift history
   * to prevent excessive memory usage.
   *
   * @param start Timestamp when the new working shift begins
   */
  static startWorkingShift(start: number): void {
    SharedData.workingShift.push({ start })
    SharedData.workingShift = StrategyUtils.trimWorkingShift(
      SharedData.workingShift,
    )
  }

  /**
   * Trim working shift history to maintain reasonable memory usage
   *
   * Keeps the working shift array size manageable while preserving
   * important historical data for reporting and analysis.
   *
   * @param _workingShift Current working shift array
   * @returns Trimmed working shift array
   */
  static trimWorkingShift(_workingShift: typeof SharedData.workingShift) {
    let workingShift = _workingShift
    if ((workingShift ?? []).length > 10) {
      // Compress old shifts into duration summary to save memory
      const duration = workingShift.reduce(
        (acc, v) => acc + (v.end ? v.end - v.start : 0),
        0,
      )
      const lastShift = workingShift[workingShift.length - 1]
      workingShift = [{ start: 0, end: duration }]
      if (!lastShift.end) {
        workingShift.push(lastShift)
      }
    }
    return workingShift
  }

  /**
   * Update position information after order execution
   *
   * Updates the current position state when a grid order is filled,
   * handling both futures and spot trading scenarios. For futures,
   * this includes position side management and liquidation price calculation.
   *
   * @param order The filled grid order that affects the position
   */
  static updatePositionWithOrder(order: FullGrid) {
    if (SharedData.futures) {
      const margin = order.qty
      const sameDirection =
        (SharedData.position.side === PositionSide.LONG &&
          order.side === BotOrderSideEnum.buy) ||
        (SharedData.position.side === PositionSide.SHORT &&
          order.side === BotOrderSideEnum.sell)

      if (sameDirection || SharedData.position.qty === 0) {
        // Increase position size or open new position
        const entryPrice =
          (SharedData.position.qty * SharedData.position.entryPrice +
            order.qty * order.price) /
          (SharedData.position.qty + order.qty)
        const side =
          order.side === BotOrderSideEnum.buy
            ? PositionSide.LONG
            : PositionSide.SHORT
        SharedData.position = {
          side,
          qty: SharedData.position.qty + margin,
          entryPrice,
          liquidationPrice: PriceCalculator.getLiquidationPrice(
            entryPrice,
            side,
          ),
        }
      } else {
        // Reduce or flip position
        const diff = SharedData.position.qty - order.qty
        if (Math.abs(diff) <= Number.EPSILON) {
          // Position closed
          SharedData.positionStats.count += 1
          SharedData.position = SharedData.emptyPositon
        } else if (diff < 0) {
          // Position flipped to opposite side
          SharedData.positionStats.count += 1
          const side =
            SharedData.position.side === PositionSide.SHORT
              ? PositionSide.LONG
              : PositionSide.SHORT
          SharedData.position = {
            qty: -diff,
            entryPrice: order.price,
            side,
            liquidationPrice: PriceCalculator.getLiquidationPrice(
              order.price,
              side,
            ),
          }
        } else {
          // Position reduced
          SharedData.position.qty -= margin
        }
      }
    }
  }
}
