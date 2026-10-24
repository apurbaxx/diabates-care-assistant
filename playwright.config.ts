import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser", timeout: 120_000, workers: 1,
  use: { baseURL: "http://localhost:3100", headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { command: "npm run start -- -p 3100", url: "http://localhost:3100", reuseExistingServer: false, timeout: 120_000 },
});
