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
      script: "./start.sh",
      interpreter: "bash",
      watch: false,
      max_restarts: 10,
      min_uptime: "2s",
      max_memory_restart: "2G",
      env: {
        ZKDEFI_REQUIRE_REAL_PROOFS: "1",
        DATABASE_URL: "postgresql://zkdefi:zkdefi@localhost:5432/zkdefi",
      },
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
    {
      name: "zkdefi-lp-recenter",
      cwd: "./backend",
      script: "../.venv_py311/bin/python3",
      args: "-m app.workers.lp_recenter_worker",
      interpreter: "none",
      watch: false,
      max_restarts: 10,
      min_uptime: "5s",
      env: {
        RECENTER_INTERVAL_SEC: "60",
        RECENTER_DRIFT_PCT: "0.75",
        RECENTER_LIVE: "0",       // shadow mode by default
      },
    },
    {
      name: "zkdefi-limit-grid",
      cwd: "./backend",
      script: "../.venv_py311/bin/python3",
      args: "-m app.workers.limit_grid_worker",
      interpreter: "none",
      watch: false,
      max_restarts: 10,
      min_uptime: "5s",
      env: {
        GRID_INTERVAL_SEC: "30",
        GRID_LEVELS: "3",
        GRID_STEP: "1000",
        GRID_LIVE: "0",           // shadow mode by default
      },
    },
    {
      name: "zkdefi-market-sim",
      cwd: "./market-maker-sim",
      script: ".venv/bin/python3",
      args: "-m uvicorn api.main:app --host 0.0.0.0 --port 8099",
      interpreter: "none",
      watch: false,
      max_restarts: 10,
      min_uptime: "2s",
      env: {
        PYTHONPATH: ".",
        MM_SIM_ADMIN_KEY: "dev-admin-key",
        MM_SIM_PORT: "8099",
      },
    },
  ],
};
