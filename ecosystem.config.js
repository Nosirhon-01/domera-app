// PM2 process definition for production (/root/domera-app).
// Start/replace:  pm2 start ecosystem.config.js && pm2 save
// Environment variables come from /root/domera-app/.env (loaded by @nestjs/config), not from here.
module.exports = {
  apps: [
    {
      name: 'domera-api',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // Give Nest time to close DB connections on restart (enableShutdownHooks)
      kill_timeout: 10000,
      max_memory_restart: '512M',
      time: true,
    },
  ],
};
