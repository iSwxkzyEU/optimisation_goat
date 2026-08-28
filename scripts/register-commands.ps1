# ============================================================
#  Enregistre les slash-commands du bot auprès de Discord.
#
#  MÊME RÔLE que scripts/register-commands.js, mais SANS Node : cette machine
#  n'a pas Node installé, donc `npm run register` ne peut pas tourner. Garder
#  les deux en phase : si tu changes la liste ici, change-la là-bas aussi.
#
#  Lancer depuis la racine du projet :
#      powershell -ExecutionPolicy Bypass -File scripts\register-commands.ps1
#
#  Lit DISCORD_APP_ID / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID dans le .env de la
#  racine (les variables d'environnement système sont prioritaires si définies).
#  Avec DISCORD_GUILD_ID : les commandes apparaissent TOUT DE SUITE sur ton
#  serveur. Sans : enregistrement global, jusqu'à ~1 h avant d'être visible.
# ============================================================

$ErrorActionPreference = "Stop"

# Discord refuse TLS < 1.2 ; PowerShell 5.1 ne le choisit pas toujours seul.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot

# --- Mini-chargeur .env (KEY=VALUE par ligne) -------------------------------
$envFile = Join-Path $root ".env"
$fromFile = @{}
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile -Encoding UTF8) {
    $m = [regex]::Match($line, '^\s*([\w.-]+)\s*=\s*(.*?)\s*$')
    if ($m.Success) {
      $fromFile[$m.Groups[1].Value] = $m.Groups[2].Value.Trim('"').Trim("'")
    }
  }
}

function Get-Setting([string]$name) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($v)) {
    if ($fromFile.ContainsKey($name)) { $v = $fromFile[$name] } else { $v = "" }
  }
  return $v
}

$appId    = Get-Setting "DISCORD_APP_ID"
$botToken = Get-Setting "DISCORD_BOT_TOKEN"
$guildId  = Get-Setting "DISCORD_GUILD_ID"

if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($botToken)) {
  Write-Host "Manque DISCORD_APP_ID et/ou DISCORD_BOT_TOKEN (.env a la racine, ou variables systeme)." -ForegroundColor Red
  exit 1
}

# --- Les commandes ----------------------------------------------------------
# PUT groupé : cette liste REMPLACE toutes les commandes existantes. Toute
# commande absente d'ici DISPARAIT de Discord — c'est ainsi qu'on retire
# /unlink, /plan, /id_syncro, /launch_syncro, /launch_same_time et /optimise.
$commands = @(
  # LE point d'entrée : catégorie -> village -> plan -> aperçu privé, puis tout
  # se fait aux boutons (publier, éditer, salon, ready check, tir).
  [ordered]@{
    name        = "id_same_time"
    description = "Browse a village and show its launch table (everything else is a button)"
  },
  # Associe un pseudo EN JEU à son compte Discord : indispensable quand les deux
  # noms diffèrent, sinon le bot ne sait pas qui pinguer.
  [ordered]@{
    name        = "link"
    description = "Link your in-game name to your Discord account (so the bot can ping you)"
    options     = @(
      [ordered]@{
        type        = 3   # STRING
        name        = "player"
        description = "Your in-game name, exactly as it appears in the nuke table"
        required    = $false
      },
      # Remplace l'ancienne commande /unlink : un lien fautif doit rester
      # effaçable, sinon le bot pinguerait toujours la mauvaise personne.
      [ordered]@{
        type        = 5   # BOOLEAN
        name        = "remove"
        description = "Unlink instead of linking (leave the name empty to unlink them all)"
        required    = $false
      }
    )
  }
)

if ([string]::IsNullOrWhiteSpace($guildId)) {
  $url = "https://discord.com/api/v10/applications/$appId/commands"
  $where = "globalement (jusqu'a ~1h avant d'etre visible)"
} else {
  $url = "https://discord.com/api/v10/applications/$appId/guilds/$guildId/commands"
  $where = "sur le serveur $guildId (immediat)"
}

# UTF-8 explicite : Invoke-RestMethod enverrait sinon du Latin-1 sur PS 5.1.
$json  = $commands | ConvertTo-Json -Depth 10
$bytes = [Text.Encoding]::UTF8.GetBytes($json)

Write-Host "Enregistrement de /id_same_time et /link $where ..."

try {
  $res = Invoke-RestMethod -Uri $url -Method Put `
    -Headers @{ Authorization = "Bot $botToken" } `
    -ContentType "application/json; charset=utf-8" `
    -Body $bytes `
    -UserAgent "DiscordBot (https://optimisation-goat.vercel.app, 1.0)"
} catch {
  # Discord renvoie le détail de l'erreur dans le CORPS, pas dans le message.
  Write-Host "Echec." -ForegroundColor Red
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object IO.StreamReader($resp.GetResponseStream())
    Write-Host ("HTTP " + [int]$resp.StatusCode + " : " + $reader.ReadToEnd()) -ForegroundColor Red
  } else {
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
  exit 1
}

Write-Host "OK - commandes enregistrees :" -ForegroundColor Green
foreach ($c in $res) { Write-Host ("  /" + $c.name) }
Write-Host "Toutes les autres (/unlink, /plan, /id_syncro, /launch_syncro, /launch_same_time, /optimise) ont ete retirees."
