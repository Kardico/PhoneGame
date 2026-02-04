/**
 * Supply Chain Simulation – Smartphone Manufacturing
 * TypeScript types for config-driven entity/process system.
 */

// ============================================================================
// CONFIG TYPES (loaded from JSON)
// ============================================================================

/** Resource definition from resources.json */
export interface ResourceConfig {
  id: string;
  name: string;
  icon?: string;
}

/** A quantity of a resource (used in process inputs/outputs) */
export interface ResourceAmount {
  resource: string;
  quantity: number;
}

/** Process definition - what an entity CAN do */
export interface Process {
  id: string;
  name: string;
  inputs: ResourceAmount[];
  outputs: ResourceAmount[];
  ticks: number;
}

/** Entity type definition from entity-types.json */
export interface EntityTypeConfig {
  name: string;
  canHold: string[];
  maxConcurrentJobs: number;
  processes: Process[];
}

/** Location definition from locations.json */
export interface LocationConfig {
  id: string;
  name: string;
  localTransportTicks: number;
  baseDemand: number;
}

/** Route between two locations */
export interface RouteConfig {
  from: string;
  to: string;
  ticks: number;
}

/** Demand phase in the cycle */
export interface DemandPhase {
  name: string;
  ticks: number;
  multiplier: number;
}

/** Demand cycle configuration */
export interface DemandCycleConfig {
  phases: DemandPhase[];
  variance: number;
}

/** Full locations config file structure */
export interface LocationsConfig {
  locations: LocationConfig[];
  routes: RouteConfig[];
  demandCycle: DemandCycleConfig;
}

/** Entity definition in scenario */
export interface ScenarioEntity {
  id: string;
  type: string;
  name: string;
  locationId: string;
  inventory: Record<string, number>;
  /** Map of resource ID -> list of potential supplier entity IDs */
  suppliers?: Record<string, string[]>;
}

/** Scenario configuration from scenario.json */
export interface ScenarioConfig {
  name: string;
  description: string;
  entities: ScenarioEntity[];
  defaultPlayerEntity: string;
}

/** Full game configuration (all config files combined) */
export interface GameConfig {
  resources: ResourceConfig[];
  entityTypes: Record<string, EntityTypeConfig>;
  locations: LocationConfig[];
  routes: RouteConfig[];
  demandCycle: DemandCycleConfig;
  scenario: ScenarioConfig;
}

// ============================================================================
// RUNTIME TYPES (game state)
// ============================================================================

/** Inventory is a map of resource ID to quantity */
export type Inventory = Record<string, number>;

/** Runtime entity in the game */
export interface Entity {
  id: string;
  type: string;
  name: string;
  locationId: string;
  inventory: Inventory;
  isPlayerControlled: boolean;
  /** Map of resource ID -> list of potential supplier entity IDs */
  suppliers: Record<string, string[]>;
}

/** A running instance of a process (production job) */
export interface Job {
  id: string;
  processId: string;
  entityId: string;
  /** Cached outputs for when job completes */
  outputs: ResourceAmount[];
  ticksRemaining: number;
}

/** Order status */
export type OrderStatus = 'pending' | 'in_transit' | 'delivered';

/** An order placed by a buyer to a seller */
export interface Order {
  id: string;
  /** Tick when order was placed */
  placedAtTick: number;
  /** Tick when order was delivered (if delivered) */
  deliveredAtTick?: number;
  /** Entity placing the order (buyer) */
  buyerEntityId: string;
  /** Entity receiving the order (seller) */
  sellerEntityId: string;
  resource: string;
  /** What the buyer requested */
  requestedQuantity: number;
  /** What the seller actually shipped (may be less if stock was low) */
  fulfilledQuantity: number;
  /** Whether the order was amended (fulfilled < requested) */
  wasAmended: boolean;
  status: OrderStatus;
}

/** A delivery in transit (shipment from seller to buyer) */
export interface Delivery {
  id: string;
  /** Reference to the order this fulfills */
  orderId: string;
  fromEntityId: string;
  toEntityId: string;
  resource: string;
  quantity: number;
  ticksRemaining: number;
}

/** Player's action for the next tick */
export interface PlayerOrder {
  entityId: string;
  /** For producers: start a job. For others: order from upstream. */
  action: 'produce' | 'order';
  /** Process ID (for produce) or resource ID (for order) */
  targetId: string;
  quantity: number;
  /** For orders: which supplier to order from (if not specified, picks best available) */
  supplierId?: string;
}

/** Tracks current position in demand cycle */
export interface DemandPhaseState {
  phaseIndex: number;
  ticksInPhase: number;
}

/** Statistics for tracking sales */
export interface SalesStats {
  totalSold: number;
  totalDemand: number;
  lostSales: number;
}

/** Full game state */
export interface GameState {
  tick: number;
  entities: Entity[];
  jobs: Job[];
  /** All orders (including history) */
  orders: Order[];
  /** Active deliveries in transit */
  deliveries: Delivery[];
  demandPhase: DemandPhaseState;
  /** Sales stats per retailer entity ID */
  sales: Record<string, SalesStats>;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/** Result of finding suppliers */
export interface SupplierOption {
  entityId: string;
  entityName: string;
  availableStock: number;
  transportTicks: number;
}
