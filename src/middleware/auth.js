// (CLERK AUTH DISABLED FOR TESTING)
// import { ClerkExpressRequireAuth } from '@clerk/backend';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const authMiddleware = (req, res, next) => {
  // Mock auth middleware that allows all requests
  req.auth = {
    userId: 'test-user-id' // Mock user ID for testing
  };
  next();
};
export const getUserFromAuth = async (req, res, next) => {
  try {
    // For testing: Get first user from database
    const user = await prisma.user.findFirst();
    
    if (!user) {
      return res.status(500).json({ error: 'No users found in database' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Error getting user from auth:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};