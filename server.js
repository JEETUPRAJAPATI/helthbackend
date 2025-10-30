const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import database connection
const connectDB = require('./config/database');

// Import middlewares
const { errorHandler, notFound } = require('./middlewares/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const expertRoutes = require('./routes/expertRoutes');
const adminRoutes = require('./routes/admin/adminRoutes');

// Connect to MongoDB
connectDB();

// Seed initial superadmin if env provided
const seedInitialAdmin = async () => {
  try {
    const Admin = require('./models/Admin');
    const email = process.env.INIT_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
    const name = process.env.INIT_ADMIN_NAME || process.env.ADMIN_NAME || 'Super Admin';
    const password = process.env.INIT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

    if (!email || !password) return;

    const existing = await Admin.findOne({ email });
    if (existing) {
      console.log('Initial admin already exists:', email);
      return;
    }

      const admin = await Admin.create({ name, email, password, role: 'superadmin', isPrimary: true });
      console.log('Seeded initial superadmin:', admin.email);
  } catch (err) {
    console.error('Failed to seed initial admin:', err.message);
  }
};

seedInitialAdmin();

  // In development, if no env-provided admin was seeded, create a demo admin for convenience
  const seedDevDemoAdmin = async () => {
    try {
      if (process.env.NODE_ENV !== 'development') return;
      const Admin = require('./models/Admin');
      const demoEmail = 'admin@zenovia.com';
      const demoPassword = 'admin123';

      const existing = await Admin.findOne({ email: demoEmail });
      if (existing) return;

      const admin = await Admin.create({ name: 'Demo Admin', email: demoEmail, password: demoPassword, role: 'superadmin', isPrimary: false });
      console.log('Seeded development demo admin:', admin.email);
    } catch (err) {
      console.error('Failed to seed dev demo admin:', err.message);
    }
  };

  seedDevDemoAdmin();

// Seed default permissions
const seedDefaultPermissions = async () => {
  try {
    const Permission = require('./models/Permission');
    
    const defaultPermissions = [
      { key: 'manage_users', label: 'Manage Users' },
      { key: 'manage_experts', label: 'Manage Experts' },
      { key: 'manage_admins', label: 'Manage Admins' },
      { key: 'manage_bookings', label: 'Manage Bookings' },
      { key: 'manage_payments', label: 'Manage Payments' },
      { key: 'manage_subscriptions', label: 'Manage Subscriptions' },
      { key: 'view_reports', label: 'View Reports' },
      { key: 'manage_settings', label: 'Manage Settings' }
    ];
    
    for (const perm of defaultPermissions) {
      const existing = await Permission.findOne({ key: perm.key });
      if (!existing) {
        await Permission.create(perm);
        console.log(`Seeded permission: ${perm.label}`);
      }
    }
  } catch (err) {
    console.error('Failed to seed default permissions:', err.message);
  }
};

seedDefaultPermissions();

// Seed default permissions
const seedDefaultPermissions = async () => {
  try {
    const Permission = require('./models/Permission');
    
    const defaultPermissions = [
      { key: 'manage_users', label: 'Manage Users' },
      { key: 'manage_experts', label: 'Manage Experts' },
      { key: 'manage_bookings', label: 'Manage Bookings' },
      { key: 'manage_payments', label: 'Manage Payments' },
      { key: 'view_reports', label: 'View Reports' },
      { key: 'manage_settings', label: 'Manage Settings' },
      { key: 'manage_admins', label: 'Manage Admins' },
      { key: 'view_analytics', label: 'View Analytics' }
    ];

    for (const perm of defaultPermissions) {
      const existing = await Permission.findOne({ key: perm.key });
      if (!existing) {
        await Permission.create(perm);
        console.log(`Seeded permission: ${perm.key}`);
      }
    }
  } catch (err) {
    console.error('Failed to seed permissions:', err.message);
  }
};

seedDefaultPermissions();

const app = express();

// Trust proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(url => url.trim()) : []),
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://10.0.2.2:3001',
      'http://10.0.2.2:3000',
      'http://192.168.1.4:8081',
      'http://192.168.1.4:3001',
      'https://apiwellness.shrawantravels.com',
      'http://apiwellness.shrawantravels.com',
      'exp://localhost:8081',
      'exp://10.0.2.2:8081',
      'exp://192.168.1.4:8081'
    ];

    if (process.env.NODE_ENV === 'development') {
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('10.0.2.2') || origin.includes('exp://'))) {
        return callback(null, true);
      }
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/experts', expertRoutes);
app.use('/api/admin', adminRoutes);

// Default route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Wellness App API',
    version: '1.0.0',
    documentation: {
      authentication: '/api/auth',
      experts: '/api/experts'
    }
  });
});

// Handle undefined routes
app.use(notFound);

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running in', process.env.NODE_ENV, 'mode on port', PORT);
  console.log('Health check: http://localhost:' + PORT + '/health');
  console.log('Health check (network): http://192.168.1.3:' + PORT + '/health');
  console.log('API Documentation: http://localhost:' + PORT + '/');
  console.log('Auth API: http://localhost:' + PORT + '/api/auth');
  console.log('Auth API (network): http://192.168.1.3:' + PORT + '/api/auth');
  console.log('Expert API: http://localhost:' + PORT + '/api/experts');
  console.log('Uploads: http://localhost:' + PORT + '/uploads');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log('Unhandled Rejection:', err.message);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log('Uncaught Exception:', err.message);
  console.log('Shutting down the server due to Uncaught Exception');
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  console.log('Shutting down gracefully');
  server.close(() => {
    console.log('Process terminated!');
  });
});

module.exports = app;
