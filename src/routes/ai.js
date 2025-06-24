import express from 'express';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { getUserFromAuth } from '../middleware/auth.js';


import 'dotenv/config'

const router = express.Router();
const prisma = new PrismaClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// (CLERK AUTH DISABLED FOR TESTING)
// import { requireAuth } from '@clerk/express';
// router.use(requireAuth);
// ...re-enable Clerk middleware above when ready...

// Apply user middleware to all routes
router.use(getUserFromAuth);

// POST /api/ai/suggest-tasks - Generate AI task suggestions for a goal
router.post('/suggest-tasks', async (req, res) => {
  console.log('POST /api/ai/suggest-tasks - Request received:', req.body);
  try {
    const { goalId, additionalContext } = req.body;

    if (!goalId) {
      console.log('Missing goalId in request');
      return res.status(400).json({ error: 'Goal ID is required' });
    }

    // Get the goal details
    console.log('Fetching goal details for goalId:', goalId);
    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId: req.user.id
      },
      include: {
        tasks: {
          where: { completed: false }
        }
      }
    });

    if (!goal) {
      console.log('Goal not found for id:', goalId);
      return res.status(404).json({ error: 'Goal not found' });
    }

    console.log('Goal found:', { id: goal.id, title: goal.title });

    // Prepare context for AI
    const existingTasks = goal.tasks.map(task => `- ${task.title}`).join('\n');
    const deadlineText = goal.deadline ? 
      `The deadline is ${goal.deadline.toLocaleDateString()}.` : 
      'No specific deadline is set.';

    const prompt = `
You are a productivity assistant. Generate 5-8 actionable tasks to help achieve the following goal:

Goal: ${goal.title}
Description: ${goal.description || 'No description provided'}
Priority: ${goal.priority}
Category: ${goal.category || 'General'}
${deadlineText}

Existing tasks (don't duplicate these):
${existingTasks || 'No existing tasks'}

Additional context: ${additionalContext || 'None'}

Please provide tasks that are:
1. Specific and actionable
2. Properly sequenced (if order matters)
3. Realistic and achievable
4. Break down the goal into manageable steps

Return only a JSON array of task objects with the following structure:
[
  {
    "title": "Task title",
    "description": "Detailed description of what needs to be done",
    "priority": "HIGH|MEDIUM|LOW",
    "estimatedTime": 60,
    "dueDate": "2024-01-15" (optional, based on goal deadline and task sequence)
  }
]

Make sure the JSON is valid and properly formatted.`;

    console.log('Sending request to OpenAI');
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are a helpful productivity assistant. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    console.log('Received response from OpenAI');

    let suggestedTasks;
    try {
      let aiResponse = completion.choices[0].message.content;
      // Clean the response - remove markdown code blocks if present
      let cleanResponse = aiResponse.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      suggestedTasks = JSON.parse(cleanResponse);
      console.log('Successfully parsed AI response:', suggestedTasks);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return res.status(500).json({ error: 'Failed to parse AI suggestions' });
    }

    // Validate the response format
    if (!Array.isArray(suggestedTasks)) {
      console.error('Invalid AI response format:', suggestedTasks);
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    // Optional: Save AI-generated tasks directly to database
    const saveToDatabase = req.body.saveToDatabase || false;
    let createdTasks = [];

    if (saveToDatabase) {
      console.log('Saving tasks to database');
      for (const taskData of suggestedTasks) {
        try {
          const task = await prisma.task.create({
            data: {
              title: taskData.title,
              description: taskData.description,
              priority: taskData.priority || 'MEDIUM',
              estimatedTime: taskData.estimatedTime,
              dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
              aiGenerated: true,
              userId: req.user.id,
              goalId: goalId
            }
          });
          console.log('Created task:', task.id);
          createdTasks.push(task);
        } catch (dbError) {
          console.error('Error saving AI task:', dbError);
          // Continue with other tasks even if one fails
        }
      }
    }

    console.log('Sending successful response');
    res.json({
      suggestions: suggestedTasks,
      ...(saveToDatabase && { createdTasks }),
      goalTitle: goal.title
    });

  } catch (error) {
    console.error('Error generating AI suggestions:', error);
    
    if (error.code === 'insufficient_quota') {
      return res.status(429).json({ 
        error: 'AI service quota exceeded. Please try again later.' 
      });
    }
    
    res.status(500).json({ error: 'Failed to generate task suggestions' });
  }
});

