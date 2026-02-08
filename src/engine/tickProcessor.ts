/**
 * Core tick processor for the supply chain simulation.
 *
 * Each tick (in order):
 * 1. Increment tick counter
 * 2. ARRIVALS — Complete deliveries with ticksRemaining <= 0 (add stock to buyers)
 * 3. Advance demand phases (per-location)
 * 4. Process production lines (startup, progress, cycle completion)
 * 5. Retail selling (entities with retail processes sell to consumers)
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
  ResourceSalesStats,
} from '../types/game';
import {
  getGameConfig,
  getTransportTime,
  getTransportRoute,
  getEntityType,
  getProductionProcess,
  getLocation,
} from './configLoader';
import { decideProduction, decideProcurement } from './ai';
import { sortOrdersByPriority, decideOrderFulfillment } from './ai';

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

function processArrivals(state: GameState): GameState {
  let nextState = state;
  const stillActive: Delivery[] = [];
  const updatedOrders = [...nextState.orders];

  for (const delivery of state.deliveries) {
    if (delivery.ticksRemaining <= 0) {
      nextState = addToInventory(nextState, delivery.toEntityId, delivery.resource, delivery.quantity);

      const orderIndex = updatedOrders.findIndex((o) => o.id === delivery.orderId);
      if (orderIndex !== -1) {
        updatedOrders[orderIndex] = {
          ...updatedOrders[orderIndex],
          status: 'delivered',
          deliveredAtTick: nextState.tick,
        };
      }
    } else {
      stillActive.push({ ...delivery, ticksRemaining: delivery.ticksRemaining - 1 });
    }
  }

  return { ...nextState, deliveries: stillActive, orders: updatedOrders };
}

// ============================================================================
// PHASE 2: DEMAND PHASES (per-location)
// ============================================================================

/**
 * Advance each location's demand phase independently.
 */
function advanceDemandPhases(state: GameState, config: GameConfig): GameState {
  const updatedPhases: Record<string, DemandPhaseState> = {};

  for (const location of config.locations) {
    const hasDemand = Object.values(location.demand).some((d) => d > 0);
    if (!hasDemand || !location.demandCycle) continue;

    const current = state.demandPhases[location.id] ?? { phaseIndex: 0, ticksInPhase: 0 };
    const cycle = location.demandCycle;
    const currentPhase = cycle.phases[current.phaseIndex];

    let newPhaseState: DemandPhaseState = {
      phaseIndex: current.phaseIndex,
      ticksInPhase: current.ticksInPhase + 1,
    };

    if (newPhaseState.ticksInPhase >= currentPhase.ticks) {
      newPhaseState = {
        phaseIndex: (current.phaseIndex + 1) % cycle.phases.length,
        ticksInPhase: 0,
      };
    }

    updatedPhases[location.id] = newPhaseState;
  }

  return { ...state, demandPhases: { ...state.demandPhases, ...updatedPhases } };
}

/**
 * Get demand for a specific resource at a specific location.
 */
function getCurrentDemand(state: GameState, config: GameConfig, locationId: string, resource: string): number {
  const location = getLocation(config, locationId);
  const baseDemand = location.demand[resource] ?? 0;
  if (baseDemand === 0) return 0;

  if (!location.demandCycle) return baseDemand;

  const phaseState = state.demandPhases[locationId];
  if (!phaseState) return baseDemand;

  const phase = location.demandCycle.phases[phaseState.phaseIndex];
  if (!phase) return baseDemand;

  const demand = baseDemand * phase.multiplier;
  const variance = location.demandCycle.variance;
  const randomFactor = 1 + (Math.random() * 2 - 1) * variance;

  return Math.max(0, Math.floor(demand * randomFactor));
}

/**
 * Get the current demand phase name for a location.
 */
export function getLocationPhaseName(state: GameState, config: GameConfig, locationId: string): string | null {
  const location = getLocation(config, locationId);
  if (!location.demandCycle) return null;
  const phaseState = state.demandPhases[locationId];
  if (!phaseState) return null;
  return location.demandCycle.phases[phaseState.phaseIndex]?.name ?? null;
}

/**
 * Get demand phase progress for a location.
 */
export function getLocationPhaseProgress(
  state: GameState,
  config: GameConfig,
  locationId: string,
): { current: number; total: number } | null {
  const location = getLocation(config, locationId);
  if (!location.demandCycle) return null;
  const phaseState = state.demandPhases[locationId];
  if (!phaseState) return null;
  const phase = location.demandCycle.phases[phaseState.phaseIndex];
  if (!phase) return null;
  return { current: phaseState.ticksInPhase, total: phase.ticks };
}

