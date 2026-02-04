import type { Entity, GameState, Inventory } from '../types/game';

const ENTITY_IDS = {
  mineral_mine: 'entity-mine',
  chip_processor: 'entity-chip',
  assembler: 'entity-assembler',
  retailer: 'entity-retailer',
} as const;

function makeEntity(
  kind: Entity['kind'],
  name: string,
  inventory: Inventory,
  isPlayerControlled: boolean
): Entity {
  return {
    id: ENTITY_IDS[kind],
    kind,
    name,
    inventory: { ...inventory },
    isPlayerControlled,
  };
}

/** Creates the default 4-entity smartphone supply chain with starting inventory. */
export function createInitialState(controlledEntityId: string | null = null): GameState {
  const entities: Entity[] = [
    makeEntity(
      'mineral_mine',
      'Mineral Mine',
      { raw_materials: 20 },
      controlledEntityId === ENTITY_IDS.mineral_mine
    ),
    makeEntity(
      'chip_processor',
      'Chip Processor',
      { raw_materials: 0, chips: 10 },
      controlledEntityId === ENTITY_IDS.chip_processor
    ),
    makeEntity(
      'assembler',
      'Assembler',
      { chips: 0, smartphones: 8 },
      controlledEntityId === ENTITY_IDS.assembler
    ),
    makeEntity(
      'retailer',
      'Retailer',
      { smartphones: 5 },
      controlledEntityId === ENTITY_IDS.retailer
    ),
  ];

  return {
    tick: 0,
    entities,
    tasks: [],
  };
}

export { ENTITY_IDS };
