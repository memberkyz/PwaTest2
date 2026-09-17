$ErrorActionPreference = "Stop"

$key = Read-Host "Paste the Firebase Web Push public key, then press Enter"
$key = $key.Trim()

if ($key.Length -lt 80) {
  throw "That key is too short. Copy the Key pair public key from Firebase Console, not the Web API key."
}

$envPath = Join-Path $PSScriptRoot ".env.local"
$envText = Get-Content -Raw -LiteralPath $envPath
if ($envText -notmatch "(?m)^VITE_FIREBASE_VAPID_KEY=") {
  throw "VITE_FIREBASE_VAPID_KEY was not found in .env.local"
}
$envText = [regex]::Replace($envText, "(?m)^VITE_FIREBASE_VAPID_KEY=.*$", "VITE_FIREBASE_VAPID_KEY=$key")
Set-Content -LiteralPath $envPath -Value $envText -NoNewline

vercel env add VITE_FIREBASE_VAPID_KEY "production,preview,development" --value $key --yes --force --no-sensitive
vercel deploy --prod --yes
Write-Host "VAPID key configured and production redeployed." -ForegroundColor Green
