/**
 * Fulfillment AI — handles order acceptance logic for sellers.
 *
 * Currently, fulfillment decisions are made centrally in the tick processor's
 * processOrderAcceptance phase. This module provides the priority/acceptance
 * logic that the central function calls per-entity.
 *
 * Tweakable parameters are at the top of this file.
 */

import type {
  Entity,
  Order,
  GameConfig,
  GameState,
} from '../../types/game';
import { getTransportTime } from '../configLoader';

// ============================================================================
// TWEAKABLE PARAMETERS
// ============================================================================

// Currently using simple rules:
// Priority: (1) shortest delivery time, (2) earliest placement

// ============================================================================
// ORDER PRIORITY
// ============================================================================

/**
 * Sort pending orders for a seller by priority.
 * Returns sorted order indices (highest priority first).
 * This function can be extended with price-based priority later.
 */
export function sortOrdersByPriority(
  seller: Entity,
  orderIndices: number[],
  orders: Order[],
  state: GameState,
  config: GameConfig,
): number[] {
  return [...orderIndices].sort((aIdx, bIdx) => {
    const a = orders[aIdx];
    const b = orders[bIdx];

    const buyerA = state.entities.find((e) => e.id === a.buyerEntityId);
    const buyerB = state.entities.find((e) => e.id === b.buyerEntityId);

    const timeA = buyerA ? getTransportTime(config, seller.locationId, buyerA.locationId) : Infinity;
    const timeB = buyerB ? getTransportTime(config, seller.locationId, buyerB.locationId) : Infinity;

    // (1) Shortest delivery time first
    if (timeA !== timeB) return timeA - timeB;
    // (2) Earliest placement first
    return a.placedAtTick - b.placedAtTick;
  });
}

/**
 * Decide whether to accept an order, and how much to fulfill.
 * Returns the quantity to fulfill (0 = decline).
 * Currently accepts as much as available stock allows.
 */
export function decideOrderFulfillment(
  _seller: Entity,
  _order: Order,
  availableStock: number,
  requestedQuantity: number,
): number {
  if (availableStock <= 0) return 0;
  return Math.min(requestedQuantity, availableStock);
}
