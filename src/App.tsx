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
    <DebugPanel
      playerEntityId={playerEntityId}
      onChangeRole={() => setPlayerEntityId(null)}
    />
  )
}

export default App
