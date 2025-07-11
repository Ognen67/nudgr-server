import { PrismaClient } from '@prisma/client';

// Check if we have a valid database URL
const hasValidDatabaseConfig = () => {
  const dbUrl = process.env.DATABASE_URL;
  return dbUrl && 
         dbUrl !== 'postgresql://username:password@localhost:5432/database' &&
         (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://'));
};

// Create a single Prisma instance with proper connection pooling
let prisma = null;

if (hasValidDatabaseConfig()) {
  if (process.env.NODE_ENV === 'production') {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: ['error', 'warn'],
    });
  } else {
    // In development, reuse the same instance to avoid connection pool exhaustion
    if (!global.prisma) {
      global.prisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
        log: ['query', 'error', 'warn'],
      });
    }
    prisma = global.prisma;
  }

  // Handle graceful shutdown
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
} else {
  console.warn('⚠️  Database configuration is missing or invalid. Please check your DATABASE_URL environment variable.');
  console.warn('   - DATABASE_URL should be a valid PostgreSQL connection string');
  console.warn('   - Example: postgresql://username:password@localhost:5432/database');
  console.warn('   Routes that depend on the database will not work until this is properly configured.');
  
  // Create a mock prisma client for development/demo purposes
  prisma = new Proxy({}, {
    get: function(target, prop) {
      if (typeof prop === 'string') {
        return new Proxy({}, {
          get: function(target, method) {
            return async function(...args) {
              throw new Error(`Database not configured. Please set a valid DATABASE_URL. Attempted to call: ${prop}.${String(method)}`);
            };
          }
        });
      }
      return undefined;
    }
  });
}

export default prisma;