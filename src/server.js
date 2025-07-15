import dotenv from 'dotenv';
// Load environment variables FIRST before any other imports
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

// Route imports
import authRoutes from './routes/auth.js';
import goalRoutes from './routes/goals.js';
import taskRoutes from './routes/tasks.js';
import aiRoutes from './routes/ai.js';
import ideaRoutes from './routes/ideas.js';
// import stripeRoutes from './routes/stripe.js';

// Middleware imports
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs (increased for development)
  message: 'Too many requests from this IP, please try again later.'
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow for development/frontend integration
  crossOriginEmbedderPolicy: false, // Allow for React Native and web clients
}));

// Enhanced CORS configuration for Next.js frontend and React Native
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Allow your production domains
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.NEXTJS_URL,
      // Add your production domains here
      'https://nudgr-web.vercel.app',
    ].filter(Boolean);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // For development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // Otherwise, reject
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Client-Type', // For identifying React Native vs web clients
    'X-App-Version'  // For version-specific handling
  ],
  exposedHeaders: ['X-Total-Count', 'X-Request-ID']
}));

app.use(morgan('combined'));
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add request ID for tracking
app.use((req, res, next) => {
  req.requestId = Math.random().toString(36).substring(2, 15);
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Auth routes (no middleware needed, handled internally)
app.use('/api/auth', authRoutes);

// Protected routes - apply auth middleware
app.use('/api/goals', authMiddleware, goalRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/ideas', authMiddleware, ideaRoutes);
// app.use('/api/stripe', authMiddleware, stripeRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    message: `The requested route ${req.originalUrl} does not exist.`,
    requestId: req.requestId
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Auth endpoints: http://localhost:${PORT}/api/auth`);
  console.log(`📱 CORS enabled for development and production`);
  
  // Log environment status
  if (!process.env.SUPABASE_URL) {
    console.warn('⚠️  Warning: SUPABASE_URL not set in environment variables');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️  Warning: SUPABASE_SERVICE_ROLE_KEY not set in environment variables');
  }
  if (!process.env.SUPABASE_JWKS_URL) {
    console.warn('⚠️  Warning: SUPABASE_JWKS_URL not set in environment variables');
  }
}); 