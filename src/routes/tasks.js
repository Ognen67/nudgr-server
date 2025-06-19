import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getUserFromAuth } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

// Apply user middleware to all routes (TEMPORARILY DISABLED FOR TESTING)
// router.use(getUserFromAuth);

// GET /api/tasks - Get all tasks for the authenticated user
router.get('/', async (req, res) => {
  try {
    const { goalId, completed, priority, limit = 50, offset = 0 } = req.query;
    
    const where = {
      userId: '1', // Using actual user ID from database
      ...(goalId && { goalId }),
      ...(completed !== undefined && { completed: completed === 'true' }),
      ...(priority && { priority })
    };

    const tasks = await prisma.task.findMany({
      where,
      include: {
        goal: {
          select: {
            id: true,
            title: true,
            category: true
          }
        }
      },
      orderBy: [
        { completed: 'asc' },
        { priority: 'desc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' }
      ],
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// GET /api/tasks/:id - Get a specific task
router.get('/:id', async (req, res) => {
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        userId: '1' // Using actual user ID from database
      },
      include: {
        goal: {
          select: {
            id: true,
            title: true,
            category: true
          }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// POST /api/tasks - Create a new task
router.post('/', async (req, res) => {
  try {
    const { 
      title, 
      description, 
      goalId, 
      priority, 
      dueDate, 
      estimatedTime,
      aiGenerated = false 
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Verify goal belongs to user if goalId is provided
    if (goalId) {
      const goal = await prisma.goal.findFirst({
        where: {
          id: goalId,
          userId: '1' // Using actual user ID from database
        }
      });

      if (!goal) {
        return res.status(404).json({ error: 'Goal not found' });
      }
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        goalId,
        priority: priority || 'MEDIUM',
        dueDate: dueDate ? new Date(dueDate) : null,
        estimatedTime,
        aiGenerated,
        userId: '1' // Using actual user ID from database
      },
      include: {
        goal: {
          select: {
            id: true,
            title: true,
            category: true
          }
        }
      }
    });

    res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id - Update a task
router.put('/:id', async (req, res) => {
  try {
    const { 
      title, 
      description, 
      goalId, 
      priority, 
      dueDate, 
      estimatedTime,
      actualTime,
      completed 
    } = req.body;

    const existingTask = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        userId: '1' // Using actual user ID from database
      }
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Verify goal belongs to user if goalId is provided
    if (goalId && goalId !== existingTask.goalId) {
      const goal = await prisma.goal.findFirst({
        where: {
          id: goalId,
          userId: '1' // Using actual user ID from database
        }
      });

      if (!goal) {
        return res.status(404).json({ error: 'Goal not found' });
      }
    }

    const updateData = {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(goalId !== undefined && { goalId }),
      ...(priority && { priority }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(estimatedTime !== undefined && { estimatedTime }),
      ...(actualTime !== undefined && { actualTime })
    };

    // Handle completion status
    if (completed !== undefined) {
      updateData.completed = completed;
      if (completed && !existingTask.completed) {
        updateData.completedAt = new Date();
      } else if (!completed && existingTask.completed) {
        updateData.completedAt = null;
      }
    }

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        goal: {
          select: {
            id: true,
            title: true,
            category: true
          }
        }
      }
    });

    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// PATCH /api/tasks/:id/complete - Toggle task completion
router.patch('/:id/complete', async (req, res) => {
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        userId: '1' // Using actual user ID from database
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updatedTask = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        completed: !task.completed,
        completedAt: !task.completed ? new Date() : null
      },
      include: {
        goal: {
          select: {
            id: true,
            title: true,
            category: true
          }
        }
      }
    });

    res.json(updatedTask);
  } catch (error) {
    console.error('Error toggling task completion:', error);
    res.status(500).json({ error: 'Failed to update task completion' });
  }
});

// DELETE /api/tasks/:id - Delete a task
router.delete('/:id', async (req, res) => {
  try {
    const existingTask = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        userId: '1' // Using actual user ID from database
      }
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await prisma.task.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// GET /api/tasks/stats - Get task statistics
router.get('/stats', async (req, res) => {
  try {
    const userId = '1'; // Using actual user ID from database
    
    const [totalTasks, completedTasks, overdueTasks] = await Promise.all([
      prisma.task.count({ where: { userId } }),
      prisma.task.count({ where: { userId, completed: true } }),
      prisma.task.count({ 
        where: { 
          userId, 
          completed: false,
          dueDate: {
            lt: new Date()
          }
        } 
      })
    ]);

    const stats = {
      total: totalTasks,
      completed: completedTasks,
      pending: totalTasks - completedTasks,
      overdue: overdueTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching task stats:', error);
    res.status(500).json({ error: 'Failed to fetch task statistics' });
  }
});

// PATCH /api/tasks/:id - Partial update of a task
router.patch('/:id', async (req, res) => {
  try {
    const { completed, priority, title, description } = req.body;

    const existingTask = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        userId: '1' // Using actual user ID from database
      }
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updateData = {};
    
    if (completed !== undefined) {
      updateData.completed = completed;
      if (completed && !existingTask.completed) {
        updateData.completedAt = new Date();
      } else if (!completed && existingTask.completed) {
        updateData.completedAt = null;
      }
    }
    
    if (priority !== undefined) updateData.priority = priority;
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        goal: {
          select: {
            id: true,
            title: true,
            category: true
          }
        }
      }
    });

    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

export default router; 