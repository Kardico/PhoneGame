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
  /** Current speed level (1-5) */
  speed: number;
  /** Set speed level (1-5) */
  setSpeed: (speed: number) => void;
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
 * When not paused, advances game state at the selected speed.
 */
export function useTickEngine(playerEntityId: string | null): UseTickEngineResult {
  const config = getGameConfig();

  const [gameState, setGameState] = useState<GameState>(() =>
    createInitialState(playerEntityId)
  );
  const [isPaused, setPaused] = useState(true);
  const [speed, setSpeedState] = useState(config.defaultSpeed);
  const [pendingOrder, setPendingOrder] = useState<PlayerOrder | null>(null);
  const pendingOrderRef = useRef<PlayerOrder | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(speed);

  // Keep refs in sync
  pendingOrderRef.current = pendingOrder;
  speedRef.current = speed;

  const setSpeed = useCallback((newSpeed: number) => {
    const clamped = Math.max(1, Math.min(5, newSpeed));
    setSpeedState(clamped);
  }, []);

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

  /** Get the interval in ms for the current speed */
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
        const order = pendingOrderRef.current;
        setGameState((prev) => runOneTick(prev, order));
        setPendingOrder(null);
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
    pendingOrder,
    clearOrder,
  };
}
