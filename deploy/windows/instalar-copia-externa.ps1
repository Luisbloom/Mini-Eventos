# Instala en este PC la copia externa diaria de Mini Eventos Jartiland.
#
#   powershell -ExecutionPolicy Bypass -File deploy\windows\instalar-copia-externa.ps1
#
# 1. Crea una clave SSH propia para esto, sin frase de paso (la tarea es
#    desatendida) y con permisos sólo para tu usuario.
# 2. Prepara un known_hosts propio copiando la huella del servidor que ya tienes
#    verificada en ~/.ssh/known_hosts. No se acepta la huella «a ciegas».
# 3. Copia copia-externa.ps1 a una ruta estable y registra la tarea programada.
#
# La parte del servidor —dar de alta la clave con sus restricciones— se hace
# aparte, porque necesita sudo allí. Este guion imprime la clave pública.

param(
    [string]$Destino = 'D:\Copias Jartiland',
    [string]$IpServidor = '100.116.88.49',
    [string]$Hora = '13:00'
)

$ErrorActionPreference = 'Stop'
$ssh = Join-Path $env:USERPROFILE '.ssh'
$clave = Join-Path $ssh 'jartiland_copias_ed25519'
$hostsPropios = Join-Path $ssh 'known_hosts_jartiland'
$instalacion = Join-Path $env:LOCALAPPDATA 'JartilandCopias'
$guion = Join-Path $instalacion 'copia-externa.ps1'

New-Item -ItemType Directory -Force -Path $ssh, $Destino, $instalacion | Out-Null

# 1. clave dedicada
if (-not (Test-Path $clave)) {
    $comentario = "copias-externas@$env:COMPUTERNAME"
    $p = Start-Process -FilePath 'ssh-keygen.exe' -NoNewWindow -Wait -PassThru `
        -ArgumentList @('-q', '-t', 'ed25519', '-N', '""', '-C', $comentario, '-f', "`"$clave`"")
    if ($p.ExitCode -ne 0) { throw 'No se pudo generar la clave.' }
}
# OpenSSH rechaza una clave privada que puedan leer otros usuarios.
& icacls.exe $clave /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

# 2. huella del servidor, de la que ya está verificada
$verificadas = & ssh-keygen.exe -F $IpServidor -f (Join-Path $ssh 'known_hosts') 2>$null |
    Where-Object { $_ -and -not $_.StartsWith('#') }
if (-not $verificadas) {
    throw "No hay huella verificada de $IpServidor en ~/.ssh/known_hosts. Conéctate una vez a mano primero."
}
Set-Content -Path $hostsPropios -Value $verificadas -Encoding ASCII

# 3. guion en ruta estable y tarea programada
Copy-Item -Force (Join-Path $PSScriptRoot 'copia-externa.ps1') $guion

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$guion`" -Destino `"$Destino`""
$disparadores = @(
    (New-ScheduledTaskTrigger -Daily -At $Hora),
    (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
)
$disparadores[1].Delay = 'PT5M'
# Si el PC estaba apagado a esa hora, se ejecuta en cuanto se pueda.
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName 'Jartiland - copia externa' -Force `
    -Description 'Trae y verifica la copia diaria de la base de Mini Eventos Jartiland.' `
    -Action $accion -Trigger $disparadores -Settings $ajustes | Out-Null

Write-Output "Tarea registrada. Copias en: $Destino"
Write-Output 'CLAVE PUBLICA (darla de alta en el servidor con sus restricciones):'
Get-Content "$clave.pub"
