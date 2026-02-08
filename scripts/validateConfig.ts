#!/usr/bin/env tsx
/**
 * Standalone config validation script.
 * Validates all game configuration files for consistency and connectivity.
 *
 * Usage: npx tsx scripts/validateConfig.ts
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configDir = resolve(__dirname, '..', 'src', 'config');

// ============================================================================
// Read JSON files
// ============================================================================

function readJson(filename: string): unknown {
  const path = resolve(configDir, filename);
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

// ============================================================================
// Types (minimal, for validation only)
// ============================================================================

interface ResourceConfig {
  id: string;
  name: string;
}

interface ResourceAmount {
  resource: string;
  quantity: number;
}

interface ProductionProcess {
  id: string;
  name: string;
  startupInputs: ResourceAmount[];
  cycleInputs: ResourceAmount[];
  tickInputs: ResourceAmount[];
  outputs: ResourceAmount[];
  cycleTicks: number;
  startupTicks: number;
  minVolume: number;
  maxVolume: number;
}

interface SimpleProcess {
  id: string;
  name: string;
  resource: string;
}

interface ProcessesConfig {
  production: ProductionProcess[];
  retail: SimpleProcess[];
  procurement: SimpleProcess[];
  fulfillment: SimpleProcess[];
}

interface EntityTypeProcesses {
  production: string[];
  retail: string[];
  procurement: string[];
  fulfillment: string[];
}

interface EntityTypeConfig {
  name: string;
  canHold: string[];
  maxProcessLines: number;
  processes: EntityTypeProcesses;
}

interface DemandPhase {
  name: string;
  ticks: number;
  multiplier: number;
}

interface LocationConfig {
  id: string;
  name: string;
  localTransportTicks: number;
  demand: Record<string, number>;
  demandCycle?: {
    phases: DemandPhase[];
    variance: number;
  };
}

interface CorridorConfig {
  locationA: string;
  locationB: string;
  cost: number;
  type: string;
}

interface ScenarioEntity {
  id: string;
  type: string;
  name: string;
  locationId: string;
  inventory: Record<string, number>;
  suppliers?: Record<string, string[]>;
}

interface SettingsConfig {
  tickSpeeds: Record<string, number>;
  defaultSpeed: number;
}

// ============================================================================
// Validation
// ============================================================================

let errorCount = 0;
let warnCount = 0;

function error(msg: string): void {
  console.error(`  ERROR: ${msg}`);
  errorCount++;
}

function warn(msg: string): void {
  console.warn(`  WARN:  ${msg}`);
  warnCount++;
}

function info(msg: string): void {
  console.log(`  ${msg}`);
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

// ============================================================================
// Main validation
// ============================================================================

function main(): void {
  console.log('Validating game configuration...\n');

  // --- Load files ---
  section('Loading config files');

  let resources: ResourceConfig[];
  let processes: ProcessesConfig;
  let entityTypes: Record<string, EntityTypeConfig>;
  let locations: LocationConfig[];
  let corridors: CorridorConfig[];
  let scenarioEntities: ScenarioEntity[];
  let defaultPlayerEntity: string;
  let settings: SettingsConfig;

  try {
    const resourcesJson = readJson('resources.json') as { resources: ResourceConfig[] };
    resources = resourcesJson.resources;
    info(`resources.json: ${resources.length} resources`);
  } catch (e) {
    error(`Failed to read resources.json: ${e}`);
    return;
  }

  try {
    processes = readJson('processes.json') as ProcessesConfig;
    info(`processes.json: ${processes.production.length} production, ${processes.retail.length} retail, ${processes.procurement.length} procurement, ${processes.fulfillment.length} fulfillment`);
  } catch (e) {
    error(`Failed to read processes.json: ${e}`);
    return;
  }

  try {
    const entityTypesJson = readJson('entity-types.json') as { entityTypes: Record<string, EntityTypeConfig> };
    entityTypes = entityTypesJson.entityTypes;
    info(`entity-types.json: ${Object.keys(entityTypes).length} entity types`);
  } catch (e) {
    error(`Failed to read entity-types.json: ${e}`);
    return;
  }

  try {
    const locationsJson = readJson('locations.json') as {
      locations: LocationConfig[];
      corridors: CorridorConfig[];
    };
    locations = locationsJson.locations;
    corridors = locationsJson.corridors;
    info(`locations.json: ${locations.length} locations, ${corridors.length} corridors`);
  } catch (e) {
    error(`Failed to read locations.json: ${e}`);
    return;
  }

  try {
    const scenarioJson = readJson('scenario.json') as {
      entities: ScenarioEntity[];
      defaultPlayerEntity: string;
    };
    scenarioEntities = scenarioJson.entities;
    defaultPlayerEntity = scenarioJson.defaultPlayerEntity;
    info(`scenario.json: ${scenarioEntities.length} entities, default player: ${defaultPlayerEntity}`);
  } catch (e) {
    error(`Failed to read scenario.json: ${e}`);
    return;
  }

  try {
    settings = readJson('settings.json') as SettingsConfig;
    info(`settings.json: ${Object.keys(settings.tickSpeeds).length} speed levels, default: ${settings.defaultSpeed}`);
  } catch (e) {
    error(`Failed to read settings.json: ${e}`);
    return;
  }

  const resourceIds = new Set(resources.map((r) => r.id));
  const locationIds = new Set(locations.map((l) => l.id));
  const entityTypeIds = new Set(Object.keys(entityTypes));
  const scenarioEntityIds = new Set(scenarioEntities.map((e) => e.id));

  // Build process ID sets
  const productionIds = new Set(processes.production.map((p) => p.id));
  const retailIds = new Set(processes.retail.map((p) => p.id));
  const procurementIds = new Set(processes.procurement.map((p) => p.id));
  const fulfillmentIds = new Set(processes.fulfillment.map((p) => p.id));

  // --- Validate resources ---
  section('Validating resources');
  for (const res of resources) {
    if (!res.id) error('Resource missing id');
    if (!res.name) error(`Resource "${res.id}" missing name`);
  }
  const dupResources = resources.map(r => r.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dupResources.length > 0) error(`Duplicate resource IDs: ${dupResources.join(', ')}`);
  info(`${resources.length} resources OK`);

  // --- Validate processes ---
  section('Validating processes');

  // Production processes
  for (const proc of processes.production) {
    if (!proc.id) error('Production process missing id');
    if (!proc.name) error(`Production process "${proc.id}" missing name`);
    if (proc.cycleTicks <= 0) error(`Production process "${proc.id}" cycleTicks must be positive`);
    if (proc.startupTicks < 0) error(`Production process "${proc.id}" startupTicks must be non-negative`);
    if (proc.minVolume <= 0) error(`Production process "${proc.id}" minVolume must be positive`);
    if (proc.maxVolume <= 0) error(`Production process "${proc.id}" maxVolume must be positive`);
    if (proc.minVolume > proc.maxVolume) error(`Production process "${proc.id}" minVolume > maxVolume`);
    for (const input of proc.startupInputs) {
      if (!resourceIds.has(input.resource)) error(`Production process "${proc.id}" has unknown startupInput "${input.resource}"`);
      if (input.quantity <= 0) error(`Production process "${proc.id}" startupInput "${input.resource}" must have positive quantity`);
    }
    for (const input of proc.cycleInputs) {
      if (!resourceIds.has(input.resource)) error(`Production process "${proc.id}" has unknown cycleInput "${input.resource}"`);
      if (input.quantity <= 0) error(`Production process "${proc.id}" cycleInput "${input.resource}" must have positive quantity`);
    }
    for (const input of proc.tickInputs) {
      if (!resourceIds.has(input.resource)) error(`Production process "${proc.id}" has unknown tickInput "${input.resource}"`);
      if (input.quantity <= 0) error(`Production process "${proc.id}" tickInput "${input.resource}" must have positive quantity`);
    }
    for (const output of proc.outputs) {
      if (!resourceIds.has(output.resource)) error(`Production process "${proc.id}" has unknown output "${output.resource}"`);
      if (output.quantity <= 0) error(`Production process "${proc.id}" output "${output.resource}" must have positive quantity`);
    }
  }

  // Simple processes (retail, procurement, fulfillment)
  for (const proc of processes.retail) {
    if (!proc.id) error('Retail process missing id');
    if (!resourceIds.has(proc.resource)) error(`Retail process "${proc.id}" has unknown resource "${proc.resource}"`);
  }
  for (const proc of processes.procurement) {
    if (!proc.id) error('Procurement process missing id');
    if (!resourceIds.has(proc.resource)) error(`Procurement process "${proc.id}" has unknown resource "${proc.resource}"`);
  }
  for (const proc of processes.fulfillment) {
    if (!proc.id) error('Fulfillment process missing id');
    if (!resourceIds.has(proc.resource)) error(`Fulfillment process "${proc.id}" has unknown resource "${proc.resource}"`);
  }

  // Check for duplicate process IDs across all categories
  const allProcessIds = [
    ...processes.production.map(p => p.id),
    ...processes.retail.map(p => p.id),
    ...processes.procurement.map(p => p.id),
    ...processes.fulfillment.map(p => p.id),
  ];
  const dupProcessIds = allProcessIds.filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dupProcessIds.length > 0) error(`Duplicate process IDs: ${dupProcessIds.join(', ')}`);

  info(`${allProcessIds.length} processes OK`);

  // --- Validate entity types ---
  section('Validating entity types');
  for (const [typeId, et] of Object.entries(entityTypes)) {
    for (const res of et.canHold) {
      if (!resourceIds.has(res)) error(`Entity type "${typeId}" canHold unknown resource "${res}"`);
    }
    if (et.maxProcessLines < 0) error(`Entity type "${typeId}" maxProcessLines must be non-negative`);
    // Validate process references
    for (const pid of et.processes.production) {
      if (!productionIds.has(pid)) error(`Entity type "${typeId}" references unknown production process "${pid}"`);
    }
    for (const pid of et.processes.retail) {
      if (!retailIds.has(pid)) error(`Entity type "${typeId}" references unknown retail process "${pid}"`);
    }
    for (const pid of et.processes.procurement) {
      if (!procurementIds.has(pid)) error(`Entity type "${typeId}" references unknown procurement process "${pid}"`);
    }
    for (const pid of et.processes.fulfillment) {
      if (!fulfillmentIds.has(pid)) error(`Entity type "${typeId}" references unknown fulfillment process "${pid}"`);
    }
  }
  info(`${Object.keys(entityTypes).length} entity types OK`);

  // --- Validate locations ---
  section('Validating locations');
  const dupLocations = locations.map(l => l.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dupLocations.length > 0) error(`Duplicate location IDs: ${dupLocations.join(', ')}`);
  for (const loc of locations) {
    if (!loc.id) error('Location missing id');
    if (!loc.name) error(`Location "${loc.id}" missing name`);
    if (loc.localTransportTicks < 0) error(`Location "${loc.id}" localTransportTicks must be non-negative`);
    // Validate demand resources
    for (const res of Object.keys(loc.demand)) {
      if (!resourceIds.has(res)) error(`Location "${loc.id}" has unknown demand resource "${res}"`);
    }
    // Validate demand cycle
    const hasDemand = Object.values(loc.demand).some((d) => d > 0);
    if (hasDemand && !loc.demandCycle) {
      error(`Location "${loc.id}" has demand but no demandCycle defined`);
    }
    if (loc.demandCycle) {
      if (loc.demandCycle.phases.length === 0) error(`Location "${loc.id}" demandCycle must have at least one phase`);
      for (const phase of loc.demandCycle.phases) {
        if (phase.ticks <= 0) error(`Location "${loc.id}" demand phase "${phase.name}" must have positive ticks`);
        if (phase.multiplier < 0) error(`Location "${loc.id}" demand phase "${phase.name}" must have non-negative multiplier`);
      }
      if (loc.demandCycle.variance < 0 || loc.demandCycle.variance > 1) {
        warn(`Location "${loc.id}" demand variance ${loc.demandCycle.variance} is outside [0, 1]`);
      }
    }
  }
  info(`${locations.length} locations OK`);

  // --- Validate corridors ---
  section('Validating corridors');
  const validCorridorTypes = ['land', 'maritime', 'air'];
  for (const corridor of corridors) {
    if (!locationIds.has(corridor.locationA)) error(`Corridor has unknown location "${corridor.locationA}"`);
    if (!locationIds.has(corridor.locationB)) error(`Corridor has unknown location "${corridor.locationB}"`);
    if (corridor.locationA === corridor.locationB) error(`Corridor connects "${corridor.locationA}" to itself`);
    if (corridor.cost <= 0) error(`Corridor ${corridor.locationA} <-> ${corridor.locationB} must have positive cost`);
    if (!validCorridorTypes.includes(corridor.type)) {
      warn(`Corridor ${corridor.locationA} <-> ${corridor.locationB} has unknown type "${corridor.type}" (expected: ${validCorridorTypes.join(', ')})`);
    }
  }
  const corridorKeys = new Set<string>();
  for (const c of corridors) {
    const key = [c.locationA, c.locationB].sort().join('|');
    if (corridorKeys.has(key)) warn(`Duplicate corridor: ${c.locationA} <-> ${c.locationB}`);
    corridorKeys.add(key);
  }
  info(`${corridors.length} corridors OK`);

  // --- Validate connectivity ---
  section('Validating corridor network connectivity');
  if (locations.length > 1) {
    const adj: Record<string, Set<string>> = {};
    for (const loc of locations) adj[loc.id] = new Set();
    for (const c of corridors) {
      adj[c.locationA]?.add(c.locationB);
      adj[c.locationB]?.add(c.locationA);
    }
    const visited = new Set<string>();
    const queue = [locations[0].id];
    visited.add(locations[0].id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of adj[current] ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    const unreachable = locations.filter((l) => !visited.has(l.id));
    if (unreachable.length > 0) {
      error(`Network NOT connected! Unreachable from "${locations[0].id}": ${unreachable.map(l => l.id).join(', ')}`);
    } else {
      info(`All ${locations.length} locations are connected`);
    }
  } else {
    info('Only 0-1 locations, connectivity trivially OK');
  }

  // --- Validate shortest paths ---
  section('Validating shortest paths (all pairs)');
  for (const from of locations) {
    for (const to of locations) {
      if (from.id === to.id) continue;
      const path = dijkstra(corridors, locations, from.id, to.id);
      if (!path) {
        error(`No path from "${from.id}" to "${to.id}"`);
      }
    }
  }
  info('All location pairs are reachable');

  // Print path table
  section('Shortest path table (corridor cost only, no local transport)');
  const header = ['From \\ To', ...locations.map(l => l.id)];
  console.log(`  ${header.join('\t')}`);
  for (const from of locations) {
    const row = [from.id];
    for (const to of locations) {
      if (from.id === to.id) {
        row.push('-');
      } else {
        const path = dijkstra(corridors, locations, from.id, to.id);
        row.push(path ? `${path.cost}` : 'X');
      }
    }
    console.log(`  ${row.join('\t')}`);
  }

  // --- Validate settings ---
  section('Validating settings');
  for (const [level, ms] of Object.entries(settings.tickSpeeds)) {
    const levelNum = parseInt(level);
    if (isNaN(levelNum) || levelNum < 1 || levelNum > 5) warn(`Unexpected speed level "${level}"`);
    if (ms < 0) error(`Speed level "${level}" must have non-negative ms (got ${ms})`);
  }
  if (settings.defaultSpeed < 1 || settings.defaultSpeed > 5) {
    error(`Default speed ${settings.defaultSpeed} must be between 1 and 5`);
  }
  if (!settings.tickSpeeds[String(settings.defaultSpeed)]) {
    warn(`Default speed ${settings.defaultSpeed} is not defined in tickSpeeds`);
  }
  info('Settings OK');

  // --- Validate scenario entities ---
  section('Validating scenario entities');
  const dupEntities = scenarioEntities.map(e => e.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dupEntities.length > 0) error(`Duplicate scenario entity IDs: ${dupEntities.join(', ')}`);
  for (const entity of scenarioEntities) {
    if (!entity.id) error('Scenario entity missing id');
    if (!entityTypeIds.has(entity.type)) error(`Entity "${entity.id}" has unknown type "${entity.type}"`);
    if (!locationIds.has(entity.locationId)) error(`Entity "${entity.id}" has unknown location "${entity.locationId}"`);
    for (const res of Object.keys(entity.inventory)) {
      if (!resourceIds.has(res)) error(`Entity "${entity.id}" has unknown resource "${res}" in inventory`);
    }
    if (entity.suppliers) {
      for (const [res, supplierIds] of Object.entries(entity.suppliers)) {
        if (!resourceIds.has(res)) error(`Entity "${entity.id}" has unknown resource "${res}" in suppliers`);
        for (const supplierId of supplierIds) {
          if (!scenarioEntityIds.has(supplierId)) {
            error(`Entity "${entity.id}" references unknown supplier "${supplierId}" for resource "${res}"`);
          }
        }
      }
    }
  }
  if (!scenarioEntityIds.has(defaultPlayerEntity)) {
    error(`Default player entity "${defaultPlayerEntity}" not found in scenario entities`);
  }
  info(`${scenarioEntities.length} scenario entities OK`);

  // --- Summary ---
  console.log('\n========================================');
  if (errorCount === 0 && warnCount === 0) {
    console.log('All validations passed!');
  } else {
    if (errorCount > 0) console.log(`${errorCount} error(s) found.`);
    if (warnCount > 0) console.log(`${warnCount} warning(s) found.`);
  }
  console.log('========================================\n');

  if (errorCount > 0) process.exit(1);
}

// ============================================================================
// Dijkstra (standalone, for validation)
// ============================================================================

function dijkstra(
  corridors: CorridorConfig[],
  locations: LocationConfig[],
  from: string,
  to: string
): { cost: number; path: string[] } | null {
  if (from === to) return { cost: 0, path: [from] };

  const adj: Record<string, { neighbor: string; cost: number }[]> = {};
  for (const loc of locations) adj[loc.id] = [];
  for (const c of corridors) {
    adj[c.locationA]?.push({ neighbor: c.locationB, cost: c.cost });
    adj[c.locationB]?.push({ neighbor: c.locationA, cost: c.cost });
  }

  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const visited = new Set<string>();

  for (const loc of locations) {
    dist[loc.id] = Infinity;
    prev[loc.id] = null;
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

  if (dist[to] === Infinity) return null;

  const path: string[] = [];
  let node: string | null = to;
  while (node !== null) {
    path.unshift(node);
    node = prev[node];
  }

  return { cost: dist[to], path };
}

// ============================================================================
// Run
// ============================================================================

main();
