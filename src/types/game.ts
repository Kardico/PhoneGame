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

// --------------------------------------------------------------------------
// Process categories (from processes.json)
// --------------------------------------------------------------------------

/** Production process - transforms inputs into outputs over time */
export interface ProductionProcess {
  id: string;
  name: string;
  /** Fixed inputs consumed once when a line starts up (NOT scaled by volume) */
  startupInputs: ResourceAmount[];
  /** Inputs consumed at the start of each production cycle (scaled by volume) */
  cycleInputs: ResourceAmount[];
  /** Inputs consumed every tick while the line is running (scaled by volume) */
  tickInputs: ResourceAmount[];
  /** Outputs produced when a cycle completes (scaled by volume) */
  outputs: ResourceAmount[];
  /** Number of ticks per production cycle (at volume 1) */
  cycleTicks: number;
  /** Number of ticks to start up a new line */
  startupTicks: number;
  /** Minimum volume (scale factor for cycle/tick inputs and outputs) */
  minVolume: number;
  /** Maximum volume (scale factor for cycle/tick inputs and outputs) */
  maxVolume: number;
}

/** Retail process - sells a resource to consumers at a location */
export interface RetailProcess {
  id: string;
  name: string;
  /** Which resource this retail process sells */
  resource: string;
}

/** Procurement process - entity can buy this resource from suppliers */
export interface ProcurementProcess {
  id: string;
  name: string;
  /** Which resource this procurement process acquires */
  resource: string;
}

/** Fulfillment process - entity can fulfill orders for this resource */
export interface FulfillmentProcess {
  id: string;
  name: string;
  /** Which resource this fulfillment process ships */
  resource: string;
}

/** All process definitions grouped by category */
export interface ProcessesConfig {
  production: ProductionProcess[];
  retail: RetailProcess[];
  procurement: ProcurementProcess[];
  fulfillment: FulfillmentProcess[];
}

// --------------------------------------------------------------------------
// Entity types (from entity-types.json)
// --------------------------------------------------------------------------

/** Process IDs that an entity type can run, grouped by category */
export interface EntityTypeProcesses {
  production: string[];
  retail: string[];
  procurement: string[];
  fulfillment: string[];
}

/** Entity type definition from entity-types.json */
export interface EntityTypeConfig {
  name: string;
  canHold: string[];
  /** Maximum number of process lines that can run simultaneously */
  maxProcessLines: number;
  /** Process IDs this entity type can use, by category */
  processes: EntityTypeProcesses;
}

// --------------------------------------------------------------------------
// Locations (from locations.json)
// --------------------------------------------------------------------------

/** Demand phase in a location's cycle */
export interface DemandPhase {
  name: string;
  ticks: number;
  multiplier: number;
}

/** Demand cycle configuration (per-location) */
export interface DemandCycleConfig {
  phases: DemandPhase[];
  variance: number;
}

/** Location definition from locations.json */
export interface LocationConfig {
  id: string;
  name: string;
  localTransportTicks: number;
  /** Per-resource base demand at this location (e.g. { "smartphones": 8 }) */
  demand: Record<string, number>;
  /** Optional demand cycle for this location (only needed if demand > 0) */
  demandCycle?: DemandCycleConfig;
}

/** Corridor type for transport links */
export type CorridorType = 'land' | 'maritime' | 'air';

/** Bi-directional corridor between two locations */
export interface CorridorConfig {
  locationA: string;
  locationB: string;
  /** Cost in ticks to traverse this corridor (excluding local transport) */
  cost: number;
  type: CorridorType;
}

/** Full locations config file structure */
export interface LocationsConfig {
  locations: LocationConfig[];
  corridors: CorridorConfig[];
}

// --------------------------------------------------------------------------
// Settings (from settings.json)
// --------------------------------------------------------------------------

/** Game settings */
export interface SettingsConfig {
  /** Map of speed level (1-5) to milliseconds per tick (0 = as fast as possible) */
  tickSpeeds: Record<string, number>;
  /** Default speed level on game start */
  defaultSpeed: number;
}

// --------------------------------------------------------------------------
// Scenario (from scenario.json)
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// Full game config
// --------------------------------------------------------------------------

/** Full game configuration (all config files combined) */
export interface GameConfig {
  resources: ResourceConfig[];
  /** All process definitions by category */
  processes: ProcessesConfig;
  entityTypes: Record<string, EntityTypeConfig>;
  locations: LocationConfig[];
  corridors: CorridorConfig[];
  scenario: ScenarioConfig;
  /** Tick speed settings */
  tickSpeeds: Record<string, number>;
  defaultSpeed: number;
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
  /** Stock reserved for accepted-but-not-yet-shipped orders */
  committed: Inventory;
  isPlayerControlled: boolean;
  /** Map of resource ID -> list of potential supplier entity IDs */
  suppliers: Record<string, string[]>;
}

/** Phase of a running process line */
export type ProcessLinePhase = 'starting' | 'running';

/** A running instance of a production process (continuous production line) */
export interface ProcessLine {
  id: string;
  /** Production process ID (references processes.production) */
  processId: string;
  entityId: string;
  /** Current phase: starting up or actively running */
  phase: ProcessLinePhase;
  /** Ticks remaining in startup (only relevant when phase === 'starting') */
  startupTicksRemaining: number;
  /** Progress towards cycle completion: 0 to cycleTicks */
  progress: number;
  /** Current volume (between minVolume and maxVolume) */
  volume: number;
}

/** Order status */
export type OrderStatus = 'pending' | 'accepted' | 'in_transit' | 'delivered' | 'declined';

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
  /** What the seller actually committed to ship (may be less if stock was low) */
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
  /** Route as list of location IDs from origin to destination (includes both endpoints) */
  route: string[];
}

/** Player's action for the next tick */
export interface PlayerOrder {
  entityId: string;
  /** start_line: start a new process line. stop_line: stop an existing line. order: order resources. */
  action: 'start_line' | 'stop_line' | 'order';
  /** Process ID (for start_line) or resource ID (for order) */
  targetId: string;
  /** For order: quantity. For start_line: initial volume. */
  quantity: number;
  /** For orders: which supplier to order from (if not specified, picks best available) */
  supplierId?: string;
  /** For stop_line: which specific process line to stop */
  lineId?: string;
}

/** Tracks current position in a location's demand cycle */
export interface DemandPhaseState {
  phaseIndex: number;
  ticksInPhase: number;
}

/** Statistics for tracking sales (per resource) */
export interface ResourceSalesStats {
  totalSold: number;
  totalDemand: number;
  lostSales: number;
}

/** Full game state */
export interface GameState {
  tick: number;
  entities: Entity[];
  /** Active process lines (continuous production) */
  processLines: ProcessLine[];
  /** All orders (including history) */
  orders: Order[];
  /** Active deliveries in transit */
  deliveries: Delivery[];
  /** Per-location demand phase state: locationId -> DemandPhaseState */
  demandPhases: Record<string, DemandPhaseState>;
  /** Sales stats: entityId -> resourceId -> ResourceSalesStats */
  sales: Record<string, Record<string, ResourceSalesStats>>;
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

/** Result of shortest-path computation */
export interface PathResult {
  /** Total corridor cost (does NOT include local transport at endpoints) */
  cost: number;
  /** List of location IDs from origin to destination (inclusive) */
  path: string[];
}
