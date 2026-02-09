/**
 * Core tick processor for the supply chain simulation.
 *
 * Each tick (in order):
 *  1. Increment tick counter
 *  2. ARRIVALS — Complete deliveries (add stock, transfer payment buyer -> seller)
 *  3. Advance demand phases (per-location)
 *  4. Process production lines (startup, progress, cycle completion)
 *  5. Retail selling (entities with retail processes sell to consumers, earn revenue)
 *  6. Storage costs (deduct per-unit inventory costs from each entity)
 *  7. Entity decisions — AI starts/stops lines, AI/player place orders
 *  8. Contract management — AI proposes contracts, mature proposals evaluated, due deliveries processed
 *  9. ACCEPT ORDERS — Sellers accept/decline pending orders (commit stock, pricing check)
 * 10. DEPARTURES — Accepted orders ship: deduct inventory & committed, create deliveries
 * 11. Contract status update — check completion & cancellation
 */

import type {
  Entity,
  GameState,
  ProcessLine,
  Delivery,
  Order,
  Contract,
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
  getBasePrice,
  getRetailPrice,
} from './configLoader';
import { decideProduction, decideProcurement, proposeContracts, evaluateContractProposals } from './ai';
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
  return { ...state, entities: state.entities.map((e) => (e.id === id ? updater(e) : e)) };
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

function getAvailable(entity: Entity, resource: string): number {
  return (entity.inventory[resource] ?? 0) - (entity.committed[resource] ?? 0);
}

function addCommitted(state: GameState, entityId: string, resource: string, quantity: number): GameState {
  const entity = getEntity(state, entityId);
  if (!entity) return state;
  const current = entity.committed[resource] ?? 0;
  return updateEntity(state, entityId, (e) => ({
    ...e,
    committed: { ...e.committed, [resource]: current + quantity },
  }));
}

function removeCommitted(state: GameState, entityId: string, resource: string, quantity: number): GameState {
  const entity = getEntity(state, entityId);
  if (!entity) return state;
  const current = entity.committed[resource] ?? 0;
  const newValue = Math.max(0, current - quantity);
  const newCommitted: Inventory = { ...entity.committed, [resource]: newValue };
  if (newValue === 0) delete newCommitted[resource];
  return updateEntity(state, entityId, (e) => ({ ...e, committed: newCommitted }));
}

/** Transfer money from one entity to another */
function transferMoney(state: GameState, fromEntityId: string, toEntityId: string, amount: number): GameState {
  if (amount <= 0) return state;

  let nextState = state;
  const from = getEntity(nextState, fromEntityId);
  const to = getEntity(nextState, toEntityId);
  if (!from || !to) return state;

  nextState = updateEntity(nextState, fromEntityId, (e) => ({ ...e, money: e.money - amount }));
  nextState = updateEntity(nextState, toEntityId, (e) => ({ ...e, money: e.money + amount }));

  // Log if sender goes negative
  const updatedFrom = getEntity(nextState, fromEntityId);
  if (updatedFrom && updatedFrom.money < 0) {
    console.warn(`[Money] ${updatedFrom.name} has negative balance: $${updatedFrom.money.toFixed(2)}`);
  }

  return nextState;
}

/** Deduct money from an entity (for costs) */
function deductMoney(state: GameState, entityId: string, amount: number): GameState {
  if (amount <= 0) return state;
  let nextState = updateEntity(state, entityId, (e) => ({ ...e, money: e.money - amount }));
  const entity = getEntity(nextState, entityId);
  if (entity && entity.money < 0) {
    console.warn(`[Money] ${entity.name} has negative balance: $${entity.money.toFixed(2)}`);
  }
  return nextState;
}

/** Add money to an entity (for revenue) */
function addMoney(state: GameState, entityId: string, amount: number): GameState {
  if (amount <= 0) return state;
  return updateEntity(state, entityId, (e) => ({ ...e, money: e.money + amount }));
}

// ============================================================================
// PHASE 2: ARRIVALS (with money transfer)
// ============================================================================