// ============================================================================
// PHASE 3: PROCESS LINES (CONTINUOUS PRODUCTION)
// ============================================================================

/**
 * Advance all active process lines.
 * - Starting lines: consume startup inputs (fixed, not scaled), decrement startup ticks.
 * - Running lines: consume tick inputs, advance progress, produce on cycle completion.
 */
function processProductionLines(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const updatedLines: ProcessLine[] = [];

  for (const line of nextState.processLines) {
    const entity = getEntity(nextState, line.entityId);
    if (!entity) continue;

    const process = getProductionProcess(config, line.processId);
    let updatedLine = { ...line };

    // --- STARTUP PHASE ---
    if (updatedLine.phase === 'starting') {
      // On first tick of startup (full startupTicks remaining), consume startup inputs (NOT scaled)
      if (updatedLine.startupTicksRemaining === process.startupTicks && process.startupInputs.length > 0) {
        let canConsumeStartup = true;
        for (const input of process.startupInputs) {
          const available = getEntity(nextState, line.entityId)?.inventory[input.resource] ?? 0;
          if (available < input.quantity) {
            canConsumeStartup = false;
            break;
          }
        }

        if (!canConsumeStartup) {
          // Can't start — keep line waiting but don't progress
          updatedLines.push(updatedLine);
          continue;
        }

        // Consume startup inputs (fixed quantity, NOT scaled by volume)
        for (const input of process.startupInputs) {
          const consumed = removeFromInventory(nextState, line.entityId, input.resource, input.quantity);
          if (consumed) nextState = consumed;
        }
      }

      updatedLine.startupTicksRemaining -= 1;
      if (updatedLine.startupTicksRemaining <= 0) {
        updatedLine.phase = 'running';
        updatedLine.progress = 0;
      }
      updatedLines.push(updatedLine);
      continue;
    }

    // --- RUNNING PHASE ---

    // At the start of a new cycle (progress === 0): consume cycle inputs (scaled by volume)
    if (updatedLine.progress === 0 && process.cycleInputs.length > 0) {
      let canConsumeCycleInputs = true;
      for (const input of process.cycleInputs) {
        const needed = input.quantity * updatedLine.volume;
        const available = getEntity(nextState, line.entityId)?.inventory[input.resource] ?? 0;
        if (available < needed) {
          canConsumeCycleInputs = false;
          break;
        }
      }

      if (!canConsumeCycleInputs) {
        updatedLines.push(updatedLine);
        continue;
      }

      for (const input of process.cycleInputs) {
        const consumed = removeFromInventory(nextState, line.entityId, input.resource, input.quantity * updatedLine.volume);
        if (consumed) nextState = consumed;
      }
    }

    // Consume tick inputs (every tick, scaled by volume)
    if (process.tickInputs.length > 0) {
      let canConsumeTickInputs = true;
      for (const input of process.tickInputs) {
        const needed = input.quantity * updatedLine.volume;
        const available = getEntity(nextState, line.entityId)?.inventory[input.resource] ?? 0;
        if (available < needed) {
          canConsumeTickInputs = false;
          break;
        }
      }

      if (!canConsumeTickInputs) {
        updatedLines.push(updatedLine);
        continue;
      }

      for (const input of process.tickInputs) {
        const consumed = removeFromInventory(nextState, line.entityId, input.resource, input.quantity * updatedLine.volume);
        if (consumed) nextState = consumed;
      }
    }

    // Advance progress
    updatedLine.progress += 1;

    // Check if cycle complete
    if (updatedLine.progress >= process.cycleTicks) {
      for (const output of process.outputs) {
        nextState = addToInventory(nextState, line.entityId, output.resource, output.quantity * updatedLine.volume);
      }
      updatedLine.progress = 0;
    }

    updatedLines.push(updatedLine);
  }

  return { ...nextState, processLines: updatedLines };
}

// ============================================================================
// PHASE 4: RETAIL SELLING
// ============================================================================

/**
 * Process retail sales for entities with retail processes.
 * Uses per-resource, per-location demand from config.
 */
