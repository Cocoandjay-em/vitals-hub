// Verify profile-driven body models: screenshot male (default) and female.
import { chromium } from 'playwright-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'http://localhost:5199/'
const API = process.env.API ?? 'http://localhost:3101'

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200))
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('response', (r) => {
  if (r.status() >= 400) console.log('[http', r.status() + ']', r.url())
})

const cdp = await page.context().newCDPSession(page)
cdp.on('Page.screencastFrame', (e) => {
  cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30 })

async function shot(name) {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(6000) // GLB load + first frames
  await page.screenshot({ path: `/tmp/pw-sex-${name}.png` })
  console.log('[shot]', name)
}

// profile check: GET should report male by default
const before = await page.request.get(`${API}/api/profile`)
console.log('[profile] initial:', await before.text())

await shot('male')

// switch profile to female via the API (what the settings modal does)
const put = await page.request.put(`${API}/api/profile`, { data: { sex: 'female' } })
console.log('[profile] switched:', await put.text())

await shot('female')

// restore owner profile: male
const restore = await page.request.put(`${API}/api/profile`, { data: { sex: 'male' } })
console.log('[profile] restored:', await restore.text())

await browser.close()
console.log('done')
