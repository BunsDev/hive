import './styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installTransport } from './transport'
import WebAuthScreen from './components/WebAuthScreen'

const { needsAuth } = installTransport()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {needsAuth ? <WebAuthScreen onAuthenticated={() => window.location.reload()} /> : <App />}
  </React.StrictMode>
)
