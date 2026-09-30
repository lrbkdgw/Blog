import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './lib/theme'
import { FontProvider } from './lib/font'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './components/Toast'
import './styles/index.css'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename || '/'}>
      <ThemeProvider>
        <AuthProvider>
          <FontProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </FontProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
