import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { login, verifyAuth, getOfficialRaces, searchIRacingName } from './iRacingApi.js';

dotenv.config();

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.speedtrapbets.com';

app.use(cors({
  origin: FRONTEND_URL,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Middleware to check authentication
const checkAuth = async (req, res, next) => {
  try {
    const isAuthenticated = await verifyAuth();
    if (isAuthenticated) {
      next();
    } else {
      res.status(401).json({ error: 'Authentication failed' });
    }
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/api/official-races', checkAuth, async (req, res) => {
  try {
    const races = await getOfficialRaces();
    res.json(races);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search-iracing-name', checkAuth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Name parameter is required' });
    }

    const result = await searchIRacingName(name);
    res.json(result);
  } catch (error) {
    console.error('Error in search-iracing-name endpoint:', error);
    res.status(500).json({ error: 'An error occurred while searching for the iRacing name' });
  }
});

const PORT = process.env.PORT || 3001;

// Start the server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    const loginSuccess = await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD);
    if (loginSuccess) {
      console.log('Successfully logged in to iRacing API');
    } else {
      console.error('Failed to log in to iRacing API');
    }
  } catch (error) {
    console.error('Error during iRacing API login:', error);
  }
});