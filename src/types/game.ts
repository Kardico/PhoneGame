/**
 * Supply chain simulation – Smartphone Manufacturing (Beer Game style)
 * Strict TypeScript data model for entities, tasks, and game state.
 */

// ---- Resources (what flows through the chain) ----
export type ResourceKind = 'raw_materials' | 'chips' | 'smartphones';

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  raw_materials: 'Raw Materials',
  chips: 'Chips',
  smartphones: 'Smartphones',
};

// ---- Entity kinds (stages in the chain) ----
export type EntityKind = 'mineral_mine' | 'chip_processor' | 'assembler' | 'retailer';

export const ENTITY_LABELS: Record<EntityKind, string> = {
  mineral_mine: 'Mineral Mine',
  chip_processor: 'Chip Processor',
  assembler: 'Assembler',
  retailer: 'Retailer',
};

/** Inventory is keyed by resource; each entity only holds relevant resources. */
export type Inventory = Partial<Record<ResourceKind, number>>;

/** Single entity in the supply chain. */
export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  /** Current stock per resource (only keys used by this entity). */
  inventory: Inventory;
  /** If true, player controls ordering; otherwise AI uses simple "order when low" logic. */
  isPlayerControlled: boolean;
}

// ---- Tasks (delayed actions) ----

export type TaskKind = 'production' | 'transport';

/** Production runs at an entity and adds output to its inventory when done. */
export interface ProductionTask {
  type: 'production';
  id: string;
  entityId: string;
  ticksRemaining: number;
  /** Resource produced (e.g. raw_materials, chips, smartphones). */
  outputResource: ResourceKind;
  quantity: number;
}

/** Shipment between two entities; completes at destination. */
export interface TransportTask {
  type: 'transport';
  id: string;
  fromEntityId: string;
  toEntityId: string;
  resource: ResourceKind;
  quantity: number;
  ticksRemaining: number;
}

export type Task = ProductionTask | TransportTask;

// ---- Orders (demand / upstream requests) ----
/** Represents a pending or desired order (e.g. "order 10 chips from processor"). */
export interface Order {
  fromEntityId: string;  // who we order from (upstream)
  resource: ResourceKind;
  quantity: number;
  /** If set, this order is already in flight as a TransportTask. */
  transportTaskId?: string;
}

/** Player's chosen action for the next tick (order quantity, or for mine: produce quantity). */
export interface PlayerOrder {
  entityId: string;
  /** For mine: 0 = do not produce, 1+ = produce that many. For others: order this many from upstream. */
  quantity: number;
}

// ---- Game state ----
export interface GameState {
  /** Current simulation tick (e.g. 1 tick = 1 day). */
  tick: number;
  entities: Entity[];
  /** Active production and in-flight shipments. */
  tasks: Task[];
}
