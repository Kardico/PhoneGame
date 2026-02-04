import { useState } from 'react'
import { DebugPanel } from './components/DebugPanel'
import { RoleSelect } from './components/RoleSelect'
import './index.css'

function App() {
  const [playerEntityId, setPlayerEntityId] = useState<string | null>(null)

  if (playerEntityId === null) {
    return <RoleSelect onSelect={setPlayerEntityId} />
  }

  return (
    <>
      <div className="fixed top-2 right-2 z-10">
        <button
          type="button"
          onClick={() => setPlayerEntityId(null)}
          className="rounded border border-slate-500 bg-slate-800/90 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
        >
          Change role
        </button>
      </div>
      <DebugPanel playerEntityId={playerEntityId} />
    </>
  )
}

export default App
