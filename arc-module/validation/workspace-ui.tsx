import { createRoot } from 'react-dom/client'
import WalletWorkspace from '../src/components/site/WalletWorkspace'
import '@fontsource/dm-sans/400.css'
import '@fontsource/space-grotesk/500.css'
import '../src/index.css'

// Development-only isolated render; Vite's production build uses index.html.
createRoot(document.getElementById('workspace-test')!).render(<WalletWorkspace />)
