import { getSelectableEntities, getEntityTypeName, getLocationName } from '../engine/createInitialState';

export interface RoleSelectProps {
  onSelect: (entityId: string) => void;
}

export function RoleSelect({ onSelect }: RoleSelectProps) {
  const entities = getSelectableEntities();

  // Group entities by type for better display
  const grouped = entities.reduce((acc, e) => {
    const typeName = getEntityTypeName(e.type);
    if (!acc[typeName]) acc[typeName] = [];
    acc[typeName].push(e);
    return acc;
  }, {} as Record<string, typeof entities>);

  return (
    <div className="min-h-screen bg-slate-900 p-6 text-slate-100 flex flex-col items-center justify-center">
      <div className="mx-auto max-w-lg space-y-8 text-center">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Supply Chain — Smartphone
          </h1>
          <p className="mt-2 text-slate-400">
            Choose which entity you will control. The rest will be run by the AI.
          </p>
        </div>

        <div className="space-y-4 text-left">
          {Object.entries(grouped).map(([typeName, typeEntities]) => (
            <div key={typeName}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">
                {typeName}
              </h3>
              <div className="space-y-2">
                {typeEntities.map((entity) => (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => onSelect(entity.id)}
                    className="w-full rounded-xl border border-slate-600 bg-slate-800/80 px-5 py-3 text-left hover:border-emerald-500 hover:bg-slate-700/80 transition-colors"
                  >
                    <div className="font-medium text-slate-200">{entity.name}</div>
                    <div className="text-sm text-slate-400">
                      {getLocationName(entity.locationId)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
