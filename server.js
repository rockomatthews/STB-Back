import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { login, verifyAuth, getOfficialRaces, searchIRacingName, getRacers } from './iRacingApi.js';
import { createClient } from '@supabase/supabase-js';

console.log('Server starting...');

dotenv.config();

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.speedtrapbets.com';

app.use(cors({
  origin: FRONTEND_URL,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 3001;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/api/race-racers', async function(req, res) {
  try {
    const subsessionId = req.query.subsessionId;
    if (!subsessionId) {
      return res.status(400).json({ error: 'Subsession ID is required' });
    }

    console.log('Fetching racers for subsession ID: ' + subsessionId);
    const racers = await getRacers(subsessionId);
    console.log('Successfully fetched ' + racers.length + ' racers');
    res.json(racers);
  } catch (error) {
    console.error('Error fetching racers:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching racers', 
      details: error.message
    });
  }
});

// Endpoint to get official races with pagination
app.get('/api/official-races', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    let userId = req.query.userId || req.cookies.userId;

    if (!userId) {
      userId = 'temp_' + Math.random().toString(36).substr(2, 9);
      res.cookie('userId', userId, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    }

    console.log(`Fetching official races for user ${userId}: page ${page}, limit ${limit}`);
    const races = await getOfficialRaces(userId, page, limit);
    console.log(`Successfully fetched ${races.races.length} races`);
    res.json(races);
  } catch (error) {
    console.error('Error fetching official races:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching official races', 
      details: error.message
    });
  }
});

// Endpoint to search for an iRacing name
app.get('/api/search-iracing-name', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Name parameter is required' });
    }

    console.log('Searching for:', name);

    const result = await searchIRacingName(name);
    console.log('Search result:', result);

    if (result.exists) {
      res.json({ exists: true, name: result.name, id: result.id });
    } else {
      res.json({ exists: false, message: `${name} has not been found in iRacing.` });
    }
  } catch (error) {
    console.error('Error in search-iracing-name endpoint:', error);
    res.status(500).json({ 
      error: 'An error occurred while searching for the iRacing name', 
      details: error.message
    });
  }
});

// Start the server and attempt login to iRacing API
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const loginSuccess = await attemptLogin();
  if (!loginSuccess) {
    console.error('Server started but iRacing login failed. Some functionality may be limited.');
  }
});

export default app;