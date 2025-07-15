import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-client';
import { supabaseAdmin, hasValidSupabaseConfig } from '../lib/supabase.js';
import { ensureUserExists } from '../lib/userSync.js';
import dotenv from 'dotenv';
// Load environment variables FIRST before any other imports
dotenv.config();
// Check if we have valid JWKS configuration
const hasValidJWKSConfig = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const jwksUrl = process.env.SUPABASE_JWKS_URL;
  
  console.log('🔍 JWKS Config Validation:');
  console.log('  SUPABASE_URL:', supabaseUrl ? 'SET' : 'MISSING');
  console.log('  SUPABASE_JWKS_URL:', jwksUrl ? 'SET' : 'MISSING');
  
  // We can build the JWKS URL from SUPABASE_URL if JWKS_URL is not provided
  if (!supabaseUrl) {
    console.log('❌ SUPABASE_URL is missing - required for JWKS');
    return false;
  }
  
  if (!supabaseUrl.includes('.supabase.co')) {
    console.log('❌ SUPABASE_URL does not contain .supabase.co');
    return false;
  }
  
  // Validate JWKS URL format if provided
  if (jwksUrl) {
    if (!jwksUrl.includes('.well-known/jwks.json')) {
      console.log('⚠️ SUPABASE_JWKS_URL should use .well-known/jwks.json format per Supabase docs');
    }
  }
  
  console.log('✅ JWKS config validation passed');
  return true;
};

// Custom JWKS fetcher for Supabase (handles API key requirement)
let jwksCache = null;
let jwksCacheExpiry = 0;

const fetchSupabaseJWKS = async () => {
  const now = Date.now();
  
  // Return cached JWKS if still valid (cache for 10 minutes as per Supabase docs)
  if (jwksCache && jwksCacheExpiry > now) {
    console.log('🔄 Using cached JWKS');
    return jwksCache;
  }
  
  const jwksUrl = process.env.SUPABASE_JWKS_URL || 
    `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  
  console.log('🔍 Fetching JWKS from:', jwksUrl);
  
  try {
    const response = await fetch(jwksUrl, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('🔍 JWKS response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`JWKS fetch failed: ${response.status} ${response.statusText}`);
    }
    
    const jwks = await response.json();
    console.log('✅ JWKS fetched successfully, keys:', jwks.keys?.length || 0);
    
    // Cache for 10 minutes
    jwksCache = jwks;
    jwksCacheExpiry = now + (10 * 60 * 1000);
    
    return jwks;
  } catch (error) {
    console.error('❌ Failed to fetch JWKS:', error);
    throw error;
  }
};

// Function to get the signing key from our custom JWKS fetcher
const getSigningKey = async (header) => {
  const jwks = await fetchSupabaseJWKS();
  
  if (!jwks.keys || !Array.isArray(jwks.keys)) {
    throw new Error('Invalid JWKS format');
  }
  
  const key = jwks.keys.find(k => k.kid === header.kid);
  if (!key) {
    throw new Error(`Unable to find a signing key that matches '${header.kid}'`);
  }
  
  // Convert JWK to PEM format for verification
  const jwkToPem = await import('jwk-to-pem');
  const pem = jwkToPem.default(key);
  
  return pem;
};

console.log('🚀 Initializing Custom JWKS Fetcher...');
if (hasValidJWKSConfig()) {
  console.log('✅ Custom JWKS fetcher initialized successfully');
} else {
  console.log('❌ JWKS initialization skipped - invalid config');
}

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

    // Helper function to verify JWT with given options using our custom JWKS fetcher
    const verifyJWT = async (options) => {
      return new Promise(async (resolve, reject) => {
        try {
          // Decode the header to get the kid
          const decoded = jwt.decode(token, { complete: true });
          if (!decoded || !decoded.header) {
            throw new Error('Invalid JWT format');
          }
          
          // Get the signing key using our custom fetcher
          const signingKey = await getSigningKey(decoded.header);
          
          // Verify the JWT with the signing key
          jwt.verify(token, signingKey, options, (err, payload) => {
            if (err) {
              reject(err);
            } else {
              resolve(payload);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    };

    // Verify the JWT token using JWKS - Based on official Supabase documentation
    let decoded;
    
    console.log('🔍 Attempting JWT validation per Supabase docs...');
    
    try {
      // Supabase JWT verification based on official documentation
      // Note: Supabase JWTs typically don't have an 'aud' claim according to their docs
      decoded = await verifyJWT({
        // Issuer format from Supabase docs: https://project-id.supabase.co/auth/v1
        issuer: `${process.env.SUPABASE_URL}/auth/v1`,
        algorithms: ['RS256'],
        ignoreExpiration: false,
        clockTolerance: 60, // Allow 60 seconds clock skew
        // No audience validation - not shown in Supabase documentation examples
      });
      
      console.log('✅ JWT verification successful');
      console.log('✅ Decoded token info:', { 
        sub: decoded.sub, 
        email: decoded.email, 
        role: decoded.role,
        iss: decoded.iss,
        aud: decoded.aud || 'Not present',
        exp: new Date(decoded.exp * 1000).toISOString()
      });
      
      // Validate that this is a proper Supabase user token
      if (!decoded.sub) {
        throw new Error('JWT missing subject (user ID)');
      }
      
      if (!decoded.role) {
        throw new Error('JWT missing role claim');
      }
      
      // Ensure the role is appropriate for API access
      if (decoded.role !== 'authenticated' && decoded.role !== 'anon') {
        console.warn('⚠️ Unusual role in JWT:', decoded.role);
      }
      
    } catch (jwtError) {
      console.error('❌ JWT verification failed:', jwtError.message);
      console.error('❌ JWT verification details:', {
        name: jwtError.name,
        message: jwtError.message,
        expectedIssuer: `${process.env.SUPABASE_URL}/auth/v1`,
        algorithm: 'RS256'
      });
      
      // Don't try fallback validation - if Supabase JWT fails, it should fail
      throw jwtError;
    }

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