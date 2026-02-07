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

interface Process {
  id: string;
  name: string;
  cycleInputs: ResourceAmount[];
  tickInputs: ResourceAmount[];
  outputs: ResourceAmount[];
  cycleTicks: number;
  startupTicks: number;
  minVolume: number;
  maxVolume: number;
}

interface EntityTypeConfig {
  name: string;
  canHold: string[];
  maxProcessLines: number;
  processes: Process[];
}

interface LocationConfig {
  id: string;
  name: string;
  localTransportTicks: number;
  baseDemand: number;
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
  let entityTypes: Record<string, EntityTypeConfig>;
  let locations: LocationConfig[];
  let corridors: CorridorConfig[];
  let demandPhases: { name: string; ticks: number; multiplier: number }[];
  let demandVariance: number;
  let scenarioEntities: ScenarioEntity[];
  let defaultPlayerEntity: string;

  try {
    const resourcesJson = readJson('resources.json') as { resources: ResourceConfig[] };
    resources = resourcesJson.resources;
    info(`resources.json: ${resources.length} resources`);
  } catch (e) {
    error(`Failed to read resources.json: ${e}`);
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
      demandCycle: { phases: { name: string; ticks: number; multiplier: number }[]; variance: number };
    };
    locations = locationsJson.locations;
    corridors = locationsJson.corridors;
    demandPhases = locationsJson.demandCycle.phases;
    demandVariance = locationsJson.demandCycle.variance;
    info(`locations.json: ${locations.length} locations, ${corridors.length} corridors, ${demandPhases.length} demand phases`);
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

  const resourceIds = new Set(resources.map((r) => r.id));
  const locationIds = new Set(locations.map((l) => l.id));
  const entityTypeIds = new Set(Object.keys(entityTypes));
  const scenarioEntityIds = new Set(scenarioEntities.map((e) => e.id));

  // --- Validate resources ---
  section('Validating resources');
  for (const res of resources) {
    if (!res.id) error('Resource missing id');
    if (!res.name) error(`Resource "${res.id}" missing name`);
  }
  const dupResources = resources.map(r => r.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dupResources.length > 0) error(`Duplicate resource IDs: ${dupResources.join(', ')}`);
  info(`${resources.length} resources OK`);

  // --- Validate entity types ---
  section('Validating entity types');
  for (const [typeId, et] of Object.entries(entityTypes)) {
    // canHold
    for (const res of et.canHold) {
      if (!resourceIds.has(res)) error(`Entity type "${typeId}" canHold unknown resource "${res}"`);
    }
    // maxProcessLines
    if (et.maxProcessLines < 0) error(`Entity type "${typeId}" maxProcessLines must be non-negative`);
    // processes
    for (const proc of et.processes) {
      if (!proc.id) error(`Process in "${typeId}" missing id`);
      if (!proc.name) error(`Process "${proc.id}" in "${typeId}" missing name`);
      if (proc.cycleTicks <= 0) error(`Process "${proc.id}" in "${typeId}" cycleTicks must be positive`);
      if (proc.startupTicks < 0) error(`Process "${proc.id}" in "${typeId}" startupTicks must be non-negative`);
      if (proc.minVolume <= 0) error(`Process "${proc.id}" in "${typeId}" minVolume must be positive`);
      if (proc.maxVolume <= 0) error(`Process "${proc.id}" in "${typeId}" maxVolume must be positive`);
      if (proc.minVolume > proc.maxVolume) error(`Process "${proc.id}" in "${typeId}" minVolume > maxVolume`);
      for (const input of proc.cycleInputs) {
        if (!resourceIds.has(input.resource)) error(`Process "${proc.id}" in "${typeId}" has unknown cycleInput "${input.resource}"`);
        if (input.quantity <= 0) error(`Process "${proc.id}" in "${typeId}" cycleInput "${input.resource}" must have positive quantity`);
      }
      for (const input of proc.tickInputs) {
        if (!resourceIds.has(input.resource)) error(`Process "${proc.id}" in "${typeId}" has unknown tickInput "${input.resource}"`);
        if (input.quantity <= 0) error(`Process "${proc.id}" in "${typeId}" tickInput "${input.resource}" must have positive quantity`);
      }
      for (const output of proc.outputs) {
        if (!resourceIds.has(output.resource)) error(`Process "${proc.id}" in "${typeId}" has unknown output "${output.resource}"`);
        if (output.quantity <= 0) error(`Process "${proc.id}" in "${typeId}" output "${output.resource}" must have positive quantity`);
      }
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
    if (loc.baseDemand < 0) error(`Location "${loc.id}" baseDemand must be non-negative`);
  }
  info(`${locations.length} locations OK`);

  // --- Validate corridors ---
  section('Validating corridors');
  const validCorridorTypes = ['land', 'maritime', 'air'];
  for (const corridor of corridors) {
    if (!locationIds.has(corridor.locationA)) error(`Corridor has unknown location "${corridor.locationA}"`);
    if (!locationIds.has(corridor.locationB)) error(`Corridor has unknown location "${corridor.locationB}"`);
    if (corridor.locationA === corridor.locationB) error(`Corridor connects "${corridor.locationA}" to itself`);
    if (corridor.cost <= 0) error(`Corridor ${corridor.locationA} ↔ ${corridor.locationB} must have positive cost`);
    if (!validCorridorTypes.includes(corridor.type)) {
      warn(`Corridor ${corridor.locationA} ↔ ${corridor.locationB} has unknown type "${corridor.type}" (expected: ${validCorridorTypes.join(', ')})`);
    }
  }
  // Check for duplicate corridors
  const corridorKeys = new Set<string>();
  for (const c of corridors) {
    const key = [c.locationA, c.locationB].sort().join('|');
    if (corridorKeys.has(key)) warn(`Duplicate corridor: ${c.locationA} ↔ ${c.locationB}`);
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

  // --- Validate demand cycle ---
  section('Validating demand cycle');
  if (demandPhases.length === 0) error('Demand cycle must have at least one phase');
  for (const phase of demandPhases) {
    if (phase.ticks <= 0) error(`Demand phase "${phase.name}" must have positive ticks`);
    if (phase.multiplier < 0) error(`Demand phase "${phase.name}" must have non-negative multiplier`);
  }
  if (demandVariance < 0 || demandVariance > 1) warn(`Demand variance ${demandVariance} is outside [0, 1]`);
  info(`${demandPhases.length} demand phases OK`);

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
