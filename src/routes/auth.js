import express from 'express';
import { PrismaClient } from '@prisma/client';
// (CLERK AUTH DISABLED FOR TESTING)
// import { requireAuth } from '@clerk/express';
// import { clerkClient } from '@clerk/backend';

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/auth/me - Get current user profile
// router.get('/me', requireAuth(), async (req, res) => { ... });

// PUT /api/auth/profile - Update user profile
// router.put('/profile', requireAuth(), async (req, res) => { ... });

// DELETE /api/auth/account - Delete user account and all associated data
// router.delete('/account', requireAuth(), async (req, res) => { ... });

// GET /api/auth/dashboard-stats - Get dashboard statistics for the user
// router.get('/dashboard-stats', requireAuth(), async (req, res) => { ... });

export default router; 