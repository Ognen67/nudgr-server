import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-client';
import { supabaseAdmin, hasValidSupabaseConfig } from '../lib/supabase.js';
import { ensureUserExists } from '../lib/userSync.js';
import dotenv from 'dotenv';
// Load environment variables FIRST before any other imports
dotenv.config();
// Check if we have valid JWKS configuration
const hasValidJWKSConfig = () => {
  const jwksUrl = process.env.SUPABASE_JWKS_URL;
  
  console.log('🔍 JWKS Config Validation:');
  console.log('  SUPABASE_JWKS_URL:', jwksUrl ? 'SET' : 'MISSING');
  
  if (!jwksUrl) {
    console.log('❌ SUPABASE_JWKS_URL is missing');
    return false;
  }
  if (jwksUrl === 'https://placeholder.supabase.co/rest/v1/auth/jwks') {
    console.log('❌ SUPABASE_JWKS_URL is still placeholder');
    return false;
  }
  if (!jwksUrl.includes('.supabase.co')) {
    console.log('❌ SUPABASE_JWKS_URL does not contain .supabase.co');
    return false;
  }
  
  console.log('✅ JWKS config validation passed');
  return true;
};

// JWKS client for verifying JWT tokens (only if configuration is valid)
let jwks = null;

console.log('🚀 Initializing JWKS...');
if (hasValidJWKSConfig()) {
  try {
    console.log('🔧 Creating JWKS client...');
    jwks = jwksClient({
      jwksUri: process.env.SUPABASE_JWKS_URL,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksRequestTimeoutMs: 5000,
    });
    console.log('✅ JWKS client initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing JWKS client:', error);
    jwks = null;
  }
} else {
  console.log('❌ JWKS initialization skipped - invalid config');
}

// Function to get the signing key from JWKS
const getSigningKey = (header, callback) => {
  if (!jwks) {
    callback(new Error('JWKS client not configured'));
    return;
  }
  
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
    } else {
      const signingKey = key.publicKey || key.rsaPublicKey;
      callback(null, signingKey);
    }
  });
};

// Main authentication middleware
export const authMiddleware = async (req, res, next) => {
  console.log('🔍 Auth Middleware - Starting validation...');
  
  // Check if Supabase is properly configured
  console.log('  supabaseAdmin exists:', !!supabaseAdmin);
  console.log('  hasValidJWKSConfig():', hasValidJWKSConfig());
  console.log('  hasValidSupabaseConfig():', hasValidSupabaseConfig());
  
  if (!supabaseAdmin || !hasValidJWKSConfig()) {
    console.error('❌ Authentication middleware - Configuration check failed:');
    console.error('  - supabaseAdmin:', !!supabaseAdmin);
    console.error('  - hasValidJWKSConfig:', hasValidJWKSConfig());
    console.error('  - hasValidSupabaseConfig:', hasValidSupabaseConfig());
    
    return res.status(503).json({
      error: 'Authentication service unavailable',
      message: 'Supabase authentication is not properly configured. Please check environment variables.',
      details: {
        supabaseAdmin: !!supabaseAdmin,
        jwksConfig: hasValidJWKSConfig(),
        supabaseConfig: hasValidSupabaseConfig()
      }
    });
  }

  console.log('✅ Auth Middleware - Configuration validation passed');

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Auth Middleware - No Bearer token provided');
      return res.status(401).json({ 
        error: 'Access denied', 
        message: 'No token provided. Please include Authorization: Bearer <token> header.' 
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    console.log('✅ Auth Middleware - Token extracted, proceeding with verification...');

    // Verify the JWT token using JWKS
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, getSigningKey, {
        audience: process.env.SUPABASE_URL?.replace('https://', ''), // Remove https:// for audience
        issuer: process.env.SUPABASE_URL + '/auth/v1',
        algorithms: ['RS256']
      }, (err, decoded) => {
        if (err) {
          console.error('❌ JWT verification failed:', err.message);
          reject(err);
        } else {
          console.log('✅ JWT verification successful');
          resolve(decoded);
        }
      });
    });

    // Extract user information from the decoded token
    const userId = decoded.sub;
    const userEmail = decoded.email;
    const userRole = decoded.role;

    console.log('🔍 User info from token:', { userId, userEmail, userRole });

    // Get full user data from Supabase
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError) {
      console.error('❌ Error fetching user from Supabase:', userError);
      return res.status(401).json({ 
        error: 'Authentication failed', 
        message: 'Unable to verify user data.' 
      });
    }

    console.log('✅ User data fetched from Supabase successfully');

    // Ensure user exists in our database and sync data
    try {
      const dbUser = await ensureUserExists(userData.user);
      console.log('✅ User synced to database successfully');
      
      // Attach comprehensive user info to request object
      req.user = {
        id: userId,
        email: userEmail,
        role: userRole,
        name: dbUser.name,
        dbUser: dbUser, // Full database user record
        // Include other claims from the token
        ...decoded
      };
    } catch (syncError) {
      console.error('⚠️ Error syncing user to database:', syncError);
      // Continue without DB sync - authentication still valid
      req.user = {
        id: userId,
        email: userEmail,
        role: userRole,
        ...decoded
      };
    }

    console.log('✅ Auth Middleware - Authentication complete, proceeding to route');
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired', 
        message: 'Your session has expired. Please log in again.' 
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token', 
        message: 'The provided token is invalid.' 
      });
    } else {
      return res.status(401).json({ 
        error: 'Authentication failed', 
        message: 'Unable to authenticate the request.' 
      });
    }
  }
};

// Optional middleware to get user from database (if you're using Prisma)
export const getUserFromDatabase = async (req, res, next) => {
  try {
    // This assumes you have a user table in your database
    // and want to get additional user data beyond what's in the JWT
    
    // Since this is optional, we'll just pass through if prisma is not available
    // or if you don't want to fetch from database
    
    next();
  } catch (error) {
    console.error('Error getting user from database:', error);
    // Don't fail the request if database lookup fails
    next();
  }
};

// Middleware to check if user has specific role
export const requireRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required', 
        message: 'You must be authenticated to access this resource.' 
      });
    }

    if (req.user.role !== requiredRole) {
      return res.status(403).json({ 
        error: 'Insufficient permissions', 
        message: `This resource requires ${requiredRole} role.` 
      });
    }

    next();
  };
};

// Optional middleware for admin-only routes
export const requireAdmin = requireRole('admin');

// Optional middleware for service role (for server-to-server communication)
export const requireServiceRole = requireRole('service_role');