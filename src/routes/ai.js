import express from 'express';
import prisma from '../lib/prisma.js';
import OpenAI from 'openai';
import 'dotenv/config'

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Note: Authentication middleware is applied at the server level
// req.user is available from the authMiddleware

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
    "estimatedTime": 60
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
        { priority: 'desc' }
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
    // Check if user is authenticated (should be set by authMiddleware)
    if (!req.user || !req.user.id) {
      console.log('User not authenticated or missing user ID');
      return res.status(401).json({ error: 'Authentication required. Please log in to continue.' });
    }

    let { thought } = req.body;
    if (!thought || typeof thought !== 'string') {
      console.log('Invalid thought provided');
      return res.status(400).json({ error: 'Thought is required.' });
    }

    // Clean and validate the thought
    thought = thought.trim();
    console.log('Processing thought:', thought);

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
      
      // Try to find JSON object in the response if it's mixed with other text
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[0];
      }
      
      aiData = JSON.parse(cleanResponse);
      console.log('Parsed AI data:', aiData);
      
      // Validate and fix the structure if needed
      if (!aiData.goal || typeof aiData.goal !== 'object') {
        console.log('Missing or invalid goal, creating fallback');
        aiData.goal = {
          title: thought.substring(0, 100),
          description: `Transform this thought: "${thought}"`,
          priority: 'MEDIUM',
          category: 'other'
        };
      }
      
      if (!Array.isArray(aiData.tasks)) {
        console.log('Missing or invalid tasks array, creating fallback');
        aiData.tasks = [
          {
            title: `Work on: ${thought.substring(0, 80)}`,
            description: `Take action on this thought: "${thought}"`,
            priority: 'MEDIUM',
            estimatedTime: 60
          }
        ];
      }
      
      // Ensure goal has required fields
      aiData.goal.title = aiData.goal.title || thought.substring(0, 100);
      aiData.goal.description = aiData.goal.description || `Goal: ${thought}`;
      aiData.goal.priority = ['HIGH', 'MEDIUM', 'LOW'].includes(aiData.goal.priority) ? aiData.goal.priority : 'MEDIUM';
      aiData.goal.category = aiData.goal.category || 'other';
      
      // Ensure tasks have required fields
      aiData.tasks = aiData.tasks.map((task, index) => ({
        title: task.title || `Task ${index + 1}`,
        description: task.description || `Work on: ${thought}`,
        priority: ['HIGH', 'MEDIUM', 'LOW'].includes(task.priority) ? task.priority : 'MEDIUM',
        estimatedTime: typeof task.estimatedTime === 'number' ? task.estimatedTime : 60
      }));
      
      console.log('Successfully processed AI response:', aiData);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      console.log('Creating fallback response for thought:', thought);
      
      // Create a fallback response if AI parsing fails
      aiData = {
        goal: {
          title: thought.substring(0, 100),
          description: `Transform this thought into action: "${thought}"`,
          priority: 'MEDIUM',
          category: 'other'
        },
        tasks: [
          {
            title: `Act on: ${thought.substring(0, 80)}`,
            description: `Take specific action on this thought: "${thought}"`,
            priority: 'MEDIUM',
            estimatedTime: 60
          },
          {
            title: 'Plan next steps',
            description: `Break down "${thought}" into smaller actionable items`,
            priority: 'MEDIUM',
            estimatedTime: 30
          }
        ]
      };
      
      console.log('Using fallback AI data:', aiData);
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
    console.error('❌ Error in transform-thought-to-goal:', err);
    console.error('❌ Error details:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code
    });
    
    // Provide more specific error messages
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(500).json({ 
        error: 'Network connection error. Please check your internet connection.',
        details: 'Unable to connect to OpenAI API'
      });
    }
    
    if (err.status === 401) {
      return res.status(500).json({ 
        error: 'OpenAI API authentication failed. Please check API key.',
        details: err.message
      });
    }
    
    if (err.status === 429) {
      return res.status(500).json({ 
        error: 'OpenAI API rate limit exceeded. Please try again later.',
        details: err.message
      });
    }
    
    if (err.status === 400) {
      return res.status(500).json({ 
        error: 'Invalid request to OpenAI API.',
        details: err.message
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to process thought into goal.',
      details: err.message,
      type: err.name || 'Unknown error'
    });
  }
});

// POST /api/ai/transform-thought-streaming - Stream task generation in real-time
router.post('/transform-thought-streaming', async (req, res) => {
  console.log('POST /api/ai/transform-thought-streaming - Request received:', req.body);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  try {
    const { thought } = req.body;

    if (!thought || typeof thought !== 'string') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Thought is required' })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Creating your goal and tasks...' })}\n\n`);

    const prompt = `
You are a world-class productivity coach and goal-setting expert. Transform this thought into a clear, actionable GOAL and then break it down into 3-4 specific tasks that will achieve that goal.

User's Thought: "${thought}"

GOAL CREATION PRINCIPLES:
- Transform the thought into a clear, specific, measurable goal
- Make it inspiring but achievable
- Include a clear success criteria or outcome
- Set appropriate priority and timeline expectations

TASK BREAKDOWN PRINCIPLES:
- Create 3-4 tasks that directly contribute to achieving the goal
- Start with the most logical first step someone can take TODAY
- Include specific deliverables or outcomes for each task
- Consider prerequisites and logical sequencing
- Make tasks challenging but achievable within the estimated timeframe
- Be specific about WHO, WHAT, WHERE, WHEN details when relevant

