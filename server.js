const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Home route
app.get('/', (req, res) => {
  res.render('index');
});

// Share and QR code page route
app.get('/share', (req, res) => {
  res.render('share');
});

// Start express server
app.listen(PORT, () => {
  console.log(`Express server is running on port ${PORT}`);
});
