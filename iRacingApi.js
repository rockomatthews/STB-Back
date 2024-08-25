import axios from 'axios'; // Import the Axios library to make HTTP requests
import crypto from 'crypto'; // Import the Crypto library for password hashing
import https from 'https'; // Import HTTPS module to manage SSL settings
import tough from 'tough-cookie'; // Import tough-cookie to manage cookies
import { createClient } from '@supabase/supabase-js'; // Import Supabase client to interact with the database
import dotenv from 'dotenv'; // Import dotenv to load environment variables

// Load environment variables from a .env file into process.env
dotenv.config();

// Import the CookieJar class from tough-cookie, which allows us to manage and store cookies
const { CookieJar } = tough;

// Define the base URL for the iRacing API
const BASE_URL = 'https://members-ng.iracing.com';

// Create a new instance of a cookie jar to store cookies from the iRacing API
const cookieJar = new CookieJar();

// Create an Axios instance with specific configuration
// This instance will be used to make HTTP requests to the iRacing API
const instance = axios.create({
  httpsAgent: new https.Agent({  
    rejectUnauthorized: false // Disable SSL certificate validation (not recommended for production)
  })
});

// Initialize Supabase client using the environment variables for URL and Anon Key
// Supabase is used for managing the database where race data is stored
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Check if the necessary environment variables for Supabase are set
// If not, throw an error to prevent the application from running with incorrect configuration
if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL or Anon Key is not set in environment variables');
}

// Create a Supabase client instance
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * This function hashes a password combined with the user's email using the SHA-256 algorithm.
 * The result is then encoded in Base64. This is required for authentication with the iRacing API.
 * 
 * @param {string} password - The user's password.
 * @param {string} email - The user's email.
 * @returns {string} - The Base64 encoded hash of the password and email.
 */
function hashPassword(password, email) {
  const hash = crypto.createHash('sha256'); // Create a SHA-256 hash object
  hash.update(password + email.toLowerCase()); // Update the hash with the password and email
  return hash.digest('base64'); // Return the Base64 encoded hash
}

/**
 * This function handles the login process to the iRacing API.
 * It hashes the password using the hashPassword function and then sends a POST request to the iRacing API.
 * If the login is successful, the cookies received from the API are stored in the cookie jar.
 * 
 * @param {string} email - The user's email address for iRacing.
 * @param {string} password - The user's password for iRacing.
 * @returns {boolean} - Returns true if the login is successful, false otherwise.
 */
