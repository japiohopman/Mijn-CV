const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware to expose site URL and path for dynamic meta tag resolution
app.use((req, res, next) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  res.locals.siteUrl = `${protocol}://${host}`;
  res.locals.currentPath = req.path;
  next();
});

// Serve static assets from public folder with caching headers
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// Home route
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Jaap Hopman | Creative Developer CV',
    description: 'Visueel en interactief CV van Jaap Hopman: creative developer, freelance chef en maker met focus op code, design en uitvoering.',
    ogUrl: '/',
    ogImage: '/images/jaap-Hopman.jpg'
  });
});

// Share and QR code page route
app.get('/share', (req, res) => {
  res.render('share', {
    title: 'Deel CV | Jaap Hopman',
    description: 'Deel of bekijk het interactieve portfolio en CV van Jaap Hopman via QR-code, WhatsApp, e-mail of direct link.',
    ogUrl: '/share',
    ogImage: '/images/jaap-Hopman.jpg'
  });
});

// Dedicated Kitchen CV page route
app.get('/keuken-cv', (req, res) => {
  res.render('keuken_cv', {
    title: 'Keuken CV | Jaap Hopman',
    description: 'Culinair profiel & Horeca-ervaring van Jaap Hopman - Zelfstandig Werkend Kok met meer dan 25 jaar ervaring.',
    ogUrl: '/keuken-cv',
    ogImage: '/images/jaap-Hopman.jpg'
  });
});

// Redirect old underscore route to clean hyphen route
app.get('/keuken_cv', (req, res) => {
  res.redirect(301, '/keuken-cv');
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
