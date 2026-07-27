// Temporary verification script: drives system Chrome (real GPU → WebGL works).
import { chromium } from 'playwright-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'http://localhost:5199/'

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

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })

// headless Chrome only issues BeginFrames on demand → rAF stalls and the
// WebGL canvas freezes on an early frame. A CDP screencast forces the
// compositor to produce frames continuously, like a real visible browser.
const cdp = await page.context().newCDPSession(page)
cdp.on('Page.screencastFrame', (e) => {
  cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30 })

await page.waitForTimeout(5000) // let GLB load + first frames render
await page.screenshot({ path: '/tmp/pw-3d-front.png' })

// debug: does the canvas receive the pointer events?
await page.evaluate(() => {
  const c = document.querySelector('canvas')
  window.__pd = 0
  window.__pm = 0
  c?.addEventListener('pointerdown', () => window.__pd++)
  c?.addEventListener('pointermove', () => window.__pm++)
})

// drag to rotate ~120° to the left (see the side/back) — start off-centre so
// the drag lands on empty canvas, not on a hotspot button
const box = await page.locator('canvas').first().boundingBox()
if (box) {
  const azimuth = () => page.evaluate(() => window.__cam?.theta ?? null)
  const camFull = () => page.evaluate(() => JSON.stringify(window.__cam ?? null))
  console.log('[debug] theta before:', await azimuth())
  const sx = box.x + box.width * 0.2
  const sy = box.y + box.height * 0.55
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx - 420, sy, { steps: 25 })
  console.log('[debug] azimuth mid-drag:', await azimuth())
  await page.screenshot({ path: '/tmp/pw-3d-mid-drag.png' })
  await page.mouse.up()
  await page.waitForTimeout(300)
  console.log('[debug] azimuth after:', await azimuth())
  const events = await page.evaluate(() => ({ pd: window.__pd, pm: window.__pm }))
  console.log('[debug] canvas pointerdown:', events.pd, 'pointermove:', events.pm)
  await page.waitForTimeout(900)
  console.log('[debug] azimuth at shot:', await azimuth())
  console.log('[debug] cam full:', await camFull())
  await page.screenshot({ path: '/tmp/pw-3d-rotated.png' })
}

// click an organ dot (the liver chip, if visible) to open the organ card
const dot = page.locator('button[title*="Liver" i]').first()
if (await dot.count()) {
  await dot.click({ force: true })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/tmp/pw-3d-organ.png' })
} else {
  console.log('[info] liver dot not found in DOM')
}

await browser.close()
console.log('done')
