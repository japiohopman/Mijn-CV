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

// Explicit route to serve the github_action.png from the root directory if it resides there
app.get('/github_action.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'github_action.png'), (err) => {
    if (err) {
      // Fallback: try to find it in public folder or send 404
      res.sendFile(path.join(__dirname, 'public', 'github_action.png'), (err2) => {
        if (err2) {
          res.status(404).end();
        }
      });
    }
  });
});

// Start express server
app.listen(PORT, () => {
  console.log(`Express server is running on port ${PORT}`);
});
