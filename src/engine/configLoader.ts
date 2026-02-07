/**
 * Loads, validates, and provides access to game configuration from JSON files.
 * Includes Dijkstra shortest-path computation over the corridor network.
 */

import type {
  GameConfig,
  ResourceConfig,
  EntityTypeConfig,
  LocationsConfig,
  ScenarioConfig,
  CorridorConfig,
  PathResult,
} from '../types/game';

import resourcesJson from '../config/resources.json';
import entityTypesJson from '../config/entity-types.json';
import locationsJson from '../config/locations.json';
import scenarioJson from '../config/scenario.json';

// ============================================================================
// CONFIG LOADING
// ============================================================================

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
    corridors: locationsConfig.corridors,
    demandCycle: locationsConfig.demandCycle,
    scenario,
  };

  validateConfig(config);
  return config;
}

// ============================================================================
// VALIDATION
// ============================================================================

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
      for (const input of process.cycleInputs) {
        if (!resourceIds.has(input.resource)) {
          throw new Error(`Process "${process.id}" in "${typeId}" has unknown cycleInput resource "${input.resource}"`);
        }
      }
      for (const input of process.tickInputs) {
        if (!resourceIds.has(input.resource)) {
          throw new Error(`Process "${process.id}" in "${typeId}" has unknown tickInput resource "${input.resource}"`);
        }
      }
      for (const output of process.outputs) {
        if (!resourceIds.has(output.resource)) {
          throw new Error(`Process "${process.id}" in "${typeId}" has unknown output resource "${output.resource}"`);
        }
      }
      // Validate process numeric fields
      if (process.cycleTicks <= 0) {
        throw new Error(`Process "${process.id}" in "${typeId}" must have positive cycleTicks`);
      }
      if (process.startupTicks < 0) {
        throw new Error(`Process "${process.id}" in "${typeId}" must have non-negative startupTicks`);
      }
      if (process.minVolume <= 0 || process.maxVolume <= 0) {
        throw new Error(`Process "${process.id}" in "${typeId}" must have positive min/maxVolume`);
      }
      if (process.minVolume > process.maxVolume) {
        throw new Error(`Process "${process.id}" in "${typeId}" minVolume cannot exceed maxVolume`);
      }
    }
  }

  // Validate corridors reference valid locations
  for (const corridor of config.corridors) {
    if (!locationIds.has(corridor.locationA)) {
      throw new Error(`Corridor has unknown location "${corridor.locationA}"`);
    }
    if (!locationIds.has(corridor.locationB)) {
      throw new Error(`Corridor has unknown location "${corridor.locationB}"`);
    }
    if (corridor.locationA === corridor.locationB) {
      throw new Error(`Corridor cannot connect a location to itself ("${corridor.locationA}")`);
    }
    if (corridor.cost <= 0) {
      throw new Error(`Corridor between "${corridor.locationA}" and "${corridor.locationB}" must have positive cost`);
    }
  }

  // Validate corridor network connectivity (all locations reachable)
  validateCorridorConnectivity(config.locations.map((l) => l.id), config.corridors);

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

/**
 * Validate that all locations are connected via the corridor network.
 * Uses BFS from the first location to ensure all are reachable.
 */
function validateCorridorConnectivity(locationIds: string[], corridors: CorridorConfig[]): void {
  if (locationIds.length <= 1) return; // 0 or 1 location is trivially connected

  // Build adjacency list
  const adj: Record<string, Set<string>> = {};
  for (const id of locationIds) {
    adj[id] = new Set();
  }
  for (const corridor of corridors) {
    adj[corridor.locationA].add(corridor.locationB);
    adj[corridor.locationB].add(corridor.locationA);
  }

  // BFS from first location
  const visited = new Set<string>();
  const queue: string[] = [locationIds[0]];
  visited.add(locationIds[0]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adj[current]) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Check all locations were reached
  const unreachable = locationIds.filter((id) => !visited.has(id));
  if (unreachable.length > 0) {
    throw new Error(
      `Corridor network is not fully connected. Unreachable locations from "${locationIds[0]}": ${unreachable.join(', ')}`
    );
  }
}

// ============================================================================
// PATHFINDING
// ============================================================================

/**
 * Build an adjacency list from corridors (bi-directional).
 */
function buildAdjacencyList(corridors: CorridorConfig[]): Record<string, { neighbor: string; cost: number }[]> {
  const adj: Record<string, { neighbor: string; cost: number }[]> = {};

  for (const corridor of corridors) {
    if (!adj[corridor.locationA]) adj[corridor.locationA] = [];
    if (!adj[corridor.locationB]) adj[corridor.locationB] = [];
    adj[corridor.locationA].push({ neighbor: corridor.locationB, cost: corridor.cost });
    adj[corridor.locationB].push({ neighbor: corridor.locationA, cost: corridor.cost });
  }

  return adj;
}