function processArrivals(state: GameState): GameState {
  let nextState = state;
  const stillActive: Delivery[] = [];
  const updatedOrders = [...nextState.orders];

  for (const delivery of state.deliveries) {
    if (delivery.ticksRemaining <= 0) {
      // Add stock to buyer
      nextState = addToInventory(nextState, delivery.toEntityId, delivery.resource, delivery.quantity);

      // Transfer payment: buyer pays seller
      const paymentAmount = delivery.quantity * delivery.pricePerUnit;
      if (paymentAmount > 0) {
        nextState = transferMoney(nextState, delivery.toEntityId, delivery.fromEntityId, paymentAmount);
      }

      // Update order status
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
// PHASE 3: DEMAND PHASES (per-location)
// ============================================================================

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

export function getLocationPhaseName(state: GameState, config: GameConfig, locationId: string): string | null {
  const location = getLocation(config, locationId);
  if (!location.demandCycle) return null;
  const phaseState = state.demandPhases[locationId];
  if (!phaseState) return null;
  return location.demandCycle.phases[phaseState.phaseIndex]?.name ?? null;
}

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
// PHASE 4: PROCESS LINES (CONTINUOUS PRODUCTION)
// ============================================================================

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
          updatedLines.push(updatedLine);
          continue;
        }
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

    updatedLine.progress += 1;

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
// PHASE 5: RETAIL SELLING (with revenue)
// ============================================================================

function processRetailSelling(state: GameState, config: GameConfig): GameState {
  let nextState = state;

  for (const entity of nextState.entities) {
    const entityType = getEntityType(config, entity);
    if (entityType.processes.retail.length === 0) continue;

    for (const retailProcessId of entityType.processes.retail) {
      const retailProcess = config.processes.retail.find((p) => p.id === retailProcessId);
      if (!retailProcess) continue;

      const resource = retailProcess.resource;
      const demand = getCurrentDemand(nextState, config, entity.locationId, resource);
      const available = getAvailable(entity, resource);
      const sold = Math.min(available, demand);
      const lostSales = Math.max(0, demand - sold);

      if (sold > 0) {
        nextState = removeFromInventory(nextState, entity.id, resource, sold) ?? nextState;

        // Retailer earns revenue at retail price
        const revenue = sold * getRetailPrice(config, resource);
        nextState = addMoney(nextState, entity.id, revenue);
      }

      // Update sales stats
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
// PHASE 6: STORAGE COSTS
// ============================================================================

function processStorageCosts(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const costPerUnit = config.pricing.storageCostPerUnit;
  if (costPerUnit <= 0) return nextState;

  for (const entity of nextState.entities) {
    let totalUnits = 0;
    for (const qty of Object.values(entity.inventory)) {
      totalUnits += qty;
    }
    if (totalUnits > 0) {
      const cost = totalUnits * costPerUnit;
      nextState = deductMoney(nextState, entity.id, cost);
    }
  }

  return nextState;
}

// ============================================================================
// PHASE 7: SUPPLIER SELECTION
// ============================================================================

function findBestSupplier(
  state: GameState,
  config: GameConfig,
  buyerEntityId: string,
  resource: string,
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
    const firstSupplier = supplierIds.length > 0 ? getEntity(state, supplierIds[0]) : null;
    return firstSupplier ?? null;
  }

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.available - a.available;
  });

  return candidates[0].supplier;
}

export function getSuppliersForResource(
  state: GameState,
  config: GameConfig,
  buyerEntityId: string,
  resource: string,
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
// ORDER PLACEMENT
// ============================================================================

function placePendingOrder(
  state: GameState,
  config: GameConfig,
  buyerEntityId: string,
  resource: string,
  requestedQuantity: number,
  pricePerUnit: number,
  supplierId?: string,
  contractId?: string,
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

  const order: Order = {
    id: nextId('order'),
    placedAtTick: state.tick,
    buyerEntityId,
    sellerEntityId: seller.id,
    resource,
    requestedQuantity,
    fulfilledQuantity: 0,
    wasAmended: false,
    status: 'pending',
    pricePerUnit,
    contractId,
  };

  return { ...state, orders: [...state.orders, order] };
}

// ============================================================================
// ORDER ACCEPTANCE (with pricing)
// ============================================================================

function processOrderAcceptance(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  const updatedOrders = [...nextState.orders];

  const pendingIndices: number[] = [];
  for (let i = 0; i < updatedOrders.length; i++) {
    if (updatedOrders[i].status === 'pending') pendingIndices.push(i);
  }

  const ordersBySeller: Record<string, number[]> = {};
  for (const idx of pendingIndices) {
    const order = updatedOrders[idx];
    if (!ordersBySeller[order.sellerEntityId]) ordersBySeller[order.sellerEntityId] = [];
    ordersBySeller[order.sellerEntityId].push(idx);
  }

  for (const [sellerId, orderIndices] of Object.entries(ordersBySeller)) {
    const seller = getEntity(nextState, sellerId);
    if (!seller) {
      for (const idx of orderIndices) {
        updatedOrders[idx] = { ...updatedOrders[idx], status: 'declined' };
      }
      continue;
    }

    const sortedIndices = sortOrdersByPriority(seller, orderIndices, updatedOrders, nextState, config);

    for (const idx of sortedIndices) {
      const order = updatedOrders[idx];
      const available = getAvailable(getEntity(nextState, sellerId)!, order.resource);
      const fulfilledQuantity = decideOrderFulfillment(seller, order, available, order.requestedQuantity, config);

      if (fulfilledQuantity <= 0) {
        updatedOrders[idx] = { ...order, status: 'declined', fulfilledQuantity: 0 };
        continue;
      }

      const wasAmended = fulfilledQuantity < order.requestedQuantity;
      updatedOrders[idx] = { ...order, status: 'accepted', fulfilledQuantity, wasAmended };
      nextState = addCommitted(nextState, sellerId, order.resource, fulfilledQuantity);
    }
  }

  return { ...nextState, orders: updatedOrders };
}

// ============================================================================
// DEPARTURES
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
      pricePerUnit: order.pricePerUnit,
    };

    newDeliveries.push(delivery);
    updatedOrders[i] = { ...order, status: 'in_transit' };
  }

  return { ...nextState, orders: updatedOrders, deliveries: newDeliveries };
}

