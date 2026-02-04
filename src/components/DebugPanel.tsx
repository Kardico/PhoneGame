import { useMemo, useState } from 'react';
import type { Entity, Job, Delivery, Order, PlayerOrder } from '../types/game';
import { useTickEngine } from '../hooks/useTickEngine';
import {
  getGameConfig,
  getEntityType,
  getCurrentPhaseName,
  getPhaseProgress,
  getOrdersForEntity,
  getDeliveriesForEntity,
  getEntityName,
  getSuppliersForResource,
} from '../engine/tickProcessor';

// ============================================================================
// ORDER HISTORY ITEM
// ============================================================================

interface OrderHistoryItemProps {
  order: Order;
  entityId: string;
  getResourceName: (id: string) => string;
  getEntityNameFn: (id: string) => string;
}

function OrderHistoryItem({ order, entityId, getResourceName, getEntityNameFn }: OrderHistoryItemProps) {
  const isBuyer = order.buyerEntityId === entityId;
  const otherEntity = isBuyer ? order.sellerEntityId : order.buyerEntityId;
  
  const statusColor = {
    pending: 'text-yellow-400',
    in_transit: 'text-blue-400',
    delivered: 'text-emerald-400',
  }[order.status];

  const statusLabel = {
    pending: 'Pending',
    in_transit: 'In Transit',
    delivered: 'Delivered',
  }[order.status];

  return (
    <div className="text-xs border-b border-slate-700/50 py-1.5 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`font-medium ${isBuyer ? 'text-blue-400' : 'text-orange-400'}`}>
          {isBuyer ? '📤 Ordered' : '📥 Received'}
        </span>
        <span className="text-slate-400">
          {getResourceName(order.resource)}
        </span>
        {order.wasAmended ? (
          <span>
            <span className="line-through text-slate-500">{order.requestedQuantity}</span>
            <span className="text-orange-400 ml-1">{order.fulfilledQuantity}</span>
          </span>
        ) : (
          <span className="text-slate-300">×{order.fulfilledQuantity}</span>
        )}
        <span className={`${statusColor} text-[10px]`}>{statusLabel}</span>
      </div>
      <div className="text-slate-500 text-[10px] mt-0.5">
        {isBuyer ? 'from' : 'to'} <span className="text-slate-400">{getEntityNameFn(otherEntity)}</span>
        {' '}• tick {order.placedAtTick}
        {order.deliveredAtTick && ` → ${order.deliveredAtTick}`}
      </div>
    </div>
  );
}

// ============================================================================
// ENTITY CARD
// ============================================================================

interface EntityCardProps {
  entity: Entity;
  jobs: Job[];
  incomingDeliveries: Delivery[];
  outgoingDeliveries: Delivery[];
  orders: Order[];
  isPlayer: boolean;
  onSubmitOrder: (order: PlayerOrder) => void;
  gameState: ReturnType<typeof useTickEngine>['gameState'];
  pendingOrder: PlayerOrder | null;
}

