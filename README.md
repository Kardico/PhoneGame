# Supply Chain — Smartphone Manufacturing Game

A turn-based supply chain simulation inspired by the **Beer Game**, themed around smartphone manufacturing. The game models a four-stage chain: raw materials → chips → assembly → retail. This document is for developers maintaining and extending the codebase.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Architecture Overview](#architecture-overview)
3. [Data Model](#data-model)
4. [Tick Engine](#tick-engine)
5. [Entity & Task Rules](#entity--task-rules)
6. [Player vs AI](#player-vs-ai)
7. [Project Structure](#project-structure)
8. [Scaling Notes](#scaling-notes)

---

## Core Concepts

### Ticks

- **Tick** = one unit of simulated time (e.g. one day).
- The simulation advances tick-by-tick. Each tick:
  1. The tick counter increments.
  2. All active **tasks** are updated: any task with `ticksRemaining === 0` is **completed** (inventory changes applied).
  3. **Entity decisions** run: each entity may start new production or place orders (player choice or AI logic).

### Task-Based Delays

Nothing is instant:

- **Production**: an entity starts a *production task* that runs for X ticks; when it finishes, output is added to that entity’s inventory.
- **Transport**: an order creates a *transport task* that runs for Y ticks; when it finishes, the requested resource is added to the *destination* entity’s inventory (and was already deducted from the *source* when the task started).

This creates lead times and is the core of the Beer Game–style dynamics.

### Pause & Play

- The simulation can be **paused** or **running**. When running, ticks advance on a timer.
- When paused, the player can **Step** to advance exactly one tick (and set their order for that tick).
- **Reset** restores the initial state (and returns to entity selection if applicable).

---

## Architecture Overview

- **State**: A single **game state** object holds the current tick, all entities, and all active tasks. It is the only source of truth for the simulation.
- **Engine**: Pure functions take the current state (and optional player input) and return the next state. No side effects inside the engine.
- **UI**: React components read state from the **useTickEngine** hook, render it, and send player actions (e.g. order quantity) back into the hook. The hook runs the engine on a timer when not paused, or on manual Step.

---

## Data Model

Defined in `src/types/game.ts`. Key types:

| Type | Purpose |
|------|--------|
| **ResourceKind** | `'raw_materials' \| 'chips' \| 'smartphones'` — what flows through the chain. |
| **EntityKind** | `'mineral_mine' \| 'chip_processor' \| 'assembler' \| 'retailer'` — the four stages. |
| **Entity** | `id`, `kind`, `name`, `inventory` (per resource), `isPlayerControlled`. |
| **ProductionTask** | `type: 'production'`, `entityId`, `ticksRemaining`, `outputResource`, `quantity`. Completes at that entity. |
| **TransportTask** | `type: 'transport'`, `fromEntityId`, `toEntityId`, `resource`, `quantity`, `ticksRemaining`. Completes at destination. |
| **Task** | Union of production and transport. |
| **PlayerOrder** | `entityId`, `quantity` — player action for the next tick (mine: produce qty; others: order qty from upstream). |
| **GameState** | `tick`, `entities[]`, `tasks[]`. |

- **Inventory** is `Partial<Record<ResourceKind, number>>`. Not every entity holds every resource (e.g. mine only has `raw_materials`).
- Entity IDs are fixed constants (e.g. `entity-mine`, `entity-chip`) so the engine can reference upstream/downstream without string literals scattered in the UI.

---

## Tick Engine

- **Entry point**: `runOneTick(state, playerOrder?)` in `src/engine/tickProcessor.ts`.
- **Steps inside one tick** (in order):
  1. **Increment** `state.tick`.
  2. **Process completed tasks**: for each task, decrement `ticksRemaining`; if it reaches 0, apply the effect (add output to the right entity) and remove the task from the list.
  3. **Process entity decisions**: for each entity, if player-controlled and `playerOrder` is provided for this tick, apply that order (production or transport); otherwise, if AI, run the standard “order when low / produce when input available” logic. New tasks are appended to the task list.

- **Durations** (in `tickProcessor.ts`):
  - Production: **raw_materials** 1 tick, **chips** 3 ticks, **smartphones** 4 ticks.
  - Transport: 2 ticks for all shipments.

- **Player order**: `runOneTick(state, playerOrder?)` accepts an optional **PlayerOrder** (`entityId`, `quantity`). If present, the player-controlled entity performs that action this tick (mine: produce N raw_materials, or 0 to skip; others: order N from upstream, capped by upstream stock). The UI sets this before Step or each auto-tick when playing.

- **useTickEngine** (`src/hooks/useTickEngine.ts`):
  - Holds `gameState` and `isPaused`.
  - When not paused, runs `runOneTick` on an interval (e.g. 800 ms).
  - Exposes `step()` (one tick with optional player order), `reset()`, and `setPaused()`.
  - Can be initialised with a **player entity id** so the initial state is created with that entity marked as player-controlled.

---

## Entity & Task Rules

### Chain Order (upstream → downstream)

1. **Mineral Mine** — produces **raw_materials** (no input). No upstream.
2. **Chip Processor** — consumes **raw_materials**, produces **chips**. Upstream: Mine.
3. **Assembler** — consumes **chips**, produces **smartphones**. Upstream: Chip Processor.
4. **Retailer** — only holds **smartphones** (sells to end customer). Upstream: Assembler. No production.

### Who can do what

- **Mine**: Start a *production* task (raw_materials). Duration 1 tick. Player can choose to produce or not (and how much, if extended).
- **Chip / Assembler**: Consume input from inventory and start a *production* task; and place *orders* (transport tasks) with upstream when they want more input. Player chooses order quantity per turn.
- **Retailer**: Only places orders with the Assembler. Player chooses order quantity per turn.

### Task ownership for display

- **Production task** “belongs” to the entity where production runs (`entityId`).
- **Transport task** “belongs” to both **from** and **to** entities (outgoing shipment for source, incoming for destination). The UI shows under each entity card: productions at that entity, and incoming/outgoing shipments for that entity.

---

## Player vs AI

- Exactly one entity is **player-controlled** per game (chosen at start).
- **At start**: The **RoleSelect** screen lets the player choose which entity to control; `createInitialState(controlledEntityId)` is then used so that entity has `isPlayerControlled === true`. A “Change role” control returns to RoleSelect.
- **Each tick**:
  - **Player entity**: Does not run AI. The player sets the action for the next tick in the UI:
    - **Mine**: “Produce (0 = skip)”: 0 to do nothing, or 1–10 to start a production task for that many raw_materials (completes in 1 tick).
    - **Chip / Assembler / Retailer**: “Order from upstream”: 0 for no order, or up to the upstream entity’s available stock. Creates a transport task (2 ticks) when the tick runs.
  - **Other entities**: Run AI logic (order when stock below threshold, produce when input available; mine auto-produces when not already producing).

Player order is passed into `runOneTick` as an optional **PlayerOrder** (`entityId`, `quantity`) so the engine stays pure and testable.

---

## Project Structure

```
src/
├── types/
│   └── game.ts          # ResourceKind, EntityKind, Entity, Task, GameState
├── engine/
│   ├── createInitialState.ts   # Build initial game state (optionally with player entity)
│   └── tickProcessor.ts        # processCompletedTasks, processEntityDecisions, runOneTick
├── hooks/
│   └── useTickEngine.ts        # State, pause/play, step, reset, player order
├── components/
│   ├── DebugPanel.tsx          # Main game UI: tick, play/pause/step, entity cards (inventory + tasks per entity, player order input)
│   └── RoleSelect.tsx          # Start screen: choose which entity to control
├── App.tsx
├── main.tsx
└── index.css
```

- **types**: Single place for all game types and constants (e.g. labels).
- **engine**: Pure logic; no React, no DOM.
- **hooks**: Connects engine to React (state, timer, player input).
- **components**: Screens and per-entity display (inventory, tasks, order controls).

---

## Scaling Notes

- **Adding entities**: Extend `EntityKind`, add an id in `createInitialState`, and update `UPSTREAM` / `INPUT_FOR_OUTPUT` / `OUTPUT_RESOURCE` in `tickProcessor.ts`. Add a role button in `RoleSelect` and ensure the UI shows the new entity and its tasks.
- **Adding resources**: Extend `ResourceKind`, update labels and any entity inventory types. Adjust production/transport rules in the engine and UI.
- **Changing durations**: Edit `PRODUCTION_DURATION_TICKS` and `TRANSPORT_DURATION_TICKS` in `tickProcessor.ts`.
- **AI tuning**: Change `REORDER_THRESHOLD` and order/production quantities in `processEntityDecisions`. Consider making them configurable (e.g. difficulty).
- **Multiple players**: Would require `GameState` to support more than one `isPlayerControlled` entity and a `playerOrders` structure keyed by entity id; `runOneTick` would accept a map of orders per player entity.
- **Persistence**: Serialise `GameState` (and optionally which entity is player) to JSON; restore in `createInitialState` or a dedicated `loadState` function.

---

*Last updated for the version that includes: entity selection at start, per-entity task display, mine 1-tick production, and player order quantity per turn.*
