// Render full-page previews of site/index.html (desktop and phone) into $MIHARCHY_VERIFY_DIR/evidence,
// and the README banner (site/banner.png) from the hero.
const path = require("path")
const { chromium } = require("playwright-core")
const SITE = "file://" + path.resolve(__dirname, "../../index.html")
const BANNER = path.resolve(__dirname, "../../banner.png")
if (!process.env.MIHARCHY_VERIFY_DIR) { console.error("set MIHARCHY_VERIFY_DIR (see ../README.md)"); process.exit(2) }
const EV = path.join(process.env.MIHARCHY_VERIFY_DIR, "evidence")

;(async () => {
  require("fs").mkdirSync(EV, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/usr/bin/chromium" })
  for (const [name, w, h, scale] of [["site-desktop", 1440, 900, 1], ["site-phone", 390, 844, 2]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale, reducedMotion: "reduce" })
    await page.goto(SITE, { waitUntil: "networkidle" })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(async () => { for (const i of document.images) { i.loading = "eager"; await i.decode().catch(() => {}) } })
    // body hides x overflow, so scrollWidth alone cannot see clipped content: list elements past the right edge.
    const overflow = await page.evaluate(() => [document.documentElement.scrollWidth - window.innerWidth,
      [...document.querySelectorAll("main *, footer *")].filter(e => !e.closest(".kanji-bg, .install code, pre") && e.getBoundingClientRect().right > window.innerWidth + 0.5).map(e => e.tagName + "." + e.className).slice(0, 8)])
    const fonts = await page.evaluate(() => [document.fonts.check("16px 'JetBrains Mono'"), document.fonts.check("900 16px 'Noto Sans JP'", "ミハーキー")])
    console.log(name, "horizontal overflow px:", overflow, "fonts:", fonts)
    // A full-page capture shows the fixed scanline layer over the first screen only; spread it over the page.
    await page.addStyleTag({ content: "body::after{position:absolute}" })
    await page.screenshot({ path: path.join(EV, name + ".png"), fullPage: true })
    if (name === "site-desktop") {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.addStyleTag({ content: "body::after{display:none} .hero{padding:0} .wrap{max-width:none;padding:0} .box{border:0;height:400px} .box-foot{display:none} .cover{height:400px;padding:36px 64px;align-content:center} .tags{display:none} .copy{display:none}" })
      const box = await page.$(".box")
      await box.screenshot({ path: BANNER })
      console.log("banner", await box.boundingBox())
    }
    await page.close()
  }
  await browser.close()
})()
