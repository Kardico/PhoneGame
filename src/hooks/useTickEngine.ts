import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, PlayerOrder } from '../types/game';
import { createInitialState } from '../engine/createInitialState';
import { runOneTick } from '../engine/tickProcessor';

const TICK_INTERVAL_MS = 800;

export interface UseTickEngineResult {
  gameState: GameState;
  isPaused: boolean;
  setPaused: (paused: boolean) => void;
  step: () => void;
  reset: () => void;
  /** Submit a player order for the next tick */
  submitOrder: (order: PlayerOrder) => void;
  /** Pending player order (if any) */
  pendingOrder: PlayerOrder | null;
  /** Clear the pending order */
  clearOrder: () => void;
}

/**
 * Core tick-based simulation hook.
 * When not paused, advances game state every TICK_INTERVAL_MS.
 */
export function useTickEngine(playerEntityId: string | null): UseTickEngineResult {
  const [gameState, setGameState] = useState<GameState>(() =>
    createInitialState(playerEntityId)
  );
  const [isPaused, setPaused] = useState(true);
  const [pendingOrder, setPendingOrder] = useState<PlayerOrder | null>(null);
  const pendingOrderRef = useRef<PlayerOrder | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync so interval callback sees latest order
  pendingOrderRef.current = pendingOrder;

  const submitOrder = useCallback((order: PlayerOrder) => {
    setPendingOrder(order);
  }, []);

  const clearOrder = useCallback(() => {
    setPendingOrder(null);
  }, []);

  const step = useCallback(() => {
    const order = pendingOrderRef.current;
    setGameState((prev) => runOneTick(prev, order));
    setPendingOrder(null);
  }, []);

  const reset = useCallback(() => {
    setGameState(createInitialState(playerEntityId));
    setPaused(true);
    setPendingOrder(null);
  }, [playerEntityId]);

  useEffect(() => {
    if (isPaused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      const order = pendingOrderRef.current;
      setGameState((prev) => runOneTick(prev, order));
      setPendingOrder(null);
    }, TICK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPaused]);

  return {
    gameState,
    isPaused,
    setPaused,
    step,
    reset,
    submitOrder,
    pendingOrder,
    clearOrder,
  };
}
