import express from 'express';
import { supabaseAdmin, supabaseClient } from '../lib/supabase.js';
import { authMiddleware, getUserFromDatabase } from '../middleware/auth.js';

const router = express.Router();

// GET /api/auth/me - Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user data from Supabase Auth
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (userError) {
      console.error('Error fetching user from Supabase:', userError);
      return res.status(500).json({ 
        error: 'Failed to fetch user data', 
        message: userError.message 
      });
    }

    if (!userData || !userData.user) {
      return res.status(404).json({ 
        error: 'User not found', 
        message: 'The authenticated user was not found in the database.' 
      });
    }

    const user = userData.user;

    // Return user profile information
    res.json({
      id: user.id,
      email: user.email,
      emailVerified: user.email_confirmed_at !== null,
      phone: user.phone,
      phoneVerified: user.phone_confirmed_at !== null,
      lastSignIn: user.last_sign_in_at,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      userMetadata: user.user_metadata,
      appMetadata: user.app_metadata,
      // Include provider information
      identities: user.identities?.map(identity => ({
        provider: identity.provider,
        identityId: identity.identity_id,
        createdAt: identity.created_at,
        updatedAt: identity.updated_at
      })) || []
    });
  } catch (error) {
    console.error('Error in /me endpoint:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'An unexpected error occurred while fetching user data.' 
    });
  }
});

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ 
        error: 'Bad request', 
        message: 'Refresh token is required.' 
      });
    }

    // Refresh the session using Supabase
    const { data, error } = await supabaseClient.auth.refreshSession({
      refresh_token
    });

    if (error) {
      return res.status(401).json({ 
        error: 'Refresh failed', 
        message: error.message 
      });
    }

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
      user: {
        id: data.user.id,
        email: data.user.email,
        emailVerified: data.user.email_confirmed_at !== null,
        lastSignIn: data.user.last_sign_in_at
      }
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'An unexpected error occurred while refreshing the token.' 
    });
  }
});

// POST /api/auth/logout - Logout user
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Sign out user from Supabase (this invalidates the session)
    const { error } = await supabaseAdmin.auth.admin.signOut(userId);

    if (error) {
      console.error('Error signing out user:', error);
      return res.status(500).json({ 
        error: 'Logout failed', 
        message: error.message 
      });
    }

    res.json({ 
      message: 'Successfully logged out' 
    });
  } catch (error) {
    console.error('Error in logout endpoint:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'An unexpected error occurred during logout.' 
    });
  }
});

// PUT /api/auth/profile - Update user profile metadata
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { user_metadata } = req.body;

    if (!user_metadata || typeof user_metadata !== 'object') {
      return res.status(400).json({ 
        error: 'Bad request', 
        message: 'user_metadata object is required.' 
      });
    }

    // Update user metadata in Supabase
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata
    });

    if (error) {
      return res.status(500).json({ 
        error: 'Update failed', 
        message: error.message 
      });
    }

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: data.user.id,
        email: data.user.email,
        userMetadata: data.user.user_metadata,
        updatedAt: data.user.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'An unexpected error occurred while updating the profile.' 
    });
  }
});

// GET /api/auth/sessions - Get all active sessions for user (admin only)
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user sessions from Supabase
    const { data, error } = await supabaseAdmin.auth.admin.listUserSessions(userId);

    if (error) {
      return res.status(500).json({ 
        error: 'Failed to fetch sessions', 
        message: error.message 
      });
    }

    res.json({
      sessions: data.map(session => ({
        id: session.id,
        userId: session.user_id,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        factorId: session.factor_id,
        aal: session.aal
      }))
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'An unexpected error occurred while fetching sessions.' 
    });
  }
});

// DELETE /api/auth/account - Delete user account and all associated data
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete user from Supabase Auth
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
      return res.status(500).json({ 
        error: 'Account deletion failed', 
        message: error.message 
      });
    }

    res.json({ 
      message: 'Account successfully deleted' 
    });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'An unexpected error occurred while deleting the account.' 
    });
  }
});

// GET /api/auth/health - Health check for auth service
router.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Authentication Service',
    provider: 'Supabase',
    timestamp: new Date().toISOString()
  });
});

export default router; 