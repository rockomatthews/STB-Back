import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { login, verifyAuth, getOfficialRaces, searchIRacingName } from './iRacingApi.js';
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
app.use(cookieParser()); // Add cookie-parser middleware

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

app.get('/api/test-races', async (req, res) => {
  console.log('Test races endpoint hit');
  try {
    const races = await getOfficialRaces('test_user', 1, 10);
    console.log('Races retrieved:', JSON.stringify(races, null, 2));
    res.json(races);
  } catch (error) {
    console.error('Error in test races endpoint:', error);
    res.status(500).json({ error: 'An error occurred while fetching races' });
  }
});

app.get('/api/test-supabase', async (req, res) => {
  try {
    const { data, error } = await supabase.from('official_races').select('count').limit(1);
    if (error) throw error;
    res.json({ success: true, message: 'Supabase connection successful', data });
  } catch (error) {
    console.error('Supabase connection test failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const checkAuth = async (req, res, next) => {
  try {
    const isAuthenticated = await verifyAuth();
    if (isAuthenticated) {
      console.log('User is authenticated');
    } else {
      console.log('User is not authenticated, proceeding with limited functionality');
    }
    next(); // Always proceed to the next middleware
  } catch (error) {
    console.error('Error in checkAuth middleware:', error);
    next(); // Proceed even if there's an error
  }
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const loginSuccess = await login(email, password);
    if (loginSuccess) {
      res.json({ success: true, message: 'Login successful' });
    } else {
      res.status(401).json({ success: false, message: 'Login failed' });
    }
  } catch (error) {
    console.error('Error in login endpoint:', error);
    res.status(500).json({ 
      error: 'An error occurred during login', 
      details: error.message
    });
  }
});

// Endpoint to get official races with pagination
app.get('/api/official-races', checkAuth, async (req, res) => {
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
    console.log('Full response:', JSON.stringify(races, null, 2));
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
app.get('/api/search-iracing-name', checkAuth, async (req, res) => {
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