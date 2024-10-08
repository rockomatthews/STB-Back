import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { login, verifyAuth, searchIRacingName, getLeagueSeasons, getLeagueSubsessions, getLeagueRoster, getRaceDetails, manualReAuth } from './iRacingApi.js';
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

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_RETRY_DELAY = 10000; // 10 seconds

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

// Middleware to check authentication before each request
app.use(async (req, res, next) => {
  try {
    const isAuthenticated = await verifyAuth();
    if (!isAuthenticated) {
      console.log('Authentication failed. Attempting manual re-authentication...');
      await manualReAuth();
    }
    next();
  } catch (error) {
    console.error('Error in authentication middleware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

app.get('/api/league-seasons', async (req, res) => {
  try {
    const leagueId = 11489; // Your league ID
    console.log(`Fetching seasons for league: ${leagueId}`);

    const seasons = await getLeagueSeasons(leagueId);
    console.log('Successfully fetched league seasons');

    res.json(seasons);
  } catch (error) {
    console.error('Error fetching league seasons:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching league seasons', 
      details: error.message
    });
  }
});

// Updated endpoint to get league subsessions
app.get('/api/league-subsessions', async (req, res) => {
  try {
    const leagueId = 11489; // Your league ID
    const { seasonId } = req.query;

    if (!seasonId) {
      return res.status(400).json({ error: 'seasonId query parameter is required' });
    }

    console.log(`Fetching subsessions for league: ${leagueId}, season: ${seasonId}`);

    const subsessionsData = await getLeagueSubsessions(leagueId, seasonId);
    console.log('Successfully fetched league subsessions');

    // Fetch roster information
    const rosterData = await getLeagueRoster(leagueId);
    console.log('Successfully fetched league roster');

    // Combine subsessions with roster information
    const sessionsWithRoster = subsessionsData.sessions.map(session => ({
      ...session,
      rosterCount: rosterData.rosterCount,
      roster: rosterData.roster
    }));

    // Optional: Store subsessions in Supabase
    if (sessionsWithRoster && Array.isArray(sessionsWithRoster)) {
      const { data, error } = await supabase
        .from('league_subsessions')
        .upsert(sessionsWithRoster.map(session => ({
          ...session,
          league_id: leagueId,
          season_id: seasonId,
          updated_at: new Date()
        })), 
        { onConflict: 'subsession_id' });

      if (error) {
        console.error('Error storing subsessions in Supabase:', error);
      } else {
        console.log('Successfully stored subsessions in Supabase');
      }
    }

    res.json({ sessions: sessionsWithRoster });
  } catch (error) {
    console.error('Error fetching league subsessions:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching league subsessions', 
      details: error.message
    });
  }
});

app.get('/api/league-roster', async (req, res) => {
  try {
    const leagueId = 11489; // Your league ID
    console.log(`Fetching roster for league: ${leagueId}`);

    const rosterData = await getLeagueRoster(leagueId);
    
    if (rosterData && Array.isArray(rosterData.roster)) {
      console.log('Successfully fetched league roster');
      res.json({
        rosterCount: rosterData.rosterCount,
        roster: rosterData.roster,
        privateRoster: rosterData.privateRoster
      });
    } else {
      console.error('Unexpected roster data format:', rosterData);
      res.status(500).json({ 
        error: 'Received unexpected data format for roster', 
        details: JSON.stringify(rosterData)
      });
    }
  } catch (error) {
    console.error('Error fetching league roster:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching league roster', 
      details: error.message
    });
  }
});

// New endpoint to get race details
app.get('/api/race/:raceId', async (req, res) => {
  try {
    const { raceId } = req.params;
    const leagueId = 11489; // Your league ID
    
    console.log(`Fetching race details for race ID: ${raceId}`);

    const raceDetails = await getRaceDetails(leagueId, null, raceId);
    console.log('Successfully fetched race details');

    res.json(raceDetails);
  } catch (error) {
    console.error('Error fetching race details:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching race details', 
      details: error.message
    });
  }
});

app.post('/api/place-bet', async (req, res) => {
  const { userId, leagueId, seasonId, raceId, selectedDriverId, betAmount, odds } = req.body;

  try {
    // Validate input
    if (!userId || !leagueId || !seasonId || !raceId || !selectedDriverId || !betAmount || !odds) {
      return res.status(400).json({ error: 'Missing required fields for placing a bet' });
    }

    // TODO: Implement logic to check user's balance before placing bet

    const { data, error } = await supabase
      .from('bets')
      .insert({
        user_id: userId,
        league_id: leagueId,
        season_id: seasonId,
        race_id: raceId,
        selected_driver_id: selectedDriverId,
        bet_amount: betAmount,
        odds: odds,
        status: 'pending'
      });

    if (error) throw error;

    // TODO: Implement logic to update user's balance after placing bet

    res.json({ success: true, bet: data[0] });
  } catch (error) {
    console.error('Error placing bet:', error);
    res.status(500).json({ error: 'Failed to place bet', details: error.message });
  }
});

// New endpoint to get user's bets
app.get('/api/user-bets/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const { data, error } = await supabase
      .from('bets')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error fetching user bets:', error);
    res.status(500).json({ error: 'Failed to fetch user bets', details: error.message });
  }
});

// New endpoint to get race results
app.get('/api/race-results/:raceId', async (req, res) => {
  try {
    const { raceId } = req.params;
    const leagueId = 11489; // Your league ID
    
    console.log(`Fetching race results for race ID: ${raceId}`);

    const raceResults = await getRaceDetails(leagueId, null, raceId);
    console.log('Successfully fetched race results');

    // TODO: Implement logic to process race results and update bet statuses

    res.json(raceResults);
  } catch (error) {
    console.error('Error fetching race results:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching race results', 
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