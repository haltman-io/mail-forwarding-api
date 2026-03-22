const path = require('path');
const { execSync } = require('child_process');

console.log('[ecosystem] Running npm run build...');
execSync('npm run build', { cwd: __dirname, stdio: 'inherit' });
console.log('[ecosystem] Build finished.');

module.exports = {
    apps: [
        {
            name: "mail-forwarding-api-nest",
            script: "./dist/src/main.js",
            cwd: ".",

            instances: 1,
            exec_mode: "fork",

            autorestart: true,
            watch: false,
            max_memory_restart: "400M",

            out_file: path.join(__dirname, 'logs', 'out.log'),
            error_file: path.join(__dirname, 'logs', 'error.log'),
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",

            env_production: {
                NODE_ENV: "production",
            },
        }
    ]
};
