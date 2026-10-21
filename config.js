/**
 * Cape Secure Solutions — Standalone Admin Application Configuration
 * 
 * In production, configure API_BASE_URL to point to your secure backend API domain:
 * e.g., 'https://api.capesecure.com' or 'https://capesecure.vercel.app'
 * 
 * When deploying independently to Vercel (admin.capesecure.vercel.app),
 * configure window.__ADMIN_API_OVERRIDE__ or allow it to resolve to the current origin.
 */

window.ADMIN_CONFIG = {
  // Configurable Backend API Endpoint (No hardcoded localhost)
  API_BASE_URL: (function() {
    if (window.__ADMIN_API_OVERRIDE__) return window.__ADMIN_API_OVERRIDE__;
    return window.location.origin;
  })(),

  // Public customer website reference for preview links
  PUBLIC_WEBSITE_URL: 'https://capesecure.vercel.app',

  // Configured Master Administrative Credentials
  ADMIN_CREDENTIALS: {
    email: 'admin@capesecure.com',
    password: 'CapeSecure@2026!',
    name: 'Master Administrator',
    role: 'admin'
  },

  // Application metadata
  APP_NAME: 'Cape Secure Admin Control Center',
  VERSION: '2.0.0'
};
