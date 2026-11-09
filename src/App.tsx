import { AppShell } from './components/layout/AppShell'
import { TitleBar } from './components/layout/TitleBar'
import { isWindowsApp } from './lib/platform'
import 'katex/dist/katex.min.css'
import './styles/globals.css'

function App() {
  // Windows runs frameless, so the app supplies its own titlebar above every
  // screen (vault picker included). Elsewhere the wrapper is layout-neutral.
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {isWindowsApp && <TitleBar />}
      <div className="relative min-h-0 flex-1">
        <AppShell />
      </div>
    </div>
  )
}

export default App
