import express from 'express';
import prisma from '../lib/prisma.js';

const router = express.Router();

// Note: Authentication middleware is applied at the server level
// req.user is available from the authMiddleware

// GET /api/goals - Get all goals for the authenticated user
router.get('/', async (req, res) => {
  try {
    const goals = await prisma.goal.findMany({
      where: { userId: req.user.id },
      include: {
        tasks: {
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            tasks: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(goals);
  } catch (error) {
    console.error('Error fetching goals:', error);
    res.status(500).json({ error: 'Failed to fetch goals' });
  }
});

// GET /api/goals/:id - Get a specific goal
router.get('/:id', async (req, res) => {
  try {
    const goal = await prisma.goal.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        tasks: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    res.json(goal);
  } catch (error) {
    console.error('Error fetching goal:', error);
    res.status(500).json({ error: 'Failed to fetch goal' });
  }
});

// POST /api/goals - Create a new goal
router.post('/', async (req, res) => {
  try {
    const { title, description, deadline, priority, category } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const goal = await prisma.goal.create({
      data: {
        title,
        description,
        deadline: deadline ? new Date(deadline) : null,
        priority: priority || 'MEDIUM',
        category,
        userId: req.user.id
      },
      include: {
        tasks: true,
        _count: {
          select: {
            tasks: true
          }
        }
      }
    });

    res.status(201).json(goal);
  } catch (error) {
    console.error('Error creating goal:', error);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// PUT /api/goals/:id - Update a goal
router.put('/:id', async (req, res) => {
  try {
    const { title, description, deadline, priority, status, category } = req.body;

    const existingGoal = await prisma.goal.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!existingGoal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const goal = await prisma.goal.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
        ...(priority && { priority }),
        ...(status && { status }),
        ...(category !== undefined && { category })
      },
      include: {
        tasks: {
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            tasks: true
          }
        }
      }
    });

    res.json(goal);
  } catch (error) {
    console.error('Error updating goal:', error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// DELETE /api/goals/:id - Delete a goal
router.delete('/:id', async (req, res) => {
  try {
    const existingGoal = await prisma.goal.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!existingGoal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    await prisma.goal.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Goal deleted successfully' });
  } catch (error) {
    console.error('Error deleting goal:', error);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

export default router; 