import axios from 'axios';
import https from 'https';
import tough from 'tough-cookie';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from the .env file
dotenv.config();

// Destructure tough's CookieJar class to manage cookies for axios requests
const { CookieJar } = tough;

// Define the base URL for iRacing's API
const BASE_URL = 'https://members-ng.iracing.com';

// Instantiate a new CookieJar to store and manage cookies
const cookieJar = new CookieJar();

// Create an axios instance with custom configurations
// The httpsAgent allows self-signed certificates, avoiding SSL errors
const instance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

// Retrieve Supabase URL and Anon Key from environment variables
// These are essential for interacting with the Supabase database
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Ensure that both the Supabase URL and Anon Key are present
// If not, throw an error to prevent further execution
if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL or Anon Key is not set in environment variables');
}

// Initialize the Supabase client using the URL and Key from the environment
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Logs in to iRacing by sending a POST request to the auth endpoint.
 * If successful, the response contains cookies that are stored in the CookieJar.
 * 
 * @param {string} email - The user's email.
 * @param {string} password - The user's password.
 * @returns {boolean} - Returns true if login was successful, otherwise false.
 */
async function login(email, password) {
  try {
    // Send a POST request to iRacing's auth endpoint with the user's credentials
    const response = await instance.post(`${BASE_URL}/auth`, {
      email,
      password
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // If the response contains cookies, store them in the CookieJar
    if (response.headers['set-cookie']) {
      response.headers['set-cookie'].forEach(cookie => {
        cookieJar.setCookieSync(cookie, BASE_URL);
      });
      console.log('Cookies set:', await cookieJar.getCookies(BASE_URL));
      return true;
    } else {
      console.error('No cookies in response');
      throw new Error('No cookies in response');
    }
  } catch (error) {
    console.error('Login failed:', error.message);
    return false;
  }
}

/**
 * Fetches race data from the iRacing API's race guide endpoint.
 * The data is processed and returned as an array of race objects.
 * 
 * @returns {Array} - Returns an array of processed race objects.
 */
async function fetchRacesFromIRacingAPI() {
  try {
    // Get cookies from the CookieJar to authenticate the request
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    // Fetch race guide data from iRacing's API
    console.log('Fetching race guide data from iRacing API');
    const raceGuideResponse = await instance.get(`${BASE_URL}/data/season/race_guide`, {
      headers: { 'Cookie': cookieString }
    });

    // Validate the response and extract the data link
    if (!raceGuideResponse.data || !raceGuideResponse.data.link) {
      throw new Error('Invalid race guide response from iRacing API');
    }

    // Fetch the actual race guide data using the provided link
    const raceGuideDataResponse = await instance.get(raceGuideResponse.data.link);
    const raceGuide = raceGuideDataResponse.data;

    console.log('Processing race data');

    // Process the race data and transform it into an array of race objects
    const officialRaces = raceGuide.sessions.map(session => {
      const race = {
        id: session.subsession_id,
        season_id: session.season_id,
        race_week_num: session.race_week_num,
        session_id: session.session_id,
        start_time: session.start_time,
        track_name: session.track ? session.track.track_name : 'Unknown Track',
        state: session.state || 'Unknown State',
        track: session.track ? session.track.config_name : 'Unknown Configuration',
        license_level: session.license_level || 1,
        car_class: session.car_class || 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Check if essential race data is missing
      // If any critical field is missing, log a warning and skip the race
      if (!race.id || !race.season_id || !race.track_name) {
        console.warn('Missing required race data:', race);
        return null;
      }

      return race;
    }).filter(race => race !== null); // Remove races that are incomplete

    console.log(`Processed ${officialRaces.length} official races`);
    return officialRaces;
  } catch (error) {
    console.error('Error fetching races from iRacing API:', error.message);
    throw error;
  }
}

/**
 * Retrieves official races from Supabase.
 * Optionally fetches fresh data from iRacing, upserts it to Supabase, and then returns the data.
 * 
 * @param {number} page - The current page number for pagination.
 * @param {number} limit - The number of races to return per page.
 * @returns {Object} - An object containing the races, total count, page, and limit.
 */
async function getOfficialRaces(page = 1, limit = 10) {
  try {
    console.log(`Getting official races: page ${page}, limit ${limit}`);
    
    // Fetch fresh race data from iRacing
    const freshRaces = await fetchRacesFromIRacingAPI();
    
    // Upsert the fresh race data into Supabase
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

    // Fetch races from Supabase
    console.log('Fetching races from Supabase');
    const { data: races, error: fetchError, count } = await supabase
      .from('official_races')
      .select('*', { count: 'exact' })
      .order('start_time', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    if (fetchError) {
      console.error('Error fetching races from Supabase:', fetchError);
      throw fetchError;
    }

    console.log(`Fetched ${races ? races.length : 0} races, total count: ${count || 0}`);

    return {
      races: races || [],
      total: count || 0,
      page: page,
      limit: limit
    };
  } catch (error) {
    console.error('Error in getOfficialRaces:', error.message);
    throw error;
  }
}

/**
 * Searches for an iRacing driver by name using the iRacing API.
 * The function checks for exact matches and partial matches in the driver's display name.
 * 
 * @param {string} name - The name of the driver to search for.
 * @returns {Object} - An object indicating whether the driver exists, and if so, their name and ID.
 */
async function searchIRacingName(name) {
  try {
    // Get cookies from the CookieJar to authenticate the request
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    // Send a GET request to the driver lookup endpoint with the provided search term
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

    // If the response contains a data link, follow it to get more detailed driver data
    if (response.data && response.data.link) {
      const driverDataResponse = await instance.get(response.data.link);
      console.log('Driver data response:', JSON.stringify(driverDataResponse.data, null, 2));

      // Convert the driver data into an array (if it's not already)
      const drivers = Array.isArray(driverDataResponse.data) ? driverDataResponse.data : [];

      console.log('Drivers found:', JSON.stringify(drivers, null, 2));

      // Look for a matching driver by exact or partial name match
      if (drivers.length > 0) {
        const matchingDriver = drivers.find(driver => 
          driver.display_name.toLowerCase() === name.toLowerCase() ||
          driver.display_name.toLowerCase().includes(name.toLowerCase())
        );

        // If a match is found, return the driver's name and ID
        if (matchingDriver) {
          return {
            exists: true,
            name: matchingDriver.display_name,
            id: matchingDriver.cust_id
          };
        }
      }
    }

    // If no match is found, return an object indicating that the driver doesn't exist
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

// Export the functions so they can be used in other parts of the application
export {
  login,
  getOfficialRaces,
  searchIRacingName
};
