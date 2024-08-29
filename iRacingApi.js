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
      throw new Error('No cookies in response');
    }
  } catch (error) {
    console.error('Login failed:', error.message);
    return false;
  }
}

async function verifyAuth() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/doc`, {
      headers: {
        'Cookie': cookieString
      }
    });

    return response.status === 200;
  } catch (error) {
    console.error('Auth verification failed:', error.message);
    return false;
  }
}

function calculateRaceState(raceStartTime) {
  const currentTime = new Date();
  const minutesDifference = (new Date(raceStartTime) - currentTime) / (1000 * 60);

  if (minutesDifference <= 0) return 'Racing';
  if (minutesDifference <= 15) return 'Qualifying';
  if (minutesDifference <= 45) return 'Practice';
  return 'Scheduled';
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

async function fetchTrackDataFromSupabase(trackId) {
  try {
    const { data: trackData, error } = await supabase
      .from('tracks')
      .select('track_name')
      .eq('track_id', trackId)
      .single();

    if (error) {
      console.error(`Error fetching track data for track ID ${trackId}:`, error.message);
      return 'Unknown Track';
    }

    return trackData.track_name || 'Unknown Track';
  } catch (error) {
    console.error('Error fetching track data from Supabase:', error.message);
    return 'Unknown Track';
  }
}

async function fetchCarData() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/car/get`, {
      headers: { 'Cookie': cookieString }
    });

    if (response.data && response.data.link) {
      const carDataResponse = await instance.get(response.data.link);
      return carDataResponse.data;
    } else {
      throw new Error('Invalid car data response from iRacing API');
    }
  } catch (error) {
    console.error('Error fetching car data:', error.message);
    throw error;
  }
}

const carClassMap = {
  1: 'Oval',
  2: 'Unknown',
  3: 'Dirt Oval',
  4: 'Dirt Road',
  5: 'Sports Car',
  6: 'Formula'
};

async function processRaceData(raceData, seriesData, carData) {
  const processedRaces = await Promise.all(raceData.map(async race => {
    const series = seriesData.find(s => s.series_id === race.series_id);

    // Fetch track name from Supabase using track_id
    const trackName = await fetchTrackDataFromSupabase(race.track.track_id);

    const state = calculateRaceState(race.start_time);

    let availableCars = [];
    if (series && series.car_class_ids) {
      availableCars = series.car_class_ids.flatMap(classId => 
        carData.filter(car => car.car_class_id === classId)
      ).map(car => car.car_name);
    }

    return {
      title: series ? series.series_name : 'Unknown Series',
      start_time: race.start_time,
      track_name: trackName,
      state: state,
      license_level: series ? series.allowed_licenses[0].group_name : 'Unknown',
      car_class: series ? series.category_id : 0,
      car_class_name: carClassMap[series ? series.category_id : 0] || 'Unknown',
      number_of_racers: race.entry_count || 0,
      series_id: race.series_id,
      available_cars: availableCars
    };
  }));

  return processedRaces
    .filter(race => race.state === 'Qualifying' || race.state === 'Practice')
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
}

async function fetchRacesFromIRacingAPI() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const raceGuideResponse = await instance.get(`${BASE_URL}/data/season/race_guide`, {
      headers: { 'Cookie': cookieString }
    });

    if (!raceGuideResponse.data || !raceGuideResponse.data.link) {
      throw new Error('Invalid race guide response from iRacing API');
    }

    const raceGuideDataResponse = await instance.get(raceGuideResponse.data.link);
    const raceGuide = raceGuideDataResponse.data;

    const seriesData = await fetchSeriesData();
    const carData = await fetchCarData();

    return await processRaceData(raceGuide.sessions, seriesData, carData);
  } catch (error) {
    console.error('Error fetching races from iRacing API:', error.message);
    throw error;
  }
}

async function getOfficialRaces(userId, page = 1, limit = 10) {
  try {
    page = Math.max(1, page);

    const freshRaces = await fetchRacesFromIRacingAPI();

    if (freshRaces.length > 0) {
      for (const race of freshRaces) {
        const { data: upsertData, error: upsertError } = await supabase
          .from('official_races')
          .upsert({
            title: race.title,
            start_time: race.start_time,
            track_name: race.track_name,
            state: race.state,
            license_level: race.license_level,
            car_class: race.car_class,
            number_of_racers: race.number_of_racers,
            series_id: race.series_id
          }, {
            onConflict: 'series_id,start_time',
            ignoreDuplicates: false
          });

        if (upsertError) console.error('Error upserting race:', upsertError);

        for (const car of race.available_cars) {
          const { error: carError } = await supabase
            .from('available_cars')
            .upsert({
              race_id: upsertData[0].id,
              car_name: car
            });

          if (carError) console.error('Error inserting available car:', carError);
        }
      }
    }

    const totalRaces = freshRaces.length;
    const paginatedRaces = freshRaces.slice((page - 1) * limit, page * limit);

    return {
      races: paginatedRaces,
      total: totalRaces,
      page: page,
      limit: limit
    };
  } catch (error) {
    console.error('Error in getOfficialRaces:', error.message);
    throw error;
  }
}

async function searchIRacingName(name) {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/lookup/drivers`, {
      params: { search_term: name, lowerbound: 1, upperbound: 25 },
      headers: { 'Cookie': cookieString }
    });

    if (response.data && response.data.link) {
      const driverDataResponse = await instance.get(response.data.link);
      const drivers = Array.isArray(driverDataResponse.data) ? driverDataResponse.data : [];

      const matchingDriver = drivers.find(driver => 
        driver.display_name.toLowerCase() === name.toLowerCase() ||
        driver.display_name.toLowerCase().includes(name.toLowerCase())
      );

      if (matchingDriver) {
        return { exists: true, name: matchingDriver.display_name, id: matchingDriver.cust_id };
      }
    }

    return { exists: false };
  } catch (error) {
    console.error('Error searching for iRacing name:', error.message);
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

// Periodic re-authentication
const RE_AUTH_INTERVAL = 30 * 60 * 1000; // 30 minutes

async function periodicReAuth() {
  try {
    const isAuthenticated = await verifyAuth();
    if (!isAuthenticated) {
      await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD);
    }
  } catch (error) {
    console.error('Error during periodic re-authentication:', error);
  }
}

setInterval(periodicReAuth, RE_AUTH_INTERVAL);

// Initialize authentication on module load
(async () => {
  try {
    await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD);
  } catch (error) {
    console.error('Initial authentication failed:', error);
  }
})();

export {
  login,
  verifyAuth,
  searchIRacingName,
  getOfficialRaces,
  getTotalRacesCount
};