PRIORITY GUIDELINES:
- HIGH: Critical path items that unlock other tasks or have deadlines
- MEDIUM: Important but not time-sensitive
- LOW: Nice-to-have or preparatory tasks

CATEGORY GUIDELINES:
- work: Professional, career, business-related
- personal: Life admin, relationships, home organization
- health: Physical fitness, mental wellness, medical
- learning: Education, skill development, courses, reading
- creative: Art, writing, design, music, creative projects
- financial: Money management, investments, budgeting

TIME ESTIMATION GUIDELINES:
- Be realistic: account for setup time, breaks, potential obstacles
- 15-30 min: Quick tasks, calls, emails, simple research
- 30-60 min: Focused work sessions, basic learning modules
- 60-120 min: Deep work, complex tasks, workshops
- 120+ min: Major projects, comprehensive research, skill practice

Return ONLY a JSON object with this exact structure:

{
  "goal": {
    "title": "Clear, inspiring goal title (max 100 characters)",
    "description": "Detailed description of what success looks like and why it matters",
    "priority": "HIGH|MEDIUM|LOW",
    "category": "work|personal|health|learning|creative|financial"
  },
  "tasks": [
    {
      "title": "Specific, action-oriented task title (max 80 characters)",
      "description": "Clear description with specific outcome or deliverable expected",
      "priority": "HIGH|MEDIUM|LOW",
      "estimatedTime": 45,
      "category": "work|personal|health|learning|creative|financial"
    }
  ]
}

Requirements:
- Return valid JSON only, no markdown, no explanations
- Create exactly 1 goal and 3-4 tasks
- Tasks should directly contribute to achieving the goal
- Include realistic time estimates in minutes for tasks
- Make titles action-oriented (start with verbs when possible for tasks)
- Ensure the goal is inspiring and the tasks are immediately actionable
`;

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a productivity assistant. Only return valid JSON arrays of tasks.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000,
      temperature: 0.7,
      stream: true
    });

    let accumulatedResponse = '';
    let goalSent = false;
    let sentTasks = [];

    // Stream chunks and parse progressively
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content || '';
      accumulatedResponse += content;

      // Send progress update
      if (content.trim()) {
        res.write(`data: ${JSON.stringify({
          type: 'progress',
          content: content,
          totalLength: accumulatedResponse.length
        })}\n\n`);
      }

      // Try to extract complete goal and tasks from accumulated response
      try {
        let cleanResponse = accumulatedResponse.trim();
        if (cleanResponse.startsWith('```json')) {
          cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanResponse.startsWith('```')) {
          cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        // Try to parse JSON - this will work once we have complete response
        if (cleanResponse.startsWith('{') && cleanResponse.includes('"goal"') && cleanResponse.includes('"tasks"')) {
          const result = JSON.parse(cleanResponse);
          
          if (result.goal && Array.isArray(result.tasks)) {
            // Send goal first if not already sent
            if (!goalSent && result.goal) {
              const goalWithId = {
                ...result.goal,
                id: `goal_${Date.now()}`,
                generated: true
              };
              
              res.write(`data: ${JSON.stringify({
                type: 'goal',
                goal: goalWithId
              })}\n\n`);
              
              goalSent = true;
            }

            // Send any new complete tasks
            for (let i = sentTasks.length; i < result.tasks.length; i++) {
              const task = {
                ...result.tasks[i],
                id: `task_${Date.now()}_${i}`,
                generated: true
              };
              
              res.write(`data: ${JSON.stringify({
                type: 'task',
                task: task,
                index: i,
                total: result.tasks.length
              })}\n\n`);
              
              sentTasks.push(task);
            }
          }
        }
      } catch (parseError) {
        // Still accumulating, ignore parse errors
      }
    }

    // Final parse for any remaining goal and tasks
    try {
      let cleanResponse = accumulatedResponse.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const result = JSON.parse(cleanResponse);
      
      if (result.goal && Array.isArray(result.tasks)) {
        // Send goal if not already sent
        if (!goalSent && result.goal) {
          const goalWithId = {
            ...result.goal,
            id: `goal_${Date.now()}`,
            generated: true
          };
          
          res.write(`data: ${JSON.stringify({
            type: 'goal',
            goal: goalWithId
          })}\n\n`);
          
          goalSent = true;
        }

        // Send any final tasks that weren't sent during streaming
        for (let i = sentTasks.length; i < result.tasks.length; i++) {
          const task = {
            ...result.tasks[i],
            id: `task_${Date.now()}_${i}`,
            generated: true
          };
          
          res.write(`data: ${JSON.stringify({
            type: 'task',
            task: task,
            index: i,
            total: result.tasks.length
          })}\n\n`);
          
          sentTasks.push(task);
        }
      }
    } catch (finalParseError) {
      console.error('Final parse error:', finalParseError);
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        message: 'Failed to parse AI response' 
      })}\n\n`);
      res.end();
      return;
    }

    // All goal and tasks sent, notify completion
    res.write(`data: ${JSON.stringify({ 
      type: 'complete', 
      goalCreated: goalSent,
      totalTasks: sentTasks.length 
    })}\n\n`);
    res.end();

  } catch (error) {
    console.error('Streaming error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to generate tasks' })}\n\n`);
    res.end();
  }
});

export default router; 