// POST /api/ai/optimize-schedule - AI-powered task scheduling optimization
router.post('/optimize-schedule', async (req, res) => {
  console.log('POST /api/ai/optimize-schedule - Request received:', req.body);
  try {
    const { timeAvailable, preferences } = req.body;

    // Get user's pending tasks
    console.log('Fetching pending tasks for user:', req.user.id);
    const pendingTasks = await prisma.task.findMany({
      where: {
        userId: req.user.id,
        completed: false
      },
      include: {
        goal: {
          select: {
            title: true,
            priority: true,
            deadline: true
          }
        }
      },
      orderBy: [
        { priority: 'desc' },
        { dueDate: 'asc' }
      ]
    });

    if (pendingTasks.length === 0) {
      console.log('No pending tasks found');
      return res.json({ 
        message: 'No pending tasks to optimize',
        schedule: []
      });
    }

    console.log(`Found ${pendingTasks.length} pending tasks`);

    const tasksContext = pendingTasks.map(task => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      estimatedTime: task.estimatedTime || 30,
      dueDate: task.dueDate,
      goalTitle: task.goal?.title,
      goalPriority: task.goal?.priority
    }));

    const prompt = `
You are a productivity scheduler. Given the following tasks and constraints, create an optimized schedule:

Available time: ${timeAvailable} minutes
User preferences: ${JSON.stringify(preferences || {})}

Tasks to schedule:
${JSON.stringify(tasksContext, null, 2)}

Create a schedule that:
1. Prioritizes high-priority and overdue tasks
2. Considers estimated time for each task
3. Fits within the available time
4. Groups related tasks when possible
5. Leaves buffer time between tasks

Return a JSON object with:
{
  "scheduledTasks": [
    {
      "taskId": "task_id",
      "title": "Task title",
      "startTime": "relative_start_time_in_minutes",
      "duration": "duration_in_minutes",
      "reason": "why this task was prioritized"
    }
  ],
  "unscheduledTasks": ["task_id1", "task_id2"],
  "totalScheduledTime": 120,
  "recommendations": ["suggestion1", "suggestion2"]
}`;

    console.log('Sending request to OpenAI');
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are a helpful productivity scheduler. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 1500
    });

    let schedule;
    try {
      schedule = JSON.parse(completion.choices[0].message.content);
      console.log('Successfully parsed AI schedule');
    } catch (parseError) {
      console.error('Error parsing AI schedule:', parseError);
      return res.status(500).json({ error: 'Failed to parse AI schedule' });
    }

    console.log('Sending successful response');
    res.json(schedule);

  } catch (error) {
    console.error('Error optimizing schedule:', error);
    res.status(500).json({ error: 'Failed to optimize schedule' });
  }
});