// ============================================================================
// AI DECISIONS (production + procurement spot orders)
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

      for (const lineId of prodDecision.linesToStop) {
        const idx = newLines.findIndex((l) => l.id === lineId);
        if (idx !== -1) newLines.splice(idx, 1);
      }

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

    // --- Procurement spot orders ---
    if (entityType.processes.procurement.length > 0) {
      const procDecision = decideProcurement(entity, entityType, nextState, config);

      for (const order of procDecision.orders) {
        nextState = placePendingOrder(
          nextState,
          config,
          entity.id,
          order.resource,
          order.quantity,
          order.pricePerUnit,
          order.supplierId,
        );
      }
    }
  }

  return { ...nextState, processLines: newLines };
}

// ============================================================================
// CONTRACT MANAGEMENT
// ============================================================================

/**
 * Phase 8: Contract management
 * - AI entities propose new contracts
 * - Evaluate mature proposals (seller accepts/declines)
 * - Process due deliveries from active contracts
 */
function processContractManagement(state: GameState, config: GameConfig): GameState {
  let nextState = state;
  let updatedContracts = [...nextState.contracts];

  // --- 8a: AI entities propose new contracts ---
  for (const entity of nextState.entities) {
    if (entity.isPlayerControlled) continue;

    const entityType = getEntityType(config, entity);
    if (entityType.processes.procurement.length === 0) continue;

    const proposalDecision = proposeContracts(entity, entityType, nextState, config);

    for (const proposal of proposalDecision.proposals) {
      const penaltyPerUnit = proposal.pricePerUnit * config.contractDefaultPenaltyRate;

      const contract: Contract = {
        id: nextId('contract'),
        buyerEntityId: entity.id,
        sellerEntityId: proposal.supplierId,
        resource: proposal.resource,
        pricePerUnit: proposal.pricePerUnit,
        unitsPerDelivery: proposal.unitsPerDelivery,
        deliveryInterval: proposal.deliveryInterval,
        totalUnits: proposal.totalUnits,
        unitsShipped: 0,
        unitsMissed: 0,
        penaltyPerUnit,
        cancellationThreshold: config.contractDefaultCancellationThreshold,
        proposedAtTick: nextState.tick,
        nextDeliveryTick: 0, // Will be set when accepted
        status: 'proposed',
      };

      updatedContracts.push(contract);
    }
  }

  nextState = { ...nextState, contracts: updatedContracts };

  // --- 8b: Sellers evaluate mature proposals ---
  const matureTick = nextState.tick - config.contractWaitTicks;

  // Group mature proposals by seller
  const proposalsBySeller = new Map<string, Contract[]>();
  for (const contract of updatedContracts) {
    if (contract.status !== 'proposed') continue;
    if (contract.proposedAtTick > matureTick) continue; // Not mature yet

    const existing = proposalsBySeller.get(contract.sellerEntityId) ?? [];
    existing.push(contract);
    proposalsBySeller.set(contract.sellerEntityId, existing);
  }

  for (const [sellerId, proposals] of proposalsBySeller) {
    const seller = getEntity(nextState, sellerId);
    if (!seller) {
      // No seller, decline all
      for (const p of proposals) {
        const idx = updatedContracts.findIndex((c) => c.id === p.id);
        if (idx !== -1) updatedContracts[idx] = { ...updatedContracts[idx], status: 'cancelled' };
      }
      continue;
    }

    // Skip evaluation for player-controlled sellers — they must manually accept
    if (seller.isPlayerControlled) continue;

    const entityType = getEntityType(config, seller);
    const evalResult = evaluateContractProposals(seller, entityType, proposals, nextState, config);

    for (const contractId of evalResult.accept) {
      const idx = updatedContracts.findIndex((c) => c.id === contractId);
      if (idx !== -1) {
        updatedContracts[idx] = {
          ...updatedContracts[idx],
          status: 'active',
          acceptedAtTick: nextState.tick,
          nextDeliveryTick: nextState.tick + updatedContracts[idx].deliveryInterval,
        };
      }
    }

    for (const contractId of evalResult.decline) {
      const idx = updatedContracts.findIndex((c) => c.id === contractId);
      if (idx !== -1) {
        updatedContracts[idx] = { ...updatedContracts[idx], status: 'cancelled' };
      }
    }
  }

  nextState = { ...nextState, contracts: updatedContracts };

  // --- 8c: Process due deliveries from active contracts ---
  for (let i = 0; i < updatedContracts.length; i++) {
    const contract = updatedContracts[i];
    if (contract.status !== 'active') continue;
    if (contract.nextDeliveryTick > nextState.tick) continue;

    const seller = getEntity(nextState, contract.sellerEntityId);
    if (!seller) {
      // Seller gone — cancel contract
      updatedContracts[i] = { ...contract, status: 'cancelled' };
      continue;
    }

    const available = getAvailable(seller, contract.resource);
    const deliveryQty = Math.min(contract.unitsPerDelivery, contract.totalUnits - contract.unitsShipped - contract.unitsMissed);

    if (deliveryQty <= 0) {
      // Contract fully processed
      updatedContracts[i] = { ...contract, status: 'completed' };
      continue;
    }

    if (available >= deliveryQty) {
      // Seller has stock — create an auto-accepted order for this contract delivery
      nextState = placePendingOrder(
        nextState,
        config,
        contract.buyerEntityId,
        contract.resource,
        deliveryQty,
        contract.pricePerUnit,
        contract.sellerEntityId,
        contract.id,
      );

      updatedContracts[i] = {
        ...contract,
        unitsShipped: contract.unitsShipped + deliveryQty,
        nextDeliveryTick: contract.nextDeliveryTick + contract.deliveryInterval,
      };
    } else {
      // Seller cannot deliver — missed
      const penalty = deliveryQty * contract.penaltyPerUnit;
      nextState = deductMoney(nextState, contract.sellerEntityId, penalty);

      updatedContracts[i] = {
        ...contract,
        unitsMissed: contract.unitsMissed + deliveryQty,
        nextDeliveryTick: contract.nextDeliveryTick + contract.deliveryInterval,
      };
    }
  }

  nextState = { ...nextState, contracts: updatedContracts };
  return nextState;
}

