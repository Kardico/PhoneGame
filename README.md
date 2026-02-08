# Supply Chain Simulation — Smartphone Manufacturing

A configurable, tick-based supply chain simulation. Entities mine, process, assemble, and retail smartphones through a corridor-based transport network with multi-hop routing.

## Architecture Overview

```
src/
  config/                    # JSON configuration files
    resources.json           # Resource definitions
    processes.json           # Process definitions (4 categories)
    entity-types.json        # Entity type definitions (reference processes by ID)
    locations.json           # Locations, corridors, per-location demand
    scenario.json            # Starting entities, inventory, suppliers
    settings.json            # Tick speed settings
  types/
    game.ts                  # All TypeScript interfaces
  engine/
    configLoader.ts          # Loads, validates, caches config; pathfinding
    createInitialState.ts    # Initializes GameState from config
    tickProcessor.ts         # Core tick loop (8 phases)
    ai/
      index.ts               # AI module barrel export
      productionAI.ts        # Production line start/stop decisions
      procurementAI.ts       # Ordering decisions
      fulfillmentAI.ts       # Order acceptance priority logic
  hooks/
    useTickEngine.ts         # React hook: tick loop, speed control, player input
  components/
    TopBar.tsx               # Sticky top bar (tick, speed, controls)
    DebugPanel.tsx           # Main game UI with entity cards
    RoleSelect.tsx           # Entity selection screen
    App.tsx                  # Root component
scripts/
  validateConfig.ts          # Standalone config validation script
```

## Tick Flow

Each tick executes 8 phases in strict order:

| # | Phase | Description |
|---|-------|-------------|
| 1 | **Increment tick** | `state.tick += 1` |
| 2 | **Arrivals** | Deliveries with `ticksRemaining <= 0` complete: stock added to buyer. Remaining deliveries decrement. |
| 3 | **Advance demand phases** | Each location's demand cycle advances independently. |
| 4 | **Production** | Active process lines advance: startup countdown, tick/cycle input consumption, progress, output on cycle completion. |
| 5 | **Retail selling** | Entities with retail processes sell to consumers based on per-location, per-resource demand. |
| 6 | **Entity decisions** | (a) Player action processed. (b) AI decisions: production AI starts/stops lines, procurement AI places orders. All new orders have status `'pending'`. |
| 7 | **Order acceptance** | Sellers accept/decline pending orders using fulfillment AI priority (shortest delivery time, then earliest placement). Accepted orders commit stock. |
| 8 | **Departures** | Accepted orders ship: inventory and committed stock deducted, `Delivery` objects created with route and `ticksRemaining`. |

## Process Categories

Processes are defined in `processes.json` and grouped into four categories:

### Production

Full production lines with startup, cycle inputs, tick inputs, outputs, and volume scaling.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique process ID |
| `name` | `string` | Display name |
| `startupInputs` | `ResourceAmount[]` | Consumed once when line starts (NOT scaled by volume) |
| `cycleInputs` | `ResourceAmount[]` | Consumed at start of each cycle (scaled by volume) |
| `tickInputs` | `ResourceAmount[]` | Consumed every tick while running (scaled by volume) |
| `outputs` | `ResourceAmount[]` | Produced when cycle completes (scaled by volume) |
| `cycleTicks` | `number` | Ticks per production cycle |
| `startupTicks` | `number` | Ticks to start up a new line |
| `minVolume` | `number` | Minimum volume (scale factor) |
| `maxVolume` | `number` | Maximum volume (scale factor) |

### Retail

Simple processes that sell a resource to consumers at the entity's location.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique process ID |
| `name` | `string` | Display name |
| `resource` | `string` | Resource sold to consumers |

### Procurement

Declares that an entity can buy a resource from suppliers.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique process ID |
| `name` | `string` | Display name |
| `resource` | `string` | Resource to procure |

### Fulfillment

Declares that an entity can fulfill orders for a resource.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique process ID |
| `name` | `string` | Display name |
| `resource` | `string` | Resource fulfilled |

## Entity Types (`entity-types.json`)

Each entity type references processes by ID:

