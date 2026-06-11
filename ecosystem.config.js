// إعداد PM2 — تشغيل دائم مع إعادة تشغيل تلقائي
module.exports = {
  apps: [
    {
      name: 'no-risk-no-fun',
      script: 'server.js',
      instances: 1,            // مهم: نسخة واحدة فقط (Socket.IO + حالة بالذاكرة)
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '400M',
      autorestart: true,
      watch: false,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
