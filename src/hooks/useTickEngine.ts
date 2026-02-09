import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, PlayerOrder } from '../types/game';
import { createInitialState } from '../engine/createInitialState';
import { runOneTick, getGameConfig } from '../engine/tickProcessor';

/** Minimum interval for "as fast as possible" mode (speed 5) */
const MIN_TICK_MS = 16;

export interface UseTickEngineResult {
  gameState: GameState;
  isPaused: boolean;
  setPaused: (paused: boolean) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  step: () => void;
  reset: () => void;
  /** Submit a player order (appends to the queue for the next tick) */
  submitOrder: (order: PlayerOrder) => void;
  /** All pending player orders for the next tick */
  pendingOrders: PlayerOrder[];
  /** Clear all pending orders */
  clearOrders: () => void;
  /** Remove a specific pending order by index */
  removePendingOrder: (index: number) => void;
}

/**
 * Core tick-based simulation hook.
 * Supports multiple player actions per tick via an order queue.
 */
export function useTickEngine(playerEntityId: string | null): UseTickEngineResult {
  const config = getGameConfig();

  const [gameState, setGameState] = useState<GameState>(() =>
    createInitialState(playerEntityId),
  );
  const [isPaused, setPaused] = useState(true);
  const [speed, setSpeedState] = useState(config.defaultSpeed);
  const [pendingOrders, setPendingOrders] = useState<PlayerOrder[]>([]);
  const pendingOrdersRef = useRef<PlayerOrder[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(speed);

  // Keep refs in sync
  pendingOrdersRef.current = pendingOrders;
  speedRef.current = speed;

  const setSpeed = useCallback((newSpeed: number) => {
    const clamped = Math.max(1, Math.min(5, newSpeed));
    setSpeedState(clamped);
  }, []);

  /** Append a player order to the queue */
  const submitOrder = useCallback((order: PlayerOrder) => {
    setPendingOrders((prev) => [...prev, order]);
  }, []);

  /** Clear all pending orders */
  const clearOrders = useCallback(() => {
    setPendingOrders([]);
  }, []);

  /** Remove a specific pending order by index */
  const removePendingOrder = useCallback((index: number) => {
    setPendingOrders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const step = useCallback(() => {
    const orders = pendingOrdersRef.current;
    setGameState((prev) => runOneTick(prev, orders));
    setPendingOrders([]);
  }, []);

  const reset = useCallback(() => {
    setGameState(createInitialState(playerEntityId));
    setPaused(true);
    setPendingOrders([]);
  }, [playerEntityId]);

  const getIntervalMs = useCallback(() => {
    const speedStr = String(speedRef.current);
    const ms = config.tickSpeeds[speedStr];
    if (ms === undefined || ms <= 0) return MIN_TICK_MS;
    return ms;
  }, [config.tickSpeeds]);

  useEffect(() => {
    if (isPaused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const startInterval = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        const orders = pendingOrdersRef.current;
        setGameState((prev) => runOneTick(prev, orders));
        setPendingOrders([]);
      }, getIntervalMs());
    };

    startInterval();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPaused, speed, getIntervalMs]);

  return {
    gameState,
    isPaused,
    setPaused,
    speed,
    setSpeed,
    step,
    reset,
    submitOrder,
    pendingOrders,
    clearOrders,
    removePendingOrder,
  };
}