// POST /api/ai/analyze-productivity - Analyze user's productivity patterns
router.post('/analyze-productivity', async (req, res) => {
  console.log('POST /api/ai/analyze-productivity - Request received:', req.body);
  try {
    const userId = req.user.id;
    const { period = 'week' } = req.body; // week, month, quarter

    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    console.log('Fetching productivity data from:', startDate);

    // Get productivity data
    const [completedTasks, totalTasks, goals] = await Promise.all([
      prisma.task.findMany({
        where: {
          userId,
          completed: true,
          completedAt: {
            gte: startDate
          }
        },
        include: {
          goal: {
            select: {
              title: true,
              category: true
            }
          }
        }
      }),
      prisma.task.count({
        where: {
          userId,
          createdAt: {
            gte: startDate
          }
        }
      }),
      prisma.goal.findMany({
        where: {
          userId,
          createdAt: {
            gte: startDate
          }
        },
        include: {
          _count: {
            select: {
              tasks: true
            }
          }
        }
      })
    ]);

    console.log(`Found ${completedTasks.length} completed tasks, ${totalTasks} total tasks, ${goals.length} goals`);

    const productivity = {
      period,
      completionRate: totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0,
      totalTasksCompleted: completedTasks.length,
      totalTasksCreated: totalTasks,
      goalsCreated: goals.length,
      averageTasksPerGoal: goals.length > 0 ? Math.round(totalTasks / goals.length) : 0,
      categoryBreakdown: {},
      timeTracking: {
        totalEstimatedTime: 0,
        totalActualTime: 0
      }
    };

    // Analyze by category
    completedTasks.forEach(task => {
      const category = task.goal?.category || 'Uncategorized';
      productivity.categoryBreakdown[category] = (productivity.categoryBreakdown[category] || 0) + 1;
      
      if (task.estimatedTime) {
        productivity.timeTracking.totalEstimatedTime += task.estimatedTime;
      }
      if (task.actualTime) {
        productivity.timeTracking.totalActualTime += task.actualTime;
      }
    });

    console.log('Productivity analysis:', productivity);

    // Get AI insights
    const prompt = `
Analyze this productivity data and provide insights:

${JSON.stringify(productivity, null, 2)}

Provide a JSON response with:
{
  "insights": [
    "insight 1",
    "insight 2",
    "insight 3"
  ],
  "recommendations": [
    "recommendation 1",
    "recommendation 2"
  ],
  "strengths": [
    "strength 1",
    "strength 2"
  ],
  "areasForImprovement": [
    "area 1",
    "area 2"
  ]
}`;

    console.log('Sending request to OpenAI');
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are a productivity analyst. Provide actionable insights based on user data."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    let analysis;
    try {
      analysis = JSON.parse(completion.choices[0].message.content);
      console.log('Successfully parsed AI analysis');
    } catch (parseError) {
      console.error('Error parsing AI analysis:', parseError);
      analysis = {
        insights: ['Unable to generate detailed insights at the moment'],
        recommendations: ['Continue tracking your tasks for better insights'],
        strengths: ['You are actively using the productivity system'],
        areasForImprovement: ['Keep logging task completion data']
      };
    }

    console.log('Sending successful response');
    res.json({
      ...productivity,
      aiAnalysis: analysis
    });

  } catch (error) {
    console.error('Error analyzing productivity:', error);
    res.status(500).json({ error: 'Failed to analyze productivity' });
  }
});

// POST /api/ai/transform-thought
router.post('/transform-thought', async (req, res) => {
  console.log('POST /api/ai/transform-thought - Request received:', req.body);
  try {
    const { thought } = req.body;
    if (!thought || typeof thought !== 'string') {
      console.log('Invalid thought provided');
      return res.status(400).json({ error: 'Thought is required.' });
    }

    const prompt = `
Transform this thought into 3-5 actionable tasks: "${thought}"

Please analyze this thought and break it down into specific, actionable tasks. Return ONLY a JSON array of task objects with this exact structure:

[
  {
    "title": "Task title (max 100 characters)",
    "description": "Detailed description of what needs to be done",
    "priority": "HIGH|MEDIUM|LOW",
    "estimatedTime": 60,
    "category": "work|personal|health|learning|other"
  }
]

Make sure:
1. Each task is specific and actionable
2. Tasks are realistic and achievable  
3. The JSON is valid and properly formatted
4. No extra text outside the JSON array`;

    console.log('Sending request to OpenAI');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: 'You are a productivity assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const aiResponse = completion.choices?.[0]?.message?.content?.trim() || '';
    console.log('AI Response:', aiResponse);

    // Parse the AI response to extract tasks
    let suggestedTasks;
    try {
      // Clean the response - remove markdown code blocks if present
      let cleanResponse = aiResponse.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      suggestedTasks = JSON.parse(cleanResponse);
      if (!Array.isArray(suggestedTasks)) {
        throw new Error('Response is not an array');
      }
      console.log('Successfully parsed AI response:', suggestedTasks);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return res.status(500).json({ 
        error: 'Failed to parse AI suggestions',
        rawResponse: aiResponse 
      });
    }

    // Save tasks to database
    const createdTasks = [];
    const userId = req.user.id; // Using actual user ID from database

    for (const taskData of suggestedTasks) {
      try {
        const task = await prisma.task.create({
          data: {
            title: taskData.title.substring(0, 100), // Ensure max length
            description: taskData.description || '',
            priority: ['HIGH', 'MEDIUM', 'LOW'].includes(taskData.priority) ? taskData.priority : 'MEDIUM',
            estimatedTime: taskData.estimatedTime || 60,
            aiGenerated: true,
            userId: userId,
            goalId: null // No specific goal for general thoughts
          }
        });
        
        console.log('Created task:', task.id);
        createdTasks.push(task);
      } catch (dbError) {
        console.error('Error saving task:', dbError);
        // Continue with other tasks even if one fails
      }
    }

    console.log('Sending successful response');
    return res.json({ 
      missions: aiResponse,
      tasks: suggestedTasks,
      createdTasks: createdTasks,
      message: `Successfully created ${createdTasks.length} tasks from your thought!`
    });
  } catch (err) {
    console.error('OpenAI error:', err);
    return res.status(500).json({ error: 'Failed to process thought.' });
  }
});

