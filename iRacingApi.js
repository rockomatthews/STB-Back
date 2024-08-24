import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import tough from 'tough-cookie';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const { CookieJar } = tough;

const BASE_URL = 'https://members-ng.iracing.com';
const cookieJar = new CookieJar();

const instance = axios.create({
  httpsAgent: new https.Agent({  
    rejectUnauthorized: false
  })
});

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL or Anon Key is not set in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

function hashPassword(password, email) {
  const hash = crypto.createHash('sha256');
  hash.update(password + email.toLowerCase());
  return hash.digest('base64');
}

async function login(email, password) {
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
      console.log('Cookies set:', await cookieJar.getCookies(BASE_URL));
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
    
    console.log('Verifying auth with cookies:', cookieString);

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

    console.log('Initial search response:', JSON.stringify(response.data, null, 2));

    if (response.data && response.data.link) {
      const driverDataResponse = await instance.get(response.data.link);
      console.log('Driver data response:', JSON.stringify(driverDataResponse.data, null, 2));

      const drivers = Array.isArray(driverDataResponse.data) ? driverDataResponse.data : [];

      console.log('Drivers found:', JSON.stringify(drivers, null, 2));

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

async function getOfficialRaces(page = 1, limit = 10) {
  try {
    console.log(`Getting official races: page ${page}, limit ${limit}`);
    
    // Check if we have recent data in Supabase
    console.log('Checking Supabase for cached races');
    const { data: cachedRaces, error: cacheError } = await supabase
      .from('official_races')
      .select('*')
      .order('start_time', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    if (cacheError) {
      console.error('Error fetching cached races from Supabase:', cacheError);
      throw cacheError;
    }

    if (cachedRaces && cachedRaces.length > 0) {
      console.log(`Found ${cachedRaces.length} cached races`);
      // Check if the cached data is recent (e.g., less than 5 minutes old)
      const mostRecentUpdate = new Date(Math.max(...cachedRaces.map(race => new Date(race.updated_at))));
      if (new Date() - mostRecentUpdate < 5 * 60 * 1000) {
        console.log('Returning cached race data from Supabase');
        return {
          races: cachedRaces,
          total: await getTotalRacesCount(),
          page: page,
          limit: limit
        };
      }
    }

    console.log('Fetching fresh race data from iRacing API');
    const races = await fetchRacesFromIRacingAPI();

    console.log('Updating Supabase with new race data');
    for (const race of races) {
      const { error } = await supabase
        .from('official_races')
        .upsert(race, { onConflict: 'id' });

      if (error) {
        console.error('Error upserting race:', error);
        console.error('Problematic race data:', race);
      }
    }

    // Fetch paginated results from Supabase
    const { data: paginatedRaces, error: fetchError, count } = await supabase
      .from('official_races')
      .select('*', { count: 'exact' })
      .order('start_time', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    if (fetchError) {
      throw fetchError;
    }

    return {
      races: paginatedRaces,
      total: count,
      page: page,
      limit: limit
    };
  } catch (error) {
    console.error('Error in getOfficialRaces:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

async function getTotalRacesCount() {
  const { count, error } = await supabase
    .from('official_races')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error getting total race count from Supabase:', error);
    throw error;
  }
  return count;
}

async function fetchRacesFromIRacingAPI() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    console.log('Fetching seasons data from iRacing API');
    const seasonsResponse = await instance.get(`${BASE_URL}/data/series/seasons`, {
      headers: {
        'Cookie': cookieString
      }
    });

    if (!seasonsResponse.data || !seasonsResponse.data.link) {
      throw new Error('Invalid seasons response from iRacing API');
    }

    console.log('Fetching detailed seasons data');
    const seasonsDataResponse = await instance.get(seasonsResponse.data.link);
    const currentSeasons = seasonsDataResponse.data;

    console.log('Fetching race guide data from iRacing API');
    const raceGuideResponse = await instance.get(`${BASE_URL}/data/season/race_guide`, {
      headers: {
        'Cookie': cookieString
      }
    });

    if (!raceGuideResponse.data || !raceGuideResponse.data.link) {
      throw new Error('Invalid race guide response from iRacing API');
    }

    console.log('Fetching detailed race guide data');
    const raceGuideDataResponse = await instance.get(raceGuideResponse.data.link);
    const raceGuide = raceGuideDataResponse.data;

    console.log('Processing race data');
    const officialRaces = raceGuide.sessions
      .filter(session => session.licenselevel !== null)
      .map(session => {
        const seasonInfo = currentSeasons.find(season => season.season_id === session.season_id);
        console.log('Processing session:', JSON.stringify(session, null, 2));
        return {
          id: session.subsession_id || session.session_id,
          season_id: session.season_id,
          series_id: session.series_id,
          race_week_num: session.race_week_num,
          session_id: session.session_id,
          super_session: session.super_session,
          entry_count: session.entry_count,
          name: seasonInfo ? seasonInfo.series_name : 'Unknown Series',
          start_time: session.start_time,
          end_time: session.end_time,
          duration: session.end_time ? 
            (new Date(session.end_time) - new Date(session.start_time)) / 60000 + ' minutes' : 
            'Unknown duration',
          license_level: session.licenselevel,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    console.log(`Processed ${officialRaces.length} official races`);
    return officialRaces;
  } catch (error) {
    console.error('Error fetching races from iRacing API:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

export {
  login,
  verifyAuth,
  searchIRacingName,
  getOfficialRaces
};