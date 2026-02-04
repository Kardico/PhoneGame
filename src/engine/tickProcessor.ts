/**
 * Core tick processor for the supply chain simulation.
 * 
 * Each tick:
 * 1. Increment tick counter
 * 2. Advance demand phase (if needed)
 * 3. Complete finished jobs (production)
 * 4. Complete finished deliveries
 * 5. Sell (retailers) - automatic, instant
 * 6. Entity decisions (AI or player order)
 */

import type {
  Entity,
  GameState,
  Job,
  Delivery,
  Order,
  PlayerOrder,
  GameConfig,
  DemandPhaseState,
} from '../types/game';
import { getGameConfig, getTransportTime, getEntityType, getProcess, getLocation } from './configLoader';

// ============================================================================
// HELPERS
// ============================================================================

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function getEntity(state: GameState, id: string): Entity | undefined {
  return state.entities.find((e) => e.id === id);
}

function updateEntity(state: GameState, id: string, updater: (e: Entity) => Entity): GameState {
  return {
    ...state,
    entities: state.entities.map((e) => (e.id === id ? updater(e) : e)),
  };
}

function addToInventory(state: GameState, entityId: string, resource: string, quantity: number): GameState {
  const entity = getEntity(state, entityId);
  if (!entity) return state;
  const current = entity.inventory[resource] ?? 0;
  return updateEntity(state, entityId, (e) => ({
    ...e,
    inventory: { ...e.inventory, [resource]: current + quantity },
  }));
}

function removeFromInventory(state: GameState, entityId: string, resource: string, quantity: number): GameState | null {
  const entity = getEntity(state, entityId);
  if (!entity) return null;
  const current = entity.inventory[resource] ?? 0;
  if (current < quantity) return null;
  return updateEntity(state, entityId, (e) => ({
    ...e,
    inventory: { ...e.inventory, [resource]: current - quantity },
  }));
}

// ============================================================================
// DEMAND PHASE
// ============================================================================

function advanceDemandPhase(state: GameState, config: GameConfig): GameState {
  const cycle = config.demandCycle;
  const currentPhase = cycle.phases[state.demandPhase.phaseIndex];
  
  let newPhaseState: DemandPhaseState = {
    phaseIndex: state.demandPhase.phaseIndex,
    ticksInPhase: state.demandPhase.ticksInPhase + 1,
  };

  // Check if we need to move to next phase
  if (newPhaseState.ticksInPhase >= currentPhase.ticks) {
    newPhaseState = {
      phaseIndex: (state.demandPhase.phaseIndex + 1) % cycle.phases.length,
      ticksInPhase: 0,
    };
  }

  return { ...state, demandPhase: newPhaseState };
}

function getCurrentDemand(state: GameState, config: GameConfig, locationId: string): number {
  const location = getLocation(config, locationId);
  if (location.baseDemand === 0) return 0;

  const cycle = config.demandCycle;
  const phase = cycle.phases[state.demandPhase.phaseIndex];
  
  const baseDemand = location.baseDemand * phase.multiplier;
  const variance = cycle.variance;
  const randomFactor = 1 + (Math.random() * 2 - 1) * variance;
  
  return Math.max(0, Math.floor(baseDemand * randomFactor));
}

export function getCurrentPhaseName(state: GameState): string {
  const config = getGameConfig();
  return config.demandCycle.phases[state.demandPhase.phaseIndex].name;
}

export function getPhaseProgress(state: GameState): { current: number; total: number } {
  const config = getGameConfig();
  const phase = config.demandCycle.phases[state.demandPhase.phaseIndex];
  return {
    current: state.demandPhase.ticksInPhase,
    total: phase.ticks,
  };
}

// ============================================================================
// JOB COMPLETION
// ============================================================================

function processCompletedJobs(state: GameState): GameState {
  let nextState = state;
  const stillActive: Job[] = [];

  for (const job of state.jobs) {
    if (job.ticksRemaining <= 0) {
      // Job completed - add outputs to entity inventory
      for (const output of job.outputs) {
        nextState = addToInventory(nextState, job.entityId, output.resource, output.quantity);
      }
    } else {
      // Still running - decrement and keep
      stillActive.push({ ...job, ticksRemaining: job.ticksRemaining - 1 });
    }
  }

  return { ...nextState, jobs: stillActive };
}

// ============================================================================
// DELIVERY COMPLETION
// ============================================================================

