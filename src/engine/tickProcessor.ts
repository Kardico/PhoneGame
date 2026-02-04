import type {
  Entity,
  GameState,
  ProductionTask,
  TransportTask,
  Task,
  ResourceKind,
  EntityKind,
  PlayerOrder,
} from '../types/game';

const PRODUCTION_DURATION_TICKS: Record<ResourceKind, number> = {
  raw_materials: 1,
  chips: 3,
  smartphones: 4,
};

const TRANSPORT_DURATION_TICKS = 2;

/** Reorder threshold: AI orders when stock below this. */
const REORDER_THRESHOLD = 5;

/** Upstream entity id for each entity (who they order from). */
const UPSTREAM: Record<EntityKind, string | null> = {
  mineral_mine: null,
  chip_processor: 'entity-mine',
  assembler: 'entity-chip',
  retailer: 'entity-assembler',
};

/** Input resource consumed to produce output (for producers). */
const INPUT_FOR_OUTPUT: Record<EntityKind, { input: ResourceKind; output: ResourceKind } | null> = {
  mineral_mine: null, // produces from nothing
  chip_processor: { input: 'raw_materials', output: 'chips' },
  assembler: { input: 'chips', output: 'smartphones' },
  retailer: null, // no production
};

/** Output resource produced by each producer. */
const OUTPUT_RESOURCE: Record<EntityKind, ResourceKind | null> = {
  mineral_mine: 'raw_materials',
  chip_processor: 'chips',
  assembler: 'smartphones',
  retailer: null,
};

function getEntity(state: GameState, id: string): Entity | undefined {
  return state.entities.find((e) => e.id === id);
}

function updateEntity(state: GameState, id: string, updater: (e: Entity) => Entity): GameState {
  return {
    ...state,
    entities: state.entities.map((e) => (e.id === id ? updater(e) : e)),
  };
}

function addToInventory(state: GameState, entityId: string, resource: ResourceKind, quantity: number): GameState {
  const entity = getEntity(state, entityId);
  if (!entity) return state;
  const current = entity.inventory[resource] ?? 0;
  return updateEntity(state, entityId, (e) => ({
    ...e,
    inventory: { ...e.inventory, [resource]: current + quantity },
  }));
}

function consumeFromInventory(state: GameState, entityId: string, resource: ResourceKind, quantity: number): GameState | null {
  const entity = getEntity(state, entityId);
  if (!entity) return null;
  const current = entity.inventory[resource] ?? 0;
  if (current < quantity) return null;
  return updateEntity(state, entityId, (e) => ({
    ...e,
    inventory: { ...e.inventory, [resource]: current - quantity },
  }));
}

/** Complete all tasks with ticksRemaining 0 and return updated state. */
export function processCompletedTasks(state: GameState): GameState {
  const stillActive: Task[] = [];
  let nextState = state;

  for (const task of state.tasks) {
    if (task.ticksRemaining > 0) {
      stillActive.push({ ...task, ticksRemaining: task.ticksRemaining - 1 });
      continue;
    }

    if (task.type === 'production') {
      const t = task as ProductionTask;
      nextState = addToInventory(nextState, t.entityId, t.outputResource, t.quantity);
    } else {
      const t = task as TransportTask;
      nextState = addToInventory(nextState, t.toEntityId, t.resource, t.quantity);
    }
  }

  return { ...nextState, tasks: stillActive };
}

/** Generate a simple unique id for new tasks. */
let taskIdCounter = 0;
function nextTaskId(prefix: string): string {
  taskIdCounter += 1;
  return `${prefix}-${taskIdCounter}`;
}