/**
 * Dijkstra shortest-path over the corridor graph.
 * Returns the shortest path cost and the list of location IDs from origin to destination.
 * Cost is the sum of corridor costs only (no local transport).
 * Returns null if no path exists.
 */
export function findShortestPath(corridors: CorridorConfig[], from: string, to: string): PathResult | null {
  if (from === to) {
    return { cost: 0, path: [from] };
  }

  const adj = buildAdjacencyList(corridors);

  // Dijkstra
  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const visited = new Set<string>();

  // Initialize all known locations
  for (const loc of Object.keys(adj)) {
    dist[loc] = Infinity;
    prev[loc] = null;
  }
  dist[from] = 0;

  // Simple priority queue using array (fine for small graphs)
  while (true) {
    // Find unvisited node with smallest distance
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [node, d] of Object.entries(dist)) {
      if (!visited.has(node) && d < currentDist) {
        current = node;
        currentDist = d;
      }
    }

    if (current === null || current === to) break;
    visited.add(current);

    const neighbors = adj[current] ?? [];
    for (const { neighbor, cost } of neighbors) {
      if (visited.has(neighbor)) continue;
      const newDist = currentDist + cost;
      if (newDist < dist[neighbor]) {
        dist[neighbor] = newDist;
        prev[neighbor] = current;
      }
    }
  }

  if (dist[to] === undefined || dist[to] === Infinity) {
    return null;
  }

  // Reconstruct path
  const path: string[] = [];
  let node: string | null = to;
  while (node !== null) {
    path.unshift(node);
    node = prev[node];
  }

  return { cost: dist[to], path };
}

// ============================================================================
// CACHED PATH TABLE
// ============================================================================

/** Pre-computed path table for all location pairs */
let cachedPathTable: Record<string, Record<string, PathResult>> | null = null;

/**
 * Pre-compute shortest paths between all location pairs.
 * Called once when config is loaded.
 */
function buildPathTable(config: GameConfig): Record<string, Record<string, PathResult>> {
  const table: Record<string, Record<string, PathResult>> = {};
  const locationIds = config.locations.map((l) => l.id);

  for (const from of locationIds) {
    table[from] = {};
    for (const to of locationIds) {
      const result = findShortestPath(config.corridors, from, to);
      if (result) {
        table[from][to] = result;
      }
    }
  }

  return table;
}

/**
 * Get the pre-computed path between two locations.
 * Returns { cost, path } where cost is corridor-only cost and path is the route.
 */
function getPath(config: GameConfig, from: string, to: string): PathResult {
  if (!cachedPathTable) {
    cachedPathTable = buildPathTable(config);
  }
  const result = cachedPathTable[from]?.[to];
  if (!result) {
    throw new Error(`No path from "${from}" to "${to}"`);
  }
  return result;
}

// ============================================================================
// TRANSPORT TIME
// ============================================================================

/**
 * Get transport time between two locations.
 * Total = local(from) + corridor path cost + local(to).
 * For same-location: just local transport ticks (once).
 * Local transport is only counted at origin and destination, NOT at intermediate stops.
 */
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

  const pathResult = getPath(config, fromLocationId, toLocationId);
  return fromLocation.localTransportTicks + pathResult.cost + toLocation.localTransportTicks;
}

/**
 * Get the full transport route between two locations.
 * Returns total time and the path (list of location IDs).
 */
export function getTransportRoute(
  config: GameConfig,
  fromLocationId: string,
  toLocationId: string
): { totalTime: number; route: string[] } {
  const fromLocation = config.locations.find((l) => l.id === fromLocationId);
  const toLocation = config.locations.find((l) => l.id === toLocationId);

  if (!fromLocation || !toLocation) {
    throw new Error(`Unknown location: ${fromLocationId} or ${toLocationId}`);
  }

  if (fromLocationId === toLocationId) {
    return {
      totalTime: fromLocation.localTransportTicks,
      route: [fromLocationId],
    };
  }

  const pathResult = getPath(config, fromLocationId, toLocationId);
  return {
    totalTime: fromLocation.localTransportTicks + pathResult.cost + toLocation.localTransportTicks,
    route: pathResult.path,
  };
}

// ============================================================================
// ACCESSORS
// ============================================================================

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

// ============================================================================
// SINGLETON
// ============================================================================

/** Singleton config instance */
let cachedConfig: GameConfig | null = null;

export function getGameConfig(): GameConfig {
  if (!cachedConfig) {
    cachedConfig = loadGameConfig();
  }
  return cachedConfig;
}

/** Reset cached config and path table (useful for testing) */
export function resetConfigCache(): void {
  cachedConfig = null;
  cachedPathTable = null;
}
