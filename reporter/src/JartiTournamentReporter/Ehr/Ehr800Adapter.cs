using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using EHR;
using Jartiland.TournamentReporter.Logging;
using Jartiland.TournamentReporter.Model;

namespace Jartiland.TournamentReporter.Ehr
{
    /// <summary>
    /// Adaptador para EHR 8.0.0 (Test Build 3) sobre Among Us 2026.8.18.
    ///
    /// Todo lo que lee aquí es API pública de EHR y ya la mantiene el propio mod:
    ///   · <c>Main.PlayerStates</c> para rol, equipo, muerte, asesino real y tareas;
    ///   · <c>CustomWinnerHolder</c> para el equipo ganador y la lista de ganadores;
    ///   · <c>GameStates.IsEnded</c> para saber que EHR ya cerró la partida.
    /// El Reporter no recalcula ninguno de esos estados por su cuenta.
    /// </summary>
    public sealed class Ehr800Adapter : IEhrGameAdapter
    {
        private readonly SecretSafeLog _log;
        private readonly Dictionary<byte, string> _friendCodes = new Dictionary<byte, string>();

        public Ehr800Adapter(SecretSafeLog log)
        {
            _log = log;
        }

        public DateTime SessionStartedUtc { get; set; } = DateTime.UtcNow;

        public bool IsAvailable
        {
            get
            {
                try { return Main.PlayerStates != null; }
                catch (Exception) { return false; }
            }
        }

        /// <summary>
        /// Único uso de reflection del proyecto, y por un motivo concreto:
        /// <c>Main.PluginVersion</c>, <c>Main.TestBuildNumber</c> y
        /// <c>Main.SupportedAUVersion</c> son <c>const</c>, de modo que el
        /// compilador los incrusta en esta DLL al compilarla. Leerlos
        /// normalmente devolvería la versión con la que se compiló el Reporter y
        /// no la que hay instalada, que es justo lo que queremos comprobar.
        /// <c>Main.Version</c> sí es <c>static readonly</c> y se lee directo.
        /// </summary>
        public EhrVersionInfo GetVersionInfo() => new EhrVersionInfo
        {
            PluginVersion = RuntimeVersion(),
            TestBuildNumber = Convert.ToInt32(RuntimeConstant(nameof(Main.TestBuildNumber)) ?? 0),
            SupportedAmongUsVersion = RuntimeConstant(nameof(Main.SupportedAUVersion)) as string
        };

        private static string RuntimeVersion()
        {
            try
            {
                var version = Main.Version;
                if (version != null) return $"{version.Major}.{version.Minor}.{version.Build}";
            }
            catch (Exception) { /* caemos a la constante incrustada */ }
            return RuntimeConstant(nameof(Main.PluginVersion)) as string ?? Main.PluginVersion;
        }

        private static object RuntimeConstant(string name)
        {
            try
            {
                var field = typeof(Main).GetField(name, BindingFlags.Public | BindingFlags.Static);
                return field != null && field.IsLiteral ? field.GetRawConstantValue() : field?.GetValue(null);
            }
            catch (Exception)
            {
                return null;
            }
        }

        public bool IsGameFinished() =>
            GameStates.IsEnded && CustomWinnerHolder.WinnerTeam != CustomWinner.Default;

        public bool IsHost() => AmongUsClient.Instance != null && AmongUsClient.Instance.AmHost;

        public IReadOnlyList<byte> GetPlayers() => Main.PlayerStates.Keys.OrderBy(id => id).ToList();

        public string GetPlayerTeam(byte playerId) =>
            Main.PlayerStates.TryGetValue(playerId, out var state) ? state.countTypes.ToString() : null;

        public string GetPlayerRole(byte playerId) =>
            Main.PlayerStates.TryGetValue(playerId, out var state) ? state.MainRole.ToString() : null;

        public EhrTaskState GetTaskState(byte playerId)
        {
            if (!Main.PlayerStates.TryGetValue(playerId, out var state) || state.TaskState == null)
                return new EhrTaskState();

            var tasks = state.TaskState;
            return new EhrTaskState
            {
                HasTasks = tasks.HasTasks,
                AllTasksCount = Math.Max(0, tasks.AllTasksCount),
                CompletedTasksCount = Math.Max(0, tasks.CompletedTasksCount),
                IsTaskFinished = tasks.IsTaskFinished
            };
        }

