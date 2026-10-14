import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import App from './App'
import './styles/globals.css'

// Vercel Web Analytics for the admin panel. inject() is the SPA entry point
// (the admin is a Vite app on React Router, not Next); <AdminRouteAnalytics />
// sends a pageview on each client-side navigation and reports the route to
// Speed Insights. Both are cookieless and carry no customer identifiers —
// see maskAdminPath there.
inject()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
