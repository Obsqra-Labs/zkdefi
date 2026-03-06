module.exports = {
  apps: [
    {
      name: 'zkdefi-frontend',
      script: 'npm',
      args: 'start -- -H 0.0.0.0 -p 3001',
      cwd: '/opt/obsqra.starknet/zkdefi/frontend',
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: 'http://localhost:8003',
        NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS: '0x02f3a1caf8898e7a17aef89523c74ceafab3262c06f512a81d06c264e0bd25a1',
        NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS: '0x07fed6973cfc23b031c0476885ec87a401f1006bdc8ba58df2bd8611b38b5ff5',
        NEXT_PUBLIC_MM_SIM_API: 'https://zkde.fi/sim',
        NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_WITHDRAW: 'true',
        NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT: 'true',
        NEXT_PUBLIC_EKUBO_HUB_V2: 'true',
      },
    },
  ],
};
