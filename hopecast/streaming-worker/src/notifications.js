/**
 * Notification abstraction. Milestone 1–3 scope: email + in-dashboard (via
 * broadcast_events, already written elsewhere). SMS/push can be added later
 * by adding a case in send() without changing any caller.
 */
class NotificationService {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.transporter = null;

    if (config.SMTP_HOST) {
      // Lazy require so the dependency is optional if SMTP isn't configured.
      const nodemailer = require('nodemailer');
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: Number(config.SMTP_PORT || 587),
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      });
    }
  }

  async send(subject, message) {
    this.logger.info({ subject }, 'Notification');
    if (!this.transporter) return; // dashboard-only if SMTP isn't configured
    try {
      await this.transporter.sendMail({
        from: this.config.NOTIFY_EMAIL_FROM,
        to: this.config.NOTIFY_EMAIL_TO,
        subject: `[HopeCast] ${subject}`,
        text: message,
      });
    } catch (err) {
      this.logger.error({ err }, 'Email notification failed to send');
    }
  }

  streamStarted(stationName) { return this.send(`${stationName} is live`, 'The broadcast started successfully.'); }
  streamStopped(stationName) { return this.send(`${stationName} stopped`, 'The broadcast ended.'); }
  streamCrashed(stationName, errorMessage) { return this.send(`${stationName} crashed`, errorMessage || 'Unknown error'); }
  streamRestarted(stationName, count) { return this.send(`${stationName} auto-restarted`, `Restart #${count} completed successfully.`); }
  connectionFailed(stationName, errorMessage) { return this.send(`${stationName}: YouTube connection failed`, errorMessage || 'Unknown error'); }
  scheduleApproaching(stationName, minutesUntil) { return this.send(`${stationName}: broadcast starting soon`, `Scheduled to start in ${minutesUntil} minute(s).`); }
  mediaMissing(stationName, detail) { return this.send(`${stationName}: media missing`, detail); }
  storageFull(stationName, detail) { return this.send(`${stationName}: storage nearly full`, detail); }
}

module.exports = { NotificationService };
