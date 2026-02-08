import { useMemo, useState } from 'react';
import type { Entity, ProcessLine, Delivery, Order, PlayerOrder, ResourceSalesStats } from '../types/game';
import { useTickEngine } from '../hooks/useTickEngine';
import { TopBar } from './TopBar';
import {
  getGameConfig,
  getEntityType,
  getLocationPhaseName,
  getLocationPhaseProgress,
  getOrdersForEntity,
  getDeliveriesForEntity,
  getEntityName,
  getSuppliersForResource,
  getProcessLinesForEntity,
  getProductionProcess,
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

  const statusColor: Record<string, string> = {
    pending: 'text-yellow-400',
    accepted: 'text-cyan-400',
    in_transit: 'text-blue-400',
    delivered: 'text-emerald-400',
    declined: 'text-red-400',
  };

  const statusLabel: Record<string, string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    in_transit: 'In Transit',
    delivered: 'Delivered',
    declined: 'Declined',
  };

  return (
    <div className="text-xs border-b border-slate-700/50 py-1.5 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`font-medium ${isBuyer ? 'text-blue-400' : 'text-orange-400'}`}>
          {isBuyer ? 'Ordered' : 'Received'}
        </span>
        <span className="text-slate-400">
          {getResourceName(order.resource)}
        </span>
        {order.wasAmended ? (
          <span>
            <span className="line-through text-slate-500">{order.requestedQuantity}</span>
            <span className="text-orange-400 ml-1">{order.fulfilledQuantity}</span>
          </span>
        ) : order.fulfilledQuantity > 0 ? (
          <span className="text-slate-300">x{order.fulfilledQuantity}</span>
        ) : (
          <span className="text-slate-300">x{order.requestedQuantity}</span>
        )}
        <span className={`${statusColor[order.status] ?? 'text-slate-400'} text-[10px]`}>
          {statusLabel[order.status] ?? order.status}
        </span>
      </div>
      <div className="text-slate-500 text-[10px] mt-0.5">
        {isBuyer ? 'from' : 'to'} <span className="text-slate-400">{getEntityNameFn(otherEntity)}</span>
        {' '}| tick {order.placedAtTick}
        {order.deliveredAtTick && ` -> ${order.deliveredAtTick}`}
      </div>
    </div>
  );
}

// ============================================================================
// ENTITY CARD
// ============================================================================

interface EntityCardProps {
  entity: Entity;
  processLines: ProcessLine[];
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
  processLines,
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
  const [selectedProcurementProcess, setSelectedProcurementProcess] = useState<string>(
    entityType.processes.procurement[0] ?? ''
  );
  const [showHistory, setShowHistory] = useState(false);

  const inventoryEntries = Object.entries(entity.inventory).filter(
    ([, qty]) => qty !== undefined && qty > 0
  );

  // Get production processes for this entity
  const productionProcesses = entityType.processes.production.map((pid) => {
    try {
      return getProductionProcess(config, pid);
    } catch {
      return null;
    }
  }).filter((p): p is NonNullable<typeof p> => p !== null);

  const canProduce = productionProcesses.length > 0;

  // For ordering: determine what resource based on selected procurement process
  let orderResource: string | null = null;
  if (selectedProcurementProcess) {
    const procProcess = config.processes.procurement.find((p) => p.id === selectedProcurementProcess);
    if (procProcess) {
      orderResource = procProcess.resource;
    }
  }

  // Get available suppliers for this resource
  const availableSuppliers = orderResource
    ? getSuppliersForResource(gameState, config, entity.id, orderResource)
    : [];

  const hasSuppliers = availableSuppliers.length > 0;

  const currentSupplierId = selectedSupplierId || (availableSuppliers[0]?.entityId ?? '');
  const currentSupplier = availableSuppliers.find(s => s.entityId === currentSupplierId);

  const atCapacity = processLines.length >= entityType.maxProcessLines;

  const activeOrdersCount = orders.filter(
    o => o.buyerEntityId === entity.id && (o.status === 'pending' || o.status === 'accepted' || o.status === 'in_transit')
  ).length;

  const handleStartLine = (processId: string) => {
    if (atCapacity) return;
    const process = getProductionProcess(config, processId);
    onSubmitOrder({
      entityId: entity.id,
      action: 'start_line',
      targetId: processId,
      quantity: process.minVolume,
    });
  };

