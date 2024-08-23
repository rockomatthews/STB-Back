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

const PORT = process.env.PORT || 3001;

const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_RETRY_DELAY = 5000; // 5 seconds

async function attemptLogin(attempts = 0) {
  try {
    const loginSuccess = await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD);
    if (loginSuccess) {
      console.log('Successfully logged in to iRacing API');
      return true;
    } else {
      throw new Error('Login failed');
    }
  } catch (error) {
    console.error(`Login attempt ${attempts + 1} failed:`, error.message);
    if (attempts < MAX_LOGIN_ATTEMPTS - 1) {
      console.log(`Retrying in ${LOGIN_RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, LOGIN_RETRY_DELAY));
      return attemptLogin(attempts + 1);
    } else {
      console.error('Max login attempts reached. Unable to log in to iRacing API.');
      return false;
    }
  }
}

const checkAuth = async (req, res, next) => {
  try {
    const isAuthenticated = await verifyAuth();
    if (isAuthenticated) {
      next();
    } else {
      console.error('Authentication failed in checkAuth middleware');
      res.status(401).json({ error: 'Authentication failed' });
    }
  } catch (error) {
    console.error('Error in checkAuth middleware:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/api/official-races', checkAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const races = await getOfficialRaces(page, limit);
    res.json(races);
  } catch (error) {
    console.error('Error fetching official races:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching official races', 
      details: error.message
    });
  }
});

app.get('/api/search-iracing-name', checkAuth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Name parameter is required' });
    }

    console.log('Searching for:', name);

    const result = await searchIRacingName(name);
    console.log('Search result:', JSON.stringify(result, null, 2));

    if (result.exists) {
      res.json({ exists: true, name: result.name, id: result.id });
    } else {
      res.json({ exists: false, message: `${name} has not been found in iRacing.` });
    }
  } catch (error) {
    console.error('Error in search-iracing-name endpoint:', error);
    res.status(500).json({ 
      error: 'An error occurred while searching for the iRacing name', 
      details: error.message,
      stack: error.stack
    });
  }
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const loginSuccess = await attemptLogin();
  if (!loginSuccess) {
    console.error('Server started but iRacing login failed. Some functionality may be limited.');
  }
});