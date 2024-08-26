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
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

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
      password: hashedPassword,
    }, {
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Cookie': cookieString },
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

function calculateRaceState(raceStartTime) {
  const currentTime = new Date();
  const timeDifference = raceStartTime - currentTime;

  if (timeDifference <= 0) {
    return 'Racing';
  } else if (timeDifference <= 15 * 60 * 1000) {
    return 'Qualifying';
  } else if (timeDifference <= 45 * 60 * 1000) {
    return 'Practice';
  } else {
    return 'Scheduled';
  }
}

async function fetchSeriesName(series_id) {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/series/get`, {
      headers: { 'Cookie': cookieString },
      params: { series_id: series_id },
    });

    return response.data.series_name || 'Unknown Series';
  } catch (error) {
    console.error(`Error fetching series name for series_id ${series_id}:`, error.message);
    return 'Unknown Series';
  }
}

async function fetchTrackName(track_id) {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/track/get`, {
      headers: { 'Cookie': cookieString },
      params: { track_id: track_id },
    });

    return response.data.track_name || 'Unknown Track';
  } catch (error) {
    console.error(`Error fetching track name for track_id ${track_id}:`, error.message);
    return 'Unknown Track';
  }
}

async function processRaceData(raceData) {
  const processedRaces = await Promise.all(raceData.map(async race => {
    const seriesName = await fetchSeriesName(race.series_id);
    const trackName = race.track ? await fetchTrackName(race.track.track_id) : 'Unknown Track';
    const state = calculateRaceState(new Date(race.start_time));

    return {
      title: seriesName,
      start_time: race.start_time,
      track_name: trackName,
      state: state,
      license_level: race.license_level || 1,
      car_class: race.car_class || 1,
      number_of_racers: race.entry_count || 0,
    };
  }));

  return processedRaces.filter(race => race.state === 'Qualifying' || race.state === 'Practice');
}

async function fetchRacesFromIRacingAPI() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    console.log('Fetching race guide data from iRacing API');
    const raceGuideResponse = await instance.get(`${BASE_URL}/data/season/race_guide`, {
      headers: { 'Cookie': cookieString },
    });

    console.log('Race guide response:', JSON.stringify(raceGuideResponse.data, null, 2));

    if (!raceGuideResponse.data || !raceGuideResponse.data.link) {
      throw new Error('Invalid race guide response from iRacing API');
    }

    const raceGuideDataResponse = await instance.get(raceGuideResponse.data.link);
    console.log('Race guide data response:', JSON.stringify(raceGuideDataResponse.data, null, 2));

    const raceGuide = raceGuideDataResponse.data;

    console.log('Processing race data');
    const officialRaces = await processRaceData(raceGuide.sessions.slice(0, 10));

    console.log(`Processed ${officialRaces.length} official races`);
    return officialRaces;
  } catch (error) {
    console.error('Error fetching races from iRacing API:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

async function getOfficialRaces(page = 1, limit = 10) {
  try {
    console.log(`Getting official races: page ${page}, limit ${limit}`);
    
    page = Math.max(1, page);

    console.log('Fetching fresh race data from iRacing API');
    const freshRaces = await fetchRacesFromIRacingAPI();
    
    if (freshRaces.length > 0) {
      console.log('Updating Supabase with new race data');
      const { error: upsertError } = await supabase
        .from('official_races')
        .upsert(freshRaces, { onConflict: 'id' });

      if (upsertError) {
        console.error('Error upserting races:', upsertError);
      } else {
        console.log(`Successfully upserted ${freshRaces.length} races to Supabase`);
      }
    }

    console.log('Fetching races from Supabase');
    const { data: races, error: fetchError, count } = await supabase
      .from('official_races')
      .select('title, start_time, track_name, state, license_level, car_class, number_of_racers', { count: 'exact' })
      .order('start_time', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    if (fetchError) {
      console.error('Error fetching races from Supabase:', fetchError);
      throw fetchError;
    }

    console.log(`Fetched ${races ? races.length : 0} races, total count: ${count || 0}`);

    console.log('Races data from Supabase:', JSON.stringify(races, null, 2));

    return {
      races: races || [],
      total: count || 0,
      page: page,
      limit: limit
    };
  } catch (error) {
    console.error('Error in getOfficialRaces:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
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
      headers: { 'Cookie': cookieString }
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

export {
  login,
  verifyAuth,
  searchIRacingName,
  getOfficialRaces,
  getTotalRacesCount
};
