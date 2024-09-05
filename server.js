import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { login, verifyAuth, searchIRacingName } from './iRacingApi.js';

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