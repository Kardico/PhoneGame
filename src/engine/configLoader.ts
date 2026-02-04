/**
 * Loads and validates game configuration from JSON files.
 */

import type {
  GameConfig,
  ResourceConfig,
  EntityTypeConfig,
  LocationsConfig,
  ScenarioConfig,
} from '../types/game';

import resourcesJson from '../config/resources.json';
import entityTypesJson from '../config/entity-types.json';
import locationsJson from '../config/locations.json';
import scenarioJson from '../config/scenario.json';

/** Load and validate all game configuration */
export function loadGameConfig(): GameConfig {
  const resources = (resourcesJson as { resources: ResourceConfig[] }).resources;
  const entityTypes = (entityTypesJson as { entityTypes: Record<string, EntityTypeConfig> }).entityTypes;
  const locationsConfig = locationsJson as unknown as LocationsConfig;
  const scenario = scenarioJson as unknown as ScenarioConfig;

  const config: GameConfig = {
    resources,
    entityTypes,
    locations: locationsConfig.locations,
    routes: locationsConfig.routes,
    demandCycle: locationsConfig.demandCycle,
    scenario,
  };

  validateConfig(config);
  return config;
}

/** Validate configuration consistency */
function validateConfig(config: GameConfig): void {
  const resourceIds = new Set(config.resources.map((r) => r.id));
  const locationIds = new Set(config.locations.map((l) => l.id));
  const entityTypeIds = new Set(Object.keys(config.entityTypes));

  // Validate entity types
  for (const [typeId, entityType] of Object.entries(config.entityTypes)) {
    // Check canHold references valid resources
    for (const res of entityType.canHold) {
      if (!resourceIds.has(res)) {
        throw new Error(`Entity type "${typeId}" canHold unknown resource "${res}"`);
      }
    }

    // Check process inputs/outputs reference valid resources
    for (const process of entityType.processes) {
      for (const input of process.inputs) {
        if (!resourceIds.has(input.resource)) {
          throw new Error(`Process "${process.id}" in "${typeId}" has unknown input resource "${input.resource}"`);
        }
      }
      for (const output of process.outputs) {
        if (!resourceIds.has(output.resource)) {
          throw new Error(`Process "${process.id}" in "${typeId}" has unknown output resource "${output.resource}"`);
        }
      }
    }
  }

  // Validate routes reference valid locations
  for (const route of config.routes) {
    if (!locationIds.has(route.from)) {
      throw new Error(`Route has unknown "from" location "${route.from}"`);
    }
    if (!locationIds.has(route.to)) {
      throw new Error(`Route has unknown "to" location "${route.to}"`);
    }
  }

  // Validate scenario entities
  for (const entity of config.scenario.entities) {
    if (!entityTypeIds.has(entity.type)) {
      throw new Error(`Scenario entity "${entity.id}" has unknown type "${entity.type}"`);
    }
    if (!locationIds.has(entity.locationId)) {
      throw new Error(`Scenario entity "${entity.id}" has unknown location "${entity.locationId}"`);
    }
    // Check inventory references valid resources
    for (const res of Object.keys(entity.inventory)) {
      if (!resourceIds.has(res)) {
        throw new Error(`Scenario entity "${entity.id}" has unknown resource "${res}" in inventory`);
      }
    }
  }

  // Validate default player entity exists
  const entityIds = new Set(config.scenario.entities.map((e) => e.id));
  if (!entityIds.has(config.scenario.defaultPlayerEntity)) {
    throw new Error(`Default player entity "${config.scenario.defaultPlayerEntity}" not found in scenario`);
  }

  // Validate demand cycle
  if (config.demandCycle.phases.length === 0) {
    throw new Error('Demand cycle must have at least one phase');
  }
  for (const phase of config.demandCycle.phases) {
    if (phase.ticks <= 0) {
      throw new Error(`Demand phase "${phase.name}" must have positive ticks`);
    }
  }
}

/** Get transport time between two locations (includes local transport at both ends) */
export function getTransportTime(
  config: GameConfig,
  fromLocationId: string,
  toLocationId: string
): number {
  const fromLocation = config.locations.find((l) => l.id === fromLocationId);
  const toLocation = config.locations.find((l) => l.id === toLocationId);

  if (!fromLocation || !toLocation) {
    throw new Error(`Unknown location: ${fromLocationId} or ${toLocationId}`);
  }

  // Same location: just local transport
  if (fromLocationId === toLocationId) {
    return fromLocation.localTransportTicks;
  }

  // Find route
  const route = config.routes.find(
    (r) => r.from === fromLocationId && r.to === toLocationId
  );

  if (!route) {
    throw new Error(`No route from "${fromLocationId}" to "${toLocationId}"`);
  }

  // Total: source local + route + destination local
  return fromLocation.localTransportTicks + route.ticks + toLocation.localTransportTicks;
}

/** Get entity type config for an entity */
export function getEntityType(config: GameConfig, entity: { type: string }): EntityTypeConfig {
  const entityType = config.entityTypes[entity.type];
  if (!entityType) {
    throw new Error(`Unknown entity type: ${entity.type}`);
  }
  return entityType;
}

/** Get process definition by ID from an entity type */
export function getProcess(entityType: EntityTypeConfig, processId: string) {
  const process = entityType.processes.find((p) => p.id === processId);
  if (!process) {
    throw new Error(`Unknown process "${processId}" in entity type "${entityType.name}"`);
  }
  return process;
}

/** Get location config by ID */
export function getLocation(config: GameConfig, locationId: string) {
  const location = config.locations.find((l) => l.id === locationId);
  if (!location) {
    throw new Error(`Unknown location: ${locationId}`);
  }
  return location;
}

/** Get resource config by ID */
export function getResource(config: GameConfig, resourceId: string) {
  const resource = config.resources.find((r) => r.id === resourceId);
  if (!resource) {
    throw new Error(`Unknown resource: ${resourceId}`);
  }
  return resource;
}

/** Singleton config instance */
let cachedConfig: GameConfig | null = null;

export function getGameConfig(): GameConfig {
  if (!cachedConfig) {
    cachedConfig = loadGameConfig();
  }
  return cachedConfig;
}
