export const errorHandler = (err, req, res, next) => {
  console.error('Error stack:', err.stack);
  
  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Duplicate entry',
      message: 'A record with this information already exists'
    });
  }
  
  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Record not found',
      message: 'The requested record could not be found'
    });
  }
  
  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      message: err.message,
      details: err.errors
    });
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid token',
      message: 'Please provide a valid authentication token'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expired',
      message: 'Your session has expired. Please log in again'
    });
  }
  
  // Default error
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';
  
  res.status(statusCode).json({
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}; 