# Supabase Authentication Setup Guide

## Overview

This backend now supports full Supabase authentication with:
- JWT token verification using JWKS
- Email/password authentication
- Google OAuth login
- Protected routes with middleware
- Complete user management endpoints

## Environment Setup

1. Copy the `.env.template` file to `.env`:
```bash
cp .env.template .env
```

2. Fill in your Supabase credentials in the `.env` file:

```env
# Supabase Configuration
SUPABASE_URL="https://your-project-id.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
SUPABASE_JWKS_URL="https://your-project-id.supabase.co/rest/v1/auth/jwks"
SUPABASE_ANON_KEY="your-anon-key"
```

### How to Get Supabase Keys:

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to Settings → API
4. Copy the following:
   - **Project URL** → `SUPABASE_URL`
   - **anon/public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`
5. For JWKS URL, use: `https://your-project-id.supabase.co/rest/v1/auth/jwks`

## Authentication Flow

### 1. Client Authentication (Frontend)

The frontend (Next.js/React Native) handles login/registration and gets JWT tokens from Supabase:

```javascript
// Example: Frontend login
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project-id.supabase.co',
  'your-anon-key'
)

// Email/Password Login
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123'
})

// Google OAuth Login
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'http://localhost:3000/auth/callback'
  }
})
```

### 2. Backend Token Verification

The backend verifies JWT tokens using JWKS and attaches user info to `req.user`:

```javascript
// Protected route example
app.get('/api/protected-resource', authMiddleware, (req, res) => {
  // req.user contains:
  // {
  //   id: 'user-uuid',
  //   email: 'user@example.com',
  //   role: 'authenticated',
  //   ...other JWT claims
  // }
  res.json({ message: 'Hello ' + req.user.email });
});
```

## API Endpoints

### Public Endpoints

- `GET /health` - Server health check
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/health` - Auth service health check

### Protected Endpoints

All require `Authorization: Bearer <jwt-token>` header:

- `GET /api/auth/me` - Get current user profile
- `PUT /api/auth/profile` - Update user metadata
- `POST /api/auth/logout` - Logout user (invalidate session)
- `GET /api/auth/sessions` - Get user sessions
- `DELETE /api/auth/account` - Delete user account

### Other Protected Routes

- `GET /api/goals` - Get user goals
- `GET /api/tasks` - Get user tasks
- `GET /api/ai` - AI endpoints
- `GET /api/ideas` - User ideas

## Frontend Integration Examples

### Next.js Example

```javascript
// utils/api.js
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const apiClient = {
  async get(endpoint, token) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return response.json();
  },

  async post(endpoint, data, token) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    return response.json();
  }
};

// Example usage in a component
import { useSupabaseClient, useSession } from '@supabase/auth-helpers-react';

function UserProfile() {
  const supabase = useSupabaseClient();
  const session = useSession();
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    if (session?.access_token) {
      apiClient.get('/api/auth/me', session.access_token)
        .then(setUserProfile);
    }
  }, [session]);

  return <div>{userProfile?.email}</div>;
}
```

### React Native Example

```javascript
// services/api.js
import AsyncStorage from '@react-native-async-storage/async-storage';

class ApiService {
  constructor() {
    this.baseURL = 'https://your-api.com';
  }

  async getToken() {
    return await AsyncStorage.getItem('supabase_token');
  }

  async request(endpoint, options = {}) {
    const token = await this.getToken();
    
    return fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'react-native',
        'Authorization': token ? `Bearer ${token}` : undefined,
        ...options.headers,
      },
    });
  }

  async getMe() {
    const response = await this.request('/api/auth/me');
    return response.json();
  }
}

export const apiService = new ApiService();
```

## Error Handling

The API returns structured error responses:

```json
{
  "error": "Token expired",
  "message": "Your session has expired. Please log in again."
}
```

Common error codes:
- `401` - Unauthorized (invalid/expired token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `500` - Internal server error

## Testing the Setup

1. Start the server:
```bash
npm run dev
```

2. Test health endpoint:
```bash
curl http://localhost:3000/health
```

3. Test auth health:
```bash
curl http://localhost:3000/api/auth/health
```

4. Test protected endpoint (should fail without token):
```bash
curl http://localhost:3000/api/auth/me
```

5. Test with valid token:
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:3000/api/auth/me
```

## Supabase Dashboard Configuration

### 1. Enable Email Authentication

1. Go to Authentication → Settings
2. Enable "Enable email confirmations"
3. Configure email templates if needed

### 2. Enable Google OAuth

1. Go to Authentication → Providers
2. Enable Google provider
3. Add your Google OAuth client ID and secret
4. Add authorized redirect URIs:
   - `https://your-project.supabase.co/auth/v1/callback`
   - Your frontend URLs (e.g., `http://localhost:3000/auth/callback`)

### 3. Configure JWT Settings

1. Go to Settings → API
2. Note the JWT expiration time
3. Optionally customize JWT claims

### 4. Row Level Security (RLS)

If you're using Supabase database, enable RLS on your tables:

```sql
-- Enable RLS on a table
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users
CREATE POLICY "Users can view own data" ON your_table
    FOR ALL USING (auth.uid() = user_id);
```

## Security Considerations

1. **Environment Variables**: Never commit `.env` files to version control
2. **HTTPS**: Always use HTTPS in production
3. **Token Storage**: Store tokens securely on the frontend
4. **Rate Limiting**: The server has rate limiting enabled
5. **CORS**: Configure CORS properly for your domains

## Troubleshooting

### "SUPABASE_JWKS_URL not set" Warning

Make sure your `.env` file has the correct JWKS URL:
```env
SUPABASE_JWKS_URL="https://your-project-id.supabase.co/rest/v1/auth/jwks"
```

### JWT Verification Fails

1. Check that the token is valid and not expired
2. Verify the JWKS URL is correct
3. Ensure the token audience matches your Supabase URL

### CORS Issues

1. Check that your frontend URL is in the allowed origins
2. For development, the server allows all origins
3. For production, add your domain to the CORS configuration

## Migration from Clerk

If you're migrating from Clerk:

1. Update frontend to use Supabase auth instead of Clerk
2. The backend is now ready for Supabase tokens
3. User data migration may be needed depending on your setup

## Additional Features

The auth system includes:

- **Role-based access control** with `requireRole()` middleware
- **Admin-only routes** with `requireAdmin` middleware
- **Session management** endpoints
- **User metadata updates**
- **Account deletion** functionality

For more advanced features, refer to the [Supabase Auth documentation](https://supabase.com/docs/guides/auth).