function processCompletedDeliveries(state: GameState): GameState {
  let nextState = state;
  const stillActive: Delivery[] = [];
  const updatedOrders = [...nextState.orders];

  for (const delivery of state.deliveries) {
    if (delivery.ticksRemaining <= 0) {
      // Delivery completed - add to destination inventory
      nextState = addToInventory(nextState, delivery.toEntityId, delivery.resource, delivery.quantity);
      
      // Update the associated order
      const orderIndex = updatedOrders.findIndex((o) => o.id === delivery.orderId);
      if (orderIndex !== -1) {
        updatedOrders[orderIndex] = {
          ...updatedOrders[orderIndex],
          status: 'delivered',
          deliveredAtTick: nextState.tick,
        };
      }
    } else {
      // Still in transit - decrement and keep
      stillActive.push({ ...delivery, ticksRemaining: delivery.ticksRemaining - 1 });
    }
  }

  return { ...nextState, deliveries: stillActive, orders: updatedOrders };
}

// ============================================================================
// SELLING (RETAILERS)
// ============================================================================

function processSelling(state: GameState, config: GameConfig): GameState {
  let nextState = state;

  for (const entity of nextState.entities) {
    const entityType = getEntityType(config, entity);
    
    // Only retailers sell (entities with no processes that can hold smartphones)
    if (entityType.processes.length > 0 || !entityType.canHold.includes('smartphones')) {
      continue;
    }

    const demand = getCurrentDemand(nextState, config, entity.locationId);
    const stock = entity.inventory['smartphones'] ?? 0;
    const sold = Math.min(stock, demand);
    const lostSales = Math.max(0, demand - stock);

    if (sold > 0) {
      nextState = removeFromInventory(nextState, entity.id, 'smartphones', sold) ?? nextState;
    }

    // Update sales stats
    const currentStats = nextState.sales[entity.id] ?? { totalSold: 0, totalDemand: 0, lostSales: 0 };
    nextState = {
      ...nextState,
      sales: {
        ...nextState.sales,
        [entity.id]: {
          totalSold: currentStats.totalSold + sold,
          totalDemand: currentStats.totalDemand + demand,
          lostSales: currentStats.lostSales + lostSales,
        },
      },
    };
  }

  return nextState;
}

// ============================================================================
// SUPPLIER SELECTION
// ============================================================================

/**
 * Find the best supplier for a resource from an entity's suppliers list.
 * Returns the supplier with stock, preferring closer ones.
 */
function findBestSupplier(
  state: GameState,
  config: GameConfig,
  buyerEntityId: string,
  resource: string
): Entity | null {
  const buyer = getEntity(state, buyerEntityId);
  if (!buyer) return null;

  const supplierIds = buyer.suppliers[resource] ?? [];
  if (supplierIds.length === 0) return null;

  // Get all potential suppliers with their stock and distance
  const candidates = supplierIds
    .map((id) => {
      const supplier = getEntity(state, id);
      if (!supplier) return null;
      const stock = supplier.inventory[resource] ?? 0;
      const distance = getTransportTime(config, supplier.locationId, buyer.locationId);
      return { supplier, stock, distance };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.stock > 0);

  if (candidates.length === 0) {
    // No suppliers with stock, return any valid supplier (order will be amended to 0)
    const firstSupplier = getEntity(state, supplierIds[0]);
    return firstSupplier ?? null;
  }

  // Sort by distance (prefer closer), then by stock (prefer more)
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.stock - a.stock;
  });

  return candidates[0].supplier;
}

/**
 * Get all available suppliers for a resource with their details.
 */
