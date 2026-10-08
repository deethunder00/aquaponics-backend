require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:8080',
  'https://aquaponics-frontend.vercel.app',
  'https://aquaponics-backend-sgr7.onrender.com'
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  }
}));

app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// ===== SCHEMAS =====
const sensorSchema = new mongoose.Schema({
  temp_sersor: String,
  ph_sensor:   String,
  do_sensor:   String,
  temp_status: String,
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

// ===== CONFIG (single doc) =====
const configSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main' },
  portions: { type: [Number], default: [] },       // 12 values, grams per feed
  stockingDate: { type: String, default: '' },      // "YYYY-MM-DD"
  harvestStart: { type: Number, default: 8 },
  harvestEnd:   { type: Number, default: 12 },
  servoRate:    { type: Number, default: 2.0 },     // grams per second
  cycleNumber:  { type: Number, default: 1 },
  lastHarvest:  { type: Date, default: null },
  updatedAt:    { type: Date, default: Date.now }
});
const Config = mongoose.model('Config', configSchema);

// ===== HELPERS =====
function normalizeStatus(raw, kind, value) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'L' || s === 'LOW')    return 'LOW';
  if (s === 'N' || s === 'NORMAL') return 'NORMAL';
  if (s === 'H' || s === 'HIGH')   return 'HIGH';

  const v = parseFloat(value);
  if (isNaN(v)) return 'UNKNOWN';
  if (kind === 'temp') {
    if (v < 26) return 'LOW';
    if (v <= 30) return 'NORMAL';
    return 'HIGH';
  }
  if (v < 6) return 'LOW';
  if (v <= 8.5) return 'NORMAL';
  return 'HIGH';
}

async function getOrCreateConfig() {
  let doc = await Config.findOne({ key: 'main' });
  if (!doc) {
    doc = await Config.create({ key: 'main' });
  }
  return doc;
}

// ===== HEALTH =====
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

// ===== SENSOR WRITE =====
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

// ===== SENSOR READ =====
app.get('/api/r_sensor', async (req, res) => {
  try {
    const latest = await Sensor.findOne().sort({ _id: -1 });
    if (!latest) {
      return res.json({
        temp: 0, ph: 0, do: 0,
        tempStatus: 'NO DATA', phStatus: 'NO DATA',
        aerator_status: 'OFF', mode: null,
        seconds_until_feed: null, date_created: null
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

// ===== FEED LOG =====
app.get('/api/feed', async (req, res) => {
  try {
    const mode = parseInt(req.query.mode) || 12;
    await Feed.create({ mode });
    res.send('New feed logged successfully');
  } catch (e) {
    console.error('feed error:', e);
    res.status(500).send('Error: ' + e.message);
  }
});

// ===== FEED READ =====
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

// ===== CONFIG READ (for website) =====
app.get('/api/get_config', async (req, res) => {
  try {
    const doc = await getOrCreateConfig();
    res.json({
      portions: doc.portions,
      stockingDate: doc.stockingDate,
      harvestStart: doc.harvestStart,
      harvestEnd: doc.harvestEnd,
      servoRate: doc.servoRate,
      cycleNumber: doc.cycleNumber,
      lastHarvest: doc.lastHarvest
    });
  } catch (e) {
    console.error('get_config error:', e);
    res.status(500).json({ error: 'get_config failed' });
  }
});

// ===== CONFIG WRITE (from website) =====
// /api/set_config?portions=10,12,14,...&stockingDate=2026-09-02&harvestStart=8&harvestEnd=12&servoRate=2.0
app.get('/api/set_config', async (req, res) => {
  try {
    const portionsRaw = (req.query.portions || '').split(',').map(s => parseFloat(s)).filter(n => !isNaN(n));
    const stockingDate = req.query.stockingDate || '';
    const harvestStart = parseInt(req.query.harvestStart) || 8;
    const harvestEnd   = parseInt(req.query.harvestEnd)   || 12;
    const servoRate    = parseFloat(req.query.servoRate)  || 2.0;

    const doc = await getOrCreateConfig();
    doc.portions = portionsRaw;
    doc.stockingDate = stockingDate;
    doc.harvestStart = harvestStart;
    doc.harvestEnd = harvestEnd;
    doc.servoRate = servoRate;
    doc.updatedAt = new Date();
    await doc.save();

    res.send('ok');
  } catch (e) {
    console.error('set_config error:', e);
    res.status(500).send('Error: ' + e.message);
  }
});

// ===== HARVEST (reset cycle) =====
app.get('/api/harvest', async (req, res) => {
  try {
    const doc = await getOrCreateConfig();
    doc.portions = [];
    doc.stockingDate = '';
    doc.cycleNumber = (doc.cycleNumber || 1) + 1;
    doc.lastHarvest = new Date();
    doc.updatedAt = new Date();
    await doc.save();
    res.send('ok');
  } catch (e) {
    console.error('harvest error:', e);
    res.status(500).send('Error: ' + e.message);
  }
});

// ===== CONFIG FOR ESP32 (plain text, easy to parse) =====
app.get('/api/get_esp_config', async (req, res) => {
  try {
    const doc = await getOrCreateConfig();
    const portions = (doc.portions && doc.portions.length === 12)
      ? doc.portions.join(',')
      : '0,0,0,0,0,0,0,0,0,0,0,0';

    const body =
      `portions=${portions}\n` +
      `stockingDate=${doc.stockingDate || ''}\n` +
      `servoRate=${doc.servoRate || 2.0}\n`;

    res.type('text/plain').send(body);
  } catch (e) {
    console.error('get_esp_config error:', e);
    res.status(500).send('error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));