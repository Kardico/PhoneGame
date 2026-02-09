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
  SettingsConfig,
  PricingConfig,
  ProcessesConfig,
  ProductionProcess,
  RetailProcess,
  ProcurementProcess,
  FulfillmentProcess,
  CorridorConfig,
  PathResult,
  LocationConfig,
} from '../types/game';

import resourcesJson from '../config/resources.json';
import entityTypesJson from '../config/entity-types.json';
import locationsJson from '../config/locations.json';
import scenarioJson from '../config/scenario.json';
import processesJson from '../config/processes.json';
import settingsJson from '../config/settings.json';
import pricingJson from '../config/pricing.json';

// ============================================================================
// CONFIG LOADING
// ============================================================================

export function loadGameConfig(): GameConfig {
  const resources = (resourcesJson as { resources: ResourceConfig[] }).resources;
  const entityTypes = (entityTypesJson as { entityTypes: Record<string, EntityTypeConfig> }).entityTypes;
  const locationsConfig = locationsJson as unknown as LocationsConfig;
  const scenario = scenarioJson as unknown as ScenarioConfig;
  const processes = processesJson as unknown as ProcessesConfig;
  const settings = settingsJson as unknown as SettingsConfig;
  const pricing = pricingJson as unknown as PricingConfig;

  const config: GameConfig = {
    resources,
    processes,
    entityTypes,
    locations: locationsConfig.locations,
    corridors: locationsConfig.corridors,
    scenario,
    pricing,
    tickSpeeds: settings.tickSpeeds,
    defaultSpeed: settings.defaultSpeed,
    contractWaitTicks: settings.contractWaitTicks,
    contractDefaultPenaltyRate: settings.contractDefaultPenaltyRate,
    contractDefaultCancellationThreshold: settings.contractDefaultCancellationThreshold,
  };

  validateConfig(config);
  return config;
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateConfig(config: GameConfig): void {
  const resourceIds = new Set(config.resources.map((r) => r.id));
  const locationIds = new Set(config.locations.map((l) => l.id));
  const entityTypeIds = new Set(Object.keys(config.entityTypes));

  const productionIds = new Set(config.processes.production.map((p) => p.id));
  const retailIds = new Set(config.processes.retail.map((p) => p.id));
  const procurementIds = new Set(config.processes.procurement.map((p) => p.id));
  const fulfillmentIds = new Set(config.processes.fulfillment.map((p) => p.id));

  // Validate process definitions
  for (const proc of config.processes.production) {
    for (const input of proc.startupInputs) {
      if (!resourceIds.has(input.resource)) {
        throw new Error(`Production process "${proc.id}" has unknown startupInput resource "${input.resource}"`);
      }
    }
    for (const input of proc.cycleInputs) {
      if (!resourceIds.has(input.resource)) {
        throw new Error(`Production process "${proc.id}" has unknown cycleInput resource "${input.resource}"`);
      }
    }
    for (const input of proc.tickInputs) {
      if (!resourceIds.has(input.resource)) {
        throw new Error(`Production process "${proc.id}" has unknown tickInput resource "${input.resource}"`);
      }
    }
    for (const output of proc.outputs) {
      if (!resourceIds.has(output.resource)) {
        throw new Error(`Production process "${proc.id}" has unknown output resource "${output.resource}"`);
      }
    }
    if (proc.cycleTicks <= 0) throw new Error(`Production process "${proc.id}" must have positive cycleTicks`);
    if (proc.startupTicks < 0) throw new Error(`Production process "${proc.id}" must have non-negative startupTicks`);
    if (proc.minVolume <= 0 || proc.maxVolume <= 0) throw new Error(`Production process "${proc.id}" must have positive min/maxVolume`);
    if (proc.minVolume > proc.maxVolume) throw new Error(`Production process "${proc.id}" minVolume cannot exceed maxVolume`);
  }

  for (const proc of config.processes.retail) {
    if (!resourceIds.has(proc.resource)) throw new Error(`Retail process "${proc.id}" has unknown resource "${proc.resource}"`);
  }
  for (const proc of config.processes.procurement) {
    if (!resourceIds.has(proc.resource)) throw new Error(`Procurement process "${proc.id}" has unknown resource "${proc.resource}"`);
  }
  for (const proc of config.processes.fulfillment) {
    if (!resourceIds.has(proc.resource)) throw new Error(`Fulfillment process "${proc.id}" has unknown resource "${proc.resource}"`);
  }

  // Validate entity types
  for (const [typeId, entityType] of Object.entries(config.entityTypes)) {
    for (const res of entityType.canHold) {
      if (!resourceIds.has(res)) throw new Error(`Entity type "${typeId}" canHold unknown resource "${res}"`);
    }
    for (const pid of entityType.processes.production) {
      if (!productionIds.has(pid)) throw new Error(`Entity type "${typeId}" references unknown production process "${pid}"`);
    }
    for (const pid of entityType.processes.retail) {
      if (!retailIds.has(pid)) throw new Error(`Entity type "${typeId}" references unknown retail process "${pid}"`);
    }
    for (const pid of entityType.processes.procurement) {
      if (!procurementIds.has(pid)) throw new Error(`Entity type "${typeId}" references unknown procurement process "${pid}"`);
    }
    for (const pid of entityType.processes.fulfillment) {
      if (!fulfillmentIds.has(pid)) throw new Error(`Entity type "${typeId}" references unknown fulfillment process "${pid}"`);
    }
  }

  // Validate corridors
  for (const corridor of config.corridors) {
    if (!locationIds.has(corridor.locationA)) throw new Error(`Corridor has unknown location "${corridor.locationA}"`);
    if (!locationIds.has(corridor.locationB)) throw new Error(`Corridor has unknown location "${corridor.locationB}"`);
    if (corridor.locationA === corridor.locationB) throw new Error(`Corridor cannot connect a location to itself ("${corridor.locationA}")`);
    if (corridor.cost <= 0) throw new Error(`Corridor between "${corridor.locationA}" and "${corridor.locationB}" must have positive cost`);
  }

  validateCorridorConnectivity(config.locations.map((l) => l.id), config.corridors);

  // Validate locations
  for (const location of config.locations) {
    const hasDemand = Object.values(location.demand).some((d) => d > 0);
    if (hasDemand && !location.demandCycle) throw new Error(`Location "${location.id}" has demand but no demandCycle defined`);
    if (location.demandCycle) {
      if (location.demandCycle.phases.length === 0) throw new Error(`Location "${location.id}" demandCycle must have at least one phase`);
      for (const phase of location.demandCycle.phases) {
        if (phase.ticks <= 0) throw new Error(`Location "${location.id}" demand phase "${phase.name}" must have positive ticks`);
      }
    }
    for (const res of Object.keys(location.demand)) {
      if (!resourceIds.has(res)) throw new Error(`Location "${location.id}" has unknown demand resource "${res}"`);
    }
  }

  // Validate pricing
  for (const res of Object.keys(config.pricing.basePrices)) {
    if (!resourceIds.has(res)) throw new Error(`Pricing basePrices has unknown resource "${res}"`);
  }
  for (const res of Object.keys(config.pricing.retailPrices)) {
    if (!resourceIds.has(res)) throw new Error(`Pricing retailPrices has unknown resource "${res}"`);
  }
  if (config.pricing.storageCostPerUnit < 0) throw new Error('Pricing storageCostPerUnit must be non-negative');

  // Validate contract settings
  if (config.contractWaitTicks < 0) throw new Error('contractWaitTicks must be non-negative');
  if (config.contractDefaultPenaltyRate < 0) throw new Error('contractDefaultPenaltyRate must be non-negative');
  if (config.contractDefaultCancellationThreshold <= 0 || config.contractDefaultCancellationThreshold > 1) {
    throw new Error('contractDefaultCancellationThreshold must be between 0 (exclusive) and 1 (inclusive)');
  }

  // Validate scenario entities
  const entityIds = new Set(config.scenario.entities.map((e) => e.id));
  for (const entity of config.scenario.entities) {
    if (!entityTypeIds.has(entity.type)) throw new Error(`Scenario entity "${entity.id}" has unknown type "${entity.type}"`);
    if (!locationIds.has(entity.locationId)) throw new Error(`Scenario entity "${entity.id}" has unknown location "${entity.locationId}"`);
    for (const res of Object.keys(entity.inventory)) {
      if (!resourceIds.has(res)) throw new Error(`Scenario entity "${entity.id}" has unknown resource "${res}" in inventory`);
    }
  }
  if (!entityIds.has(config.scenario.defaultPlayerEntity)) {
    throw new Error(`Default player entity "${config.scenario.defaultPlayerEntity}" not found in scenario`);
  }
}

function validateCorridorConnectivity(locationIds: string[], corridors: CorridorConfig[]): void {
  if (locationIds.length <= 1) return;

  const adj: Record<string, Set<string>> = {};
  for (const id of locationIds) adj[id] = new Set();
  for (const corridor of corridors) {
    adj[corridor.locationA].add(corridor.locationB);
    adj[corridor.locationB].add(corridor.locationA);
  }

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

export function findShortestPath(corridors: CorridorConfig[], from: string, to: string): PathResult | null {
  if (from === to) return { cost: 0, path: [from] };

  const adj = buildAdjacencyList(corridors);
  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const visited = new Set<string>();

  for (const loc of Object.keys(adj)) {
    dist[loc] = Infinity;
    prev[loc] = null;
  }
  dist[from] = 0;

  while (true) {
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

    for (const { neighbor, cost } of adj[current] ?? []) {
      if (visited.has(neighbor)) continue;
      const newDist = currentDist + cost;
      if (newDist < dist[neighbor]) {
        dist[neighbor] = newDist;
        prev[neighbor] = current;
      }
    }
  }

  if (dist[to] === undefined || dist[to] === Infinity) return null;

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

let cachedPathTable: Record<string, Record<string, PathResult>> | null = null;

function buildPathTable(config: GameConfig): Record<string, Record<string, PathResult>> {
  const table: Record<string, Record<string, PathResult>> = {};
  const locationIds = config.locations.map((l) => l.id);
  for (const from of locationIds) {
    table[from] = {};
    for (const to of locationIds) {
      const result = findShortestPath(config.corridors, from, to);
      if (result) table[from][to] = result;
    }
  }
  return table;
}

function getPath(config: GameConfig, from: string, to: string): PathResult {
  if (!cachedPathTable) cachedPathTable = buildPathTable(config);
  const result = cachedPathTable[from]?.[to];
  if (!result) throw new Error(`No path from "${from}" to "${to}"`);
  return result;
}

// ============================================================================
// TRANSPORT TIME
// ============================================================================

export function getTransportTime(config: GameConfig, fromLocationId: string, toLocationId: string): number {
  const fromLocation = config.locations.find((l) => l.id === fromLocationId);
  const toLocation = config.locations.find((l) => l.id === toLocationId);
  if (!fromLocation || !toLocation) throw new Error(`Unknown location: ${fromLocationId} or ${toLocationId}`);

  if (fromLocationId === toLocationId) return fromLocation.localTransportTicks;

  const pathResult = getPath(config, fromLocationId, toLocationId);
  return fromLocation.localTransportTicks + pathResult.cost + toLocation.localTransportTicks;
}

export function getTransportRoute(
  config: GameConfig,
  fromLocationId: string,
  toLocationId: string,
): { totalTime: number; route: string[] } {
  const fromLocation = config.locations.find((l) => l.id === fromLocationId);
  const toLocation = config.locations.find((l) => l.id === toLocationId);
  if (!fromLocation || !toLocation) throw new Error(`Unknown location: ${fromLocationId} or ${toLocationId}`);

  if (fromLocationId === toLocationId) {
    return { totalTime: fromLocation.localTransportTicks, route: [fromLocationId] };
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

export function getEntityType(config: GameConfig, entity: { type: string }): EntityTypeConfig {
  const entityType = config.entityTypes[entity.type];
  if (!entityType) throw new Error(`Unknown entity type: ${entity.type}`);
  return entityType;
}

export function getProductionProcess(config: GameConfig, processId: string): ProductionProcess {
  const process = config.processes.production.find((p) => p.id === processId);
  if (!process) throw new Error(`Unknown production process: ${processId}`);
  return process;
}

export function getRetailProcess(config: GameConfig, processId: string): RetailProcess {
  const process = config.processes.retail.find((p) => p.id === processId);
  if (!process) throw new Error(`Unknown retail process: ${processId}`);
  return process;
}

export function getProcurementProcess(config: GameConfig, processId: string): ProcurementProcess {
  const process = config.processes.procurement.find((p) => p.id === processId);
  if (!process) throw new Error(`Unknown procurement process: ${processId}`);
  return process;
}

export function getFulfillmentProcess(config: GameConfig, processId: string): FulfillmentProcess {
  const process = config.processes.fulfillment.find((p) => p.id === processId);
  if (!process) throw new Error(`Unknown fulfillment process: ${processId}`);
  return process;
}

export function getLocation(config: GameConfig, locationId: string): LocationConfig {
  const location = config.locations.find((l) => l.id === locationId);
  if (!location) throw new Error(`Unknown location: ${locationId}`);
  return location;
}

export function getResource(config: GameConfig, resourceId: string) {
  const resource = config.resources.find((r) => r.id === resourceId);
  if (!resource) throw new Error(`Unknown resource: ${resourceId}`);
  return resource;
}

/**
 * Calculate the production cost per output unit for a production process.
 * Cost = sum of (cycleInput quantities * basePrices + tickInput quantities * cycleTicks * basePrices) / total output quantity.
 * Returns 0 for processes with no inputs (e.g. mining).
 */
export function getProductionCostPerUnit(config: GameConfig, processId: string): number {
  const process = getProductionProcess(config, processId);

  let totalInputCost = 0;
  for (const input of process.cycleInputs) {
    totalInputCost += input.quantity * (config.pricing.basePrices[input.resource] ?? 0);
  }
  for (const input of process.tickInputs) {
    totalInputCost += input.quantity * process.cycleTicks * (config.pricing.basePrices[input.resource] ?? 0);
  }

  let totalOutputUnits = 0;
  for (const output of process.outputs) {
    totalOutputUnits += output.quantity;
  }

  if (totalOutputUnits === 0) return 0;
  return totalInputCost / totalOutputUnits;
}

/**
 * Get the base wholesale price for a resource.
 */
export function getBasePrice(config: GameConfig, resource: string): number {
  return config.pricing.basePrices[resource] ?? 0;
}

/**
 * Get the retail price for a resource.
 */
export function getRetailPrice(config: GameConfig, resource: string): number {
  return config.pricing.retailPrices[resource] ?? config.pricing.basePrices[resource] ?? 0;
}

// ============================================================================
// SINGLETON
// ============================================================================

let cachedConfig: GameConfig | null = null;

export function getGameConfig(): GameConfig {
  if (!cachedConfig) cachedConfig = loadGameConfig();
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
  cachedPathTable = null;
}
