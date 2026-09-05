const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// ===== SCHEMAS =====
const sensorSchema = new mongoose.Schema({
  temp_sersor: String,
  ph_sensor: String,
  do_sensor: String,
  temp_status: String,
  ph_status: String,
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

// ===== ROUTES (mirrors your PHP files exactly) =====

// mirrors c_sensor.php
app.get('/api/c_sensor', async (req, res) => {
  try {
    const { temp_sersor, ph_sensor, do_sensor, temp_status, ph_status } = req.query;
    const mode = parseInt(req.query.mode) || 12;
    const seconds_until_feed = parseInt(req.query.seconds_until_feed) || 0;

    await Sensor.create({ temp_sersor, ph_sensor, do_sensor, temp_status, ph_status, mode, seconds_until_feed });

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    res.send(`${hh}:${mm}`);
  } catch (e) {
    res.send('0');
  }
});

// mirrors r_sensor.php
app.get('/api/r_sensor', async (req, res) => {
  const latest = await Sensor.findOne().sort({ _id: -1 });
  if (!latest) {
    return res.json({ temp: 0, ph: 0, do: 0, tempStatus: "NO DATA", phStatus: "NO DATA", mode: null, seconds_until_feed: null });
  }
  const temp = parseFloat(latest.temp_sersor);
  const ph = parseFloat(latest.ph_sensor);
  const doVal = parseFloat(latest.do_sensor);
  const tempStatus = temp < 26 ? "LOW" : (temp <= 30 ? "NORMAL" : "HIGH");
  const phStatus = ph < 6 ? "LOW" : (ph <= 8.5 ? "NORMAL" : "HIGH");

  res.json({
    temp, ph, do: doVal, tempStatus, phStatus,
    mode: latest.mode, seconds_until_feed: latest.seconds_until_feed
  });
});

// mirrors feed.php
app.get('/api/feed', async (req, res) => {
  try {
    const mode = parseInt(req.query.mode) || 12;
    await Feed.create({ mode });
    res.send('New feed logged successfully');
  } catch (e) {
    res.send('Error: ' + e.message);
  }
});

// mirrors r_feed.php
app.get('/api/r_feed', async (req, res) => {
  const feeds = await Feed.find().sort({ _id: -1 }).limit(10);
  res.json(feeds.map(f => ({
    feed_time: f.feed_time.toISOString().slice(0, 19).replace('T', ' '),
    mode: f.mode
  })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));