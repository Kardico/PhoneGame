# Supply Chain Simulation — Smartphone Manufacturing

A tick-based supply chain simulation where entities extract, process, assemble, and retail smartphones. Players and AI are interchangeable — both control entities with the same actions and information.

## Architecture Overview

```
src/
├── config/           # JSON config files (all game data)
│   ├── resources.json
│   ├── processes.json
│   ├── entity-types.json
│   ├── locations.json
│   ├── scenario.json
│   ├── settings.json
│   └── pricing.json
├── types/
│   └── game.ts       # All TypeScript interfaces
├── engine/
│   ├── configLoader.ts    # Loads, validates config; pathfinding; accessors
│   ├── tickProcessor.ts   # Core tick logic (all phases)
│   ├── createInitialState.ts
│   └── ai/
│       ├── index.ts           # Barrel exports
│       ├── productionAI.ts    # Start/stop production lines
│       ├── procurementAI.ts   # Spot order decisions
│       ├── fulfillmentAI.ts   # Order acceptance with pricing
│       └── contractAI.ts      # Contract proposals + evaluation
├── hooks/
│   └── useTickEngine.ts   # React hook: game loop, speed, multi-action queue
├── components/
│   ├── App.tsx
│   ├── TopBar.tsx         # Sticky header: tick, money, speed, controls
│   ├── DebugPanel.tsx     # Main game UI with entity cards
│   └── RoleSelect.tsx     # Entity selection screen
└── index.css
```

## Tick Flow

Each tick executes these phases in order:

1. **Increment tick** counter
2. **Arrivals** — Complete deliveries (ticksRemaining <= 0), add stock to buyer, transfer payment (buyer -> seller)
3. **Advance demand phases** — Per-location demand cycle progression
4. **Production lines** — Process startup, consume inputs, advance progress, produce outputs
5. **Retail selling** — Entities with retail processes sell to consumers at retail prices (revenue added)
6. **Storage costs** — Deduct per-unit inventory cost from all entities
7. **Entity decisions** — Player actions (multiple per tick) + AI production/procurement decisions
8. **Contract management** — AI proposes contracts, sellers evaluate mature proposals, due deliveries processed
9. **Order acceptance** — Sellers accept/decline pending orders (pricing check, commit stock)
10. **Departures** — Ship accepted orders: deduct inventory + committed, create deliveries
11. **Contract status** — Check completion (all units delivered) and cancellation (missed threshold exceeded)

## Config Files

### `resources.json`

```json
{ "resources": [{ "id": "string", "name": "string", "icon?": "string" }] }
```

### `processes.json`

Four categories of processes:

```json
{
  "production": [{
    "id": "string",
    "name": "string",
    "startupInputs": [{ "resource": "string", "quantity": "number" }],
    "cycleInputs": [{ "resource": "string", "quantity": "number" }],
    "tickInputs": [{ "resource": "string", "quantity": "number" }],
    "outputs": [{ "resource": "string", "quantity": "number" }],
    "cycleTicks": "number",
    "startupTicks": "number",
    "minVolume": "number",
    "maxVolume": "number"
  }],
  "retail": [{ "id": "string", "name": "string", "resource": "string" }],
  "procurement": [{ "id": "string", "name": "string", "resource": "string" }],
  "fulfillment": [{ "id": "string", "name": "string", "resource": "string" }]
}
```

- **startupInputs**: Fixed, NOT scaled by volume. Consumed once when a line starts.
- **cycleInputs/tickInputs/outputs**: Scaled by line volume.

### `entity-types.json`

```json
{
  "entityTypes": {
    "type_id": {
      "name": "string",
      "canHold": ["resource_id"],
      "maxProcessLines": "number",
      "processes": {
        "production": ["process_id"],
        "retail": ["process_id"],
        "procurement": ["process_id"],
        "fulfillment": ["process_id"]
      }
    }
  }
}
```

### `locations.json`

```json
{
  "locations": [{
    "id": "string",
    "name": "string",
    "localTransportTicks": "number",
    "demand": { "resource_id": "number" },
    "demandCycle?": {
      "phases": [{ "name": "string", "ticks": "number", "multiplier": "number" }],
      "variance": "number (0-1)"
    }
  }],
  "corridors": [{
    "locationA": "string",
    "locationB": "string",
    "cost": "number (ticks)",
    "type": "land | maritime | air"
  }]
}
```

Corridors are bi-directional. Multi-hop routing uses Dijkstra's algorithm. Local transport ticks are added at origin and destination but excluded from pathfinding.

### `scenario.json`

```json
{
  "name": "string",
  "description": "string",
  "entities": [{
    "id": "string",
    "type": "entity_type_id",
    "name": "string",
    "locationId": "location_id",
    "inventory": { "resource_id": "number" },
    "suppliers?": { "resource_id": ["supplier_entity_id"] },
    "money?": "number (starting balance)"
  }],
  "defaultPlayerEntity": "entity_id"
}
```

### `settings.json`

```json
{
  "tickSpeeds": { "1": 2000, "2": 1000, "3": 500, "4": 200, "5": 0 },
  "defaultSpeed": 2,
  "contractWaitTicks": 3,
  "contractDefaultPenaltyRate": 0.5,
  "contractDefaultCancellationThreshold": 0.25
}
```

- `tickSpeeds`: ms per tick for each speed level (0 = as fast as possible)
- `contractWaitTicks`: Ticks a proposal must wait before seller evaluates
- `contractDefaultPenaltyRate`: Fraction of pricePerUnit charged as penalty per missed unit
- `contractDefaultCancellationThreshold`: Fraction of totalUnits missed that triggers cancellation

