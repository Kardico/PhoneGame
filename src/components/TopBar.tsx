/**
 * TopBar — always-visible sticky bar at the top of the screen.
 * Contains tick counter, speed control, and play/pause/step/reset buttons.
 */

interface TopBarProps {
  tick: number;
  isPaused: boolean;
  speed: number;
  onSetPaused: (paused: boolean) => void;
  onSetSpeed: (speed: number) => void;
  onStep: () => void;
  onReset: () => void;
  onChangeRole: () => void;
}

const SPEED_LABELS: Record<number, string> = {
  1: '1x',
  2: '2x',
  3: '3x',
  4: '4x',
  5: 'Max',
};

export function TopBar({
  tick,
  isPaused,
  speed,
  onSetPaused,
  onSetSpeed,
  onStep,
  onReset,
  onChangeRole,
}: TopBarProps) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-4 bg-slate-900/95 border-b border-slate-700 px-4 py-2 backdrop-blur-sm">
      {/* Tick counter */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400 text-sm">Tick:</span>
        <span className="font-mono text-lg font-semibold text-white">{tick}</span>
      </div>

      {/* Separator */}
      <div className="h-6 w-px bg-slate-700" />

      {/* Speed selector */}
      <div className="flex items-center gap-1">
        <span className="text-slate-400 text-sm mr-1">Speed:</span>
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSetSpeed(s)}
            className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
              speed === s
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
            }`}
          >
            {SPEED_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div className="h-6 w-px bg-slate-700" />

      {/* Playback controls */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSetPaused(!isPaused)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          {isPaused ? 'Play' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={onStep}
          disabled={!isPaused}
          className="rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-500 disabled:opacity-50"
        >
          Step
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-slate-500 bg-transparent px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700"
        >
          Reset
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Change role button */}
      <button
        type="button"
        onClick={onChangeRole}
        className="rounded border border-slate-500 bg-slate-800/90 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
      >
        Change role
      </button>
    </div>
  );
}
