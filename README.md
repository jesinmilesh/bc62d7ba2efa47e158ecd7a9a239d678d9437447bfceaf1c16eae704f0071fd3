# Cape Secure Solutions — Administrator Application

This is the standalone administrative frontend for Cape Secure Solutions.
It is completely decoupled from the public customer-facing website (`https://capesecure.vercel.app/`).

## Architecture & Security Boundary
- **Zero Direct Database Connections**: This browser application contains no database passwords, MongoDB URI strings, or direct DB queries.
- **Backend API as Single Source of Truth**: All operations communicate with the backend REST API over HTTPS (`/api/auth/*` and `/api/admin/*`).
- **Authorization**: Protected by signed PBKDF2/HMAC session tokens and `role === 'admin'` enforcement on the server.
- **Data Minimization**: Returns only sanitized administrative records.
- **Brute Force Protection**: 3 consecutive failed login attempts lock administrative access for 15 minutes.

## Configuration
Edit `config.js` or inject `window.__ADMIN_API_OVERRIDE__` in production:
```javascript
window.ADMIN_CONFIG = {
  API_BASE_URL: 'https://api.capesecure.com', // Your secure backend URL
  PUBLIC_WEBSITE_URL: 'https://capesecure.vercel.app',
  ADMIN_CREDENTIALS: {
    email: 'admin@capesecure.com',
    password: 'CapeSecure@2026!'
  }
};
```

### Administrative Credentials
- **Username / Email:** `admin@capesecure.com`
- **Password:** `CapeSecure@2026!`


## Deployment to Vercel
To deploy as a separate application (e.g. `https://admin.capesecure.vercel.app`):
```bash
# In the admin-app directory:
cd admin-app
vercel --prod
```
Configure your custom domain in the Vercel Project settings.
Ensure the Backend server environment variable `ADMIN_ORIGIN` includes your admin domain:
`ADMIN_ORIGIN=https://admin.capesecure.vercel.app`