  const handleStopLine = (lineId: string) => {
    onSubmitOrder({
      entityId: entity.id,
      action: 'stop_line',
      targetId: '',
      quantity: 0,
      lineId,
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

  const getResourceName = (id: string) => {
    return config.resources.find((r) => r.id === id)?.name ?? id;
  };

  const getEntityNameFn = (id: string) => getEntityName(gameState, id);

  const getLocationName = (id: string) => {
    return config.locations.find((l) => l.id === id)?.name ?? id;
  };

  // Sales stats (per-resource)
  const entitySales = gameState.sales[entity.id];

  return (
    <div className={`rounded-xl border ${isPlayer ? 'border-amber-500' : 'border-slate-600'} bg-slate-800/50 overflow-hidden`}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-600 bg-slate-800/80">
        <div className="font-medium text-slate-200">{entity.name}</div>
        <div className="text-xs text-slate-500">{entityType.name}</div>
        {activeOrdersCount > 0 && (
          <span className="rounded-full bg-blue-600/30 px-2 py-0.5 text-xs text-blue-300" title="Active orders">
            {activeOrdersCount} orders
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
            inventoryEntries.map(([res, qty]) => {
              const comm = entity.committed[res] ?? 0;
              return (
                <span key={res} className="rounded bg-slate-700 px-2 py-0.5 text-slate-300">
                  {getResourceName(res)}: <strong>{qty}</strong>
                  {comm > 0 && (
                    <span className="text-orange-400 text-xs ml-1" title="Committed (reserved for shipping)">
                      ({comm} reserved)
                    </span>
                  )}
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* Process Lines */}
      {(processLines.length > 0 || (canProduce && isPlayer)) && (
        <div className="px-4 py-2 border-b border-slate-700">
          <div className="text-xs text-slate-500 mb-1">
            Production Lines ({processLines.length}/{entityType.maxProcessLines})
          </div>
          {processLines.length > 0 && (
            <ul className="text-sm text-slate-400 space-y-1">
              {processLines.map((line) => {
                let procName = line.processId;
                let cycleTicks = '?';
                try {
                  const proc = getProductionProcess(config, line.processId);
                  procName = proc.name;
                  cycleTicks = String(proc.cycleTicks);
                } catch { /* ignore */ }
                return (
                  <li key={line.id} className="flex items-center gap-2">
                    <span className="text-slate-300">{procName}</span>
                    {line.phase === 'starting' ? (
                      <span className="text-yellow-400 text-xs">
                        Starting ({line.startupTicksRemaining}t)
                      </span>
                    ) : (
                      <span className="text-emerald-400 text-xs">
                        {line.progress}/{cycleTicks}
                      </span>
                    )}
                    {line.volume > 1 && (
                      <span className="text-xs text-slate-500">x{line.volume}</span>
                    )}
                    {isPlayer && (
                      <button
                        type="button"
                        onClick={() => handleStopLine(line.id)}
                        className="ml-auto text-xs text-red-400 hover:text-red-300"
                        title="Stop this line"
                      >
                        Stop
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Deliveries */}
      {(incomingDeliveries.length > 0 || outgoingDeliveries.length > 0) && (
        <div className="px-4 py-2 border-b border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Deliveries</div>
          <ul className="text-sm space-y-1">
            {incomingDeliveries.map((d) => (
              <li key={d.id} className="text-emerald-400">
                <span>Incoming:</span>{' '}
                <span className="text-slate-300">{getResourceName(d.resource)} x{d.quantity}</span>{' '}
                <span className="text-slate-500">from {getEntityNameFn(d.fromEntityId)}</span>{' '}
                <span className="text-slate-400">- {d.ticksRemaining}t</span>
                {d.route.length > 2 && (
                  <span className="text-slate-600 text-xs ml-1" title="Route">
                    via {d.route.slice(1, -1).map(getLocationName).join(' > ')}
                  </span>
                )}
              </li>
            ))}
            {outgoingDeliveries.map((d) => (
              <li key={d.id} className="text-orange-400">
                <span>Outgoing:</span>{' '}
                <span className="text-slate-300">{getResourceName(d.resource)} x{d.quantity}</span>{' '}
                <span className="text-slate-500">to {getEntityNameFn(d.toEntityId)}</span>{' '}
                <span className="text-slate-400">- {d.ticksRemaining}t</span>
                {d.route.length > 2 && (
                  <span className="text-slate-600 text-xs ml-1" title="Route">
                    via {d.route.slice(1, -1).map(getLocationName).join(' > ')}
                  </span>
                )}
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
                {pendingOrder.action === 'start_line'
                  ? `Start ${pendingOrder.targetId}`
                  : pendingOrder.action === 'stop_line'
                  ? `Stop line`
                  : `Order ${pendingOrder.quantity} ${getResourceName(pendingOrder.targetId)}${pendingOrder.supplierId ? ` from ${getEntityNameFn(pendingOrder.supplierId)}` : ''}`}
              </span>
              <span className="text-amber-500/70 text-xs">(next tick)</span>
            </div>
          )}

          {/* Start line buttons for each production process */}
          {canProduce && productionProcesses.map((process) => (
            <div key={process.id} className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleStartLine(process.id)}
                disabled={atCapacity}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start {process.name}
              </button>
              <span className="text-xs text-slate-400">
                {process.cycleInputs.length > 0
                  ? `${process.cycleInputs.map((i) => `${i.quantity} ${getResourceName(i.resource)}`).join(', ')} -> ${process.outputs.map((o) => `${o.quantity} ${getResourceName(o.resource)}`).join(', ')}`
                  : `-> ${process.outputs.map((o) => `${o.quantity} ${getResourceName(o.resource)}`).join(', ')}`}
                {' '}({process.cycleTicks}t/cycle)
              </span>
              {atCapacity && <span className="text-xs text-orange-400">At capacity</span>}
            </div>
          ))}

          {/* Order controls */}
          {entityType.processes.procurement.length > 0 && (
            <div className="space-y-2">
              {/* Procurement process selector (if multiple) */}
              {entityType.processes.procurement.length > 1 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Buy:</span>
                  <select
                    value={selectedProcurementProcess}
                    onChange={(e) => {
                      setSelectedProcurementProcess(e.target.value);
                      setSelectedSupplierId('');
                    }}
                    className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-slate-200"
                  >
                    {entityType.processes.procurement.map((pid) => {
                      const proc = config.processes.procurement.find((p) => p.id === pid);
                      return (
                        <option key={pid} value={pid}>
                          {proc?.name ?? pid}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {orderResource && hasSuppliers && (
                <>
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
                        {currentSupplier?.entityName} ({currentSupplier?.availableStock} available, {currentSupplier?.transportTime}t delivery)
                      </span>
                    ) : (
                      <select
                        value={currentSupplierId}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                        className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-slate-200"
                      >
                        {availableSuppliers.map((s) => (
                          <option key={s.entityId} value={s.entityId}>
                            {s.entityName} ({s.availableStock} avail, {s.transportTime}t)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}

              {orderResource && !hasSuppliers && (
                <div className="text-xs text-slate-500">
                  No suppliers available for {getResourceName(orderResource)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sales stats for retailers (per-resource) */}
      {entitySales && Object.keys(entitySales).length > 0 && (
        <div className="px-4 py-2 bg-slate-900/50 text-xs text-slate-500 space-y-0.5">
          {Object.entries(entitySales).map(([resource, stats]: [string, ResourceSalesStats]) => (
            <div key={resource}>
              {getResourceName(resource)}: Sold {stats.totalSold} | Lost {stats.lostSales} | Demand {stats.totalDemand}
            </div>
          ))}
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
          <span>{showHistory ? 'Hide' : 'Show'}</span>
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
  onChangeRole: () => void;
}

export function DebugPanel({ playerEntityId, onChangeRole }: DebugPanelProps) {
  const {
    gameState,
    isPaused,
    setPaused,
    speed,
    setSpeed,
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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Sticky top bar */}
      <TopBar
        tick={gameState.tick}
        isPaused={isPaused}
        speed={speed}
        onSetPaused={setPaused}
        onSetSpeed={setSpeed}
        onStep={step}
        onReset={reset}
        onChangeRole={onChangeRole}
      />

      {/* Main content */}
      <div className="p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Entities by Location */}
          <div className="space-y-6">
            {config.locations.map((location) => {
              const entities = entitiesByLocation[location.id] ?? [];
              if (entities.length === 0) return null;

              const phaseName = getLocationPhaseName(gameState, config, location.id);
              const phaseProgress = getLocationPhaseProgress(gameState, config, location.id);
              const hasDemand = Object.values(location.demand).some((d) => d > 0);

              return (
                <div key={location.id} className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
                      {location.name}
                    </h2>
                    {hasDemand && (
                      <span className="text-xs text-slate-500">
                        (Demand: {Object.entries(location.demand).map(([r, d]) => {
                          const rName = config.resources.find((res) => res.id === r)?.name ?? r;
                          return `${rName}: ${d}`;
                        }).join(', ')})
                      </span>
                    )}
                    {phaseName && (
                      <span className="text-xs text-emerald-400">
                        {phaseName}
                        {phaseProgress && ` (${phaseProgress.current}/${phaseProgress.total})`}
                      </span>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {entities.map((entity) => {
                      const deliveries = getDeliveriesForEntity(gameState, entity.id);
                      const orders = getOrdersForEntity(gameState, entity.id);
                      const lines = getProcessLinesForEntity(gameState, entity.id);
                      return (
                        <EntityCard
                          key={entity.id}
                          entity={entity}
                          processLines={lines}
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
    </div>
  );
}
