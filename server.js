const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Parse incoming request bodies for API forms
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Contact Form API route with validation, anti-spam honeypot, and privacy protection
app.post('/api/contact', (req, res) => {
  const { name, email, subject, message, website_url } = req.body || {};

  // Anti-spam check: honeypot field 'website_url' should be empty
  if (website_url) {
    // Return silent success response to bots without processing or logging
    return res.status(200).json({
      success: true,
      message: 'Bedankt voor je bericht! Ik neem zo snel mogelijk contact met je op.'
    });
  }

  // Validate required fields
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedEmail = typeof email === 'string' ? email.trim() : '';
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';
  const trimmedSubject = typeof subject === 'string' ? subject.trim() : 'Contactformulier Portfolio';

  if (!trimmedName || !trimmedEmail || !trimmedMessage) {
    return res.status(400).json({
      success: false,
      message: 'Vul alstublieft alle verplichte velden in (naam, e-mailadres en bericht).'
    });
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return res.status(400).json({
      success: false,
      message: 'Voer een geldig e-mailadres in.'
    });
  }

  // In production, integration with transactional service (SendGrid, Resend, etc.) would trigger here.
  // Privacy assurance: We intentionally do NOT log sensitive payload data (message text or email) to stdout/logs.

  return res.status(200).json({
    success: true,
    message: 'Bedankt voor je bericht! Ik neem zo snel mogelijk contact met je op.'
  });
});

// Start express server
app.listen(PORT, () => {
  console.log(`Express server is running on port ${PORT}`);
});
