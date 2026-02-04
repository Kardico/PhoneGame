import { useMemo } from 'react';
import type { Entity, ResourceKind, Task } from '../types/game';
import { ENTITY_LABELS, RESOURCE_LABELS } from '../types/game';
import { useTickEngine } from '../hooks/useTickEngine';

function getTasksForEntity(entityId: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => {
    if (t.type === 'production') return t.entityId === entityId;
    return t.fromEntityId === entityId || t.toEntityId === entityId;
  });
}

function EntityCard({
  entity,
  tasks,
  isPlayer,
  orderQuantity,
  onOrderChange,
  maxOrder,
  orderLabel,
}: {
  entity: Entity;
  tasks: Task[];
  isPlayer: boolean;
  orderQuantity: number;
  onOrderChange: (qty: number) => void;
  maxOrder: number;
  orderLabel: string;
}) {
  const inventoryEntries = (
    Object.entries(entity.inventory) as [ResourceKind, number | undefined][]
  ).filter(([, qty]) => qty !== undefined);

  return (
    <div className="rounded-xl border border-slate-600 bg-slate-800/50 overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-slate-600">
        <div className="min-w-[140px] font-medium text-slate-200">
          {ENTITY_LABELS[entity.kind]}
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {inventoryEntries.length === 0 ? (
            <span className="text-slate-500">—</span>
          ) : (
            inventoryEntries.map(([res, qty]) => (
              <span key={res} className="rounded bg-slate-700 px-2 py-0.5 text-slate-300">
                {RESOURCE_LABELS[res]}: <strong>{qty ?? 0}</strong>
              </span>
            ))
          )}
        </div>
        {isPlayer && (
          <span className="ml-auto rounded bg-amber-600/30 px-2 py-0.5 text-xs text-amber-300">
            You
          </span>
        )}
      </div>

      {isPlayer && (
        <div className="px-4 py-2 bg-slate-800/80 border-b border-slate-600 flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-400">{orderLabel}</label>
          <input
            type="number"
            min={0}
            max={maxOrder}
            value={orderQuantity}
            onChange={(e) => onOrderChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="w-20 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-slate-200 font-mono text-sm"
          />
          <span className="text-xs text-slate-500">(max {maxOrder})</span>
        </div>
      )}

      {tasks.length > 0 && (
        <ul className="px-4 py-2 space-y-1 text-sm text-slate-400">
          {tasks.map((t) =>
            t.type === 'production' ? (
              <li key={t.id}>
                Producing {RESOURCE_LABELS[t.outputResource]} +{t.quantity} in {t.ticksRemaining}t
              </li>
            ) : (
              <li key={t.id}>
                {t.fromEntityId === entity.id ? 'Outgoing' : 'Incoming'}: {RESOURCE_LABELS[t.resource]} ×{t.quantity} in {t.ticksRemaining}t
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

export interface DebugPanelProps {
  playerEntityId: string;
}

export function DebugPanel({ playerEntityId }: DebugPanelProps) {
  const {
    gameState,
    isPaused,
    setPaused,
    step,
    reset,
    playerOrderForNextTick,
    setPlayerOrderForNextTick,
  } = useTickEngine(playerEntityId);

  const tasksByEntity = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const e of gameState.entities) {
      map[e.id] = getTasksForEntity(e.id, gameState.tasks);
    }
    return map;
  }, [gameState.entities, gameState.tasks]);

  const getMaxOrder = (entity: Entity): number => {
    if (entity.kind === 'mineral_mine') return 10;
    const upstreamId =
      entity.kind === 'chip_processor' ? 'entity-mine' :
      entity.kind === 'assembler' ? 'entity-chip' :
      entity.kind === 'retailer' ? 'entity-assembler' : null;
    if (!upstreamId) return 0;
    const upstream = gameState.entities.find((e) => e.id === upstreamId);
    const res =
      entity.kind === 'retailer' ? 'smartphones' :
      entity.kind === 'assembler' ? 'chips' : 'raw_materials';
    return upstream?.inventory[res] ?? 0;
  };

  const getOrderLabel = (entity: Entity): string => {
    if (entity.kind === 'mineral_mine') return 'Produce (0 = skip):';
    return 'Order from upstream:';
  };

  const handleOrderChange = (entityId: string, qty: number) => {
    setPlayerOrderForNextTick({ entityId, quantity: qty });
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-white">
          Supply Chain — Smartphone
        </h1>

        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-600 bg-slate-800/80 p-4">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Tick:</span>
            <span className="font-mono text-lg font-semibold text-white">
              {gameState.tick}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPaused(!isPaused)}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
            >
              {isPaused ? 'Play' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={step}
              disabled={!isPaused}
              className="rounded-lg bg-slate-600 px-4 py-2 font-medium text-slate-200 hover:bg-slate-500 disabled:opacity-50 disabled:hover:bg-slate-600"
            >
              Step
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-slate-500 bg-transparent px-4 py-2 font-medium text-slate-300 hover:bg-slate-700"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Entities
          </h2>
          <div className="space-y-2">
            {gameState.entities.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                tasks={tasksByEntity[entity.id] ?? []}
                isPlayer={entity.isPlayerControlled}
                orderQuantity={playerOrderForNextTick?.entityId === entity.id ? playerOrderForNextTick.quantity : 0}
                onOrderChange={(qty) => handleOrderChange(entity.id, qty)}
                maxOrder={getMaxOrder(entity)}
                orderLabel={getOrderLabel(entity)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
