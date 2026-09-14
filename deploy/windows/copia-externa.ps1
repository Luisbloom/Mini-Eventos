# Copia externa de Mini Eventos Jartiland.
#
# Se trae a este PC la última copia de la base del servidor, comprueba que llegó
# entera (SHA-256) y sólo entonces se lo confirma al servidor. El vigilante del
# servidor avisa si pasan más de 72 horas sin una confirmación.
#
# Existe porque todo vivía en una única máquina: si el Mac mini moría, se perdía
# el torneo. La lanza una tarea programada; ver instalar-copia-externa.ps1.
#
# La clave sólo puede ejecutar una orden fija en el servidor (sha256, descargar,
# confirmar) y sólo desde la IP de Tailscale de este PC. No da shell.

param(
    [string]$Servidor = 'jartiland-copias@100.116.88.49',
    [string]$Clave = (Join-Path $env:USERPROFILE '.ssh\jartiland_copias_ed25519'),
    [string]$HostsConocidos = (Join-Path $env:USERPROFILE '.ssh\known_hosts_jartiland'),
    [string]$Destino = 'D:\Copias Jartiland',
    [int]$Conservar = 30
)

$ErrorActionPreference = 'Stop'
$registro = Join-Path $Destino 'registro.txt'

function Anotar([string]$texto) {
    $linea = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $texto
    Add-Content -Path $registro -Value $linea -Encoding UTF8
    Write-Output $linea
}

function OpcionesSsh {
    # Se piden sólo los tipos de huella que hay verificados en el fichero. Si no,
    # el cliente negocia el que prefiera (ed25519), no lo encuentra y rechaza la
    # conexión aunque tengamos otra huella perfectamente válida del mismo servidor.
    $algoritmos = Get-Content $HostsConocidos |
        ForEach-Object { ($_ -split '\s+')[1] } | Where-Object { $_ } |
        ForEach-Object { if ($_ -eq 'ssh-rsa') { 'rsa-sha2-512'; 'rsa-sha2-256' } else { $_ } } |
        Sort-Object -Unique
    # ⚠️ UserKnownHostsFile NO puede llevar la ruta tal cual: ssh separa por
    # espacios los valores de esa opción (admite varios ficheros), y la carpeta
    # de usuario es «C:\Users\Luis Miguel». Leía «C:\Users\Luis» y «Miguel\...»,
    # no encontraba ninguna huella y rechazaba la conexión con un mensaje que
    # parecía de otro problema. %d lo expande el propio ssh a la carpeta de
    # usuario DESPUÉS de separar, así que el espacio nunca llega a partirlo.
    $hostsParaSsh = if ($HostsConocidos -eq (Join-Path $env:USERPROFILE '.ssh\known_hosts_jartiland')) {
        '%d/.ssh/known_hosts_jartiland'
    } else { $HostsConocidos }
    @('-i', $Clave, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
      '-o', 'StrictHostKeyChecking=yes', '-o', "UserKnownHostsFile=$hostsParaSsh",
      '-o', "HostKeyAlgorithms=$($algoritmos -join ',')",
      '-o', 'ConnectTimeout=20', $Servidor)
}

New-Item -ItemType Directory -Force -Path $Destino | Out-Null

try {
    # 1. qué copia hay y cuál es su huella
    $respuesta = (& ssh.exe @(OpcionesSsh) 'sha256' 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $respuesta -notmatch '^([0-9a-f]{64}) (tournament-[0-9TZ]+\.db)$') {
        throw "El servidor no devolvió una huella válida: $respuesta"
    }
    $huella = $Matches[1]
    $nombre = $Matches[2]
    $final = Join-Path $Destino $nombre

    # 2. si ya la tenemos verificada, sólo se confirma
    $yaEsta = (Test-Path $final) -and ((Get-FileHash -Algorithm SHA256 $final).Hash.ToLower() -eq $huella)

    if (-not $yaEsta) {
        # PowerShell corrompe la salida binaria de un programa si se redirige con
        # «>»: la trata como texto. Start-Process escribe los bytes tal cual.
        $parcial = "$final.partial"
        Remove-Item -Force -ErrorAction SilentlyContinue $parcial
        $argumentos = (OpcionesSsh | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) + 'descargar'
        $proceso = Start-Process -FilePath 'ssh.exe' -ArgumentList $argumentos -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $parcial -RedirectStandardError "$parcial.err"
        if ($proceso.ExitCode -ne 0) {
            throw "La descarga falló (código $($proceso.ExitCode)): $(Get-Content -Raw "$parcial.err")"
        }
        $obtenida = (Get-FileHash -Algorithm SHA256 $parcial).Hash.ToLower()
        if ($obtenida -ne $huella) {
            throw "La copia llegó dañada: huella $obtenida, esperada $huella"
        }
        Move-Item -Force $parcial $final
        Remove-Item -Force -ErrorAction SilentlyContinue "$parcial.err"
    }

    # 3. confirmar al servidor: sólo ahora cuenta como copia externa
    $confirmacion = (& ssh.exe @(OpcionesSsh) "confirmar $huella" 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $confirmacion -ne 'confirmada') {
        throw "El servidor no confirmó la copia: $confirmacion"
    }

    # 4. conservar sólo las más recientes
    Get-ChildItem -Path $Destino -Filter 'tournament-*.db' |
        Sort-Object Name -Descending | Select-Object -Skip $Conservar |
        Remove-Item -Force

    $tamano = [math]::Round((Get-Item $final).Length / 1KB)
    Anotar ("OK  {0}  {1} KB  {2}" -f $nombre, $tamano, $(if ($yaEsta) { 'ya estaba' } else { 'descargada' }))

    # el registro no crece para siempre
    $lineas = Get-Content $registro
    if ($lineas.Count -gt 500) { $lineas | Select-Object -Last 500 | Set-Content $registro -Encoding UTF8 }
    exit 0
}
catch {
    Anotar "FALLO  $($_.Exception.Message)"
    exit 1
}
