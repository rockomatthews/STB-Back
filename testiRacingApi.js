require('dotenv').config();
const { login, verifyAuth } = require('./iRacingApi');

async function testApi() {
  console.log('Testing iRacing API...');

  const email = process.env.IRACING_EMAIL;
  const password = process.env.IRACING_PASSWORD;

  if (!email || !password) {
    console.error('Please set IRACING_EMAIL and IRACING_PASSWORD in your .env file');
    return;
  }

  console.log('Attempting to login...');
  const loginSuccess = await login(email, password);

  if (loginSuccess) {
    console.log('Login successful');

    console.log('Waiting 2 seconds before verifying authentication...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Verifying authentication...');
    const authVerified = await verifyAuth();

    if (authVerified) {
      console.log('Authentication verified');
    } else {
      console.log('Authentication verification failed');
    }
  } else {
    console.log('Login failed');
  }
}

testApi();