/**
 * Procurement AI — decides what to order and from whom for AI-controlled entities.
 *
 * Tweakable parameters are at the top of this file.
 * Each decision function takes the entity context and returns orders to place.
 */

import type {
  Entity,
  GameState,
  GameConfig,
  EntityTypeConfig,
} from '../../types/game';
import { getProcurementProcess, getTransportTime } from '../configLoader';

// ============================================================================
// TWEAKABLE PARAMETERS
// ============================================================================

/** Threshold below which AI orders more resources */
export const AI_REORDER_THRESHOLD = 10;

/** How much AI tries to order at once */
export const AI_ORDER_QUANTITY = 10;

// ============================================================================
// DECISION TYPES
// ============================================================================

export interface ProcurementDecision {
  /** Orders to place: { resource, quantity, supplierId? } */
  orders: { resource: string; quantity: number; supplierId?: string }[];
}

// ============================================================================
// MAIN DECISION FUNCTION
// ============================================================================

/**
 * Decide what to order for an AI entity.
 * Called once per tick for each AI-controlled entity that has procurement processes.
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

  if (currentStock < shouldReorder(currentStock)) {
    // Find best supplier
    const bestSupplierId = pickBestSupplier(entity, resource, supplierIds, state, config);
    if (bestSupplierId) {
      decision.orders.push({
        resource,
        quantity: howMuchToOrder(currentStock),
        supplierId: bestSupplierId,
      });
    }
  }
}

// ============================================================================
// TWEAKABLE: should we reorder? Returns the threshold.
// ============================================================================

function shouldReorder(_currentStock: number): number {
  return AI_REORDER_THRESHOLD;
}

// ============================================================================
// TWEAKABLE: how much to order
// ============================================================================

function howMuchToOrder(_currentStock: number): number {
  return AI_ORDER_QUANTITY;
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
  // Get available stock (inventory - committed) for each supplier
  const candidates = supplierIds
    .map((id) => {
      const supplier = state.entities.find((e) => e.id === id);
      if (!supplier) return null;
      const available = (supplier.inventory[resource] ?? 0) - (supplier.committed[resource] ?? 0);
      const distance = getTransportTime(config, supplier.locationId, entity.locationId);
      return { id, available, distance };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Prefer suppliers with stock, sorted by distance then available stock
  const withStock = candidates.filter((c) => c.available > 0);
  if (withStock.length > 0) {
    withStock.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.available - a.available;
    });
    return withStock[0].id;
  }

  // No suppliers with stock — still order from closest (will be declined, but signal demand)
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].id;
  }

  return null;
}