// ============================================================================
// PHASE 11: CONTRACT STATUS UPDATE
// ============================================================================

function updateContractStatuses(state: GameState): GameState {
  const updatedContracts = state.contracts.map((contract) => {
    if (contract.status !== 'active') return contract;

    // Check if fully delivered or missed
    const totalProcessed = contract.unitsShipped + contract.unitsMissed;
    if (totalProcessed >= contract.totalUnits) {
      return { ...contract, status: 'completed' as const };
    }

    // Check cancellation threshold
    if (contract.unitsMissed / contract.totalUnits > contract.cancellationThreshold) {
      return { ...contract, status: 'cancelled' as const };
    }

    return contract;
  });

  return { ...state, contracts: updatedContracts };
}

// ============================================================================
// PLAYER ORDERS (multiple per tick, including set_volume + propose_contract)
// ============================================================================

function processPlayerOrders(state: GameState, config: GameConfig, playerActions: PlayerOrder[]): GameState {
  let nextState = state;

  for (const playerAction of playerActions) {
    const entity = getEntity(nextState, playerAction.entityId);
    if (!entity || !entity.isPlayerControlled) continue;

    if (playerAction.action === 'start_line') {
      const process = getProductionProcess(config, playerAction.targetId);
      const newLines = [...nextState.processLines];
      const entityType = getEntityType(config, entity);
      const entityLines = newLines.filter((l) => l.entityId === entity.id);
      if (entityLines.length >= entityType.maxProcessLines) continue;

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
    } else if (playerAction.action === 'set_volume') {
      const lineId = playerAction.lineId ?? playerAction.targetId;
      const newVolume = playerAction.quantity;

      nextState = {
        ...nextState,
        processLines: nextState.processLines.map((line) => {
          if (line.id !== lineId) return line;
          const process = getProductionProcess(config, line.processId);
          const clamped = Math.max(process.minVolume, Math.min(process.maxVolume, newVolume));
          return { ...line, volume: clamped };
        }),
      };
    } else if (playerAction.action === 'order') {
      const resource = playerAction.targetId;
      const supplierIds = entity.suppliers[resource] ?? [];

      if (supplierIds.length > 0) {
        const pricePerUnit = getBasePrice(config, resource);
        nextState = placePendingOrder(
          nextState,
          config,
          entity.id,
          resource,
          playerAction.quantity,
          pricePerUnit,
          playerAction.supplierId,
        );
      }
    } else if (playerAction.action === 'propose_contract') {
      const proposal = playerAction.contractProposal;
      if (!proposal) continue;

      const penaltyPerUnit = proposal.pricePerUnit * config.contractDefaultPenaltyRate;

      const contract: Contract = {
        id: nextId('contract'),
        buyerEntityId: entity.id,
        sellerEntityId: proposal.supplierId,
        resource: proposal.resource,
        pricePerUnit: proposal.pricePerUnit,
        unitsPerDelivery: proposal.unitsPerDelivery,
        deliveryInterval: proposal.deliveryInterval,
        totalUnits: proposal.totalUnits,
        unitsShipped: 0,
        unitsMissed: 0,
        penaltyPerUnit,
        cancellationThreshold: config.contractDefaultCancellationThreshold,
        proposedAtTick: nextState.tick,
        nextDeliveryTick: 0,
        status: 'proposed',
      };

      nextState = { ...nextState, contracts: [...nextState.contracts, contract] };
    } else if (playerAction.action === 'accept_contract') {
      const contractId = playerAction.targetId;
      nextState = {
        ...nextState,
        contracts: nextState.contracts.map((c) => {
          if (c.id === contractId && c.status === 'proposed' && c.sellerEntityId === entity.id) {
            return {
              ...c,
              status: 'active' as const,
              acceptedAtTick: nextState.tick,
              nextDeliveryTick: nextState.tick + c.deliveryInterval,
            };
          }
          return c;
        }),
      };
    } else if (playerAction.action === 'decline_contract') {
      const contractId = playerAction.targetId;
      nextState = {
        ...nextState,
        contracts: nextState.contracts.map((c) => {
          if (c.id === contractId && c.status === 'proposed' && c.sellerEntityId === entity.id) {
            return { ...c, status: 'cancelled' as const };
          }
          return c;
        }),
      };
    }
  }

  return nextState;
}

