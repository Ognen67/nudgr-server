import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-client';
import { supabaseAdmin } from '../lib/supabase.js';

// Check if we have valid JWKS configuration
const hasValidJWKSConfig = () => {
  const jwksUrl = process.env.SUPABASE_JWKS_URL;
  return jwksUrl && 
         jwksUrl !== 'https://placeholder.supabase.co/rest/v1/auth/jwks' &&
         jwksUrl.includes('.supabase.co');
};

// JWKS client for verifying JWT tokens (only if configuration is valid)
let jwks = null;

if (hasValidJWKSConfig()) {
  jwks = jwksClient({
    jwksUri: process.env.SUPABASE_JWKS_URL,
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksRequestTimeoutMs: 5000,
  });
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
  // Check if Supabase is properly configured
  if (!supabaseAdmin || !hasValidJWKSConfig()) {
    console.warn('⚠️  Authentication middleware called but Supabase is not properly configured');
    return res.status(503).json({
      error: 'Authentication service unavailable',
      message: 'Supabase authentication is not properly configured. Please check environment variables.'
    });
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Access denied', 
        message: 'No token provided. Please include Authorization: Bearer <token> header.' 
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the JWT token using JWKS
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, getSigningKey, {
        audience: process.env.SUPABASE_URL?.replace('https://', ''), // Remove https:// for audience
        issuer: process.env.SUPABASE_URL + '/auth/v1',
        algorithms: ['RS256']
      }, (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded);
        }
      });
    });

    // Extract user information from the decoded token
    const userId = decoded.sub;
    const userEmail = decoded.email;
    const userRole = decoded.role;

    // Attach user info to request object
    req.user = {
      id: userId,
      email: userEmail,
      role: userRole,
      // Include other claims from the token
      ...decoded
    };

    // Optional: Get additional user data from Supabase if needed
    // You can uncomment this if you need more user data from the database
    /*
    try {
      const { data: userData, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (userData && userData.user) {
        req.user.metadata = userData.user.user_metadata;
        req.user.appMetadata = userData.user.app_metadata;
      }
    } catch (userError) {
      console.warn('Could not fetch additional user data:', userError);
    }
    */

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
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