        public int GetKillCount(byte playerId) =>
            Main.PlayerStates.TryGetValue(playerId, out var state) ? state.GetKillCount() : 0;

        public EhrWinner GetWinner() => new EhrWinner
        {
            Team = CustomWinnerHolder.WinnerTeam.ToString(),
            WinnerIds = CustomWinnerHolder.WinnerIds?.ToArray() ?? Array.Empty<byte>()
        };

        /// <summary>
        /// Se llama en el hook de inicio: guarda el Friend Code de cada jugador
        /// mientras su PlayerControl sigue vivo. Si alguien se desconecta a mitad
        /// de partida, su código sigue disponible para identificarlo al final.
        /// </summary>
        public void CaptureLobbyIdentities()
        {
            _friendCodes.Clear();
            try
            {
                foreach (var player in Main.EnumeratePlayerControls())
                {
                    if (player == null) continue;
                    var code = player.FriendCode;
                    if (!string.IsNullOrWhiteSpace(code)) _friendCodes[player.PlayerId] = code;
                }
            }
            catch (Exception error)
            {
                _log?.Warning($"No se han podido leer los Friend Codes del lobby: {error.Message}");
            }
        }

        public EhrGameSnapshot CaptureSnapshot()
        {
            var winner = GetWinner();
            var version = GetVersionInfo();
            var winnerIds = new HashSet<byte>(winner.WinnerIds);
            var snapshot = new EhrGameSnapshot
            {
                Finished = IsGameFinished(),
                WinnerTeam = winner.Team,
                GameMode = Options.CurrentGameMode.ToString(),
                Map = SafeMapName(),
                DurationSeconds = Math.Max(0, (int)(DateTime.UtcNow - SessionStartedUtc).TotalSeconds),
                EhrVersion = version.PluginVersion,
                EhrTestBuild = version.TestBuildNumber,
                AmongUsVersion = version.SupportedAmongUsVersion
            };

            foreach (var entry in Main.PlayerStates.OrderBy(pair => pair.Key))
            {
                var playerId = entry.Key;
                var state = entry.Value;
                var tasks = GetTaskState(playerId);
                var deathReason = state.deathReason.ToString();

                snapshot.Players.Add(new EhrPlayerSnapshot
                {
                    PlayerId = playerId,
                    Name = ResolveName(playerId, state),
                    FriendCode = ResolveFriendCode(playerId, state),
                    MainRole = state.MainRole.ToString(),
                    CountType = state.countTypes.ToString(),
                    IsDead = state.IsDead,
                    DeathReason = deathReason,
                    RealKillerId = state.GetRealKiller(),
                    HasTasks = tasks.HasTasks,
                    TasksTotal = tasks.AllTasksCount,
                    TasksCompleted = tasks.CompletedTasksCount,
                    IsTaskFinished = tasks.IsTaskFinished,
                    RawKillCount = state.GetKillCount(),
                    Won = winnerIds.Contains(playerId),
                    Disconnected = string.Equals(deathReason, "Disconnected", StringComparison.Ordinal)
                });
            }

            return snapshot;
        }

        private string ResolveName(byte playerId, PlayerState state)
        {
            if (Main.AllPlayerNames != null && Main.AllPlayerNames.TryGetValue(playerId, out var cached)
                && !string.IsNullOrWhiteSpace(cached))
            {
                return cached;
            }

            try
            {
                var player = state.Player;
                if (player != null && !string.IsNullOrWhiteSpace(player.Data?.PlayerName)) return player.Data.PlayerName;
            }
            catch (Exception) { /* el PlayerControl puede haberse destruido al desconectar */ }

            return $"Jugador {playerId}";
        }

        private string ResolveFriendCode(byte playerId, PlayerState state)
        {
            if (_friendCodes.TryGetValue(playerId, out var captured) && !string.IsNullOrWhiteSpace(captured))
                return captured;

            try
            {
                var player = state.Player;
                if (player != null && !string.IsNullOrWhiteSpace(player.FriendCode)) return player.FriendCode;
            }
            catch (Exception) { /* idem */ }

            return null;
        }

        private string SafeMapName()
        {
            try { return Main.CurrentMap.ToString(); }
            catch (Exception) { return null; }
        }
    }
}