function EntityCard({
  entity,
  jobs,
  incomingDeliveries,
  outgoingDeliveries,
  orders,
  isPlayer,
  onSubmitOrder,
  gameState,
  pendingOrder,
}: EntityCardProps) {
  const config = getGameConfig();
  const entityType = getEntityType(config, entity);
  const [orderQuantity, setOrderQuantity] = useState(5);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [showHistory, setShowHistory] = useState(false);

  const inventoryEntries = Object.entries(entity.inventory).filter(
    ([, qty]) => qty !== undefined && qty > 0
  );

  // Determine what player can do
  const canProduce = entityType.processes.length > 0;
  const process = canProduce ? entityType.processes[0] : null;
  
  // For ordering: determine what resource this entity needs
  let orderResource: string | null = null;
  if (process && process.inputs.length > 0) {
    orderResource = process.inputs[0].resource;
  } else if (entityType.canHold.includes('smartphones') && !canProduce) {
    orderResource = 'smartphones';
  }

  // Get available suppliers for this resource
  const availableSuppliers = orderResource
    ? getSuppliersForResource(gameState, config, entity.id, orderResource)
    : [];
  
  const hasSuppliers = availableSuppliers.length > 0;

  // Get currently selected supplier (or first available)
  const currentSupplierId = selectedSupplierId || (availableSuppliers[0]?.entityId ?? '');
  const currentSupplier = availableSuppliers.find(s => s.entityId === currentSupplierId);

  // Check if can start production
  const activeJobCount = jobs.length;
  const atCapacity = activeJobCount >= entityType.maxConcurrentJobs;
  const hasInputsForProduction = process?.inputs.every(
    (input) => (entity.inventory[input.resource] ?? 0) >= input.quantity
  ) ?? true;

  // Count pending orders (in_transit to this entity)
  const pendingOrdersCount = orders.filter(o => o.buyerEntityId === entity.id && o.status === 'in_transit').length;

  const handleProduce = () => {
    if (!process || atCapacity) return;
    onSubmitOrder({
      entityId: entity.id,
      action: 'produce',
      targetId: process.id,
      quantity: 1,
    });
  };

  const handleOrder = () => {
    if (!orderResource || orderQuantity <= 0 || !currentSupplierId) return;
    onSubmitOrder({
      entityId: entity.id,
      action: 'order',
      targetId: orderResource,
      quantity: orderQuantity,
      supplierId: currentSupplierId,
    });
  };

  // Get resource config for display
  const getResourceName = (id: string) => {
    return config.resources.find((r) => r.id === id)?.name ?? id;
  };

  const getEntityNameFn = (id: string) => getEntityName(gameState, id);

  return (
    <div className={`rounded-xl border ${isPlayer ? 'border-amber-500' : 'border-slate-600'} bg-slate-800/50 overflow-hidden`}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-600 bg-slate-800/80">
        <div className="font-medium text-slate-200">{entity.name}</div>
        <div className="text-xs text-slate-500">{entityType.name}</div>
        {pendingOrdersCount > 0 && (
          <span className="rounded-full bg-blue-600/30 px-2 py-0.5 text-xs text-blue-300" title="Orders awaiting delivery">
            📦 {pendingOrdersCount}
          </span>
        )}
        {isPlayer && (
          <span className="ml-auto rounded bg-amber-600/30 px-2 py-0.5 text-xs text-amber-300">
            You
          </span>
        )}
      </div>

      {/* Inventory */}
      <div className="px-4 py-2 border-b border-slate-700">
        <div className="text-xs text-slate-500 mb-1">Inventory</div>
        <div className="flex flex-wrap gap-2 text-sm">
          {inventoryEntries.length === 0 ? (
            <span className="text-slate-500">Empty</span>
          ) : (
            inventoryEntries.map(([res, qty]) => (
              <span key={res} className="rounded bg-slate-700 px-2 py-0.5 text-slate-300">
                {getResourceName(res)}: <strong>{qty}</strong>
              </span>
            ))
          )}
        </div>
      </div>

      {/* Active Jobs */}
      {jobs.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Production ({jobs.length}/{entityType.maxConcurrentJobs})</div>
          <ul className="text-sm text-slate-400 space-y-0.5">
            {jobs.map((job) => (
              <li key={job.id}>
                {job.outputs.map((o) => `${getResourceName(o.resource)} ×${o.quantity}`).join(', ')} — {job.ticksRemaining}t left
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deliveries */}
      {(incomingDeliveries.length > 0 || outgoingDeliveries.length > 0) && (
        <div className="px-4 py-2 border-b border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Deliveries</div>
          <ul className="text-sm space-y-1">
            {incomingDeliveries.map((d) => (
              <li key={d.id} className="text-emerald-400">
                <span>↓ Incoming:</span>{' '}
                <span className="text-slate-300">{getResourceName(d.resource)} ×{d.quantity}</span>{' '}
                <span className="text-slate-500">from {getEntityNameFn(d.fromEntityId)}</span>{' '}
                <span className="text-slate-400">— {d.ticksRemaining}t</span>
              </li>
            ))}
            {outgoingDeliveries.map((d) => (
              <li key={d.id} className="text-orange-400">
                <span>↑ Outgoing:</span>{' '}
                <span className="text-slate-300">{getResourceName(d.resource)} ×{d.quantity}</span>{' '}
                <span className="text-slate-500">to {getEntityNameFn(d.toEntityId)}</span>{' '}
                <span className="text-slate-400">— {d.ticksRemaining}t</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Player Controls */}
      {isPlayer && (
        <div className="px-4 py-3 bg-slate-800/60 space-y-3">
          {/* Pending order indicator */}
          {pendingOrder && pendingOrder.entityId === entity.id && (
            <div className="flex items-center gap-2 text-sm bg-amber-900/40 border border-amber-600/50 rounded px-3 py-2">
              <span className="text-amber-400 font-medium">Queued:</span>
              <span className="text-amber-200">
                {pendingOrder.action === 'produce'
                  ? `Produce ${pendingOrder.quantity}`
                  : `Order ${pendingOrder.quantity} ${getResourceName(pendingOrder.targetId)}${pendingOrder.supplierId ? ` from ${getEntityNameFn(pendingOrder.supplierId)}` : ''}`}
              </span>
              <span className="text-amber-500/70 text-xs">(next tick)</span>
            </div>
          )}

          {/* Produce button */}
          {canProduce && process && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleProduce}
                disabled={atCapacity || !hasInputsForProduction}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Produce
              </button>
              <span className="text-xs text-slate-400">
                {process.inputs.length > 0
                  ? `${process.inputs.map((i) => `${i.quantity} ${getResourceName(i.resource)}`).join(', ')} → ${process.outputs.map((o) => `${o.quantity} ${getResourceName(o.resource)}`).join(', ')}`
                  : `→ ${process.outputs.map((o) => `${o.quantity} ${getResourceName(o.resource)}`).join(', ')}`}
                {' '}({process.ticks}t)
              </span>
              {atCapacity && <span className="text-xs text-orange-400">At capacity</span>}
              {!hasInputsForProduction && !atCapacity && <span className="text-xs text-red-400">Need inputs</span>}
            </div>
          )}

          {/* Order controls */}
          {orderResource && hasSuppliers && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-400">Order {getResourceName(orderResource)}:</span>
                <input
                  type="number"
                  min={1}
                  value={orderQuantity}
                  onChange={(e) => setOrderQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-slate-200"
                />
                <button
                  type="button"
                  onClick={handleOrder}
                  disabled={orderQuantity <= 0 || !currentSupplierId}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Order
                </button>
              </div>
              
              {/* Supplier selection */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">From:</span>
                {availableSuppliers.length === 1 ? (
                  <span className="text-slate-400">
                    {currentSupplier?.entityName} ({currentSupplier?.stock} in stock, {currentSupplier?.transportTime}t delivery)
                  </span>
                ) : (
                  <select
                    value={currentSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-slate-200"
                  >
                    {availableSuppliers.map((s) => (
                      <option key={s.entityId} value={s.entityId}>
                        {s.entityName} ({s.stock} stock, {s.transportTime}t)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {/* No suppliers warning */}
          {orderResource && !hasSuppliers && (
            <div className="text-xs text-slate-500">
              No suppliers available for {getResourceName(orderResource)}
            </div>
          )}
        </div>
      )}

      {/* Sales stats for retailers */}
      {gameState.sales[entity.id] && (
        <div className="px-4 py-2 bg-slate-900/50 text-xs text-slate-500">
          Sold: {gameState.sales[entity.id].totalSold} | 
          Lost: {gameState.sales[entity.id].lostSales} | 
          Total Demand: {gameState.sales[entity.id].totalDemand}
        </div>
      )}

      {/* History Toggle */}
      <div className="border-t border-slate-700">
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          className="w-full px-4 py-2 text-xs text-slate-500 hover:bg-slate-700/50 flex items-center justify-between"
        >
          <span>Order History ({orders.length})</span>
          <span>{showHistory ? '▲' : '▼'}</span>
        </button>
        {showHistory && orders.length > 0 && (
          <div className="px-4 py-2 bg-slate-900/30 max-h-40 overflow-y-auto">
            {orders.slice().reverse().map((order) => (
              <OrderHistoryItem
                key={order.id}
                order={order}
                entityId={entity.id}
                getResourceName={getResourceName}
                getEntityNameFn={getEntityNameFn}
              />
            ))}
          </div>
        )}
        {showHistory && orders.length === 0 && (
          <div className="px-4 py-2 bg-slate-900/30 text-xs text-slate-500">
            No orders yet
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PANEL
// ============================================================================

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
    submitOrder,
    pendingOrder,
  } = useTickEngine(playerEntityId);

  const config = getGameConfig();

  // Group entities by location
  const entitiesByLocation = useMemo(() => {
    const map: Record<string, Entity[]> = {};
    for (const entity of gameState.entities) {
      if (!map[entity.locationId]) map[entity.locationId] = [];
      map[entity.locationId].push(entity);
    }
    return map;
  }, [gameState.entities]);

  // Get jobs for each entity
  const getJobsForEntity = (entityId: string) =>
    gameState.jobs.filter((j) => j.entityId === entityId);

  const phaseName = getCurrentPhaseName(gameState);
  const phaseProgress = getPhaseProgress(gameState);

  return (
    <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-bold text-white">
          Supply Chain — Smartphone
        </h1>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-600 bg-slate-800/80 p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Tick:</span>
              <span className="font-mono text-lg font-semibold text-white">
                {gameState.tick}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Phase:</span>
              <span className="font-medium text-emerald-400">{phaseName}</span>
              <span className="text-xs text-slate-500">
                ({phaseProgress.current}/{phaseProgress.total})
              </span>
            </div>
          </div>
          <div className="flex gap-2 ml-auto">
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
              className="rounded-lg bg-slate-600 px-4 py-2 font-medium text-slate-200 hover:bg-slate-500 disabled:opacity-50"
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

        {/* Entities by Location */}
        <div className="space-y-6">
          {config.locations.map((location) => {
            const entities = entitiesByLocation[location.id] ?? [];
            if (entities.length === 0) return null;

            return (
              <div key={location.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
                    {location.name}
                  </h2>
                  {location.baseDemand > 0 && (
                    <span className="text-xs text-slate-500">
                      (Base demand: {location.baseDemand})
                    </span>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {entities.map((entity) => {
                    const deliveries = getDeliveriesForEntity(gameState, entity.id);
                    const orders = getOrdersForEntity(gameState, entity.id);
                    return (
                      <EntityCard
                        key={entity.id}
                        entity={entity}
                        jobs={getJobsForEntity(entity.id)}
                        incomingDeliveries={deliveries.incoming}
                        outgoingDeliveries={deliveries.outgoing}
                        orders={orders}
                        isPlayer={entity.isPlayerControlled}
                        onSubmitOrder={submitOrder}
                        gameState={gameState}
                        pendingOrder={pendingOrder}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
