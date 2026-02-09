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
  resource: string;
}

/** Procurement process - entity can buy this resource from suppliers */
export interface ProcurementProcess {
  id: string;
  name: string;
  resource: string;
}

/** Fulfillment process - entity can fulfill orders for this resource */
export interface FulfillmentProcess {
  id: string;
  name: string;
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
  maxProcessLines: number;
  processes: EntityTypeProcesses;
}

// --------------------------------------------------------------------------
// Locations (from locations.json)
// --------------------------------------------------------------------------

export interface DemandPhase {
  name: string;
  ticks: number;
  multiplier: number;
}

export interface DemandCycleConfig {
  phases: DemandPhase[];
  variance: number;
}

export interface LocationConfig {
  id: string;
  name: string;
  localTransportTicks: number;
  demand: Record<string, number>;
  demandCycle?: DemandCycleConfig;
}

export type CorridorType = 'land' | 'maritime' | 'air';

export interface CorridorConfig {
  locationA: string;
  locationB: string;
  cost: number;
  type: CorridorType;
}

export interface LocationsConfig {
  locations: LocationConfig[];
  corridors: CorridorConfig[];
}

// --------------------------------------------------------------------------
// Pricing (from pricing.json)
// --------------------------------------------------------------------------

export interface PricingConfig {
  /** Base wholesale prices per resource */
  basePrices: Record<string, number>;
  /** Retail prices per resource (what consumers pay) */
  retailPrices: Record<string, number>;
  /** Storage cost per unit per tick */
  storageCostPerUnit: number;
}

// --------------------------------------------------------------------------
// Settings (from settings.json)
// --------------------------------------------------------------------------

export interface SettingsConfig {
  tickSpeeds: Record<string, number>;
  defaultSpeed: number;
  /** Ticks a contract proposal must wait before seller can evaluate */
  contractWaitTicks: number;
  /** Default penalty rate: fraction of pricePerUnit charged per missed unit */
  contractDefaultPenaltyRate: number;
  /** Default cancellation threshold: fraction of totalUnits missed that cancels contract */
  contractDefaultCancellationThreshold: number;
}

// --------------------------------------------------------------------------
// Scenario (from scenario.json)
// --------------------------------------------------------------------------

export interface ScenarioEntity {
  id: string;
  type: string;
  name: string;
  locationId: string;
  inventory: Record<string, number>;
  suppliers?: Record<string, string[]>;
  /** Starting money balance */
  money?: number;
}

export interface ScenarioConfig {
  name: string;
  description: string;
  entities: ScenarioEntity[];
  defaultPlayerEntity: string;
}

// --------------------------------------------------------------------------
// Full game config
// --------------------------------------------------------------------------

export interface GameConfig {
  resources: ResourceConfig[];
  processes: ProcessesConfig;
  entityTypes: Record<string, EntityTypeConfig>;
  locations: LocationConfig[];
  corridors: CorridorConfig[];
  scenario: ScenarioConfig;
  pricing: PricingConfig;
  tickSpeeds: Record<string, number>;
  defaultSpeed: number;
  contractWaitTicks: number;
  contractDefaultPenaltyRate: number;
  contractDefaultCancellationThreshold: number;
}

// ============================================================================
// RUNTIME TYPES (game state)
// ============================================================================

export type Inventory = Record<string, number>;

export interface Entity {
  id: string;
  type: string;
  name: string;
  locationId: string;
  inventory: Inventory;
  committed: Inventory;
  isPlayerControlled: boolean;
  suppliers: Record<string, string[]>;
  /** Current money balance (can go negative) */
  money: number;
}

export type ProcessLinePhase = 'starting' | 'running';

export interface ProcessLine {
  id: string;
  processId: string;
  entityId: string;
  phase: ProcessLinePhase;
  startupTicksRemaining: number;
  progress: number;
  volume: number;
}

export type OrderStatus = 'pending' | 'accepted' | 'in_transit' | 'delivered' | 'declined';

