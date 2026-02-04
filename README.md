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
7. [Player vs AI](#player-vs-ai)
8. [Project Structure](#project-structure)
9. [Extending the Game](#extending-the-game)

---

## Core Concepts

### Ticks

- **Tick** = one unit of simulated time (e.g., one day).
- The simulation advances tick-by-tick. Each tick:
  1. Increment the tick counter.
  2. Advance demand phase (if applicable).
  3. Complete finished **jobs** (production) and **transport jobs**.
  4. Process **selling** at retailers (automatic, instant).
  5. Process entity decisions (player orders + AI logic).

### Jobs (not Tasks)

- **Process** = A definition of what an entity CAN do (in config).
- **Job** = A running instance of a process. Has `processId`, `entityId`, `ticksRemaining`, `outputs`.

### Transport Jobs

- When an entity orders resources, a **TransportJob** is created.
- Transport time = `source.localTransportTicks + route.ticks + destination.localTransportTicks`.
- Resources are deducted from the supplier immediately; added to buyer when transport completes.

### Locations

- Entities exist within **locations** (cities/regions).
- Each location has:
  - `localTransportTicks`: Time for internal logistics.
  - `baseDemand`: Consumer demand for smartphones (retailers only).
- Routes connect locations with travel times.

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
│  Loads, validates, provides GameConfig singleton            │
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
│  RoleSelect → DebugPanel (entities, jobs, controls)         │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration Files

All in `src/config/`:

### `resources.json`

Defines available resource types.

```json
{
  "resources": [
    { "id": "raw_materials", "name": "Raw Materials", "icon": "🪨" },
    { "id": "chips", "name": "Chips", "icon": "🔲" },
    { "id": "smartphones", "name": "Smartphones", "icon": "📱" }
  ]
}
```

### `entity-types.json`

Defines entity types and their processes.

```json
{
  "entityTypes": {
    "mineral_mine": {
      "name": "Mineral Mine",
      "canHold": ["raw_materials"],
      "maxConcurrentJobs": 1,
      "processes": [
        {
          "id": "extract_minerals",
          "name": "Extract Minerals",
          "inputs": [],
          "outputs": [{ "resource": "raw_materials", "quantity": 2 }],
          "ticks": 1
        }
      ]
    },
    "chip_processor": { ... },
    "assembler": { ... },
    "retailer": { ... }
  }
}
```

Key fields:
- `canHold`: Which resources this entity can store.
- `maxConcurrentJobs`: How many jobs can run simultaneously.
- `processes`: Array of process definitions (id, inputs, outputs, ticks).

### `locations.json`

Defines locations, routes, and demand cycle.

```json
{
  "locations": [
    { "id": "mine_region", "name": "Mine Region", "localTransportTicks": 1, "baseDemand": 0 },
    { "id": "tech_city", "name": "Tech City", "localTransportTicks": 1, "baseDemand": 0 },
    { "id": "market_a", "name": "Market A", "localTransportTicks": 1, "baseDemand": 8 },
    { "id": "market_b", "name": "Market B", "localTransportTicks": 1, "baseDemand": 6 }
  ],
  "routes": [
    { "from": "mine_region", "to": "tech_city", "ticks": 2 },
    { "from": "tech_city", "to": "market_a", "ticks": 2 },
    ...
  ],
  "demandCycle": {
    "phases": [
      { "name": "Normal", "ticks": 15, "multiplier": 1.0 },
      { "name": "Growth", "ticks": 10, "multiplier": 1.3 },
      { "name": "Peak", "ticks": 5, "multiplier": 1.8 },
      { "name": "Decline", "ticks": 10, "multiplier": 0.7 }
    ],
    "variance": 0.15
  }
}
```

### `scenario.json`

Defines initial game state (which entities exist, where, starting inventory).

```json
{
  "name": "Standard Smartphone Supply Chain",
  "description": "1 mine, 1 chip processor, 1 assembler, 2 competing retailers",
  "entities": [
    { "id": "mine-1", "type": "mineral_mine", "name": "Northern Mine", "locationId": "mine_region", "inventory": { "raw_materials": 20 } },
    { "id": "chip-1", "type": "chip_processor", "name": "TechCity Chips", "locationId": "tech_city", "inventory": { "raw_materials": 5, "chips": 10 } },
    { "id": "asm-1", "type": "assembler", "name": "TechCity Assembly", "locationId": "tech_city", "inventory": { "chips": 5, "smartphones": 8 } },
    { "id": "ret-1", "type": "retailer", "name": "PhoneMart A", "locationId": "market_a", "inventory": { "smartphones": 5 } },
    { "id": "ret-2", "type": "retailer", "name": "PhoneMart B", "locationId": "market_b", "inventory": { "smartphones": 5 } }
  ],
  "defaultPlayerEntity": "ret-1"
}
```

---

## Data Model

### Config Types (from JSON)

| Type | Purpose |
|------|---------|
| `ResourceConfig` | Resource definition (id, name, icon) |
| `Process` | Process definition (id, inputs, outputs, ticks) |
| `EntityTypeConfig` | Entity type (name, canHold, maxConcurrentJobs, processes) |
| `LocationConfig` | Location (id, name, localTransportTicks, baseDemand) |
| `RouteConfig` | Route between locations (from, to, ticks) |
| `DemandPhase` | Phase in demand cycle (name, ticks, multiplier) |
| `ScenarioConfig` | Initial game setup (entities, defaultPlayerEntity) |
| `GameConfig` | All config combined |

### Runtime Types (game state)

| Type | Purpose |
|------|---------|
| `Entity` | Runtime entity (id, type, name, locationId, inventory, isPlayerControlled) |
| `Job` | Running production job (id, processId, entityId, outputs, ticksRemaining) |
| `TransportJob` | In-transit shipment (id, from, to, resource, quantity, ticksRemaining) |
| `PlayerOrder` | Player's action for next tick (entityId, action, targetId, quantity) |
| `GameState` | Full state (tick, entities, jobs, transportJobs, demandPhase, sales) |

---

## Tick Engine

### Tick Flow

```
1. Increment tick counter
2. Advance demand phase (cycle through Normal → Growth → Peak → Decline)
3. Complete finished jobs → add outputs to entity inventory
4. Complete finished transports → add resources to destination
5. Sell at retailers → min(stock, demand), update sales stats
6. Apply player order (if any)
7. Run AI decisions for non-player entities
```

### Transport Time Calculation

```
totalTime = source.localTransportTicks + route.ticks + destination.localTransportTicks
```

For same-location transport (e.g., chip processor → assembler in Tech City):
```
totalTime = location.localTransportTicks (just once, no route)
```

### Supplier Selection

When ordering, the engine finds suppliers dynamically:
1. Find all entities with the needed resource in stock.
2. Sort by transport time (closest first), then by available stock.
3. Pick the first one (first-come-first-served for contention).

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

## Player vs AI

### Player

- Chooses one entity to control at game start.
- Each tick can:
  - **Produce**: Start a job (if entity has processes and capacity).
  - **Order**: Request resources from suppliers.
- Orders are applied at the start of the next tick.

### AI

For non-player entities:
- **Production**: Start jobs when inputs are available and under capacity.
- **Mine special case**: Produces continuously unless stock > 30.
- **Ordering**: Order resources when stock falls below threshold (5).
- **Supplier choice**: Pick closest supplier with available stock.

---

## Project Structure

```
src/
├── config/                      # JSON configuration files
│   ├── resources.json
│   ├── entity-types.json
│   ├── locations.json
│   └── scenario.json
├── types/
│   └── game.ts                  # All TypeScript types
├── engine/
│   ├── configLoader.ts          # Load and validate config
│   ├── createInitialState.ts    # Build initial GameState
│   └── tickProcessor.ts         # Core tick logic
├── hooks/
│   └── useTickEngine.ts         # React hook for game state
├── components/
│   ├── RoleSelect.tsx           # Entity selection screen
│   └── DebugPanel.tsx           # Main game UI
├── App.tsx
├── main.tsx
└── index.css
```

---

## Extending the Game

### Adding a New Resource

1. Add to `resources.json`.
2. Update entity types that use it (canHold, process inputs/outputs).
3. Config loader validates automatically.

### Adding a New Entity Type

1. Add to `entity-types.json` with processes.
2. Add entities of this type to `scenario.json`.
3. UI auto-discovers from config.

### Adding a New Location

1. Add to `locations.json`.
2. Add routes to/from other locations.
3. Optionally place entities there in scenario.

### Adding a New Process to an Entity Type

1. Add to the `processes` array in `entity-types.json`.
2. Currently AI uses only the first process; extend `processAIDecisions` for multi-process logic.

### Changing Durations

- **Production**: Edit `ticks` in process definition.
- **Transport**: Edit `localTransportTicks` in locations and `ticks` in routes.

### Future Extensions (noted in design)

- **Money system**: Add currency, pricing, budgets.
- **Supplier discovery**: Entities must "find" suppliers before ordering.
- **Multiple player entities**: Control several entities at once.
- **AI prioritization**: Factor in cost, reliability, relationships.
- **Contracts**: Lock in suppliers at fixed rates.

---

*Current scenario: 1 mine, 1 chip processor, 1 assembler, 2 retailers across 4 locations.*
