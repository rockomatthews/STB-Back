import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import tough from 'tough-cookie';
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
    const cookies = await cookieJar.getCookies(BASE_URL);
    const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

    const response = await instance.get(`${BASE_URL}/data/series/seasons`, {
      headers: {
        'Cookie': cookieString
      }
    });

    if (response.data && response.data.link) {
      const racesDataResponse = await instance.get(response.data.link);
      const allRaces = Array.isArray(racesDataResponse.data) ? racesDataResponse.data : [];

      // Filter for official races and sort by start time
      const officialRaces = allRaces
        .filter(race => race.official)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

      // Implement pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedRaces = officialRaces.slice(startIndex, endIndex);

      // Format the race data
      const formattedRaces = paginatedRaces.map(race => ({
        id: race.season_id,
        name: race.series_name,
        track: race.track?.track_name || 'Unknown Track',
        start_time: race.start_time,
        duration: race.race_week_length,
        car_class: race.car_class?.name || 'Unknown Class',
        license_level: race.license_group
      }));

      return {
        races: formattedRaces,
        total: officialRaces.length,
        page: page,
        limit: limit
      };
    }

    return { races: [], total: 0, page: page, limit: limit };
  } catch (error) {
    console.error('Error fetching official races:', error.message);
    throw error;
  }
}

export {
  login,
  verifyAuth,
  searchIRacingName,
  getOfficialRaces
};