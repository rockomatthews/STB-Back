import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import tough from 'tough-cookie';
import { createClient } from '@supabase/supabase-js';
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

function calculateRaceState(raceStartTime) {
  const currentTime = new Date();
  const timeDifference = new Date(raceStartTime) - currentTime;
  const minutesDifference = timeDifference / (1000 * 60);

  if (minutesDifference <= 0) {
    return 'Racing';
  } else if (minutesDifference <= 15) {
    return 'Qualifying';
  } else if (minutesDifference <= 45) {
    return 'Practice';
  } else {
    return 'Scheduled';
  }
}

async function fetchSeriesData() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/series/get`, {
      headers: { 'Cookie': cookieString }
    });

    if (response.data && response.data.link) {
      const seriesDataResponse = await instance.get(response.data.link);
      return seriesDataResponse.data;
    } else {
      throw new Error('Invalid series data response from iRacing API');
    }
  } catch (error) {
    console.error('Error fetching series data:', error.message);
    throw error;
  }
}

async function fetchTrackData() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/track/get`, {
      headers: { 'Cookie': cookieString }
    });

    if (response.data && response.data.link) {
      const trackDataResponse = await instance.get(response.data.link);
      return trackDataResponse.data;
    } else {
      throw new Error('Invalid track data response from iRacing API');
    }
  } catch (error) {
    console.error('Error fetching track data:', error.message);
    throw error;
  }
}

async function processRaceData(raceData, seriesData, trackData) {
  console.log('Sample raw race data:', JSON.stringify(raceData[0], null, 2));
  console.log('Sample series data:', JSON.stringify(seriesData[0], null, 2));
  console.log('Sample track data:', JSON.stringify(trackData[0], null, 2));

  return raceData.map(race => {
    const series = seriesData.find(s => s.series_id === race.series_id);
    const track = race.track && race.track.track_id 
      ? trackData.find(t => t.track_id === race.track.track_id)
      : null;
    const state = calculateRaceState(race.start_time);

    const processedRace = {
      title: series ? series.series_name : 'Unknown Series',
      start_time: race.start_time,
      track_name: track ? track.track_name : 'Unknown Track',
      state: state,
      license_level: series ? series.allowed_licenses[0].group_name : 'Unknown',
      car_class: series ? series.category_id : 0, // Use category_id instead of category
      number_of_racers: race.entry_count || 0,
      series_id: race.series_id
    };

    console.log('Processed race:', JSON.stringify(processedRace, null, 2));
    return processedRace;
  }).filter(race => race.state === 'Qualifying' || race.state === 'Practice')
    .sort((a, b) => {
      if (a.state === b.state) {
        return new Date(a.start_time) - new Date(b.start_time);
      }
      return a.state === 'Qualifying' ? -1 : 1;
    });
}

async function fetchRacesFromIRacingAPI() {
  console.log('fetchRacesFromIRacingAPI called');
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    console.log('Fetching race guide data from iRacing API');
    const raceGuideResponse = await instance.get(`${BASE_URL}/data/season/race_guide`, {
      headers: { 'Cookie': cookieString }
    });

    if (!raceGuideResponse.data || !raceGuideResponse.data.link) {
      console.error('Invalid race guide response:', raceGuideResponse.data);
      throw new Error('Invalid race guide response from iRacing API');
    }

    const raceGuideDataResponse = await instance.get(raceGuideResponse.data.link);
    const raceGuide = raceGuideDataResponse.data;

    console.log('Fetching series data');
    const seriesData = await fetchSeriesData();
    console.log(`Fetched ${seriesData.length} series`);

    console.log('Fetching track data');
    const trackData = await fetchTrackData();
    console.log(`Fetched ${trackData.length} tracks`);

    console.log('Processing race data');
    console.log(`Total races to process: ${raceGuide.sessions.length}`);
    
    const officialRaces = await processRaceData(raceGuide.sessions, seriesData, trackData);

    console.log(`Processed ${officialRaces.length} official races`);
    return officialRaces;
  } catch (error) {
    console.error('Error fetching races from iRacing API:', error.message);
    console.error('Error stack:', error.stack);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    throw error;
  }
}

async function getOfficialRaces(userId, page = 1, limit = 10) {
  try {
    console.log(`Getting official races: page ${page}, limit ${limit}`);

    page = Math.max(1, page);

    console.log('Fetching fresh race data from iRacing API');
    const freshRaces = await fetchRacesFromIRacingAPI();

    if (freshRaces.length > 0) {
      console.log('Updating Supabase with new race data');
      console.log('Sample race data being upserted:', JSON.stringify(freshRaces[0], null, 2));

      const { data: upsertData, error: upsertError } = await supabase
        .from('official_races')
        .upsert(freshRaces.map(race => ({
          title: race.title,
          start_time: race.start_time,
          track_name: race.track_name,
          state: race.state,
          license_level: race.license_level,
          car_class: race.car_class,
          number_of_racers: race.number_of_racers,
          series_id: race.series_id
        })), {
          onConflict: 'series_id,start_time',
          ignoreDuplicates: false
        });

      if (upsertError) {
        console.error('Error upserting races:', upsertError);
      } else {
        console.log(`Successfully upserted ${freshRaces.length} races to Supabase`);
        console.log('Upsert response data:', JSON.stringify(upsertData, null, 2));
      }
    }

    console.log('Fetching races from Supabase');
    const { data: races, error: fetchError, count } = await supabase
      .from('official_races')
      .select('*', { count: 'exact' })
      .or('state.eq.Qualifying,state.eq.Practice')
      .order('state', { ascending: true })
      .order('start_time', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    if (fetchError) {
      console.error('Error fetching races from Supabase:', fetchError);
      throw fetchError;
    }

    console.log(`Fetched ${races ? races.length : 0} races, total count: ${count || 0}`);
    console.log('Sample race data from Supabase:', JSON.stringify(races[0], null, 2));

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