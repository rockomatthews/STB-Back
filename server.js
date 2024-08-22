import React, { useState } from 'react';
import { TextField, Button, Box, Typography, CircularProgress, Paper } from '@mui/material';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import axios from 'axios';

// Replace this with your actual Render.com HTTPS URL
const BACKEND_URL = 'https://stb-back-etjo.onrender.com';

const RealNameSearch = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async () => {
    setIsLoading(true);
    setError(null);
    setSearchResult(null);

    try {
      const response = await axios.get(`${BACKEND_URL}/api/search-iracing-name?name=${encodeURIComponent(searchTerm)}`);
      
      if (response.data.exists) {
        setSearchResult({ name: response.data.name, exists: true });
      } else {
        setSearchResult({ name: searchTerm, exists: false });
      }
    } catch (err) {
      setError('An error occurred while searching. Please try again.');
      console.error('Search error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 400, margin: 'auto', mt: 4 }}>
      <Typography variant="h5" gutterBottom>
        Search iRacing Real Name
      </Typography>
      <Box sx={{ display: 'flex', mb: 2 }}>
        <TextField
          fullWidth
          variant="outlined"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Enter a real name"
        />
        <Button
          variant="contained"
          onClick={handleSearch}
          disabled={isLoading || !searchTerm.trim()}
          sx={{ ml: 1 }}
        >
          Search
        </Button>
      </Box>
      
      {isLoading && <CircularProgress />}
      
      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}
      
      {searchResult && (
        <Paper elevation={3} sx={{ p: 2, mt: 2 }}>
          {searchResult.exists ? (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ flexGrow: 1 }}>{searchResult.name}</Typography>
              <StarBorderIcon />
            </Box>
          ) : (
            <Typography>
              {searchResult.name} has not created an iRacing account yet.
            </Typography>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default RealNameSearch;