/**
 * Core tick processor for the supply chain simulation.
 *
 * Each tick (in order):
 * 1. Increment tick counter
 * 2. ARRIVALS — Complete deliveries with ticksRemaining <= 0 (add stock to buyers)
 * 3. Advance demand phase
 * 4. Process production lines (startup, progress, cycle completion)
 * 5. Sell at retailers (automatic, instant)
 * 6. Entity decisions — AI starts/stops lines + AI/player place orders (status = 'pending')
 * 7. ACCEPT ORDERS — Sellers accept/decline pending orders (commit stock)
 * 8. DEPARTURES — Accepted orders ship: deduct inventory & committed, create deliveries
 */

import type {
  Entity,
  GameState,
  ProcessLine,
  Delivery,
  Order,
  PlayerOrder,
  GameConfig,
  DemandPhaseState,
  Inventory,
} from '../types/game';
import {
  getGameConfig,
  getTransportTime,
  getTransportRoute,
  getEntityType,
  getProcess,
  getLocation,
} from './configLoader';

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

/** Get available stock: inventory minus committed */
function getAvailable(entity: Entity, resource: string): number {
  return (entity.inventory[resource] ?? 0) - (entity.committed[resource] ?? 0);
}

/** Add to committed stock */
function addCommitted(state: GameState, entityId: string, resource: string, quantity: number): GameState {
  const entity = getEntity(state, entityId);
  if (!entity) return state;
  const current = entity.committed[resource] ?? 0;
  return updateEntity(state, entityId, (e) => ({
    ...e,
    committed: { ...e.committed, [resource]: current + quantity },
  }));
}

/** Remove from committed stock */
function removeCommitted(state: GameState, entityId: string, resource: string, quantity: number): GameState {
  const entity = getEntity(state, entityId);
  if (!entity) return state;
  const current = entity.committed[resource] ?? 0;
  const newValue = Math.max(0, current - quantity);
  const newCommitted: Inventory = { ...entity.committed, [resource]: newValue };
  // Clean up zero entries
  if (newValue === 0) {
    delete newCommitted[resource];
  }
  return updateEntity(state, entityId, (e) => ({
    ...e,
    committed: newCommitted,
  }));
}

// ============================================================================
// PHASE 1: ARRIVALS
// ============================================================================

/**
 * Complete deliveries with ticksRemaining <= 0 (add stock to buyers).
 * Remaining deliveries have their ticks decremented.
 */