```json
{
  "entityTypes": {
    "assembler": {
      "name": "Assembler",
      "canHold": ["chips", "smartphones"],
      "maxProcessLines": 3,
      "processes": {
        "production": ["assemble_phone"],
        "retail": [],
        "procurement": ["buy_chips"],
        "fulfillment": ["sell_smartphones_wholesale"]
      }
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Display name |
| `canHold` | `string[]` | Resource IDs this entity can store |
| `maxProcessLines` | `number` | Max concurrent production lines |
| `processes.production` | `string[]` | Production process IDs |
| `processes.retail` | `string[]` | Retail process IDs |
| `processes.procurement` | `string[]` | Procurement process IDs |
| `processes.fulfillment` | `string[]` | Fulfillment process IDs |

## Locations (`locations.json`)

Each location has its own demand configuration:

```json
{
  "locations": [
    {
      "id": "market_a",
      "name": "Market A",
      "localTransportTicks": 1,
      "demand": { "smartphones": 8 },
      "demandCycle": {
        "phases": [
          { "name": "Normal", "ticks": 20, "multiplier": 1.0 },
          { "name": "Peak", "ticks": 5, "multiplier": 2.0 }
        ],
        "variance": 0.15
      }
    }
  ],
  "corridors": [
    { "locationA": "mine_region", "locationB": "hot_city", "cost": 2, "type": "land" }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique location ID |
| `name` | `string` | Display name |
| `localTransportTicks` | `number` | Ticks for local transport (added at origin + destination) |
| `demand` | `Record<string, number>` | Per-resource base demand (e.g. `{ "smartphones": 8 }`) |
| `demandCycle` | `DemandCycleConfig?` | Optional demand cycle (required if demand > 0) |

Corridors are bi-directional. `cost` is the corridor traversal time in ticks (local transport is added separately at origin and destination only).

## Transport System

### Corridors

Transport links are bi-directional corridors with a cost in ticks and a type (`land`, `maritime`, `air`). Type has no gameplay effect currently.

### Multi-Hop Routing

Dijkstra's algorithm computes shortest paths between all location pairs. A path table is pre-computed and cached at startup.

**Total transport time** = `localTransport(origin)` + `corridorPathCost` + `localTransport(destination)`

Local transport is only counted at the two endpoints, not at intermediate hops.

### Delivery Tracking

Each `Delivery` object tracks its route as a list of location IDs from origin to destination:

```typescript
interface Delivery {
  route: string[];       // e.g. ["tech_city", "hot_city", "market_a"]
  ticksRemaining: number;
}
```

## Order System

### Order Lifecycle

1. **Placed** (`pending`): Buyer creates order via procurement AI or player action
2. **Accepted/Declined**: Seller evaluates pending orders using fulfillment AI priority; accepted orders commit stock
3. **In Transit** (`in_transit`): Accepted orders ship during departures phase
4. **Delivered**: Delivery arrives, stock added to buyer

### Committed Stock

When a seller accepts an order, the fulfilled quantity is marked as "committed" in the seller's inventory. This prevents the same units from being promised to multiple buyers. Committed stock is deducted from available stock calculations.

`available = inventory - committed`

## Production System

Production uses continuous process lines:

1. **Startup**: Line enters `'starting'` phase, consumes `startupInputs` (fixed, NOT volume-scaled), counts down `startupTicks`
2. **Running**: Each tick:
   - At cycle start (`progress === 0`): consume `cycleInputs` (scaled by volume)
   - Every tick: consume `tickInputs` (scaled by volume)
   - Advance progress by 1
   - On cycle completion (`progress >= cycleTicks`): produce `outputs` (scaled by volume), reset progress
3. **Starvation**: If inputs unavailable, line stalls (no progress) but stays active
4. **Stopping**: Player or AI can stop a line at any time (removes it)

## Demand System

Demand is **per-resource, per-location** with **per-location demand cycles**.

Each location with demand has its own independent cycle of phases (e.g., Normal, Growth, Peak, Decline). Phases advance independently — Market A can be in Peak while Market B is in Normal.

Actual demand per tick = `baseDemand * phaseMultiplier * (1 + random * variance)`

## Tick Speed

Five speed levels configurable in `settings.json`:

| Level | Default ms | Description |
|-------|-----------|-------------|
| 1 | 2000 | Slowest |
| 2 | 1000 | Default |
| 3 | 500 | Fast |
| 4 | 200 | Faster |
| 5 | 0 | As fast as possible (~16ms) |

The sticky top bar provides speed selection buttons.

## AI Modules

AI logic is split into modular, tweakable functions in `src/engine/ai/`:

### `productionAI.ts`

Decides which production lines to start/stop.

- **Tweakable parameter**: `MINE_MAX_STOCK` — stock threshold above which source entities pause production
- **Source processes** (no inputs): Start if no line running, stop if overstocked
- **Normal processes**: Start if no line running and inputs available

### `procurementAI.ts`

Decides what resources to order and from whom.

- **Tweakable parameters**: `AI_REORDER_THRESHOLD` (reorder below this), `AI_ORDER_QUANTITY` (order size)
- **Supplier selection**: Prefer suppliers with available stock, sorted by distance then stock

### `fulfillmentAI.ts`

Provides order acceptance priority logic.

- **`sortOrdersByPriority`**: Sorts pending orders by (1) shortest delivery time, (2) earliest placement
- **`decideOrderFulfillment`**: Determines quantity to fulfill (currently: as much as available)

## Settings (`settings.json`)

```json
{
  "tickSpeeds": { "1": 2000, "2": 1000, "3": 500, "4": 200, "5": 0 },
  "defaultSpeed": 2
}
```

## Scenario (`scenario.json`)

Defines the starting game state:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Scenario name |
| `description` | `string` | Description |
| `entities` | `ScenarioEntity[]` | Starting entities |
| `defaultPlayerEntity` | `string` | Entity ID the player controls by default |

Each entity:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique entity ID |
| `type` | `string` | References entity type in `entity-types.json` |
| `name` | `string` | Display name |
| `locationId` | `string` | Starting location |
| `inventory` | `Record<string, number>` | Starting inventory |
| `suppliers` | `Record<string, string[]>` | Resource ID -> list of supplier entity IDs |

## Runtime State (`GameState`)

| Field | Type | Description |
|-------|------|-------------|
| `tick` | `number` | Current tick number |
| `entities` | `Entity[]` | All entities with inventory, committed stock |
| `processLines` | `ProcessLine[]` | Active production lines |
| `orders` | `Order[]` | All orders (including history) |
| `deliveries` | `Delivery[]` | Active deliveries in transit |
| `demandPhases` | `Record<string, DemandPhaseState>` | Per-location demand phase state |
| `sales` | `Record<string, Record<string, ResourceSalesStats>>` | Per-entity, per-resource sales stats |

## UI Components

### `TopBar.tsx`

Sticky bar at the top of the screen. Contains:
- Tick counter
- Speed selector (1-5 buttons)
- Play / Pause / Step / Reset buttons
- Change role button

### `DebugPanel.tsx`

Main game panel. Shows entities grouped by location, each with:
- Inventory (with committed stock indicators)
- Production lines (with phase, progress, volume, stop button)
- Deliveries (incoming/outgoing with route)
- Player controls (start line, order resources with supplier selection)
- Sales stats (per-resource for retailers)
- Order history (expandable)

Per-location: demand info and current demand phase.

### `RoleSelect.tsx`

Entity selection screen. Groups entities by type. Player picks which entity to control.

## Key Engine Files

### `configLoader.ts`

- **`loadGameConfig()`**: Loads all JSON configs, validates, returns `GameConfig`
- **`validateConfig()`**: Cross-references all IDs, validates process fields, demand cycles
- **`validateCorridorConnectivity()`**: BFS to ensure all locations are connected
- **`findShortestPath()`**: Dijkstra's algorithm for corridor graph
- **`buildPathTable()`**: Pre-computes all-pairs shortest paths (cached)
- **`getTransportTime(from, to)`**: Returns total transport time (local + corridor path)
- **`getTransportRoute(from, to)`**: Returns total time and route as location ID list
- **`getProductionProcess(config, id)`**: Lookup production process by ID
- **`getRetailProcess(config, id)`**: Lookup retail process by ID
- **`getProcurementProcess(config, id)`**: Lookup procurement process by ID
- **`getFulfillmentProcess(config, id)`**: Lookup fulfillment process by ID
- **`getEntityType(config, entity)`**: Lookup entity type config
- **`getLocation(config, locationId)`**: Lookup location config
- **`getGameConfig()`**: Singleton accessor (loads once, caches)

### `tickProcessor.ts`

- **`runOneTick(state, playerAction?)`**: Executes one full tick (8 phases)
- **`processArrivals()`**: Phase 2 — complete deliveries
- **`advanceDemandPhases()`**: Phase 3 — per-location demand advancement
- **`processProductionLines()`**: Phase 4 — production line progression
- **`processRetailSelling()`**: Phase 5 — retail sales using retail process config
- **`processAIDecisions()`**: Phase 6b — delegates to AI modules
- **`processPlayerOrder()`**: Phase 6a — handles player actions
- **`processOrderAcceptance()`**: Phase 7 — accept/decline using fulfillment AI
- **`processDepartures()`**: Phase 8 — ship accepted orders
- **`getSuppliersForResource()`**: Returns supplier details for UI
- **`getLocationPhaseName()`**: Returns demand phase name for a location
- **`getLocationPhaseProgress()`**: Returns demand phase progress for a location

### `createInitialState.ts`

- **`createInitialState(playerEntityId?)`**: Creates `GameState` from config
- **`getSelectableEntities()`**: Returns entities for role selection
- **`getEntityTypeName(typeId)`**: Display name lookup
- **`getLocationName(locationId)`**: Display name lookup

### `useTickEngine.ts`

React hook managing the game loop:
- **`gameState`**: Current game state
- **`isPaused` / `setPaused`**: Pause control
- **`speed` / `setSpeed`**: Speed level (1-5)
- **`step()`**: Advance one tick manually
- **`reset()`**: Reset to initial state
- **`submitOrder(order)`**: Queue a player action
- **`pendingOrder`**: Currently queued player action

## Scripts

- **`npm run dev`** — Start dev server
- **`npm run build`** — TypeScript check + production build
- **`npm run validate`** — Run `scripts/validateConfig.ts` to validate all config files
