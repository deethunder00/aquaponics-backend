require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// ===== CORS =====
// Explicit allow-list. Matches local dev, your Vercel frontend, and Render itself.
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'https://aquaponics-frontend.vercel.app',
  'https://aquaponics-backend-sgr7.onrender.com'
];

app.use(cors({
  origin: (origin, cb) => {
    // Allow tools like curl / Postman (no origin header) and any origin in the list.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  }
}));

// ===== DB =====
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// ===== SCHEMAS =====
const sensorSchema = new mongoose.Schema({
  temp_sersor: String,               // keep original spelling for backward compat
  ph_sensor:   String,
  do_sensor:   String,
  temp_status: String,               // trust firmware, do not recompute
  ph_status:   String,
  aerator_status: { type: String, default: 'OFF' },
  mode: { type: Number, default: 12 },
  seconds_until_feed: { type: Number, default: 0 },
  date_created: { type: Date, default: Date.now }
});
const Sensor = mongoose.model('Sensor', sensorSchema);

const feedSchema = new mongoose.Schema({
  feed_time: { type: Date, default: Date.now },
  mode: { type: Number, default: 12 }
});
const Feed = mongoose.model('Feed', feedSchema);

// ===== HELPERS =====
// Firmware may send "N"/"L"/"H" (its own codes) or a full word.
// Normalize whatever comes in so the frontend always sees LOW / NORMAL / HIGH.
function normalizeStatus(raw, kind /* 'temp' | 'ph' */, value) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'L' || s === 'LOW')    return 'LOW';
  if (s === 'N' || s === 'NORMAL') return 'NORMAL';
  if (s === 'H' || s === 'HIGH')   return 'HIGH';

  // Fallback: if firmware sent nothing, derive from the numeric value.
  const v = parseFloat(value);
  if (isNaN(v)) return 'UNKNOWN';
  if (kind === 'temp') {
    if (v < 26) return 'LOW';
    if (v <= 30) return 'NORMAL';
    return 'HIGH';
  }
  // ph
  if (v < 6) return 'LOW';
  if (v <= 8.5) return 'NORMAL';
  return 'HIGH';
}

// ===== HEALTH =====
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

// ===== WRITE SENSOR (called by ESP32) =====
// mirrors c_sensor.php
app.get('/api/c_sensor', async (req, res) => {
  try {
    const {
      temp_sersor, ph_sensor, do_sensor,
      temp_status, ph_status,
      aerator_status,
      mode, seconds_until_feed
    } = req.query;

    await Sensor.create({
      temp_sersor: temp_sersor ?? '',
      ph_sensor:   ph_sensor   ?? '',
      do_sensor:   do_sensor   ?? '',
      temp_status: normalizeStatus(temp_status, 'temp', temp_sersor),
      ph_status:   normalizeStatus(ph_status,   'ph',   ph_sensor),
      aerator_status: (aerator_status || 'OFF').toUpperCase(),
      mode: parseInt(mode) || 12,
      seconds_until_feed: parseInt(seconds_until_feed) || 0
    });

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    res.send(`${hh}:${mm}`);
  } catch (e) {
    console.error('c_sensor error:', e);
    res.status(500).send('0');
  }
});

// ===== READ LATEST SENSOR (called by dashboard) =====
// mirrors r_sensor.php
app.get('/api/r_sensor', async (req, res) => {
  try {
    const latest = await Sensor.findOne().sort({ _id: -1 });

    if (!latest) {
      return res.json({
        temp: 0, ph: 0, do: 0,
        tempStatus: 'NO DATA',
        phStatus: 'NO DATA',
        aerator_status: 'OFF',
        mode: null,
        seconds_until_feed: null,
        date_created: null
      });
    }

    res.json({
      temp: parseFloat(latest.temp_sersor),
      ph:   parseFloat(latest.ph_sensor),
      do:   parseFloat(latest.do_sensor),
      tempStatus: latest.temp_status,
      phStatus:   latest.ph_status,
      aerator_status: latest.aerator_status,
      mode: latest.mode,
      seconds_until_feed: latest.seconds_until_feed,
      date_created: latest.date_created
    });
  } catch (e) {
    console.error('r_sensor error:', e);
    res.status(500).json({ error: 'r_sensor failed' });
  }
});

// ===== LOG A FEED (called by ESP32 when servo fires) =====
// mirrors feed.php
app.get('/api/feed', async (req, res) => {
  try {
    const mode = parseInt(req.query.mode) || 12;
    const f = await Feed.create({ mode });
    res.send('New feed logged successfully');
  } catch (e) {
    console.error('feed error:', e);
    res.status(500).send('Error: ' + e.message);
  }
});

// ===== READ FEED HISTORY (called by dashboard) =====
// mirrors r_feed.php
app.get('/api/r_feed', async (req, res) => {
  try {
    const feeds = await Feed.find().sort({ _id: -1 }).limit(50);
    res.json(feeds.map(f => ({
      feed_time: f.feed_time.toISOString().slice(0, 19).replace('T', ' '),
      mode: f.mode
    })));
  } catch (e) {
    console.error('r_feed error:', e);
    res.status(500).json({ error: 'r_feed failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));