function processArrivals(state: GameState): GameState {
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
// PHASE 2: DEMAND PHASE
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
// PHASE 3: PROCESS LINES (CONTINUOUS PRODUCTION)
// ============================================================================

/**
 * Advance all active process lines.
 * - Starting lines: decrement startup ticks, transition to running.
 * - Running lines: consume tick inputs, advance progress, produce on cycle completion.
 */
function processProductionLines(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const updatedLines: ProcessLine[] = [];

  for (const line of nextState.processLines) {
    const entity = getEntity(nextState, line.entityId);
    if (!entity) continue;

    const entityType = getEntityType(config, entity);
    const process = getProcess(entityType, line.processId);
    let updatedLine = { ...line };

    // --- STARTUP PHASE ---
    if (updatedLine.phase === 'starting') {
      updatedLine.startupTicksRemaining -= 1;
      if (updatedLine.startupTicksRemaining <= 0) {
        updatedLine.phase = 'running';
        updatedLine.progress = 0;
      }
      updatedLines.push(updatedLine);
      continue;
    }

    // --- RUNNING PHASE ---

    // At the start of a new cycle (progress === 0): consume cycle inputs
    if (updatedLine.progress === 0 && process.cycleInputs.length > 0) {
      let canConsumeCycleInputs = true;
      for (const input of process.cycleInputs) {
        const needed = input.quantity * updatedLine.volume;
        const available = (getEntity(nextState, line.entityId)?.inventory[input.resource] ?? 0);
        if (available < needed) {
          canConsumeCycleInputs = false;
          break;
        }
      }

      if (!canConsumeCycleInputs) {
        // Line is starved at cycle start - don't advance progress
        updatedLines.push(updatedLine);
        continue;
      }

      // Consume cycle inputs
      for (const input of process.cycleInputs) {
        const consumed = removeFromInventory(nextState, line.entityId, input.resource, input.quantity * updatedLine.volume);
        if (consumed) {
          nextState = consumed;
        }
      }
    }

    // Consume tick inputs (every tick)
    if (process.tickInputs.length > 0) {
      let canConsumeTickInputs = true;
      for (const input of process.tickInputs) {
        const needed = input.quantity * updatedLine.volume;
        const available = (getEntity(nextState, line.entityId)?.inventory[input.resource] ?? 0);
        if (available < needed) {
          canConsumeTickInputs = false;
          break;
        }
      }

      if (!canConsumeTickInputs) {
        // Line is starved for tick inputs - don't advance progress
        updatedLines.push(updatedLine);
        continue;
      }

      // Consume tick inputs
      for (const input of process.tickInputs) {
        const consumed = removeFromInventory(nextState, line.entityId, input.resource, input.quantity * updatedLine.volume);
        if (consumed) {
          nextState = consumed;
        }
      }
    }

    // Advance progress
    updatedLine.progress += 1;

    // Check if cycle complete
    if (updatedLine.progress >= process.cycleTicks) {
      // Produce outputs (scaled by volume)
      for (const output of process.outputs) {
        nextState = addToInventory(nextState, line.entityId, output.resource, output.quantity * updatedLine.volume);
      }
      // Reset for next cycle
      updatedLine.progress = 0;
    }

    updatedLines.push(updatedLine);
  }

  return { ...nextState, processLines: updatedLines };
}

// ============================================================================
// PHASE 4: SELLING (RETAILERS)
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
// PHASE 5: SUPPLIER SELECTION
// ============================================================================

/**
 * Find the best supplier for a resource from an entity's suppliers list.
 * Uses available stock (inventory - committed) to avoid double-promising.
 * Returns the supplier with available stock, preferring closer ones.
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

  // Get all potential suppliers with their available stock and distance
  const candidates = supplierIds
    .map((id) => {
      const supplier = getEntity(state, id);
      if (!supplier) return null;
      const available = getAvailable(supplier, resource);
      const distance = getTransportTime(config, supplier.locationId, buyer.locationId);
      return { supplier, available, distance };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.available > 0);

  if (candidates.length === 0) {
    // No suppliers with stock, return any valid supplier (order will be declined)
    const firstSupplier = getEntity(state, supplierIds[0]);
    return firstSupplier ?? null;
  }

  // Sort by distance (prefer closer), then by available stock (prefer more)
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.available - a.available;
  });

  return candidates[0].supplier;
}

/**
 * Get all available suppliers for a resource with their details.
 * Uses available stock (inventory - committed).
 */
export function getSuppliersForResource(
  state: GameState,
  config: GameConfig,
  buyerEntityId: string,
  resource: string
): { entityId: string; entityName: string; availableStock: number; transportTime: number }[] {
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
        availableStock: getAvailable(supplier, resource),
        transportTime: getTransportTime(config, supplier.locationId, buyer.locationId),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

// ============================================================================
// PHASE 6: ORDER PLACEMENT (creates 'pending' orders)
// ============================================================================

/**
 * Place a pending order from buyer to a specific supplier.
 * Does NOT commit stock or create deliveries — that happens in the accept & depart phases.
 */
function placePendingOrder(
  state: GameState,
  config: GameConfig,
  buyerEntityId: string,
  resource: string,
  requestedQuantity: number,
  supplierId?: string
): GameState {
  const buyer = getEntity(state, buyerEntityId);
  if (!buyer) return state;

  // Find the seller
  let seller: Entity | null = null;
  if (supplierId) {
    const validSuppliers = buyer.suppliers[resource] ?? [];
    if (validSuppliers.includes(supplierId)) {
      seller = getEntity(state, supplierId) ?? null;
    }
  }

  // If seller id is provided (by the player), use it. Otherwise, find the best supplier.
  if (!seller) {
    seller = findBestSupplier(state, config, buyerEntityId, resource);
  }

  if (!seller) return state;

  // Create a pending order
  const orderId = nextId('order');
  const order: Order = {
    id: orderId,
    placedAtTick: state.tick,
    buyerEntityId,
    sellerEntityId: seller.id,
    resource,
    requestedQuantity,
    fulfilledQuantity: 0, // determined during acceptance
    wasAmended: false,
    status: 'pending',
  };

  return {
    ...state,
    orders: [...state.orders, order],
  };
}

// ============================================================================
// PHASE 7: ORDER ACCEPTANCE
// ============================================================================

/**
 * Sellers accept or decline pending orders.
 * Priority: shortest delivery time to buyer, then earliest placedAtTick.
 * Commits stock for accepted orders.
 */
function processOrderAcceptance(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const updatedOrders = [...nextState.orders];

  // Gather all pending orders
  const pendingIndices: number[] = [];
  for (let i = 0; i < updatedOrders.length; i++) {
    if (updatedOrders[i].status === 'pending') {
      pendingIndices.push(i);
    }
  }

  // Group pending orders by seller
  const ordersBySeller: Record<string, number[]> = {};
  for (const idx of pendingIndices) {
    const order = updatedOrders[idx];
    if (!ordersBySeller[order.sellerEntityId]) {
      ordersBySeller[order.sellerEntityId] = [];
    }
    ordersBySeller[order.sellerEntityId].push(idx);
  }

  // For each seller, sort and accept/decline
  for (const [sellerId, orderIndices] of Object.entries(ordersBySeller)) {
    const seller = getEntity(nextState, sellerId);
    if (!seller) {
      // Decline all orders for non-existent seller
      for (const idx of orderIndices) {
        updatedOrders[idx] = { ...updatedOrders[idx], status: 'declined' };
      }
      continue;
    }

    // Sort by: (1) shortest delivery time to buyer, (2) earliest placement
    const sortedIndices = [...orderIndices].sort((aIdx, bIdx) => {
      const a = updatedOrders[aIdx];
      const b = updatedOrders[bIdx];
      const buyerA = getEntity(nextState, a.buyerEntityId);
      const buyerB = getEntity(nextState, b.buyerEntityId);
      const timeA = buyerA ? getTransportTime(config, seller.locationId, buyerA.locationId) : Infinity;
      const timeB = buyerB ? getTransportTime(config, seller.locationId, buyerB.locationId) : Infinity;
      if (timeA !== timeB) return timeA - timeB;
      return a.placedAtTick - b.placedAtTick;
    });

    // Accept orders in priority order until stock runs out
    for (const idx of sortedIndices) {
      const order = updatedOrders[idx];
      const available = getAvailable(getEntity(nextState, sellerId)!, order.resource);

      if (available <= 0) {
        // No stock left — decline
        updatedOrders[idx] = { ...order, status: 'declined', fulfilledQuantity: 0 };
        continue;
      }

      const fulfilledQuantity = Math.min(order.requestedQuantity, available);
      const wasAmended = fulfilledQuantity < order.requestedQuantity;

      updatedOrders[idx] = {
        ...order,
        status: 'accepted',
        fulfilledQuantity,
        wasAmended,
      };

      // Commit stock
      nextState = addCommitted(nextState, sellerId, order.resource, fulfilledQuantity);
    }
  }

  return { ...nextState, orders: updatedOrders };
}

// ============================================================================
// PHASE 8: DEPARTURES
// ============================================================================

/**
 * Ship accepted orders: deduct from inventory and committed, create deliveries.
 */
function processDepartures(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const updatedOrders = [...nextState.orders];
  const newDeliveries = [...nextState.deliveries];

  for (let i = 0; i < updatedOrders.length; i++) {
    const order = updatedOrders[i];
    if (order.status !== 'accepted') continue;

    const seller = getEntity(nextState, order.sellerEntityId);
    const buyer = getEntity(nextState, order.buyerEntityId);
    if (!seller || !buyer || order.fulfilledQuantity <= 0) {
      updatedOrders[i] = { ...order, status: 'declined' };
      continue;
    }

    // Deduct from inventory
    const deducted = removeFromInventory(nextState, seller.id, order.resource, order.fulfilledQuantity);
    if (!deducted) {
      // Shouldn't happen if committed was correct, but handle gracefully
      updatedOrders[i] = { ...order, status: 'declined', fulfilledQuantity: 0 };
      continue;
    }
    nextState = deducted;

    // Remove from committed
    nextState = removeCommitted(nextState, seller.id, order.resource, order.fulfilledQuantity);

    // Get transport route
    const { totalTime, route } = getTransportRoute(config, seller.locationId, buyer.locationId);

    // Create delivery
    const delivery: Delivery = {
      id: nextId('delivery'),
      orderId: order.id,
      fromEntityId: seller.id,
      toEntityId: order.buyerEntityId,
      resource: order.resource,
      quantity: order.fulfilledQuantity,
      ticksRemaining: totalTime,
      route,
    };

    newDeliveries.push(delivery);

    // Update order status to in_transit
    updatedOrders[i] = { ...order, status: 'in_transit' };
  }

  return { ...nextState, orders: updatedOrders, deliveries: newDeliveries };
}

// ============================================================================
// AI LOGIC
// ============================================================================

/** Threshold below which AI orders more resources */
const AI_REORDER_THRESHOLD = 10;
/** How much AI tries to order at once */
const AI_ORDER_QUANTITY = 10;
/** Threshold above which mine pauses production */
const MINE_MAX_STOCK = 30;

/**
 * AI decisions:
 * - Start/stop process lines
 * - Place orders for needed resources
 */
function processAIDecisions(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const newLines: ProcessLine[] = [...nextState.processLines];

  for (const entity of nextState.entities) {
    if (entity.isPlayerControlled) continue;

    const entityType = getEntityType(config, entity);

    // --- Manage process lines ---
    const entityLines = newLines.filter((l) => l.entityId === entity.id);
    const availableSlots = entityType.maxProcessLines - entityLines.length;

    if (entityType.processes.length > 0) {
      const process = entityType.processes[0]; // For now, just use first process

      if (process.cycleInputs.length === 0 && process.tickInputs.length === 0) {
        // Mine-like entity: no inputs
        const outputResource = process.outputs[0]?.resource;
        const currentStock = entity.inventory[outputResource] ?? 0;

        if (currentStock >= MINE_MAX_STOCK) {
          // Stop all lines for this process if overproducing
          const linesToRemove = entityLines
            .filter((l) => l.processId === process.id)
            .map((l) => l.id);
          for (let i = newLines.length - 1; i >= 0; i--) {
            if (linesToRemove.includes(newLines[i].id)) {
              newLines.splice(i, 1);
            }
          }
        } else if (!entityLines.some((l) => l.processId === process.id) && availableSlots > 0) {
          // Start a line if none running
          newLines.push({
            id: nextId('line'),
            processId: process.id,
            entityId: entity.id,
            phase: process.startupTicks > 0 ? 'starting' : 'running',
            startupTicksRemaining: process.startupTicks,
            progress: 0,
            volume: process.minVolume,
          });
        }
      } else {
        // Normal production: start line if we don't have one and have inputs
        if (!entityLines.some((l) => l.processId === process.id) && availableSlots > 0) {
          // Check if we have cycle inputs to start
          let hasInputs = true;
          for (const input of process.cycleInputs) {
            if ((entity.inventory[input.resource] ?? 0) < input.quantity * process.minVolume) {
              hasInputs = false;
              break;
            }
          }
          for (const input of process.tickInputs) {
            if ((entity.inventory[input.resource] ?? 0) < input.quantity * process.minVolume) {
              hasInputs = false;
              break;
            }
          }

          if (hasInputs) {
            newLines.push({
              id: nextId('line'),
              processId: process.id,
              entityId: entity.id,
              phase: process.startupTicks > 0 ? 'starting' : 'running',
              startupTicksRemaining: process.startupTicks,
              progress: 0,
              volume: process.minVolume,
            });
          }
        }
      }
    }

    // --- Order resources if running low ---
    const neededResources: string[] = [];

    // Check process inputs
    for (const process of entityType.processes) {
      for (const input of process.cycleInputs) {
        if (!neededResources.includes(input.resource)) {
          neededResources.push(input.resource);
        }
      }
      for (const input of process.tickInputs) {
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
      if (supplierIds.length === 0) continue;

      const currentStock = entity.inventory[neededResource] ?? 0;

      if (currentStock < AI_REORDER_THRESHOLD) {
        nextState = placePendingOrder(nextState, config, entity.id, neededResource, AI_ORDER_QUANTITY);
      }
    }
  }

  return { ...nextState, processLines: newLines };
}

// ============================================================================
// PLAYER ORDERS
// ============================================================================

function processPlayerOrder(state: GameState, config: GameConfig, playerAction: PlayerOrder): GameState {
  const entity = getEntity(state, playerAction.entityId);
  if (!entity || !entity.isPlayerControlled) return state;

  let nextState = state;

  if (playerAction.action === 'start_line') {
    // Start a new process line
    const entityType = getEntityType(config, entity);
    const process = getProcess(entityType, playerAction.targetId);
    const newLines = [...nextState.processLines];

    // Check capacity
    const entityLines = newLines.filter((l) => l.entityId === entity.id);
    if (entityLines.length >= entityType.maxProcessLines) {
      return state; // At capacity
    }

    const volume = Math.max(process.minVolume, Math.min(process.maxVolume, playerAction.quantity || process.minVolume));

    newLines.push({
      id: nextId('line'),
      processId: process.id,
      entityId: entity.id,
      phase: process.startupTicks > 0 ? 'starting' : 'running',
      startupTicksRemaining: process.startupTicks,
      progress: 0,
      volume,
    });

    nextState = { ...nextState, processLines: newLines };
  } else if (playerAction.action === 'stop_line') {
    // Stop a specific process line
    const lineId = playerAction.lineId ?? playerAction.targetId;
    nextState = {
      ...nextState,
      processLines: nextState.processLines.filter((l) => l.id !== lineId),
    };
  } else if (playerAction.action === 'order') {
    // Place a pending order
    const resource = playerAction.targetId;
    const supplierIds = entity.suppliers[resource] ?? [];

    if (supplierIds.length > 0) {
      nextState = placePendingOrder(
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

  // 2. ARRIVALS — complete finished deliveries
  next = processArrivals(next);

  // 3. Advance demand phase
  next = advanceDemandPhase(next, config);

  // 4. Process production lines (startup, progress, cycle completion)
  next = processProductionLines(next, config);

  // 5. Sell (retailers)
  next = processSelling(next, config);

  // 6a. Process player action if provided
  if (playerAction) {
    next = processPlayerOrder(next, config, playerAction);
  }

  // 6b. Process AI decisions (start/stop lines, place orders)
  next = processAIDecisions(next, config);

  // 7. Accept/decline pending orders (commit stock)
  next = processOrderAcceptance(next, config);

  // 8. DEPARTURES — ship accepted orders, create deliveries
  next = processDepartures(next, config);

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

/** Get process lines for a specific entity */
export function getProcessLinesForEntity(state: GameState, entityId: string): ProcessLine[] {
  return state.processLines.filter((l) => l.entityId === entityId);
}