// ============================================================================
// MAIN TICK PROCESSOR
// ============================================================================

export function runOneTick(state: GameState, playerActions: PlayerOrder[] = []): GameState {
  const config = getGameConfig();

  // 1. Increment tick
  let next: GameState = { ...state, tick: state.tick + 1 };

  // 2. ARRIVALS — complete finished deliveries + transfer payments
  next = processArrivals(next);

  // 3. Advance demand phases (per-location)
  next = advanceDemandPhases(next, config);

  // 4. Process production lines
  next = processProductionLines(next, config);

  // 5. Retail selling (with revenue)
  next = processRetailSelling(next, config);

  // 6. Storage costs
  next = processStorageCosts(next, config);

  // 7a. Process player actions (multiple per tick)
  if (playerActions.length > 0) {
    next = processPlayerOrders(next, config, playerActions);
  }

  // 7b. Process AI decisions (production + procurement spot orders)
  next = processAIDecisions(next, config);

  // 8. Contract management (proposals, evaluation, due deliveries)
  next = processContractManagement(next, config);

  // 9. Accept/decline pending orders
  next = processOrderAcceptance(next, config);

  // 10. DEPARTURES — ship accepted orders
  next = processDepartures(next, config);

  // 11. Contract status update (completion, cancellation)
  next = updateContractStatuses(next);

  return next;
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export { getGameConfig, getTransportTime, getEntityType, getProductionProcess, getLocation, getBasePrice, getRetailPrice };

export function getOrdersForEntity(state: GameState, entityId: string): Order[] {
  return state.orders.filter(
    (o) => o.buyerEntityId === entityId || o.sellerEntityId === entityId,
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

export function getContractsForEntity(state: GameState, entityId: string): Contract[] {
  return state.contracts.filter(
    (c) => c.buyerEntityId === entityId || c.sellerEntityId === entityId,
  );
}
