const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { login, verifyAuth, getOfficialRaces } = require('./iRacingApi');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Middleware to check authentication
const checkAuth = async (req, res, next) => {
  try {
    await verifyAuth();
    next();
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

// Start the server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD);
    console.log('Successfully logged in to iRacing API');
  } catch (error) {
    console.error('Failed to log in to iRacing API:', error);
  }
});