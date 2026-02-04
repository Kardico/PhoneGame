import type { EntityKind } from '../types/game';
import { ENTITY_LABELS } from '../types/game';
import { ENTITY_IDS } from '../engine/createInitialState';

const ENTITY_ORDER: EntityKind[] = ['mineral_mine', 'chip_processor', 'assembler', 'retailer'];

const ENTITY_ID_BY_KIND: Record<EntityKind, string> = {
  mineral_mine: ENTITY_IDS.mineral_mine,
  chip_processor: ENTITY_IDS.chip_processor,
  assembler: ENTITY_IDS.assembler,
  retailer: ENTITY_IDS.retailer,
};

export interface RoleSelectProps {
  onSelect: (entityId: string) => void;
}

export function RoleSelect({ onSelect }: RoleSelectProps) {
  return (
    <div className="min-h-screen bg-slate-900 p-6 text-slate-100 flex flex-col items-center justify-center">
      <div className="mx-auto max-w-md space-y-8 text-center">
        <h1 className="text-2xl font-bold text-white">
          Supply Chain — Smartphone
        </h1>
        <p className="text-slate-400">
          Choose which entity you will control. The rest will be run by the AI.
        </p>
        <div className="grid gap-3">
          {ENTITY_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onSelect(ENTITY_ID_BY_KIND[kind])}
              className="rounded-xl border border-slate-600 bg-slate-800/80 px-6 py-4 text-left font-medium text-slate-200 hover:border-emerald-500 hover:bg-slate-700/80 hover:text-white transition-colors"
            >
              {ENTITY_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
