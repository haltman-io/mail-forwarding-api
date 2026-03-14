process.env.APP_ENV = "test";
process.env.APP_PUBLIC_URL = "http://localhost:8080";
process.env.SMTP_HOST = "smtp.test";
process.env.SMTP_FROM = "Test <test@example.com>";
process.env.MARIADB_HOST = "127.0.0.1";
process.env.MARIADB_USER = "test";
process.env.MARIADB_DATABASE = "test";
process.env.CHECKDNS_BASE_URL = "http://checkdns.test";
process.env.CHECKDNS_TOKEN = "test-token";
process.env.CHECKDNS_HTTP_TIMEOUT_MS = "8000";
process.env.AUTH_CSRF_SECRET = "test-csrf-secret";
process.env.JWT_ACCESS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIM8/WR5q5ZpH6MJZu5ij4bsCGIKxVUzQ7uH/5EZtMOE9
-----END PRIVATE KEY-----`;
process.env.JWT_ACCESS_KID = "test-access-key";
process.env.JWT_ACCESS_VERIFY_KEYS = JSON.stringify({
  "test-access-key": `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAr7Y3wjyQYaeUShXZSvrV3da5s+VpbY1VwJicY+2GINo=
-----END PUBLIC KEY-----`,
});
process.env.JWT_ACCESS_ISSUER = "mail-forwarding-api-test";
process.env.JWT_ACCESS_AUDIENCE = "mail-forwarding-web-test";
process.env.JWT_ACCESS_TTL_SECONDS = "600";
process.env.JWT_ACCESS_CLOCK_SKEW_SECONDS = "60";