function processRetailSelling(state: GameState, config: GameConfig): GameState {
  let nextState = state;

  for (const entity of nextState.entities) {
    const entityType = getEntityType(config, entity);

    // Only entities with retail processes sell to consumers
    if (entityType.processes.retail.length === 0) continue;

    for (const retailProcessId of entityType.processes.retail) {
      const retailProcess = config.processes.retail.find((p) => p.id === retailProcessId);
      if (!retailProcess) continue;

      const resource = retailProcess.resource;
      const demand = getCurrentDemand(nextState, config, entity.locationId, resource);
      const stock = entity.inventory[resource] ?? 0;
      const available = getAvailable(entity, resource);
      const canSell = Math.min(available, stock);
      const sold = Math.min(canSell, demand);
      const lostSales = Math.max(0, demand - sold);

      if (sold > 0) {
        nextState = removeFromInventory(nextState, entity.id, resource, sold) ?? nextState;
      }

      // Update per-entity, per-resource sales stats
      const entitySales = nextState.sales[entity.id] ?? {};
      const currentStats: ResourceSalesStats = entitySales[resource] ?? { totalSold: 0, totalDemand: 0, lostSales: 0 };

      nextState = {
        ...nextState,
        sales: {
          ...nextState.sales,
          [entity.id]: {
            ...entitySales,
            [resource]: {
              totalSold: currentStats.totalSold + sold,
              totalDemand: currentStats.totalDemand + demand,
              lostSales: currentStats.lostSales + lostSales,
            },
          },
        },
      };
    }
  }

  return nextState;
}

// ============================================================================
// PHASE 5: SUPPLIER SELECTION
// ============================================================================

