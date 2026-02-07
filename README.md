# Supply Chain — Smartphone Manufacturing Game

A turn-based supply chain simulation inspired by the **Beer Game**, themed around smartphone manufacturing. The game uses a config-driven architecture where entity types, processes, locations, and scenarios are all defined in JSON files.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Architecture Overview](#architecture-overview)
3. [Configuration Files](#configuration-files)
4. [Data Model](#data-model)
5. [Tick Engine](#tick-engine)
6. [Demand System](#demand-system)
7. [Transport System](#transport-system)
8. [Order System](#order-system)
9. [Production System](#production-system)
10. [Player vs AI](#player-vs-ai)
11. [Project Structure](#project-structure)
12. [Scripts](#scripts)
13. [Extending the Game](#extending-the-game)

---

## Core Concepts

### Ticks

- **Tick** = one unit of simulated time (e.g., one day).
- The simulation advances tick-by-tick with a fixed ordering of phases per tick (see [Tick Engine](#tick-engine)).

### Transport (Corridors)

- Locations are connected by **corridors** — bi-directional transport links with a cost and a type (land, maritime, air).
- Shipments can traverse multiple corridors (shortest-path routing via Dijkstra).
- Local transport ticks are added at origin and destination only, never at intermediate stops.

### Processes (Continuous Production Lines)

- **Process** = a definition of what an entity CAN do (in config).
- **ProcessLine** = a running instance of a process. It starts up, then runs continuously producing output on each cycle.
- Lines have a min/max volume and can be started/stopped by the player or AI.

### Orders and Committed Stock

- Entities place **orders** for resources from suppliers.
- Sellers **accept or decline** pending orders based on available stock (priority: shortest delivery time, then first-placed).
- Accepted orders **commit** stock (reserved for shipment) until they depart as deliveries at the end of the tick.

### Locations

- Entities exist within **locations** (cities/regions).
- Each location has `localTransportTicks` (internal logistics time) and `baseDemand` (consumer demand).
- Corridors connect locations; the network must be fully connected.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CONFIG (JSON)                          │
│  resources.json │ entity-types.json │ locations.json │ scenario.json │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    CONFIG LOADER                            │
│  Loads, validates, pre-computes shortest paths (Dijkstra)  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     TICK PROCESSOR                          │
│  Pure functions: runOneTick(state, playerOrder?) → newState │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    useTickEngine HOOK                       │
│  React state, timer, player orders                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                         UI                                  │
│  RoleSelect → DebugPanel (entities, lines, controls)        │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration Files

All in `src/config/`.

### `resources.json`

Defines available resource types.

**Schema:**

```json
{
  "resources": [
    { "id": "string", "name": "string", "icon": "string (optional)" }
  ]
}
```

### `entity-types.json`

Defines entity types, their storage capabilities, process line capacity, and available processes.

**Schema:**

```json
{
  "entityTypes": {
    "<type_id>": {
      "name": "string",
      "canHold": ["<resource_id>", ...],
      "maxProcessLines": "number (max concurrent process lines)",
      "processes": [
        {
          "id": "string",
          "name": "string",
          "cycleInputs": [{ "resource": "<resource_id>", "quantity": "number" }],
          "tickInputs": [{ "resource": "<resource_id>", "quantity": "number" }],
          "outputs": [{ "resource": "<resource_id>", "quantity": "number" }],
          "cycleTicks": "number (ticks per production cycle)",
          "startupTicks": "number (ticks to start up a new line)",
          "minVolume": "number (minimum volume scale factor)",
          "maxVolume": "number (maximum volume scale factor)"
        }
      ]
    }
  }
}
```

Key fields:

- `canHold`: Which resources this entity can store.
- `maxProcessLines`: How many process lines can run simultaneously.
- `cycleInputs`: Resources consumed at the **start** of each production cycle.
- `tickInputs`: Resources consumed **every tick** while the line is running.
- `outputs`: Resources produced when a cycle completes.
- `cycleTicks`: How many ticks one production cycle takes.
- `startupTicks`: How many ticks before a newly started line begins producing.
- `minVolume` / `maxVolume`: Bounds on the volume scale factor (scales inputs and outputs proportionally).

### `locations.json`

Defines locations, corridors (bi-directional transport links), and the demand cycle.

**Schema:**

```json
{
  "locations": [
    {
      "id": "string",
      "name": "string",
      "localTransportTicks": "number",
      "baseDemand": "number"
    }
  ],
  "corridors": [
    {
      "locationA": "string",
      "locationB": "string",
      "cost": "number (corridor traversal cost in ticks)",
      "type": "'land' | 'maritime' | 'air'"
    }
  ],
  "demandCycle": {
    "phases": [
      { "name": "string", "ticks": "number", "multiplier": "number" }
    ],
    "variance": "number (0-1, random demand variance)"
  }
}
```

Key points:

- Corridors are **bi-directional** — define each link once, it works in both directions.
- Not every pair of locations needs a direct corridor; the network just needs to be fully connected. Shipments find the shortest path automatically.
- `localTransportTicks` is added at origin and destination only, not at intermediate stops.
- Corridor `type` is metadata for future use (no gameplay effect currently).

### `scenario.json`

Defines the initial game setup: which entities exist, where, starting inventory, and supplier relationships.

**Schema:**

```json
{
  "name": "string",
  "description": "string",
  "entities": [
    {
      "id": "string",
      "type": "<entity_type_id>",
      "name": "string",
      "locationId": "<location_id>",
      "inventory": { "<resource_id>": "number" },
      "suppliers": { "<resource_id>": ["<entity_id>", ...] }
    }
  ],
  "defaultPlayerEntity": "<entity_id>"
}
```

Key fields:

- `suppliers`: Map of resource ID to list of entity IDs that can supply that resource. Determines who an entity can order from.
- `defaultPlayerEntity`: Which entity the player controls by default.

---

## Data Model

### `src/types/game.ts`

#### Config Types

| Type | Purpose |
|------|---------|
| `ResourceConfig` | Resource definition (`id`, `name`, `icon?`) |
| `ResourceAmount` | A quantity of a resource (`resource`, `quantity`) |
| `Process` | Process definition (`id`, `name`, `cycleInputs`, `tickInputs`, `outputs`, `cycleTicks`, `startupTicks`, `minVolume`, `maxVolume`) |
| `EntityTypeConfig` | Entity type (`name`, `canHold`, `maxProcessLines`, `processes`) |
| `LocationConfig` | Location (`id`, `name`, `localTransportTicks`, `baseDemand`) |
| `CorridorConfig` | Bi-directional transport link (`locationA`, `locationB`, `cost`, `type`) |
| `CorridorType` | `'land' \| 'maritime' \| 'air'` |
| `DemandPhase` | Phase in demand cycle (`name`, `ticks`, `multiplier`) |
| `DemandCycleConfig` | Demand cycle (`phases`, `variance`) |
| `LocationsConfig` | Full locations file structure (`locations`, `corridors`, `demandCycle`) |
| `ScenarioEntity` | Entity in scenario (`id`, `type`, `name`, `locationId`, `inventory`, `suppliers?`) |
| `ScenarioConfig` | Scenario (`name`, `description`, `entities`, `defaultPlayerEntity`) |
| `GameConfig` | All config combined (`resources`, `entityTypes`, `locations`, `corridors`, `demandCycle`, `scenario`) |

#### Runtime Types

| Type | Purpose |
|------|---------|
| `Inventory` | `Record<string, number>` — resource ID to quantity |
| `Entity` | Runtime entity (`id`, `type`, `name`, `locationId`, `inventory`, `committed`, `isPlayerControlled`, `suppliers`) |
| `ProcessLine` | Running process line (`id`, `processId`, `entityId`, `phase`, `startupTicksRemaining`, `progress`, `volume`) |
| `ProcessLinePhase` | `'starting' \| 'running'` |
| `OrderStatus` | `'pending' \| 'accepted' \| 'in_transit' \| 'delivered' \| 'declined'` |
| `Order` | Order record (`id`, `placedAtTick`, `deliveredAtTick?`, `buyerEntityId`, `sellerEntityId`, `resource`, `requestedQuantity`, `fulfilledQuantity`, `wasAmended`, `status`) |
| `Delivery` | In-transit shipment (`id`, `orderId`, `fromEntityId`, `toEntityId`, `resource`, `quantity`, `ticksRemaining`, `route`) |
| `PlayerOrder` | Player action (`entityId`, `action`, `targetId`, `quantity`, `supplierId?`, `lineId?`) |
| `DemandPhaseState` | Current demand phase position (`phaseIndex`, `ticksInPhase`) |
| `SalesStats` | Retailer sales stats (`totalSold`, `totalDemand`, `lostSales`) |
| `GameState` | Full state (`tick`, `entities`, `processLines`, `orders`, `deliveries`, `demandPhase`, `sales`) |
| `SupplierOption` | Supplier info for UI (`entityId`, `entityName`, `availableStock`, `transportTicks`) |
| `PathResult` | Shortest path result (`cost`, `path`) |

---

## Tick Engine

### `src/engine/tickProcessor.ts`

The tick processor contains all the simulation logic as pure functions. The main entry point is `runOneTick(state, playerAction?)`.

### Tick Flow (strict ordering)

```
1. Increment tick counter
2. ARRIVALS — Complete finished deliveries (ticksRemaining <= 0), add stock to buyers
3. Advance demand phase (cycle through Normal → Growth → Peak → Decline)
4. PRODUCTION — Advance all process lines (startup, progress, cycle completion)
5. SELLING — Retailers automatically sell smartphones to consumers
6. DECISIONS — Player order (if any) + AI decisions (start/stop lines, place orders)
7. ACCEPT ORDERS — Sellers accept/decline pending orders (commit stock, priority: shortest delivery time then first-placed)
8. DEPARTURES — Accepted orders ship: deduct inventory & committed, create deliveries with route
```

Key design: **arrivals happen first** (stock from completed deliveries is available for this tick's decisions) and **departures happen last** (new shipments leave at end of tick).

### Helper Functions

| Function | Purpose |
|----------|---------|
| `getEntity(state, id)` | Find an entity by ID |
| `updateEntity(state, id, updater)` | Immutably update an entity |
| `addToInventory(state, entityId, resource, qty)` | Add stock |
| `removeFromInventory(state, entityId, resource, qty)` | Remove stock (returns null if insufficient) |
| `getAvailable(entity, resource)` | Available stock = `inventory - committed` |
| `addCommitted(state, entityId, resource, qty)` | Reserve stock for accepted orders |
| `removeCommitted(state, entityId, resource, qty)` | Release reserved stock (on shipment) |

### Phase Functions

| Function | Phase | Description |
|----------|-------|-------------|
| `processArrivals(state)` | 2 | Complete deliveries, add stock to buyers, update order status to `'delivered'` |
| `advanceDemandPhase(state, config)` | 3 | Move through demand cycle phases |
| `processProductionLines(state, config)` | 4 | Advance startup, consume inputs, advance progress, produce outputs on cycle completion |
| `processSelling(state, config)` | 5 | Retailers sell `min(stock, demand)`, update sales stats |
| `processPlayerOrder(state, config, action)` | 6a | Handle player actions: `start_line`, `stop_line`, `order` |
| `processAIDecisions(state, config)` | 6b | AI starts/stops lines, places orders |
| `processOrderAcceptance(state, config)` | 7 | Sellers accept/decline pending orders, commit stock |
| `processDepartures(state, config)` | 8 | Ship accepted orders, create deliveries with route |

### Supplier Selection

| Function | Description |
|----------|-------------|
| `findBestSupplier(state, config, buyerId, resource)` | Find supplier with available stock, prefer closer |
| `getSuppliersForResource(state, config, buyerId, resource)` | Get all suppliers with available stock and transport time (used by UI) |

### Order Placement

| Function | Description |
|----------|-------------|
| `placePendingOrder(state, config, buyerId, resource, qty, supplierId?)` | Create a `'pending'` order (no commitment yet) |

### Utility Exports

| Function | Description |
|----------|-------------|
| `getOrdersForEntity(state, entityId)` | All orders involving this entity (buyer or seller) |
| `getDeliveriesForEntity(state, entityId)` | Active deliveries split into `incoming` and `outgoing` |
| `getEntityName(state, entityId)` | Display name for an entity |
| `getProcessLinesForEntity(state, entityId)` | All process lines for an entity |
| `getCurrentPhaseName(state)` | Current demand phase name |
| `getPhaseProgress(state)` | Current/total ticks in demand phase |

---

## Demand System

### Phases

The game cycles through demand phases defined in `demandCycle`:
- **Normal** (15 ticks): ×1.0 multiplier
- **Growth** (10 ticks): ×1.3 multiplier
- **Peak** (5 ticks): ×1.8 multiplier
- **Decline** (10 ticks): ×0.7 multiplier

### Calculation per Tick

```
actualDemand = floor(baseDemand × phaseMultiplier × (1 + random(-variance, +variance)))
```

With `variance: 0.15`, demand varies ±15% around the phase-adjusted base.

### Selling

Each tick, retailers automatically sell:
```
sold = min(inventory.smartphones, actualDemand)
lostSales = max(0, actualDemand - inventory.smartphones)
```

Sales stats are tracked per retailer for scoring.

---

## Transport System

### `src/engine/configLoader.ts`

#### Corridors

Transport is defined by **corridors** — bi-directional links between two locations with a cost (in ticks) and a type. The network does not require a corridor between every pair of locations; it only needs to be fully connected.

#### Pathfinding

The config loader pre-computes shortest paths between all location pairs using **Dijkstra's algorithm** over the corridor graph. Paths are cached in a path table at startup.

#### Transport Time Calculation

```
totalTime = local(from) + corridorPathCost(from, to) + local(to)
```

- `local(from)` / `local(to)` = the `localTransportTicks` of the origin / destination location.
- `corridorPathCost` = sum of corridor costs along the shortest path.
- **Local transport is NOT added at intermediate stops** — only at origin and destination.
- For same-location transport: `totalTime = localTransportTicks` (just once).

#### Route Storage

Deliveries store their full route as a list of location IDs (from origin to destination, inclusive). This enables UI display of multi-hop routes ("via Tech City") and future features like corridor capacity.

#### Functions

| Function | Description |
|----------|-------------|
| `findShortestPath(corridors, from, to)` | Dijkstra over corridors, returns `{ cost, path }` |
| `getTransportTime(config, from, to)` | Total time including local transport at endpoints |
| `getTransportRoute(config, from, to)` | Returns `{ totalTime, route }` for delivery creation |
| `loadGameConfig()` | Load and validate all config files |
| `validateConfig(config)` | Validate references, process fields, demand cycle |
| `validateCorridorConnectivity(locationIds, corridors)` | BFS to ensure all locations are connected |
| `getEntityType(config, entity)` | Get entity type config |
| `getProcess(entityType, processId)` | Get process definition |
| `getLocation(config, locationId)` | Get location config |
| `getResource(config, resourceId)` | Get resource config |
| `getGameConfig()` | Singleton accessor (loads once, cached) |
| `resetConfigCache()` | Reset cached config and path table |

---

## Order System

### Order Lifecycle

1. **Placement** (during decisions phase): Buyer creates a `'pending'` order specifying resource and quantity.
2. **Acceptance** (after all decisions): Seller evaluates pending orders.
   - **Priority**: shortest delivery time to buyer, then earliest `placedAtTick`.
   - **Accept**: sets `fulfilledQuantity`, marks as `'accepted'`, commits stock.
   - **Decline**: marks as `'declined'` with `fulfilledQuantity: 0`.
   - Partial fulfillment: if stock < requested, the order is accepted with reduced quantity (`wasAmended: true`).
3. **Departure** (end of tick): Accepted orders ship — inventory and committed stock are deducted, delivery is created.
4. **In Transit**: Delivery travels along the shortest path. `ticksRemaining` decrements each tick during arrival check.
5. **Arrival** (start of next eligible tick): When `ticksRemaining <= 0`, stock is added to buyer, order status becomes `'delivered'`.

### Committed Stock

- `Entity.committed` tracks stock reserved for accepted-but-not-yet-shipped orders.
- **Available stock** = `inventory[resource] - committed[resource]`.
- Prevents double-promising the same goods to multiple orders in the same tick.
- Committed stock is cleared when the delivery departs (both `inventory` and `committed` are deducted).

---

## Production System

### Continuous Process Lines

Processes are **continuous** — once started, a line runs indefinitely until stopped or starved of inputs.

#### Lifecycle

1. **Start**: A new `ProcessLine` is created with `phase: 'starting'` (if `startupTicks > 0`) or `phase: 'running'`.
2. **Startup**: Each tick, `startupTicksRemaining` decrements. When it reaches 0, the line transitions to `'running'`.
3. **Running**: Each tick:
   - If `progress === 0` and `cycleInputs` exist: consume cycle inputs (scaled by volume). If inputs unavailable, line stalls.
   - If `tickInputs` exist: consume tick inputs (scaled by volume). If unavailable, line stalls.
   - Advance `progress` by 1.
   - If `progress >= cycleTicks`: produce outputs (scaled by volume), reset `progress` to 0.
4. **Stop**: Line is removed from state.

#### Volume

- Volume is a scale factor between `minVolume` and `maxVolume`.
- Affects input consumption and output production proportionally.
- Can be adjusted within bounds without restarting the line.

#### Capacity

- Each entity type has `maxProcessLines` (total number of lines that can run simultaneously).
- Multiple lines of the same or different process types are allowed, up to the cap.

---

## Player vs AI

### Player

- Chooses one entity to control at game start.
- Each tick can submit one action:
  - **`start_line`**: Start a new process line (specify process ID and initial volume).
  - **`stop_line`**: Stop a running process line (specify line ID).
  - **`order`**: Place an order for resources (specify resource, quantity, optional supplier).
- Actions are applied during the decisions phase of the next tick.

### AI

For non-player entities:

- **Process lines**: Start a line for the first available process if none running and under capacity.
  - Mine entities: start if stock below threshold, stop if stock above `MINE_MAX_STOCK` (30).
  - Other entities: start if inputs are available.
- **Ordering**: Order resources when stock falls below `AI_REORDER_THRESHOLD` (5), ordering `AI_ORDER_QUANTITY` (10) at a time.
- **Supplier choice**: Pick closest supplier with available stock.

---

## Project Structure

```
src/
├── config/                      # JSON configuration files
│   ├── resources.json           # Resource definitions
│   ├── entity-types.json        # Entity types and process definitions
│   ├── locations.json           # Locations, corridors, demand cycle
│   └── scenario.json            # Entities, suppliers, starting state
├── types/
│   └── game.ts                  # All TypeScript types (config + runtime)
├── engine/
│   ├── configLoader.ts          # Load, validate config; pathfinding
│   ├── createInitialState.ts    # Build initial GameState from config
│   └── tickProcessor.ts         # Core tick logic (8 phases)
├── hooks/
│   └── useTickEngine.ts         # React hook for game state + timer
├── components/
│   ├── RoleSelect.tsx           # Entity selection screen
│   └── DebugPanel.tsx           # Main game UI
├── App.tsx                      # Root component
├── main.tsx                     # Entry point
└── index.css                    # Styles (Tailwind)

scripts/
└── validateConfig.ts            # Standalone config validation script
```

---

## Scripts

### `npm run validate`

Runs the standalone config validation script (`scripts/validateConfig.ts`). Checks:

- All JSON files parse correctly.
- All cross-references are valid (resources, locations, entity types, suppliers).
- All process fields are valid (positive cycleTicks, non-negative startupTicks, minVolume <= maxVolume).
- All corridor endpoints reference valid locations.
- The corridor network is fully connected (BFS from first location reaches all others).
- All location pairs have a valid shortest path (Dijkstra).
- Prints a shortest-path cost table for all location pairs.

Exit code 0 if all checks pass, 1 if any errors found.

---

## Extending the Game

### Adding a New Resource

1. Add to `resources.json`.
2. Update entity types that use it (`canHold`, process `cycleInputs`/`tickInputs`/`outputs`).
3. Run `npm run validate` to check.

### Adding a New Entity Type

1. Add to `entity-types.json` with processes.
2. Add entities of this type to `scenario.json`.
3. UI auto-discovers from config.

### Adding a New Location

1. Add to `locations.json`.
2. Add at least one corridor connecting it to the existing network.
3. Run `npm run validate` to verify connectivity.

### Adding a New Corridor

1. Add to the `corridors` array in `locations.json`. Only define it once (bi-directional).
2. Run `npm run validate` to verify.

### Adding a New Process to an Entity Type

1. Add to the `processes` array in `entity-types.json`.
2. Set `cycleInputs`, `tickInputs`, `outputs`, `cycleTicks`, `startupTicks`, `minVolume`, `maxVolume`.

### Changing Durations

- **Production**: Edit `cycleTicks` or `startupTicks` in process definition.
- **Transport**: Edit corridor `cost` in `locations.json` or `localTransportTicks` on locations.

### Future Extensions (noted in design)

- **Money system**: Add currency, pricing, budgets.
- **Long-term contracts**: Scheduled recurring orders over a period.
- **Expected orders book**: Visibility into future demand for production planning.
- **Corridor capacity**: Limit shipments per corridor per tick.
- **Corridor type effects**: Different costs or speeds by type.
- **Volume adjustment**: Player/AI adjusting line volume within min/max bounds.

---

*Current scenario: 1 mine, 2 chip processors, 1 assembler, 2 retailers across 5 locations.*