// POST /api/ai/transform-thought-to-goal - Transform thought into goal with tasks
router.post('/transform-thought-to-goal', async (req, res) => {
  console.log('POST /api/ai/transform-thought-to-goal - Request received:', req.body);
  try {
    const { thought } = req.body;
    if (!thought || typeof thought !== 'string') {
      console.log('Invalid thought provided');
      return res.status(400).json({ error: 'Thought is required.' });
    }

    const prompt = `
Transform this thought into a goal with related tasks: "${thought}"

Please analyze this thought and create:
1. ONE main goal that encompasses the overall objective
2. 3-5 specific tasks that will help achieve this goal

Return ONLY a JSON object with this exact structure:

{
  "goal": {
    "title": "Goal title (max 100 characters)",
    "description": "Detailed description of the goal",
    "priority": "HIGH|MEDIUM|LOW",
    "category": "work|personal|health|learning|other"
  },
  "tasks": [
    {
      "title": "Task title (max 100 characters)",
      "description": "Detailed description of what needs to be done",
      "priority": "HIGH|MEDIUM|LOW",
      "estimatedTime": 60
    }
  ]
}

Make sure:
1. The goal is the overarching objective
2. Each task is specific and actionable toward achieving the goal
3. Tasks are realistic and achievable  
4. The JSON is valid and properly formatted
5. No extra text outside the JSON object`;

    console.log('Sending request to OpenAI');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: 'You are a productivity assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const aiResponse = completion.choices?.[0]?.message?.content?.trim() || '';
    console.log('AI Response:', aiResponse);

    // Parse the AI response to extract goal and tasks
    let aiData;
    try {
      // Clean the response - remove markdown code blocks if present
      let cleanResponse = aiResponse.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      aiData = JSON.parse(cleanResponse);
      if (!aiData.goal || !Array.isArray(aiData.tasks)) {
        throw new Error('Response missing goal or tasks array');
      }
      console.log('Successfully parsed AI response:', aiData);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return res.status(500).json({ 
        error: 'Failed to parse AI suggestions',
        rawResponse: aiResponse 
      });
    }

    const userId = req.user.id; // Using actual user ID from database

    // Create the goal first
    let createdGoal;
    try {
      createdGoal = await prisma.goal.create({
        data: {
          title: aiData.goal.title.substring(0, 100), // Ensure max length
          description: aiData.goal.description || '',
          priority: ['HIGH', 'MEDIUM', 'LOW'].includes(aiData.goal.priority) ? aiData.goal.priority : 'MEDIUM',
          category: aiData.goal.category || 'other',
          userId: userId
        }
      });
      console.log('Created goal:', createdGoal.id);
    } catch (dbError) {
      console.error('Error saving goal:', dbError);
      return res.status(500).json({ error: 'Failed to create goal' });
    }

    // Create tasks associated with the goal
    const createdTasks = [];
    for (const taskData of aiData.tasks) {
      try {
        const task = await prisma.task.create({
          data: {
            title: taskData.title.substring(0, 100), // Ensure max length
            description: taskData.description || '',
            priority: ['HIGH', 'MEDIUM', 'LOW'].includes(taskData.priority) ? taskData.priority : 'MEDIUM',
            estimatedTime: taskData.estimatedTime || 60,
            aiGenerated: true,
            userId: userId,
            goalId: createdGoal.id // Associate with the created goal
          }
        });
        
        console.log('Created task:', task.id);
        createdTasks.push(task);
      } catch (dbError) {
        console.error('Error saving task:', dbError);
        // Continue with other tasks even if one fails
      }
    }

    console.log('Sending successful response');
    return res.json({ 
      goal: aiData.goal,
      tasks: aiData.tasks,
      createdGoal: createdGoal,
      createdTasks: createdTasks,
      message: `Successfully created goal "${createdGoal.title}" with ${createdTasks.length} tasks!`
    });
  } catch (err) {
    console.error('OpenAI error:', err);
    return res.status(500).json({ error: 'Failed to process thought into goal.' });
  }
});

export default router; 