export function getSuppliersForResource(
  state: GameState,
  config: GameConfig,
  buyerEntityId: string,
  resource: string
): { entityId: string; entityName: string; stock: number; transportTime: number }[] {
  const buyer = getEntity(state, buyerEntityId);
  if (!buyer) return [];

  const supplierIds = buyer.suppliers[resource] ?? [];
  
  return supplierIds
    .map((id) => {
      const supplier = getEntity(state, id);
      if (!supplier) return null;
      return {
        entityId: supplier.id,
        entityName: supplier.name,
        stock: supplier.inventory[resource] ?? 0,
        transportTime: getTransportTime(config, supplier.locationId, buyer.locationId),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

// ============================================================================
// ORDER CREATION
// ============================================================================

/**
 * Create an order from buyer to a specific supplier.
 * If supplierId is not provided, finds the best supplier from the buyer's list.
 * The supplier immediately fulfills what they can (up to their stock).
 * If fulfilled > 0, a delivery is created.
 */
function createOrder(
  state: GameState,
  config: GameConfig,
  buyerEntityId: string,
  resource: string,
  requestedQuantity: number,
  supplierId?: string
): GameState {
  const buyer = getEntity(state, buyerEntityId);
  if (!buyer) return state;

  // Find the seller - either specified or best available
  let seller: Entity | null = null;
  if (supplierId) {
    // Verify the supplier is in the buyer's suppliers list for this resource
    const validSuppliers = buyer.suppliers[resource] ?? [];
    if (validSuppliers.includes(supplierId)) {
      seller = getEntity(state, supplierId) ?? null;
    }
  }
  
  if (!seller) {
    seller = findBestSupplier(state, config, buyerEntityId, resource);
  }

  if (!seller) return state;

  const sellerStock = seller.inventory[resource] ?? 0;
  const fulfilledQuantity = Math.min(requestedQuantity, sellerStock);
  const wasAmended = fulfilledQuantity < requestedQuantity;

  // Create the order record
  const orderId = nextId('order');
  const order: Order = {
    id: orderId,
    placedAtTick: state.tick,
    buyerEntityId,
    sellerEntityId: seller.id,
    resource,
    requestedQuantity,
    fulfilledQuantity,
    wasAmended,
    status: fulfilledQuantity > 0 ? 'in_transit' : 'delivered', // 'delivered' with 0 if nothing shipped
  };

  let nextState: GameState = {
    ...state,
    orders: [...state.orders, order],
  };

  // If any quantity is fulfilled, deduct from seller and create delivery
  if (fulfilledQuantity > 0) {
    nextState = removeFromInventory(nextState, seller.id, resource, fulfilledQuantity) ?? nextState;

    const transportTime = getTransportTime(config, seller.locationId, buyer.locationId);

    const delivery: Delivery = {
      id: nextId('delivery'),
      orderId,
      fromEntityId: seller.id,
      toEntityId: buyerEntityId,
      resource,
      quantity: fulfilledQuantity,
      ticksRemaining: transportTime,
    };

    nextState = {
      ...nextState,
      deliveries: [...nextState.deliveries, delivery],
    };
  }

  return nextState;
}

// ============================================================================
// AI LOGIC
// ============================================================================

/** Threshold below which AI orders more resources */
const AI_REORDER_THRESHOLD = 5;
/** How much AI tries to order at once */
const AI_ORDER_QUANTITY = 10;
/** Threshold above which mine pauses production */
const MINE_MAX_STOCK = 30;

function processAIDecisions(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const newJobs: Job[] = [...nextState.jobs];

  for (const entity of nextState.entities) {
    if (entity.isPlayerControlled) continue;

    const entityType = getEntityType(config, entity);

    // --- Start production jobs if we have inputs and capacity ---
    const activeJobsForEntity = newJobs.filter((j) => j.entityId === entity.id).length;
    const availableCapacity = entityType.maxConcurrentJobs - activeJobsForEntity;

    if (availableCapacity > 0 && entityType.processes.length > 0) {
      const process = entityType.processes[0]; // For now, just use first process

      // Check if this is a mine (no inputs)
      if (process.inputs.length === 0) {
        // Mine logic: produce if stock isn't too high
        const outputResource = process.outputs[0]?.resource;
        const currentStock = entity.inventory[outputResource] ?? 0;
        
        if (currentStock < MINE_MAX_STOCK && availableCapacity > 0) {
          newJobs.push({
            id: nextId('job'),
            processId: process.id,
            entityId: entity.id,
            outputs: [...process.outputs],
            ticksRemaining: process.ticks,
          });
        }
      } else {
        // Normal production: check if we have all inputs
        let canProduce = true;
        for (const input of process.inputs) {
          const available = entity.inventory[input.resource] ?? 0;
          if (available < input.quantity) {
            canProduce = false;
            break;
          }
        }

        if (canProduce) {
          // Consume inputs
          for (const input of process.inputs) {
            const consumed = removeFromInventory(nextState, entity.id, input.resource, input.quantity);
            if (consumed) {
              nextState = consumed;
            }
          }

          newJobs.push({
            id: nextId('job'),
            processId: process.id,
            entityId: entity.id,
            outputs: [...process.outputs],
            ticksRemaining: process.ticks,
          });
        }
      }
    }

    // --- Order resources if running low (for each resource we have suppliers for) ---
    // Collect all needed resources
    const neededResources: string[] = [];
    
    // Check process inputs
    for (const process of entityType.processes) {
      for (const input of process.inputs) {
        if (!neededResources.includes(input.resource)) {
          neededResources.push(input.resource);
        }
      }
    }

    // Retailers need smartphones
    if (entityType.processes.length === 0 && entityType.canHold.includes('smartphones')) {
      if (!neededResources.includes('smartphones')) {
        neededResources.push('smartphones');
      }
    }

    // Check each needed resource and order if low
    for (const neededResource of neededResources) {
      const supplierIds = entity.suppliers[neededResource] ?? [];
      if (supplierIds.length === 0) continue; // No suppliers for this resource

      const currentStock = entity.inventory[neededResource] ?? 0;
      
      if (currentStock < AI_REORDER_THRESHOLD) {
        // Place an order (supplier may not have full stock, that's okay)
        nextState = createOrder(nextState, config, entity.id, neededResource, AI_ORDER_QUANTITY);
      }
    }
  }

  return { ...nextState, jobs: newJobs };
}

// ============================================================================
// PLAYER ORDERS
// ============================================================================

function processPlayerOrder(state: GameState, config: GameConfig, playerAction: PlayerOrder): GameState {
  const entity = getEntity(state, playerAction.entityId);
  if (!entity || !entity.isPlayerControlled) return state;

  let nextState = state;
  const newJobs: Job[] = [...nextState.jobs];

  if (playerAction.action === 'produce') {
    // Start a production job
    const entityType = getEntityType(config, entity);
    const process = getProcess(entityType, playerAction.targetId);

    // Check capacity
    const activeJobsForEntity = newJobs.filter((j) => j.entityId === entity.id).length;
    if (activeJobsForEntity >= entityType.maxConcurrentJobs) {
      return state; // At capacity
    }

    // Check inputs (if any)
    if (process.inputs.length > 0) {
      for (const input of process.inputs) {
        const available = entity.inventory[input.resource] ?? 0;
        if (available < input.quantity * playerAction.quantity) {
          return state; // Not enough inputs
        }
      }

      // Consume inputs
      for (const input of process.inputs) {
        const consumed = removeFromInventory(nextState, entity.id, input.resource, input.quantity * playerAction.quantity);
        if (consumed) {
          nextState = consumed;
        }
      }
    }

    // Create job(s)
    for (let i = 0; i < playerAction.quantity; i++) {
      if (newJobs.filter((j) => j.entityId === entity.id).length >= entityType.maxConcurrentJobs) {
        break; // Hit capacity
      }
      newJobs.push({
        id: nextId('job'),
        processId: process.id,
        entityId: entity.id,
        outputs: [...process.outputs],
        ticksRemaining: process.ticks,
      });
    }
    nextState = { ...nextState, jobs: newJobs };
  } else if (playerAction.action === 'order') {
    // Place an order - use specified supplier or find best
    const resource = playerAction.targetId;
    const supplierIds = entity.suppliers[resource] ?? [];
    
    if (supplierIds.length > 0) {
      nextState = createOrder(
        nextState,
        config,
        entity.id,
        resource,
        playerAction.quantity,
        playerAction.supplierId
      );
    }
  }

  return nextState;
}

// ============================================================================
// MAIN TICK PROCESSOR
// ============================================================================

export function runOneTick(state: GameState, playerAction: PlayerOrder | null = null): GameState {
  const config = getGameConfig();

  // 1. Increment tick
  let next: GameState = { ...state, tick: state.tick + 1 };

  // 2. Advance demand phase
  next = advanceDemandPhase(next, config);

  // 3. Complete finished jobs (production)
  next = processCompletedJobs(next);

  // 4. Complete finished deliveries
  next = processCompletedDeliveries(next);

  // 5. Sell (retailers)
  next = processSelling(next, config);

  // 6a. Process player action if provided
  if (playerAction) {
    next = processPlayerOrder(next, config, playerAction);
  }

  // 6b. Process AI decisions
  next = processAIDecisions(next, config);

  return next;
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export { getGameConfig, getTransportTime, getEntityType, getProcess, getLocation };

/** Get orders for a specific entity (as buyer or seller) */
export function getOrdersForEntity(state: GameState, entityId: string): Order[] {
  return state.orders.filter(
    (o) => o.buyerEntityId === entityId || o.sellerEntityId === entityId
  );
}

/** Get active deliveries for a specific entity (incoming or outgoing) */
export function getDeliveriesForEntity(state: GameState, entityId: string): {
  incoming: Delivery[];
  outgoing: Delivery[];
} {
  return {
    incoming: state.deliveries.filter((d) => d.toEntityId === entityId),
    outgoing: state.deliveries.filter((d) => d.fromEntityId === entityId),
  };
}

/** Get entity name by ID */
export function getEntityName(state: GameState, entityId: string): string {
  return state.entities.find((e) => e.id === entityId)?.name ?? entityId;
}