async function login(email, password) {
  // Hash the password with the user's email
  const hashedPassword = hashPassword(password, email);

  try {
    // Send a POST request to the iRacing API to authenticate the user
    const response = await instance.post(`${BASE_URL}/auth`, {
      email,
      password: hashedPassword
    }, {
      headers: {
        'Content-Type': 'application/json' // Set the content type to JSON
      }
    });

    // Check if the response contains cookies
    if (response.headers['set-cookie']) {
      // If cookies are present, store them in the cookie jar
      response.headers['set-cookie'].forEach(cookie => {
        cookieJar.setCookieSync(cookie, BASE_URL);
      });
      console.log('Cookies set:', await cookieJar.getCookies(BASE_URL));
      return true; // Return true indicating successful login
    } else {
      // If no cookies are found in the response, log the headers and data for debugging
      console.error('No cookies in response');
      console.log('Response headers:', response.headers);
      console.log('Response data:', response.data);
      throw new Error('No cookies in response'); // Throw an error for missing cookies
    }
  } catch (error) {
    // Log any errors that occur during the login process
    console.error('Login failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return false; // Return false indicating failed login
  }
}

/**
 * This function verifies whether the current session is authenticated by making a request to the iRacing API.
 * The cookies stored in the cookie jar are sent with the request to validate the session.
 * 
 * @returns {boolean} - Returns true if the session is authenticated, false otherwise.
 */
async function verifyAuth() {
  try {
    // Retrieve cookies from the cookie jar
    const cookies = await cookieJar.getCookies(BASE_URL);
    // Convert the cookies into a string format suitable for the Cookie header
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');
    
    console.log('Verifying auth with cookies:', cookieString);

    // Send a GET request to verify the authentication status
    const response = await instance.get(`${BASE_URL}/data/doc`, {
      headers: {
        'Cookie': cookieString
      }
    });

    console.log('Verification response status:', response.status);
    return response.status === 200; // Return true if the status is 200 (OK)
  } catch (error) {
    // Log any errors that occur during the authentication verification process
    console.error('Auth verification failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return false; // Return false indicating failed authentication
  }
}

/**
 * This function fetches race data from the iRacing API, processes it, and returns a list of official races.
 * It performs several API calls to retrieve series seasons and race guide data, and then filters and processes the data.
 * 
 * @returns {Array<Object>} - Returns an array of official race objects.
 */
async function fetchRacesFromIRacingAPI() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    console.log('Fetching series seasons data from iRacing API');
    const seasonsResponse = await instance.get(`${BASE_URL}/data/series/seasons`, {
      params: { include_series: true },
      headers: { 'Cookie': cookieString }
    });

    if (!seasonsResponse.data || !seasonsResponse.data.link) {
      throw new Error('Invalid seasons response from iRacing API');
    }

    const seasonsDataResponse = await instance.get(seasonsResponse.data.link);
    const seriesSeasons = seasonsDataResponse.data;

    console.log('Fetching race guide data from iRacing API');
    const raceGuideResponse = await instance.get(`${BASE_URL}/data/season/race_guide`, {
      headers: { 'Cookie': cookieString }
    });

    if (!raceGuideResponse.data || !raceGuideResponse.data.link) {
      throw new Error('Invalid race guide response from iRacing API');
    }

    const raceGuideDataResponse = await instance.get(raceGuideResponse.data.link);
    const raceGuide = raceGuideDataResponse.data;

    console.log('Processing race data');
    // Process the race guide data with minimal filtering
    const officialRaces = raceGuide.sessions.map(session => {
      const seriesSeason = seriesSeasons.find(season => season.season_id === session.season_id);
      return {
        id: session.subsession_id,
        season_id: session.season_id,
        series_id: seriesSeason ? seriesSeason.series_id : null,
        race_week_num: session.race_week_num,
        session_id: session.session_id,
        license_group: session.license_group,
        name: seriesSeason ? seriesSeason.series_name : 'Unknown Series',
        start_time: session.start_time,
        end_time: calculateEndTime(session),
        track_name: session.track ? session.track.track_name : 'Unknown Track',
        category_id: seriesSeason ? seriesSeason.category_id : null,
        state: session.state,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    console.log(`Processed ${officialRaces.length} official races`);
    return officialRaces;
  } catch (error) {
    console.error('Error fetching races from iRacing API:', error.message);
    throw error;
  }
}


/**
 * This function calculates the end time for a race session based on its start time and duration.
 * It estimates the duration if it's not explicitly provided.
 * 
 * @param {Object} session - The race session object containing start time and possible duration fields.
 * @returns {string} - The calculated end time in ISO format.
 */
function calculateEndTime(session) {
  // If the session already has an end time, return it
  if (session.end_time) return session.end_time;
  
  // Calculate the start time as a Date object
  const startTime = new Date(session.start_time);
  let duration = 0;
  
  // Estimate the duration based on lap limit or time limit
  if (session.race_lap_limit) {
    duration = session.race_lap_limit * 2; // Estimate 2 minutes per lap
  } else if (session.race_time_limit) {
    duration = session.race_time_limit;
  }
  
  // Calculate the end time by adding the duration to the start time
  return new Date(startTime.getTime() + duration * 60000).toISOString();
}

/**
 * This function retrieves a list of official races from the database (Supabase), 
 * and optionally fetches fresh data from the iRacing API if necessary.
 * It handles pagination and limits the number of races returned.
 * 
 * @param {number} page - The page number for pagination (default is 1).
 * @param {number} limit - The maximum number of races to return (default is 10).
 * @returns {Object} - An object containing the list of races, total count, page, and limit.
 */
async function getOfficialRaces(page = 1, limit = 10) {
  try {
    console.log(`Getting official races: page ${page}, limit ${limit}`);
    
    // Ensure page is at least 1
    page = Math.max(1, page);

    // Fetch fresh race data from iRacing API
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

    // Fetch races from Supabase
    console.log('Fetching races from Supabase');
    const { data: races, error: fetchError, count } = await supabase
      .from('official_races')
      .select('*', { count: 'exact' })
      .order('start_time', { ascending: true }) // Closest start time first
      .range((page - 1) * limit, page * limit - 1);

    if (fetchError) {
      console.error('Error fetching races from Supabase:', fetchError);
      throw fetchError;
    }

    console.log(`Fetched ${races ? races.length : 0} races, total count: ${count || 0}`);

    // Log the actual data returned from Supabase
    console.log('Races data from Supabase:', JSON.stringify(races, null, 2));

    return {
      races: races || [],
      total: count || 0,
      page: page,
      limit: limit
    };
  } catch (error) {
    // Log any errors that occur during the race fetching process
    console.error('Error in getOfficialRaces:', error.message);
    console.error('Error stack:', error.stack);
    throw error; // Re-throw the error to be handled by the calling function
  }
}

/**
 * This function searches for a driver's name in the iRacing API.
 * It sends a request to the API with the search term and returns information about the driver if found.
 * 
 * @param {string} name - The name of the driver to search for.
 * @returns {Object} - An object containing the driver's information if found, or a message if not found.
 */
async function searchIRacingName(name) {
  try {
    // Retrieve cookies from the cookie jar
    const cookies = await cookieJar.getCookies(BASE_URL);
    // Convert the cookies into a string format suitable for the Cookie header
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    // Send a GET request to search for the driver's name in the iRacing API
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

    // Check if the response contains a link to the driver's data
    if (response.data && response.data.link) {
      // Fetch detailed driver data from the link provided in the previous response
      const driverDataResponse = await instance.get(response.data.link);
      console.log('Driver data response:', JSON.stringify(driverDataResponse.data, null, 2));

      const drivers = Array.isArray(driverDataResponse.data) ? driverDataResponse.data : [];

      console.log('Drivers found:', JSON.stringify(drivers, null, 2));

      if (drivers.length > 0) {
        // Find the driver that matches the search term
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
    // Log any errors that occur during the driver search process
    console.error('Error searching for iRacing name:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error; // Re-throw the error to be handled by the calling function
  }
}

/**
 * This function retrieves the total count of official races stored in Supabase.
 * 
 * @returns {number} - The total number of official races in the database.
 */
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

// Export the functions so they can be used in other parts of the application
export {
  login,
  verifyAuth,
  searchIRacingName,
  getOfficialRaces
};
