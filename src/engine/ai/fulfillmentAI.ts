/**
 * Fulfillment AI — handles order acceptance logic for sellers.
 *
 * Now includes price-based priority: higher price offers are accepted first.
 * Sellers decline orders below their production cost.
 *
 * Tweakable parameters are at the top of this file.
 */

import type {
  Entity,
  Order,
  GameConfig,
  GameState,
} from '../../types/game';
import { getTransportTime, getProductionCostPerUnit } from '../configLoader';

// ============================================================================
// TWEAKABLE PARAMETERS
// ============================================================================

// Priority: (1) highest price, (2) shortest delivery time, (3) earliest placement

// ============================================================================
// ORDER PRIORITY
// ============================================================================

/**
 * Sort pending orders for a seller by priority.
 * Returns sorted order indices (highest priority first).
 * Priority: (1) price offered (higher first), (2) shortest delivery time, (3) earliest placement.
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

    // (1) Highest price first
    if (a.pricePerUnit !== b.pricePerUnit) return b.pricePerUnit - a.pricePerUnit;

    const buyerA = state.entities.find((e) => e.id === a.buyerEntityId);
    const buyerB = state.entities.find((e) => e.id === b.buyerEntityId);

    const timeA = buyerA ? getTransportTime(config, seller.locationId, buyerA.locationId) : Infinity;
    const timeB = buyerB ? getTransportTime(config, seller.locationId, buyerB.locationId) : Infinity;

    // (2) Shortest delivery time first
    if (timeA !== timeB) return timeA - timeB;
    // (3) Earliest placement first
    return a.placedAtTick - b.placedAtTick;
  });
}

/**
 * Decide whether to accept an order, and how much to fulfill.
 * Returns the quantity to fulfill (0 = decline).
 * Declines orders priced below the seller's production cost for that resource.
 */
export function decideOrderFulfillment(
  seller: Entity,
  order: Order,
  availableStock: number,
  requestedQuantity: number,
  config: GameConfig,
): number {
  if (availableStock <= 0) return 0;

  // Check if price is above production cost
  const sellerType = config.entityTypes[seller.type];
  if (sellerType) {
    let minCost = 0;
    for (const processId of sellerType.processes.production) {
      const process = config.processes.production.find((p) => p.id === processId);
      if (!process) continue;
      const producesResource = process.outputs.some((o) => o.resource === order.resource);
      if (producesResource) {
        const cost = getProductionCostPerUnit(config, processId);
        minCost = cost;
        break;
      }
    }
    // Decline if offered price is below production cost (but always accept free resources like from mines)
    if (order.pricePerUnit < minCost) return 0;
  }

  return Math.min(requestedQuantity, availableStock);
}