/**
 * Find the best supplier for a resource from an entity's suppliers list.
 * Uses available stock (inventory - committed) to avoid double-promising.
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
    const firstSupplier = getEntity(state, supplierIds[0]);
    return firstSupplier ?? null;
  }

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.available - a.available;
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
// PHASE 6: ORDER PLACEMENT
// ============================================================================

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

  let seller: Entity | null = null;
  if (supplierId) {
    const validSuppliers = buyer.suppliers[resource] ?? [];
    if (validSuppliers.includes(supplierId)) {
      seller = getEntity(state, supplierId) ?? null;
    }
  }

  if (!seller) {
    seller = findBestSupplier(state, config, buyerEntityId, resource);
  }

  if (!seller) return state;

  const orderId = nextId('order');
  const order: Order = {
    id: orderId,
    placedAtTick: state.tick,
    buyerEntityId,
    sellerEntityId: seller.id,
    resource,
    requestedQuantity,
    fulfilledQuantity: 0,
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

function processOrderAcceptance(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const updatedOrders = [...nextState.orders];

  // Gather pending orders
  const pendingIndices: number[] = [];
  for (let i = 0; i < updatedOrders.length; i++) {
    if (updatedOrders[i].status === 'pending') {
      pendingIndices.push(i);
    }
  }

  // Group by seller
  const ordersBySeller: Record<string, number[]> = {};
  for (const idx of pendingIndices) {
    const order = updatedOrders[idx];
    if (!ordersBySeller[order.sellerEntityId]) {
      ordersBySeller[order.sellerEntityId] = [];
    }
    ordersBySeller[order.sellerEntityId].push(idx);
  }

  // For each seller, use fulfillment AI to sort and accept/decline
  for (const [sellerId, orderIndices] of Object.entries(ordersBySeller)) {
    const seller = getEntity(nextState, sellerId);
    if (!seller) {
      for (const idx of orderIndices) {
        updatedOrders[idx] = { ...updatedOrders[idx], status: 'declined' };
      }
      continue;
    }

    // Use fulfillment AI to determine priority
    const sortedIndices = sortOrdersByPriority(seller, orderIndices, updatedOrders, nextState, config);

    // Accept orders in priority order until stock runs out
    for (const idx of sortedIndices) {
      const order = updatedOrders[idx];
      const available = getAvailable(getEntity(nextState, sellerId)!, order.resource);

      const fulfilledQuantity = decideOrderFulfillment(seller, order, available, order.requestedQuantity);

      if (fulfilledQuantity <= 0) {
        updatedOrders[idx] = { ...order, status: 'declined', fulfilledQuantity: 0 };
        continue;
      }

      const wasAmended = fulfilledQuantity < order.requestedQuantity;
      updatedOrders[idx] = {
        ...order,
        status: 'accepted',
        fulfilledQuantity,
        wasAmended,
      };

      nextState = addCommitted(nextState, sellerId, order.resource, fulfilledQuantity);
    }
  }

  return { ...nextState, orders: updatedOrders };
}

// ============================================================================
// PHASE 8: DEPARTURES
// ============================================================================

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

    const deducted = removeFromInventory(nextState, seller.id, order.resource, order.fulfilledQuantity);
    if (!deducted) {
      updatedOrders[i] = { ...order, status: 'declined', fulfilledQuantity: 0 };
      continue;
    }
    nextState = deducted;

    nextState = removeCommitted(nextState, seller.id, order.resource, order.fulfilledQuantity);

    const { totalTime, route } = getTransportRoute(config, seller.locationId, buyer.locationId);

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
    updatedOrders[i] = { ...order, status: 'in_transit' };
  }

  return { ...nextState, orders: updatedOrders, deliveries: newDeliveries };
}

// ============================================================================
// AI DECISIONS (delegates to AI modules)
// ============================================================================

function processAIDecisions(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const newLines: ProcessLine[] = [...nextState.processLines];

  for (const entity of nextState.entities) {
    if (entity.isPlayerControlled) continue;

    const entityType = getEntityType(config, entity);
    const entityLines = newLines.filter((l) => l.entityId === entity.id);

    // --- Production decisions ---
    if (entityType.processes.production.length > 0) {
      const prodDecision = decideProduction(entity, entityType, entityLines, nextState, config);

      // Stop lines
      for (const lineId of prodDecision.linesToStop) {
        const idx = newLines.findIndex((l) => l.id === lineId);
        if (idx !== -1) newLines.splice(idx, 1);
      }

      // Start lines
      for (const toStart of prodDecision.linesToStart) {
        const currentCount = newLines.filter((l) => l.entityId === entity.id).length;
        if (currentCount >= entityType.maxProcessLines) break;

        const process = getProductionProcess(config, toStart.processId);
        newLines.push({
          id: nextId('line'),
          processId: toStart.processId,
          entityId: entity.id,
          phase: process.startupTicks > 0 ? 'starting' : 'running',
          startupTicksRemaining: process.startupTicks,
          progress: 0,
          volume: toStart.volume,
        });
      }
    }

    // --- Procurement decisions ---
    if (entityType.processes.procurement.length > 0) {
      const procDecision = decideProcurement(entity, entityType, nextState, config);

      for (const order of procDecision.orders) {
        nextState = placePendingOrder(
          nextState,
          config,
          entity.id,
          order.resource,
          order.quantity,
          order.supplierId,
        );
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
    const process = getProductionProcess(config, playerAction.targetId);
    const newLines = [...nextState.processLines];

    const entityType = getEntityType(config, entity);
    const entityLines = newLines.filter((l) => l.entityId === entity.id);
    if (entityLines.length >= entityType.maxProcessLines) {
      return state;
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
    const lineId = playerAction.lineId ?? playerAction.targetId;
    nextState = {
      ...nextState,
      processLines: nextState.processLines.filter((l) => l.id !== lineId),
    };
  } else if (playerAction.action === 'order') {
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

  // 3. Advance demand phases (per-location)
  next = advanceDemandPhases(next, config);

  // 4. Process production lines (startup, progress, cycle completion)
  next = processProductionLines(next, config);

  // 5. Retail selling
  next = processRetailSelling(next, config);

  // 6a. Process player action if provided
  if (playerAction) {
    next = processPlayerOrder(next, config, playerAction);
  }

  // 6b. Process AI decisions (production + procurement)
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

export { getGameConfig, getTransportTime, getEntityType, getProductionProcess, getLocation };

export function getOrdersForEntity(state: GameState, entityId: string): Order[] {
  return state.orders.filter(
    (o) => o.buyerEntityId === entityId || o.sellerEntityId === entityId
  );
}

export function getDeliveriesForEntity(state: GameState, entityId: string): {
  incoming: Delivery[];
  outgoing: Delivery[];
} {
  return {
    incoming: state.deliveries.filter((d) => d.toEntityId === entityId),
    outgoing: state.deliveries.filter((d) => d.fromEntityId === entityId),
  };
}

export function getEntityName(state: GameState, entityId: string): string {
  return state.entities.find((e) => e.id === entityId)?.name ?? entityId;
}

export function getProcessLinesForEntity(state: GameState, entityId: string): ProcessLine[] {
  return state.processLines.filter((l) => l.entityId === entityId);
}
