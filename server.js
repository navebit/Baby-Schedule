const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Init DB
db.initDb();

// Store io on app
app.set('io', io);

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'baby-schedule-secret-fallback-change-me';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
  },
});

app.use(sessionMiddleware);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const entriesRoutes = require('./routes/entries');

app.use('/', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/entries', entriesRoutes);

// Page routes
app.get('/', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  if (req.session.userStatus !== 'approved') {
    return res.redirect('/pending');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pending', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pending.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Socket.io - share session
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.use((socket, next) => {
  const session = socket.request.session;
  if (session && session.userId && session.userStatus === 'approved') {
    next();
  } else {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const session = socket.request.session;
  const username = session.username;
  const groupId = session.groupId;

  // Join the group-specific room so events are scoped per family group
  if (groupId) {
    socket.join(`group:${groupId}`);
  }

  console.log(`Socket connected: ${username}${groupId ? ` (group:${groupId})` : ''}`);

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${username}`);
  });
});

server.listen(PORT, () => {
  console.log(`Baby Schedule app running at http://localhost:${PORT}`);
  console.log('Default admin login: admin / admin123');
});
