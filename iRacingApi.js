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
  const hashedPassword = hashPassword(password, email);

  try {
    const response = await instance.post(`${BASE_URL}/auth`, {
      email,
      password: hashedPassword
    }, {
      headers: {
        'Content-Type': 'application/json' // Set the content type to JSON
      }
    });

    if (response.headers['set-cookie']) {
      response.headers['set-cookie'].forEach(cookie => {
        cookieJar.setCookieSync(cookie, BASE_URL);
      });
      console.log('Cookies set:', await cookieJar.getCookies(BASE_URL));
      return true; // Return true indicating successful login
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

/**
 * This function calculates the custom state for a race based on the start time.
 * 
 * @param {Date} raceStartTime - The start time of the race.
 * @returns {string} - The state of the race ('Scheduled', 'Practice', 'Qualifying', 'Racing').
 */
function calculateRaceState(raceStartTime) {
  const currentTime = new Date();
  const timeDifference = raceStartTime - currentTime;

  if (timeDifference <= 0) {
    return 'Racing'; // Race has started
  } else if (timeDifference <= 15 * 60 * 1000) {
    return 'Qualifying'; // Within 15 minutes of the start time
  } else if (timeDifference <= 45 * 60 * 1000) {
    return 'Practice'; // Between 45 and 15 minutes before the start time
  } else {
    return 'Scheduled'; // More than 45 minutes before the start time
  }
}

/**
 * This function fetches race data from the iRacing API, processes it, and returns a list of official races.
 * It performs an API call to retrieve race guide data, and then filters and processes the data.
 * 
 * @returns {Array<Object>} - Returns an array of official race objects with only the required fields.
 */
async function fetchRacesFromIRacingAPI() {
  try {
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    console.log('Fetching race guide data from iRacing API');
    const raceGuideResponse = await instance.get(`${BASE_URL}/data/season/race_guide`, {
      headers: { 'Cookie': cookieString }
    });

    console.log('Race guide response:', JSON.stringify(raceGuideResponse.data, null, 2));

    if (!raceGuideResponse.data || !raceGuideResponse.data.link) {
      throw new Error('Invalid race guide response from iRacing API');
    }

    const raceGuideDataResponse = await instance.get(raceGuideResponse.data.link);
    console.log('Race guide data response:', JSON.stringify(raceGuideDataResponse.data, null, 2));

    const raceGuide = raceGuideDataResponse.data;

    console.log('Processing race data');
    const officialRaces = raceGuide.sessions
      .filter(session => session.license_group !== null)
      .map(session => {
        const raceStartTime = new Date(session.start_time);
        return {
          series_name: session.series_name || 'Unknown Series', // Use `series_name` instead of `title`
          start_time: session.start_time,
          track_name: session.track ? session.track.track_name : 'Unknown Track',
          state: calculateRaceState(raceStartTime),
          license_level: session.license_level || 1,
          car_class: session.car_class || 1,
          number_of_racers: session.num_drivers || 0 // Assuming `num_drivers` is the field representing the number of racers
        };
      })
      .filter(race => race.state === 'Qualifying' || race.state === 'Practice'); // Filter only for Qualifying and Practice states

    console.log(`Processed ${officialRaces.length} official races`);
    return officialRaces;
  } catch (error) {
    console.error('Error fetching races from iRacing API:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
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
      .select('series_name, start_time, track_name, state, license_level, car_class, number_of_racers', { count: 'exact' })
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

/**
 * This function searches for a driver's name in the iRacing API.
 * It sends a request to the API with the search term and returns information about the driver if found.
 * 
 * @param {string} name - The name of the driver to search for.
 * @returns {Object} - An object containing the driver's information if found, or a message if not found.
 */
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
  getOfficialRaces,
  getTotalRacesCount
};

