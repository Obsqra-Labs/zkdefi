/**
 * PM2 ecosystem for zkde.fi
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart all
 *   pm2 stop all
 *   pm2 logs
 *   pm2 monit          # terminal UI
 *   pm2 plus          # optional: cloud dashboard at pm2.io
 */
module.exports = {
  apps: [
    {
      name: "zkdefi-frontend",
      cwd: "./frontend",
      script: "npm",
      args: "start",
      env: { NODE_ENV: "production" },
      interpreter: "none",
      watch: false,
      max_restarts: 10,
      min_uptime: "2s",
    },
    {
      name: "zkdefi-backend",
      cwd: "./backend",
      script: "../.venv_py311/bin/python3",
      args: "-m uvicorn app.main:app --host 0.0.0.0 --port 8003",
      interpreter: "none",
      watch: false,
      max_restarts: 10,
      min_uptime: "2s",
    },
    {
      name: "zkdefi-relayer-runner",
      cwd: "./backend",
      script: "./run_relayer_runner.sh",
      interpreter: "bash",
      watch: false,
      max_restarts: 10,
      min_uptime: "2s",
    },
  ],
};
