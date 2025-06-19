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
    const { userId: clerkId } = req.auth;
    
    if (!clerkId) {
      return res.status(401).json({ error: 'No user ID found in token' });
    }

    // Find or create user in database
    let user = await prisma.user.findUnique({
      where: { clerkId }
    });

    if (!user) {
      // Get user details from Clerk
      // const clerkUser = await clerkClient.users.getUser(clerkId);
      
      user = await prisma.user.create({
        data: {
          clerkId,
          email: clerkUser.emailAddresses[0]?.emailAddress || '',
          name: `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim(),
          imageUrl: clerkUser.imageUrl
        }
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Error getting user from auth:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 