export interface Order {
  id: string;
  placedAtTick: number;
  deliveredAtTick?: number;
  buyerEntityId: string;
  sellerEntityId: string;
  resource: string;
  requestedQuantity: number;
  fulfilledQuantity: number;
  wasAmended: boolean;
  status: OrderStatus;
  /** Price per unit for this order */
  pricePerUnit: number;
  /** If this order is from a contract, reference its ID */
  contractId?: string;
}

export interface Delivery {
  id: string;
  orderId: string;
  fromEntityId: string;
  toEntityId: string;
  resource: string;
  quantity: number;
  ticksRemaining: number;
  route: string[];
  /** Price per unit (for payment on delivery) */
  pricePerUnit: number;
}

// --------------------------------------------------------------------------
// Contracts
// --------------------------------------------------------------------------

export type ContractStatus = 'proposed' | 'active' | 'completed' | 'cancelled';

export interface Contract {
  id: string;
  buyerEntityId: string;
  sellerEntityId: string;
  resource: string;
  /** Price per unit agreed upon */
  pricePerUnit: number;
  /** Units to deliver each scheduled delivery */
  unitsPerDelivery: number;
  /** Ticks between deliveries */
  deliveryInterval: number;
  /** Total units over the contract lifetime */
  totalUnits: number;
  /** Units successfully shipped so far */
  unitsShipped: number;
  /** Units missed (could not deliver on schedule) */
  unitsMissed: number;
  /** Money penalty per missed unit */
  penaltyPerUnit: number;
  /** Contract cancelled if unitsMissed / totalUnits exceeds this */
  cancellationThreshold: number;
  /** Tick when proposed */
  proposedAtTick: number;
  /** Tick when accepted (undefined if still proposed) */
  acceptedAtTick?: number;
  /** Next tick when a delivery is due (for active contracts) */
  nextDeliveryTick: number;
  status: ContractStatus;
}

// --------------------------------------------------------------------------
// Player orders
// --------------------------------------------------------------------------

/** Details for proposing a contract */
export interface ContractProposal {
  supplierId: string;
  resource: string;
  unitsPerDelivery: number;
  deliveryInterval: number;
  totalUnits: number;
  pricePerUnit: number;
}

export interface PlayerOrder {
  entityId: string;
  action: 'start_line' | 'stop_line' | 'order' | 'set_volume' | 'propose_contract' | 'accept_contract' | 'decline_contract';
  /** Process ID (for start_line), resource ID (for order), or contract ID (for accept/decline_contract) */
  targetId: string;
  /** For order: quantity. For start_line: initial volume. For set_volume: new volume. */
  quantity: number;
  supplierId?: string;
  lineId?: string;
  contractProposal?: ContractProposal;
}

// --------------------------------------------------------------------------
// Demand & stats
// --------------------------------------------------------------------------

export interface DemandPhaseState {
  phaseIndex: number;
  ticksInPhase: number;
}

export interface ResourceSalesStats {
  totalSold: number;
  totalDemand: number;
  lostSales: number;
}

// --------------------------------------------------------------------------
// Order book entry (computed, not stored)
// --------------------------------------------------------------------------

export interface OrderBookEntry {
  tick: number;
  contractId: string;
  resource: string;
  quantity: number;
  counterpartyId: string;
  direction: 'incoming' | 'outgoing';
}

// --------------------------------------------------------------------------
// Full game state
// --------------------------------------------------------------------------

export interface GameState {
  tick: number;
  entities: Entity[];
  processLines: ProcessLine[];
  orders: Order[];
  deliveries: Delivery[];
  contracts: Contract[];
  demandPhases: Record<string, DemandPhaseState>;
  sales: Record<string, Record<string, ResourceSalesStats>>;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface SupplierOption {
  entityId: string;
  entityName: string;
  availableStock: number;
  transportTicks: number;
}

export interface PathResult {
  cost: number;
  path: string[];
}
