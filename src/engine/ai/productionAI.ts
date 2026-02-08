/**
 * Production AI — decides which production lines to start/stop for AI-controlled entities.
 *
 * Tweakable parameters are at the top of this file.
 * Each decision function takes the entity context and returns actions to take.
 */

import type {
  Entity,
  GameState,
  GameConfig,
  EntityTypeConfig,
  ProcessLine,
  ProductionProcess,
} from '../../types/game';
import { getProductionProcess } from '../configLoader';

// ============================================================================
// TWEAKABLE PARAMETERS
// ============================================================================

/** Threshold above which a mine-like entity (no inputs) pauses production */
export const MINE_MAX_STOCK = 30;

// ============================================================================
// DECISION TYPES
// ============================================================================

export interface ProductionDecision {
  /** Production process lines to start: { processId, volume } */
  linesToStart: { processId: string; volume: number }[];
  /** IDs of process lines to stop */
  linesToStop: string[];
}

// ============================================================================
// MAIN DECISION FUNCTION
// ============================================================================

/**
 * Decide which production lines to start/stop for an AI entity.
 * Called once per tick for each AI-controlled entity that has production processes.
 */
export function decideProduction(
  entity: Entity,
  entityType: EntityTypeConfig,
  entityLines: ProcessLine[],
  _state: GameState,
  config: GameConfig,
): ProductionDecision {
  const decision: ProductionDecision = { linesToStart: [], linesToStop: [] };

  const availableSlots = entityType.maxProcessLines - entityLines.length;

  for (const processId of entityType.processes.production) {
    const process = getProductionProcess(config, processId);
    const linesForProcess = entityLines.filter((l) => l.processId === processId);

    if (isSourceProcess(process)) {
      // Mine-like: no inputs, just produces
      decideSourceProduction(entity, process, linesForProcess, availableSlots, decision);
    } else {
      // Normal production: needs inputs
      decideNormalProduction(entity, process, linesForProcess, availableSlots, decision);
    }
  }

  return decision;
}

// ============================================================================
// HELPER: is this a source process (no inputs)?
// ============================================================================

function isSourceProcess(process: ProductionProcess): boolean {
  return process.cycleInputs.length === 0 && process.tickInputs.length === 0;
}

// ============================================================================
// SOURCE PRODUCTION (mines, extractors — no inputs)
// ============================================================================

function decideSourceProduction(
  entity: Entity,
  process: ProductionProcess,
  linesForProcess: ProcessLine[],
  availableSlots: number,
  decision: ProductionDecision,
): void {
  const outputResource = process.outputs[0]?.resource;
  if (!outputResource) return;

  const currentStock = entity.inventory[outputResource] ?? 0;

  if (currentStock >= MINE_MAX_STOCK) {
    // Overstocked — stop all lines for this process
    for (const line of linesForProcess) {
      decision.linesToStop.push(line.id);
    }
  } else if (linesForProcess.length === 0 && availableSlots > 0) {
    // No lines running and have capacity — start one
    decision.linesToStart.push({ processId: process.id, volume: process.minVolume });
  }
}

// ============================================================================
// NORMAL PRODUCTION (needs inputs)
// ============================================================================

function decideNormalProduction(
  entity: Entity,
  process: ProductionProcess,
  linesForProcess: ProcessLine[],
  availableSlots: number,
  decision: ProductionDecision,
): void {
  // Start a line if none running and have inputs
  if (linesForProcess.length === 0 && availableSlots > 0) {
    if (hasRequiredInputs(entity, process, process.minVolume)) {
      decision.linesToStart.push({ processId: process.id, volume: process.minVolume });
    }
  }
}

// ============================================================================
// HELPER: check if entity has enough inputs to start a cycle at given volume
// ============================================================================

function hasRequiredInputs(entity: Entity, process: ProductionProcess, volume: number): boolean {
  for (const input of process.cycleInputs) {
    if ((entity.inventory[input.resource] ?? 0) < input.quantity * volume) {
      return false;
    }
  }
  for (const input of process.tickInputs) {
    if ((entity.inventory[input.resource] ?? 0) < input.quantity * volume) {
      return false;
    }
  }
  return true;
}
