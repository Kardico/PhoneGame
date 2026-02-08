/**
 * Creates the initial game state from scenario configuration.
 */

import type { Entity, GameState, DemandPhaseState, ResourceSalesStats } from '../types/game';
import { getGameConfig } from './configLoader';

/** Create initial game state from config, with optional player entity override */
export function createInitialState(playerEntityId: string | null = null): GameState {
  const config = getGameConfig();
  const scenario = config.scenario;

  const actualPlayerEntityId = playerEntityId ?? scenario.defaultPlayerEntity;

  // Create entities from scenario
  const entities: Entity[] = scenario.entities.map((scenarioEntity) => ({
    id: scenarioEntity.id,
    type: scenarioEntity.type,
    name: scenarioEntity.name,
    locationId: scenarioEntity.locationId,
    inventory: { ...scenarioEntity.inventory },
    committed: {},
    isPlayerControlled: scenarioEntity.id === actualPlayerEntityId,
    suppliers: scenarioEntity.suppliers ?? {},
  }));

  // Initialize per-location demand phases
  const demandPhases: Record<string, DemandPhaseState> = {};
  for (const location of config.locations) {
    const hasDemand = Object.values(location.demand).some((d) => d > 0);
    if (hasDemand && location.demandCycle) {
      demandPhases[location.id] = {
        phaseIndex: 0,
        ticksInPhase: 0,
      };
    }
  }

  // Initialize sales stats for entities with retail processes
  const sales: Record<string, Record<string, ResourceSalesStats>> = {};
  for (const entity of entities) {
    const entityType = config.entityTypes[entity.type];
    if (entityType.processes.retail.length > 0) {
      sales[entity.id] = {};
      for (const retailProcessId of entityType.processes.retail) {
        const retailProcess = config.processes.retail.find((p) => p.id === retailProcessId);
        if (retailProcess) {
          sales[entity.id][retailProcess.resource] = {
            totalSold: 0,
            totalDemand: 0,
            lostSales: 0,
          };
        }
      }
    }
  }

  return {
    tick: 0,
    entities,
    processLines: [],
    orders: [],
    deliveries: [],
    demandPhases,
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
