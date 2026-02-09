/**
 * Contract AI — handles contract proposals (buyer side) and
 * contract evaluation/acceptance (seller side).
 *
 * Tweakable parameters at the top of this file.
 */

import type {
  Entity,
  GameState,
  GameConfig,
  EntityTypeConfig,
  Contract,
} from '../../types/game';
import {
  getProcurementProcess,
  getProductionCostPerUnit,
  getBasePrice,
  getTransportTime,
} from '../configLoader';

// ============================================================================
// TWEAKABLE PARAMETERS
// ============================================================================

/** Number of deliveries per contract */
export const CONTRACT_DELIVERIES = 5;

/** Units per delivery (same as spot order size) */
export const CONTRACT_UNITS_PER_DELIVERY = 10;

/** Ticks between deliveries */
export const CONTRACT_DELIVERY_INTERVAL = 5;

/** Stock threshold below which AI considers proposing a contract */
export const CONTRACT_PROPOSE_THRESHOLD = 15;

// ============================================================================
// CONTRACT PROPOSAL (BUYER SIDE)
// ============================================================================

export interface ContractProposalDecision {
  proposals: {
    resource: string;
    supplierId: string;
    unitsPerDelivery: number;
    deliveryInterval: number;
    totalUnits: number;
    pricePerUnit: number;
  }[];
}

/**
 * Decide which contracts to propose for an AI entity.
 * Proposes contracts for resources where:
 *   - Entity has procurement processes
 *   - No active/proposed contract already exists for that resource+supplier pair
 *   - Stock is below threshold
 */
export function proposeContracts(
  entity: Entity,
  entityType: EntityTypeConfig,
  state: GameState,
  config: GameConfig,
): ContractProposalDecision {
  const decision: ContractProposalDecision = { proposals: [] };

  for (const processId of entityType.processes.procurement) {
    const process = getProcurementProcess(config, processId);
    const resource = process.resource;
    const currentStock = entity.inventory[resource] ?? 0;

    if (currentStock >= CONTRACT_PROPOSE_THRESHOLD) continue;

    // Check if we already have an active or proposed contract for this resource
    const hasExisting = state.contracts.some(
      (c) =>
        c.buyerEntityId === entity.id &&
        c.resource === resource &&
        (c.status === 'active' || c.status === 'proposed'),
    );
    if (hasExisting) continue;

    // Find best supplier for the contract
    const supplierIds = entity.suppliers[resource] ?? [];
    const bestSupplierId = pickContractSupplier(entity, resource, supplierIds, state, config);
    if (!bestSupplierId) continue;

    const totalUnits = CONTRACT_UNITS_PER_DELIVERY * CONTRACT_DELIVERIES;
    const pricePerUnit = getBasePrice(config, resource);

    decision.proposals.push({
      resource,
      supplierId: bestSupplierId,
      unitsPerDelivery: CONTRACT_UNITS_PER_DELIVERY,
      deliveryInterval: CONTRACT_DELIVERY_INTERVAL,
      totalUnits,
      pricePerUnit,
    });
  }

  return decision;
}

/**
 * Pick the best supplier for a contract (similar to procurement AI).
 */
function pickContractSupplier(
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

  if (candidates.length === 0) return null;

  // Prefer suppliers with stock, sorted by distance
  const withStock = candidates.filter((c) => c.available > 0);
  if (withStock.length > 0) {
    withStock.sort((a, b) => a.distance - b.distance);
    return withStock[0].id;
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].id;
}

// ============================================================================
// CONTRACT EVALUATION (SELLER SIDE)
// ============================================================================

export interface ContractEvaluationResult {
  /** Contract IDs to accept */
  accept: string[];
  /** Contract IDs to decline */
  decline: string[];
}

/**
 * Evaluate mature contract proposals for a seller entity.
 * Accepts the most profitable proposal(s) and declines unprofitable ones.
 * A proposal is "mature" when it has waited at least contractWaitTicks.
 */
export function evaluateContractProposals(
  _seller: Entity,
  entityType: EntityTypeConfig,
  matureProposals: Contract[],
  _state: GameState,
  config: GameConfig,
): ContractEvaluationResult {
  const result: ContractEvaluationResult = { accept: [], decline: [] };

  if (matureProposals.length === 0) return result;

  // Calculate seller's minimum acceptable price for each resource
  // (based on production cost of the relevant fulfillment resource)
  const costFloors = new Map<string, number>();

  for (const processId of entityType.processes.production) {
    const costPerUnit = getProductionCostPerUnit(config, processId);
    const process = config.processes.production.find((p) => p.id === processId);
    if (!process) continue;
    for (const output of process.outputs) {
      const existing = costFloors.get(output.resource);
      if (existing === undefined || costPerUnit < existing) {
        costFloors.set(output.resource, costPerUnit);
      }
    }
  }

  // Group proposals by resource
  const byResource = new Map<string, Contract[]>();
  for (const proposal of matureProposals) {
    const existing = byResource.get(proposal.resource) ?? [];
    existing.push(proposal);
    byResource.set(proposal.resource, existing);
  }

  for (const [resource, proposals] of byResource) {
    const costFloor = costFloors.get(resource) ?? 0;

    // Sort by price (highest first) — take the most profitable
    const sorted = [...proposals].sort((a, b) => b.pricePerUnit - a.pricePerUnit);

    let accepted = false;
    for (const proposal of sorted) {
      if (proposal.pricePerUnit >= costFloor && !accepted) {
        result.accept.push(proposal.id);
        accepted = true;
      } else if (proposal.pricePerUnit < costFloor) {
        result.decline.push(proposal.id);
      } else {
        // Already accepted a better one for this resource — decline
        result.decline.push(proposal.id);
      }
    }
  }

  return result;
}

// ============================================================================
// ORDER BOOK (COMPUTED VIEW)
// ============================================================================

/**
 * Get the order book for an entity: expected deliveries over the next `horizon` ticks.
 * This is computed from active contracts, not stored in state.
 */
export function getOrderBook(
  state: GameState,
  entityId: string,
  horizon: number = 25,
): { tick: number; contractId: string; resource: string; quantity: number; counterpartyId: string; direction: 'incoming' | 'outgoing' }[] {
  const entries: { tick: number; contractId: string; resource: string; quantity: number; counterpartyId: string; direction: 'incoming' | 'outgoing' }[] = [];

  for (const contract of state.contracts) {
    if (contract.status !== 'active') continue;

    const isBuyer = contract.buyerEntityId === entityId;
    const isSeller = contract.sellerEntityId === entityId;
    if (!isBuyer && !isSeller) continue;

    // Calculate remaining deliveries within horizon
    let deliveryTick = contract.nextDeliveryTick;
    const maxTick = state.tick + horizon;
    const remainingUnits = contract.totalUnits - contract.unitsShipped - contract.unitsMissed;

    let unitsScheduled = 0;
    while (deliveryTick <= maxTick && unitsScheduled < remainingUnits) {
      const deliveryQty = Math.min(contract.unitsPerDelivery, remainingUnits - unitsScheduled);
      entries.push({
        tick: deliveryTick,
        contractId: contract.id,
        resource: contract.resource,
        quantity: deliveryQty,
        counterpartyId: isBuyer ? contract.sellerEntityId : contract.buyerEntityId,
        direction: isBuyer ? 'incoming' : 'outgoing',
      });
      unitsScheduled += deliveryQty;
      deliveryTick += contract.deliveryInterval;
    }
  }

  entries.sort((a, b) => a.tick - b.tick);
  return entries;
}
