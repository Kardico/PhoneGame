/**
 * Procurement AI — decides what to order and from whom for AI-controlled entities.
 *
 * With the contract system, AI primarily uses contracts for regular supply.
 * Spot orders are placed as emergency orders when contracts aren't covering demand.
 *
 * Tweakable parameters are at the top of this file.
 */

import type {
  Entity,
  GameState,
  GameConfig,
  EntityTypeConfig,
} from '../../types/game';
import { getProcurementProcess, getTransportTime, getBasePrice } from '../configLoader';

// ============================================================================
// TWEAKABLE PARAMETERS
// ============================================================================

/** Threshold below which AI places emergency spot orders */
export const AI_EMERGENCY_THRESHOLD = 5;

/** How much AI orders in emergency spot orders */
export const AI_EMERGENCY_QUANTITY = 10;

/** General reorder threshold (for entities without contracts) */
export const AI_REORDER_THRESHOLD = 10;

/** Standard order quantity */
export const AI_ORDER_QUANTITY = 10;

// ============================================================================
// DECISION TYPES
// ============================================================================

export interface ProcurementDecision {
  orders: { resource: string; quantity: number; supplierId?: string; pricePerUnit: number }[];
}

// ============================================================================
// MAIN DECISION FUNCTION
// ============================================================================

/**
 * Decide what spot orders to place for an AI entity.
 * With contracts in play, this focuses on emergency orders when stock is critically low.
 */
export function decideProcurement(
  entity: Entity,
  entityType: EntityTypeConfig,
  state: GameState,
  config: GameConfig,
): ProcurementDecision {
  const decision: ProcurementDecision = { orders: [] };

  for (const processId of entityType.processes.procurement) {
    const process = getProcurementProcess(config, processId);
    const resource = process.resource;

    decideOrderForResource(entity, resource, state, config, decision);
  }

  return decision;
}

// ============================================================================
// ORDER DECISION FOR A SINGLE RESOURCE
// ============================================================================

function decideOrderForResource(
  entity: Entity,
  resource: string,
  state: GameState,
  config: GameConfig,
  decision: ProcurementDecision,
): void {
  const supplierIds = entity.suppliers[resource] ?? [];
  if (supplierIds.length === 0) return;

  const currentStock = entity.inventory[resource] ?? 0;

  // Check if we have an active contract for this resource
  const hasContract = state.contracts.some(
    (c) =>
      c.buyerEntityId === entity.id &&
      c.resource === resource &&
      c.status === 'active',
  );

  // With an active contract: only emergency orders if critically low
  const threshold = hasContract ? AI_EMERGENCY_THRESHOLD : AI_REORDER_THRESHOLD;
  const quantity = hasContract ? AI_EMERGENCY_QUANTITY : AI_ORDER_QUANTITY;

  if (currentStock < threshold) {
    const bestSupplierId = pickBestSupplier(entity, resource, supplierIds, state, config);
    if (bestSupplierId) {
      decision.orders.push({
        resource,
        quantity,
        supplierId: bestSupplierId,
        pricePerUnit: getBasePrice(config, resource),
      });
    }
  }
}

// ============================================================================
// TWEAKABLE: pick best supplier
// ============================================================================

function pickBestSupplier(
  entity: Entity,
  resource: string,
  supplierIds: string[],
  state: GameState,
  config: GameConfig,
): string | null {
  const candidates = supplierIds
    .map((id) => {
      const supplier = state.entities.find((e) => e.id === id);
      if (!supplier) return null;
      const available = (supplier.inventory[resource] ?? 0) - (supplier.committed[resource] ?? 0);
      const distance = getTransportTime(config, supplier.locationId, entity.locationId);
      return { id, available, distance };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const withStock = candidates.filter((c) => c.available > 0);
  if (withStock.length > 0) {
    withStock.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.available - a.available;
    });
    return withStock[0].id;
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].id;
  }

  return null;
}