/** Apply player order for this tick (production or transport), then run AI for others. */
export function processEntityDecisions(state: GameState, playerOrder: PlayerOrder | null): GameState {
  let nextState = state;
  const newTasks: Task[] = [...nextState.tasks];

  // Apply player order first
  if (playerOrder && playerOrder.quantity > 0) {
    const entity = getEntity(nextState, playerOrder.entityId);
    if (entity?.isPlayerControlled) {
      const upstreamId = UPSTREAM[entity.kind];
      const qty = Math.max(0, Math.floor(playerOrder.quantity));

      if (entity.kind === 'mineral_mine') {
        newTasks.push({
          type: 'production',
          id: nextTaskId('production'),
          entityId: entity.id,
          ticksRemaining: PRODUCTION_DURATION_TICKS.raw_materials,
          outputResource: 'raw_materials',
          quantity: qty,
        });
      } else if (upstreamId) {
        const demandedResource = INPUT_FOR_OUTPUT[entity.kind]?.input ?? (entity.kind === 'retailer' ? 'smartphones' : null);
        if (demandedResource) {
          const upstream = getEntity(nextState, upstreamId);
          const upStock = upstream?.inventory[demandedResource] ?? 0;
          const orderQty = Math.min(qty, upStock);
          if (orderQty > 0) {
            const deductState = consumeFromInventory(nextState, upstreamId, demandedResource, orderQty);
            if (deductState) {
              nextState = deductState;
              newTasks.push({
                type: 'transport',
                id: nextTaskId('transport'),
                fromEntityId: upstreamId,
                toEntityId: entity.id,
                resource: demandedResource,
                quantity: orderQty,
                ticksRemaining: TRANSPORT_DURATION_TICKS,
              });
            }
          }
        }
      }
    }
  }

  for (const entity of nextState.entities) {
    const upstreamId = UPSTREAM[entity.kind];
    const io = INPUT_FOR_OUTPUT[entity.kind];
    const outputRes = OUTPUT_RESOURCE[entity.kind];

    // Skip player-controlled; already handled above
    if (entity.isPlayerControlled) continue;

    // ---- Order from upstream when stock is low ----
    if (upstreamId) {
      const demandedResource = io?.input ?? (entity.kind === 'retailer' ? 'smartphones' : null);
      if (demandedResource) {
        const current = entity.inventory[demandedResource] ?? 0;
        if (current < REORDER_THRESHOLD) {
          const upstream = getEntity(nextState, upstreamId);
          const upStock = upstream?.inventory[demandedResource] ?? 0;
          const orderQty = Math.min(10, upStock, REORDER_THRESHOLD * 2 - current);
          if (orderQty > 0) {
            const deductState = consumeFromInventory(nextState, upstreamId, demandedResource, orderQty);
            if (deductState) {
              nextState = deductState;
              newTasks.push({
                type: 'transport',
                id: nextTaskId('transport'),
                fromEntityId: upstreamId,
                toEntityId: entity.id,
                resource: demandedResource,
                quantity: orderQty,
                ticksRemaining: TRANSPORT_DURATION_TICKS,
              });
            }
          }
        }
      }
    }

    // ---- Start production if entity has input ----
    if (io && outputRes) {
      const inputStock = entity.inventory[io.input] ?? 0;
      const produceQty = 1;
      if (inputStock >= produceQty) {
        const afterConsume = consumeFromInventory(nextState, entity.id, io.input, produceQty);
        if (afterConsume) {
          nextState = afterConsume;
          const ticks = PRODUCTION_DURATION_TICKS[outputRes];
          newTasks.push({
            type: 'production',
            id: nextTaskId('production'),
            entityId: entity.id,
            ticksRemaining: ticks,
            outputResource: outputRes,
            quantity: produceQty,
          });
        }
      }
    }

    // Mine: produce raw_materials periodically (no input)
    if (entity.kind === 'mineral_mine') {
      const alreadyProducing = newTasks.some(
        (t) => t.type === 'production' && t.entityId === entity.id
      );
      if (!alreadyProducing) {
        newTasks.push({
          type: 'production',
          id: nextTaskId('production'),
          entityId: entity.id,
          ticksRemaining: PRODUCTION_DURATION_TICKS.raw_materials,
          outputResource: 'raw_materials',
          quantity: 2,
        });
      }
    }
  }

  return { ...nextState, tasks: newTasks };
}

/** Run one full tick: increment tick, process completed tasks, then entity decisions. */
export function runOneTick(state: GameState, playerOrder: PlayerOrder | null = null): GameState {
  let next = { ...state, tick: state.tick + 1 };
  next = processCompletedTasks(next);
  next = processEntityDecisions(next, playerOrder);
  return next;
}
