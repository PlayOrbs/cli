import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, '..', 'cards', 'cli-overview.html');
const outputPath = join(__dirname, '..', 'assets', 'banner.png');

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 300 });
await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
await page.screenshot({ path: outputPath, type: 'png' });
await browser.close();

console.log(`Screenshot saved to ${outputPath}`);
