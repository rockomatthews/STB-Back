import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import tough from 'tough-cookie';
import dotenv from 'dotenv';

console.log('iRacingApi module loading...');

dotenv.config();

const { CookieJar } = tough;

const BASE_URL = 'https://members-ng.iracing.com';
const cookieJar = new CookieJar();

const instance = axios.create({
  httpsAgent: new https.Agent({  
    rejectUnauthorized: false
  })
});

function hashPassword(password, email) {
  const hash = crypto.createHash('sha256');
  hash.update(password + email.toLowerCase());
  return hash.digest('base64');
}

async function login(email, password) {
  console.log('Attempting to login...');
  const hashedPassword = hashPassword(password, email);

  try {
    const response = await instance.post(`${BASE_URL}/auth`, {
      email,
      password: hashedPassword
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.headers['set-cookie']) {
      response.headers['set-cookie'].forEach(cookie => {
        cookieJar.setCookieSync(cookie, BASE_URL);
      });
      console.log('Cookies set successfully');
      return true;
    } else {
      console.error('No cookies in response');
      console.log('Response headers:', response.headers);
      console.log('Response data:', response.data);
      throw new Error('No cookies in response');
    }
  } catch (error) {
    console.error('Login failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return false;
  }
}

async function verifyAuth() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    console.log('Verifying auth with cookies');

    const response = await instance.get(`${BASE_URL}/data/doc`, {
      headers: {
        'Cookie': cookieString
      }
    });

    console.log('Verification response status:', response.status);
    return response.status === 200;
  } catch (error) {
    console.error('Auth verification failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return false;
  }
}

async function searchIRacingName(name) {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/lookup/drivers`, {
      params: {
        search_term: name,
        lowerbound: 1,
        upperbound: 25
      },
      headers: {
        'Cookie': cookieString
      }
    });

    if (response.data && response.data.link) {
      const driverDataResponse = await instance.get(response.data.link);
      const drivers = Array.isArray(driverDataResponse.data) ? driverDataResponse.data : [];

      if (drivers.length > 0) {
        const matchingDriver = drivers.find(driver => 
          driver.display_name.toLowerCase() === name.toLowerCase() ||
          driver.display_name.toLowerCase().includes(name.toLowerCase())
        );

        if (matchingDriver) {
          return {
            exists: true,
            name: matchingDriver.display_name,
            id: matchingDriver.cust_id
          };
        }
      }
    }

    return { exists: false };
  } catch (error) {
    console.error('Error searching for iRacing name:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

async function getLeagueSeasons(leagueId) {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/league/seasons`, {
      params: {
        league_id: leagueId
      },
      headers: {
        'Cookie': cookieString
      }
    });

    if (response.data && response.data.link) {
      const seasonsDataResponse = await instance.get(response.data.link);
      return seasonsDataResponse.data;
    } else {
      throw new Error('Invalid response from iRacing API for league seasons');
    }
  } catch (error) {
    console.error('Error fetching league seasons:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

async function getLeagueSubsessions(leagueId, seasonId) {
  if (!seasonId) {
    throw new Error('season_id is required');
  }

  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/league/season_sessions`, {
      params: {
        league_id: leagueId,
        season_id: seasonId,
        results_only: false  // Include upcoming sessions as well
      },
      headers: {
        'Cookie': cookieString
      }
    });

    if (response.data && response.data.link) {
      const subsessionsResponse = await instance.get(response.data.link);
      const sessions = subsessionsResponse.data.sessions;

      console.log('Raw sessions data:', JSON.stringify(sessions, null, 2));

      // For now, let's return all sessions without filtering
      return { sessions: sessions };
    } else {
      throw new Error('Invalid response from iRacing API for league subsessions');
    }
  } catch (error) {
    console.error('Error fetching league subsessions:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

async function getLeagueRoster(leagueId) {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    console.log(`Fetching roster for league ID: ${leagueId}`);
    const response = await instance.get(`${BASE_URL}/data/league/roster`, {
      params: {
        league_id: leagueId
      },
      headers: {
        'Cookie': cookieString
      }
    });

    console.log('Initial roster response:', response.data);

    if (response.data && response.data.data_url) {
      console.log('Fetching roster data from URL:', response.data.data_url);
      const rosterDataResponse = await instance.get(response.data.data_url);
      console.log('Roster data response:', rosterDataResponse.data);
      return {
        rosterCount: response.data.data.roster_count,
        roster: rosterDataResponse.data.roster,
        privateRoster: rosterDataResponse.data.private_roster
      };
    } else {
      console.error('Invalid response structure:', response.data);
      throw new Error('Invalid response from iRacing API for league roster');
    }
  } catch (error) {
    console.error('Error fetching league roster:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

async function getRaceDetails(leagueId, seasonId, subsessionId) {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/results/get`, {
      params: {
        subsession_id: subsessionId
      },
      headers: {
        'Cookie': cookieString
      }
    });

    if (response.data && response.data.link) {
      const raceDetailsResponse = await instance.get(response.data.link);
      return raceDetailsResponse.data;
    } else {
      throw new Error('Invalid response from iRacing API for race details');
    }
  } catch (error) {
    console.error('Error fetching race details:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

const RE_AUTH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_RETRY_DELAY = 10000; // 10 seconds

async function periodicReAuth() {
  let attempts = 0;
  while (attempts < MAX_LOGIN_ATTEMPTS) {
    try {
      const isAuthenticated = await verifyAuth();
      if (isAuthenticated) {
        console.log('Authentication verified successfully');
        return;
      }
      console.log('Session expired. Attempting to re-authenticate...');
      const loginSuccess = await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD);
      if (loginSuccess) {
        console.log('Re-authentication successful');
        return;
      }
    } catch (error) {
      console.error(`Re-authentication attempt ${attempts + 1} failed:`, error);
    }
    attempts++;
    if (attempts < MAX_LOGIN_ATTEMPTS) {
      console.log(`Retrying in ${LOGIN_RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, LOGIN_RETRY_DELAY));
    }
  }
  console.error('Max re-authentication attempts reached. Please check your credentials and network connection.');
}

let reAuthInterval;

function startPeriodicReAuth() {
  if (reAuthInterval) {
    clearInterval(reAuthInterval);
  }
  reAuthInterval = setInterval(periodicReAuth, RE_AUTH_INTERVAL);
  console.log('Periodic re-authentication started');
}

(async () => {
  try {
    const loginSuccess = await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD);
    if (loginSuccess) {
      console.log('Initial authentication successful');
      startPeriodicReAuth();
    } else {
      console.error('Initial authentication failed. Please check your credentials.');
    }
  } catch (error) {
    console.error('Initial authentication failed:', error);
  }
})();

async function manualReAuth() {
  await periodicReAuth();
  startPeriodicReAuth();
}

export {
  login,
  verifyAuth,
  searchIRacingName,
  getLeagueSeasons,
  getLeagueSubsessions,
  getLeagueRoster,
  getRaceDetails,
  manualReAuth
};