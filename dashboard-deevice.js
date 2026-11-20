/* Browser + Node-compatible countdown state; device reports are authoritative. */
(function(root) {
  class DeviceCountdown {
    constructor() { this.disconnect(); }
    disconnect() {
      this.deadline = null; this.expires = 0; this.online = false;
      this.feeding = false; this.priming = false; this.waterChange = false;
    }
    update(data, now) {
      this.online = data.online === true;
      this.feeding = data.feeding === true;
      this.priming = data.priming === true;
      this.waterChange = data.water_change_active === true;
      const serverMs = Date.parse(data.server_now);
      const sampleMs = Date.parse(data.sample_at || data.date_created);
      const age = Number.isFinite(serverMs) && Number.isFinite(sampleMs) ? Math.max(0, serverMs - sampleMs) : Infinity;
      const windowMs = Number(data.online_window_ms) || 30000;
      this.expires = now + Math.max(0, windowMs - age);
      const deadlineMs = Date.parse(data.next_feed_at);
      const remaining = Number.isFinite(deadlineMs) && Number.isFinite(serverMs)
        ? Math.max(0, deadlineMs - serverMs)
        : data.seconds_until_feed === null ? NaN : Number(data.seconds_until_feed) * 1000;
      this.deadline = Number.isFinite(remaining) ? now + remaining : null;
    }
    isOnline(now) { return this.online && now < this.expires; }
    label(now) {
      if (!this.isOnline(now)) return '--:--:--';
      if (this.feeding) return this.priming ? 'PRIMING…' : 'FEEDING…';
      if (this.deadline === null) return '--:--:--';
      const seconds = Math.max(0, Math.ceil((this.deadline - now) / 1000));
      if (!seconds) return this.waterChange ? 'Waiting: water change' : 'Feed due';
      const pad = value => String(value).padStart(2, '0');
      return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { DeviceCountdown };
  else root.DeviceCountdown = DeviceCountdown;
})(typeof window === 'undefined' ? globalThis : window);