/**
 * Creates the initial game state from scenario configuration.
 */

import type { Entity, GameState, SalesStats } from '../types/game';
import { getGameConfig } from './configLoader';

/** Create initial game state from config, with optional player entity override */
export function createInitialState(playerEntityId: string | null = null): GameState {
  const config = getGameConfig();
  const scenario = config.scenario;

  // Use default player entity if none specified
  const actualPlayerEntityId = playerEntityId ?? scenario.defaultPlayerEntity;

  // Create entities from scenario
  const entities: Entity[] = scenario.entities.map((scenarioEntity) => ({
    id: scenarioEntity.id,
    type: scenarioEntity.type,
    name: scenarioEntity.name,
    locationId: scenarioEntity.locationId,
    inventory: { ...scenarioEntity.inventory },
    isPlayerControlled: scenarioEntity.id === actualPlayerEntityId,
    suppliers: scenarioEntity.suppliers ?? {},
  }));

  // Initialize sales stats for retailers
  const sales: Record<string, SalesStats> = {};
  for (const entity of entities) {
    const entityType = config.entityTypes[entity.type];
    // Retailers are entities that can hold smartphones but have no processes
    if (entityType.processes.length === 0 && entityType.canHold.includes('smartphones')) {
      sales[entity.id] = {
        totalSold: 0,
        totalDemand: 0,
        lostSales: 0,
      };
    }
  }

  return {
    tick: 0,
    entities,
    jobs: [],
    orders: [],
    deliveries: [],
    demandPhase: {
      phaseIndex: 0,
      ticksInPhase: 0,
    },
    sales,
  };
}

/** Get list of entity IDs available for player selection */
export function getSelectableEntities(): { id: string; name: string; type: string; locationId: string }[] {
  const config = getGameConfig();
  return config.scenario.entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    locationId: e.locationId,
  }));
}

/** Get entity type display name */
export function getEntityTypeName(typeId: string): string {
  const config = getGameConfig();
  return config.entityTypes[typeId]?.name ?? typeId;
}

/** Get location display name */
export function getLocationName(locationId: string): string {
  const config = getGameConfig();
  return config.locations.find((l) => l.id === locationId)?.name ?? locationId;
}
