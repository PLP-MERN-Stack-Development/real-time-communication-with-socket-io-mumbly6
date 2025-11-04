const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

// Load environment variables
dotenv.config();

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);

// Enable CORS
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Store connected users
const users = new Map();

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Handle new user joining
  socket.on('user_connected', (username) => {
    users.set(socket.id, { username, status: 'online' });
    console.log(`${username} (${socket.id}) connected`);
    
    // Notify all users about the new connection
    io.emit('user_status_changed', {
      userId: socket.id,
      username,
      status: 'online',
      timestamp: new Date()
    });
    
    // Send current users list to the newly connected user
    socket.emit('users_list', Array.from(users.entries()).map(([id, user]) => ({
      id,
      username: user.username,
      status: user.status
    })));
  });

  // Handle chat messages
  socket.on('send_message', (data) => {
    const { to, message } = data;
    const sender = users.get(socket.id);
    
    if (to) {
      // Private message
      socket.to(to).emit('receive_message', {
        from: socket.id,
        username: sender?.username || 'Unknown',
        message,
        isPrivate: true,
        timestamp: new Date()
      });
    } else {
      // Broadcast to all except sender
      socket.broadcast.emit('receive_message', {
        from: socket.id,
        username: sender?.username || 'Unknown',
        message,
        isPrivate: false,
        timestamp: new Date()
      });
    }
  });

  // Handle typing indicator
  socket.on('typing', (isTyping) => {
    const user = users.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_typing', {
        userId: socket.id,
        username: user.username,
        isTyping
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.set(socket.id, { ...user, status: 'offline' });
      console.log(`${user.username} (${socket.id}) disconnected`);
      
      // Notify all users about the disconnection
      io.emit('user_status_changed', {
        userId: socket.id,
        username: user.username,
        status: 'offline',
        timestamp: new Date()
      });
      
      // Remove user after a delay to allow reconnection
      setTimeout(() => {
        if (!io.sockets.sockets.has(socket.id)) {
          users.delete(socket.id);
        }
      }, 60000); // 1 minute grace period
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Blog API' });
});

// API Routes
app.use('/api/posts', require('./routes/postRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));

// Not found middleware
app.use(notFound);

// Error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  // server.close(() => process.exit(1));
});

const server = app.listen(
  PORT,
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`.yellow.bold)
);
