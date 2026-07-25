// One PM2 app per station. Each app is its own process with its own
// STATION_ID / CONTROL_API_PORT / env file, so one station's crash or
// restart never touches another's. Per the current decision, only
// Delana Hope Weekend Radio is enabled today — add more entries to the
// `apps` array (with a matching `.env.<station-slug>` file) when a second
// station is ready to go live, rather than teaching one process to juggle
// multiple concurrent FFmpeg encodes.

module.exports = {
  apps: [
    {
      name: 'hopecast-delana-hope-weekend-radio',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1, // must stay 1 per station — a single continuous FFmpeg process
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      restart_delay: 5000,
      watch: false,
      env_file: './.env', // holds STATION_ID for this station
      env: { NODE_ENV: 'production' },
      out_file: '/var/log/hopecast/delana-hope-weekend-radio-out.log',
      error_file: '/var/log/hopecast/delana-hope-weekend-radio-error.log',
      merge_logs: true,
      time: true,
    },

    // Template for a future second station — copy, rename, point env_file at
    // a distinct .env.<station-slug>, and give it a distinct CONTROL_API_PORT
    // inside that file before uncommenting:
    //
    // {
    //   name: 'hopecast-<next-station-slug>',
    //   script: 'src/server.js',
    //   cwd: __dirname,
    //   instances: 1,
    //   exec_mode: 'fork',
    //   autorestart: true,
    //   max_restarts: 20,
    //   min_uptime: '30s',
    //   restart_delay: 5000,
    //   watch: false,
    //   env_file: './.env.<next-station-slug>',
    //   env: { NODE_ENV: 'production' },
    //   out_file: '/var/log/hopecast/<next-station-slug>-out.log',
    //   error_file: '/var/log/hopecast/<next-station-slug>-error.log',
    //   merge_logs: true,
    //   time: true,
    // },
  ],
};
