import express from 'express';
import prisma from '../lib/prisma.js';

const router = express.Router();

// Note: Authentication middleware is applied at the server level
// req.user is available from the authMiddleware

// GET /api/tasks - Get all tasks for the authenticated user
router.get('/', async (req, res) => {
  try {
    // Debug: Count total tasks and completed tasks
    const totalTasks = await prisma.task.count({ where: { userId: req.user.id } });
    const completedTasks = await prisma.task.count({ where: { userId: req.user.id, completed: true } });
    
    console.log(`Debug /all: User ${req.user.id} has ${totalTasks} total tasks, ${completedTasks} completed`);

    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user.id
      },
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
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    console.log(`Debug /all: Returning ${tasks.length} tasks, completed count: ${tasks.filter(t => t.completed).length}`);
    
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching all tasks:', error);
    res.status(500).json({ error: 'Failed to fetch all tasks' });
  }
});

// GET /api/tasks/:id - Get a specific task
router.get('/:id', async (req, res) => {
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
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
      estimatedTime,
      aiGenerated = false,
      dueDate
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Verify goal belongs to user if goalId is provided
    if (goalId) {
      const goal = await prisma.goal.findFirst({
        where: {
          id: goalId,
          userId: req.user.id
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
        estimatedTime,
        aiGenerated,
        userId: req.user.id,
        dueDate
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
      estimatedTime,
      actualTime,
      completed,
      dueDate
    } = req.body;

    const existingTask = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id // Using actual user ID from database
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
          userId: req.user.id // Using actual user ID from database
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
      ...(estimatedTime !== undefined && { estimatedTime }),
      ...(actualTime !== undefined && { actualTime }),
      ...(dueDate && { dueDate })
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
        userId: req.user.id // Using actual user ID from database
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
        userId: req.user.id // Using actual user ID from database
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
    const userId = req.user.id; // Using actual user ID from database
    
    const [totalTasks, completedTasks] = await Promise.all([
      prisma.task.count({ where: { userId } }),
      prisma.task.count({ where: { userId, completed: true } })
    ]);

    const stats = {
      total: totalTasks,
      completed: completedTasks,
      pending: totalTasks - completedTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching task stats:', error);
    res.status(500).json({ error: 'Failed to fetch task statistics' });
  }
});

// GET /api/tasks/all - Get all tasks for the authenticated user (no pagination)
router.get('/all', async (req, res) => {
  try {
    // Debug: Count total tasks and completed tasks
    const totalTasks = await prisma.task.count({ where: { userId: req.user.id } });
    const completedTasks = await prisma.task.count({ where: { userId: req.user.id, completed: true } });
    
    console.log(`Debug /all: User ${req.user.id} has ${totalTasks} total tasks, ${completedTasks} completed`);

    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user.id
      },
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
        { createdAt: 'desc' }
      ]
    });

    console.log(`Debug /all: Returning ${tasks.length} tasks, completed count: ${tasks.filter(t => t.completed).length}`);
    
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching all tasks:', error);
    res.status(500).json({ error: 'Failed to fetch all tasks' });
  }
});

// PATCH /api/tasks/:id - Partial update of a task
router.patch('/:id', async (req, res) => {
  try {
    const { completed, priority, title, description } = req.body;

    const existingTask = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id // Using actual user ID from database
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