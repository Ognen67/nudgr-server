import prisma from './prisma.js';

/**
 * Ensures a user exists in the database from Supabase auth data
 * @param {Object} supabaseUser - User object from Supabase auth
 * @returns {Object} Database user record
 */
export const ensureUserExists = async (supabaseUser) => {
  if (!supabaseUser || !supabaseUser.id) {
    throw new Error('Invalid user data from Supabase');
  }

  try {
    // Try to find existing user
    let user = await prisma.user.findUnique({
      where: { id: supabaseUser.id }
    });

    // If user doesn't exist, create them
    if (!user) {
      user = await prisma.user.create({
        data: {
          id: supabaseUser.id,
          email: supabaseUser.email,
          name: supabaseUser.user_metadata?.name || 
                supabaseUser.user_metadata?.full_name || 
                supabaseUser.email?.split('@')[0],
        }
      });
      console.log(`✅ Created new user: ${user.email}`);
    } else {
      // Update user info if needed
      const updates = {};
      if (supabaseUser.email && user.email !== supabaseUser.email) {
        updates.email = supabaseUser.email;
      }
      if (supabaseUser.user_metadata?.name && user.name !== supabaseUser.user_metadata.name) {
        updates.name = supabaseUser.user_metadata.name;
      }

      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({
          where: { id: supabaseUser.id },
          data: updates
        });
        console.log(`✅ Updated user: ${user.email}`);
      }
    }

    return user;
  } catch (error) {
    console.error('Error ensuring user exists:', error);
    throw error;
  }
};

/**
 * Get user from database by Supabase ID
 * @param {string} supabaseUserId 
 * @returns {Object|null} Database user record
 */
export const getUserById = async (supabaseUserId) => {
  if (!supabaseUserId) {
    return null;
  }

  try {
    return await prisma.user.findUnique({
      where: { id: supabaseUserId },
      include: {
        profile: true,
        subscription: true
      }
    });
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
}; 