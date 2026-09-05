import { Buffer } from "node:buffer"
import path from "node:path"
import { stdout } from "node:process"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const landingDirectory = path.resolve(scriptDirectory, "..")
const iconPath = path.join(landingDirectory, "src/assets/skillglass-icon.png")
const outputPath = path.join(landingDirectory, "public/og-image.png")

const icon = await sharp(iconPath).resize(72, 72).png().toBuffer()
const background = Buffer.from(`
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="violet" cx="0" cy="0" r="1" gradientTransform="translate(250 50) rotate(45) scale(620 460)" gradientUnits="userSpaceOnUse">
        <stop stop-color="#6C38D6" stop-opacity=".38"/>
        <stop offset="1" stop-color="#0B0B0D" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="orange" cx="0" cy="0" r="1" gradientTransform="translate(1050 40) rotate(130) scale(490 360)" gradientUnits="userSpaceOnUse">
        <stop stop-color="#D87438" stop-opacity=".28"/>
        <stop offset="1" stop-color="#0B0B0D" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="#0B0B0D"/>
    <rect width="1200" height="630" fill="url(#violet)"/>
    <rect width="1200" height="630" fill="url(#orange)"/>
    <rect x="24" y="24" width="1152" height="582" rx="28" fill="none" stroke="white" stroke-opacity=".08"/>
    <text x="144" y="102" fill="#F4F4F5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="650">Skillglass</text>
    <text x="74" y="258" fill="#FAFAFA" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="66" font-weight="650" letter-spacing="-2.2">Find and edit your skills</text>
    <text x="74" y="338" fill="#FAFAFA" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="66" font-weight="650" letter-spacing="-2.2">in one place</text>
    <text x="76" y="544" fill="#FAFAFA" fill-opacity=".5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" font-weight="600" letter-spacing="2.2">LOCAL · NO ACCOUNT · NO TELEMETRY</text>
  </svg>
`)

await sharp(background)
  .composite([{ input: icon, left: 62, top: 50 }])
  .png({ compressionLevel: 9, palette: true, quality: 95 })
  .toFile(outputPath)

await Promise.all([
  sharp(iconPath).resize(64, 64).png({ compressionLevel: 9 }).toFile(path.join(landingDirectory, "public/favicon.png")),
  sharp(iconPath).resize(180, 180).png({ compressionLevel: 9 }).toFile(path.join(landingDirectory, "public/apple-touch-icon.png")),
  sharp(iconPath).resize(192, 192).png({ compressionLevel: 9 }).toFile(path.join(landingDirectory, "public/icon-192.png")),
  sharp(iconPath).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(landingDirectory, "public/icon-512.png")),
])

stdout.write(`Generated ${outputPath}\n`)