### `pricing.json`

```json
{
  "basePrices": { "resource_id": "number" },
  "retailPrices": { "resource_id": "number" },
  "storageCostPerUnit": "number (per unit per tick)"
}
```

- `basePrices`: Default wholesale prices used for spot orders and contract proposals
- `retailPrices`: What consumers pay (retail revenue per unit sold)
- `storageCostPerUnit`: Per-tick cost for each unit in any entity's inventory

## Money System

Each entity has a `money` balance:

- **Delivery arrival**: Buyer pays `quantity * pricePerUnit` to seller
- **Retail sales**: Retailer earns `quantity * retailPrice` from consumers
- **Storage costs**: All entities pay `totalInventoryUnits * storageCostPerUnit` per tick
- **Contract penalties**: Seller pays `missedUnits * penaltyPerUnit` when failing to deliver
- Negative balances are allowed but logged as warnings

## Contract System

Contracts define scheduled deliveries between entities:

### Contract fields
- `buyerEntityId`, `sellerEntityId`, `resource`
- `pricePerUnit`: Agreed price
- `unitsPerDelivery`: Quantity per scheduled delivery
- `deliveryInterval`: Ticks between deliveries
- `totalUnits`: Total quantity over contract lifetime
- `unitsShipped`, `unitsMissed`: Tracking counters
- `penaltyPerUnit`: Money penalty for missed units
- `cancellationThreshold`: Fraction of totalUnits missed that cancels the contract
- `status`: `proposed` | `active` | `completed` | `cancelled`

### Contract lifecycle
1. **Proposal**: Buyer proposes (AI or player)
2. **Waiting**: Proposal sits for `contractWaitTicks` before evaluation
3. **Evaluation**: Seller accepts (most profitable, above production cost) or declines
4. **Active**: Deliveries created on schedule; seller must have stock or gets penalized
5. **Completion/Cancellation**: All units processed, or too many missed

### Order book
The `getOrderBook()` function computes a 25-tick forward view of expected deliveries from active contracts, useful for production planning.

## Pricing Logic

- Sellers decline orders where `pricePerUnit < production cost per unit`
- Order acceptance priority: (1) highest price, (2) shortest delivery time, (3) earliest placed
- Production cost = sum of (input quantities * base prices) / total output quantity
- Contracts wait before acceptance so sellers can receive competing offers

## Player Actions

The player can queue **multiple actions per tick**:

| Action | Description |
|--------|-------------|
| `start_line` | Start a new production line (with initial volume) |
| `stop_line` | Stop an existing production line |
| `set_volume` | Adjust volume on a running production line (clamped to min/max) |
| `order` | Place a spot order for resources from a supplier |
| `propose_contract` | Propose a supply contract to a seller |

All actions are queued and executed together when the next tick runs. Actions can be removed from the queue before execution.

## AI Modules

### `productionAI.ts`
- **Source processes** (no inputs): Start if no line running, stop if stock > `MINE_MAX_STOCK`
- **Normal processes**: Start if inputs available and line slots open

### `procurementAI.ts`
- With active contract: emergency spot orders only if stock < `AI_EMERGENCY_THRESHOLD`
- Without contract: order if stock < `AI_REORDER_THRESHOLD`
- Picks closest supplier with available stock

### `fulfillmentAI.ts`
- Sorts orders by price (highest first), then delivery time, then placement time
- Declines orders below production cost
- Fulfills up to available stock

### `contractAI.ts`
- **Buyer side**: Proposes contracts when stock is low and no active contract exists
- **Seller side**: Accepts most profitable proposal per resource (above cost floor), declines rest
- **Order book**: Forward-looking schedule of expected deliveries

## UI Components

### `TopBar.tsx`
Sticky header showing: tick counter, player money, 5-speed selector, play/pause/step/reset, change role.

### `DebugPanel.tsx`
Main game view with entity cards showing:
- Entity name, type, money balance
- Inventory with committed stock
- Production lines with volume adjustment controls (+/- buttons)
- Active deliveries with route and price info
- Player controls: start/stop lines, spot orders, contract proposals
- Multi-action queue with remove buttons
- Contracts section (expandable)
- Order history (expandable) with price and contract indicators
- Per-resource sales stats for retailers

## Scripts

- `npm run validate` — Validates all config files including pricing and contract settings
- `npm run dev` — Start development server

## Key Engine Files

### `configLoader.ts`
- `loadGameConfig()`: Loads and validates all JSON config
- `getTransportTime()` / `getTransportRoute()`: Pathfinding with local transport
- `getProductionCostPerUnit()`: Calculates production cost from input prices
- `getBasePrice()` / `getRetailPrice()`: Price lookups
- Accessor functions for all config types

### `tickProcessor.ts`
- `runOneTick(state, playerActions[])`: Executes all 11 tick phases
- `processArrivals()`: Deliveries + payment transfer
- `processRetailSelling()`: Consumer sales + revenue
- `processStorageCosts()`: Inventory holding costs
- `processContractManagement()`: Proposals, evaluation, due deliveries
- `processOrderAcceptance()`: Price-based order sorting and acceptance
- `getContractsForEntity()`: Query contracts for an entity

### `createInitialState.ts`
- Initializes entities with money from scenario config
- Initializes empty contracts array
- Sets up demand phases and sales stats
