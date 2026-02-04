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
  /** Player order for the next tick (entityId + quantity). Set by UI. */
  playerOrderForNextTick: PlayerOrder | null;
  setPlayerOrderForNextTick: (order: PlayerOrder | null) => void;
}

/**
 * Core tick-based simulation hook. When not paused, advances game state
 * every TICK_INTERVAL_MS. Each tick uses playerOrderForNextTick if set.
 */
export function useTickEngine(playerEntityId: string | null): UseTickEngineResult {
  const [gameState, setGameState] = useState<GameState>(() =>
    createInitialState(playerEntityId)
  );
  const [isPaused, setPaused] = useState(true);
  const [playerOrderForNextTick, setPlayerOrderForNextTick] = useState<PlayerOrder | null>(null);
  const playerOrderRef = useRef<PlayerOrder | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync so interval callback sees latest order
  playerOrderRef.current = playerOrderForNextTick;

  const step = useCallback(() => {
    const order = playerOrderRef.current;
    setGameState((prev) => runOneTick(prev, order ?? null));
    setPlayerOrderForNextTick(null);
  }, []);

  const reset = useCallback(() => {
    setGameState(createInitialState(playerEntityId));
    setPaused(true);
    setPlayerOrderForNextTick(null);
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
      const order = playerOrderRef.current;
      setGameState((prev) => runOneTick(prev, order ?? null));
      setPlayerOrderForNextTick(null);
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
    playerOrderForNextTick,
    setPlayerOrderForNextTick,
  };
}
