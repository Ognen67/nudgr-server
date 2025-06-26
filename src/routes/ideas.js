import express from 'express';
import prisma from '../lib/prisma.js';
import { getUserFromAuth } from '../middleware/auth.js';

const router = express.Router();

// Apply user middleware to all routes
router.use(getUserFromAuth);

// GET /api/ideas - Get all ideas for the authenticated user
router.get('/', async (req, res) => {
  try {
    const { expanded, limit = 50, offset = 0 } = req.query;
    
    const where = {
      userId: req.user.id,
      ...(expanded !== undefined && { expanded: expanded === 'true' }),
    };

    const ideas = await prisma.idea.findMany({
      where,
      orderBy: [
        { createdAt: 'desc' }
      ],
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    res.json(ideas);
  } catch (error) {
    console.error('Error fetching ideas:', error);
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// GET /api/ideas/:id - Get a specific idea
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const idea = await prisma.idea.findFirst({
      where: {
        id,
        userId: req.user.id, // Ensure user can only access their own ideas
      }
    });

    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    res.json(idea);
  } catch (error) {
    console.error('Error fetching idea:', error);
    res.status(500).json({ error: 'Failed to fetch idea' });
  }
});

// POST /api/ideas - Create a new idea
router.post('/', async (req, res) => {
  try {
    const { title, description, content, tags, position, color } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    // Generate random position if not provided (for mind map)
    const defaultPosition = position || {
      x: Math.random() * 300 + 50, // Random position between 50-350
      y: Math.random() * 400 + 100  // Random position between 100-500
    };

    // Generate random pastel color if not provided
    const colors = ['#FFE5E5', '#E5F2FF', '#E5FFE5', '#FFF5E5', '#F0E5FF', '#E5FFF5'];
    const defaultColor = color || colors[Math.floor(Math.random() * colors.length)];

    const idea = await prisma.idea.create({
      data: {
        title: title.trim(),
        description: description?.trim(),
        content: content.trim(),
        tags: tags || [],
        position: defaultPosition,
        color: defaultColor,
        userId: req.user.id,
      }
    });

    res.status(201).json(idea);
  } catch (error) {
    console.error('Error creating idea:', error);
    res.status(500).json({ error: 'Failed to create idea' });
  }
});

// PUT /api/ideas/:id - Update an idea
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, content, tags, position, color, expanded } = req.body;

    // Verify idea exists and belongs to user
    const existingIdea = await prisma.idea.findFirst({
      where: {
        id,
        userId: req.user.id,
      }
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    const updatedIdea = await prisma.idea.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() }),
        ...(content !== undefined && { content: content.trim() }),
        ...(tags !== undefined && { tags }),
        ...(position !== undefined && { position }),
        ...(color !== undefined && { color }),
        ...(expanded !== undefined && { expanded }),
      }
    });

    res.json(updatedIdea);
  } catch (error) {
    console.error('Error updating idea:', error);
    res.status(500).json({ error: 'Failed to update idea' });
  }
});

// DELETE /api/ideas/:id - Delete an idea (forget)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify idea exists and belongs to user
    const existingIdea = await prisma.idea.findFirst({
      where: {
        id,
        userId: req.user.id,
      }
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    await prisma.idea.delete({
      where: { id }
    });

    res.json({ message: 'Idea deleted successfully' });
  } catch (error) {
    console.error('Error deleting idea:', error);
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

// POST /api/ideas/:id/expand - Expand an idea into a goal with tasks
router.post('/:id/expand', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify idea exists and belongs to user
    const idea = await prisma.idea.findFirst({
      where: {
        id,
        userId: req.user.id,
      }
    });

    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (idea.expanded) {
      return res.status(400).json({ error: 'Idea has already been expanded' });
    }

    // Create a goal from the idea
    const goal = await prisma.goal.create({
      data: {
        title: idea.title,
        description: idea.description || idea.content,
        category: 'idea-expansion',
        userId: req.user.id,
      }
    });

    // Mark idea as expanded
    const updatedIdea = await prisma.idea.update({
      where: { id },
      data: { expanded: true }
    });

    res.json({
      message: 'Idea expanded successfully',
      idea: updatedIdea,
      goal: goal
    });
  } catch (error) {
    console.error('Error expanding idea:', error);
    res.status(500).json({ error: 'Failed to expand idea' });
  }
});

// PATCH /api/ideas/:id/position - Update idea position (for mind map drag & drop)
router.patch('/:id/position', async (req, res) => {
  try {
    const { id } = req.params;
    const { x, y } = req.body;

    if (typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'Valid x and y coordinates are required' });
    }

    // Verify idea exists and belongs to user
    const existingIdea = await prisma.idea.findFirst({
      where: {
        id,
        userId: req.user.id,
      }
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    const updatedIdea = await prisma.idea.update({
      where: { id },
      data: {
        position: { x, y }
      }
    });

    res.json(updatedIdea);
  } catch (error) {
    console.error('Error updating idea position:', error);
    res.status(500).json({ error: 'Failed to update idea position' });
  }
});

export default router; 