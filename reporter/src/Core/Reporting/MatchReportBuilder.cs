using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Jartiland.TournamentReporter.Configuration;
using Jartiland.TournamentReporter.Model;

namespace Jartiland.TournamentReporter.Reporting
{
    public sealed class MatchReportOutcome
    {
        public bool Success => Result != null && Blocking.Count == 0;
        public MatchResult Result { get; set; }
        public List<string> Blocking { get; } = new List<string>();
        public List<string> Warnings { get; } = new List<string>();
    }

    /// <summary>
    /// Convierte la foto que dejó EHR al terminar la partida en el cuerpo exacto
    /// que acepta <c>POST /api/events/:slug/matches</c>. Sólo datos crudos: la
    /// puntuación la calcula el backend, aquí no se suma ni un punto.
    /// </summary>
    public static class MatchReportBuilder
    {
        public const string SupportedGameMode = "Standard";

        public static MatchReportOutcome Build(
            EhrGameSnapshot snapshot,
            CompetitionContext context,
            ReporterSettings settings,
            string pluginVersion,
            string reportId,
            DateTime playedAtUtc)
        {
            var outcome = new MatchReportOutcome();

            if (snapshot == null)
            {
                outcome.Blocking.Add("No hay datos de la partida.");
                return outcome;
            }

            if (!snapshot.Finished)
            {
                outcome.Blocking.Add("EHR todavía no ha marcado la partida como terminada.");
                return outcome;
            }

            if (!string.Equals(snapshot.GameMode, SupportedGameMode, StringComparison.OrdinalIgnoreCase))
            {
                outcome.Blocking.Add($"El modo de juego '{snapshot.GameMode}' no es el modo estándar del torneo.");
            }

            var winner = TournamentRules.NormalizeWinner(snapshot.WinnerTeam);
            if (winner == null)
            {
                outcome.Blocking.Add(
                    $"El final '{snapshot.WinnerTeam}' no es una victoria de tripulantes ni de impostores; " +
                    "esta partida no es puntuable.");
            }

            if (context == null || !context.ReportingEnabled)
            {
                outcome.Blocking.Add(context?.Message
                    ?? "No se ha podido determinar la fase, el grupo ni el número de partida.");
            }

            var players = new List<PlayerResult>();
            foreach (var player in snapshot.Players ?? new List<EhrPlayerSnapshot>())
            {
                var fingerprint = FriendCodeFingerprint.Compute(player.FriendCode);
                var rosterEntry = context?.FindByFingerprint(fingerprint);
                if (rosterEntry == null)
                {
                    outcome.Warnings.Add(
                        $"{Describe(player)} no está inscrito en esta fase o grupo y queda fuera del resultado.");
                    continue;
                }

                var team = TournamentRules.NormalizeTeam(player.CountType);
                if (team == null)
                {
                    outcome.Blocking.Add(
                        $"{rosterEntry.DisplayName} terminó como '{player.CountType}' ({player.MainRole}), " +
                        "que no es tripulante ni impostor.");
                    continue;
                }

                if (!TournamentRules.IsRoleAllowed(player.MainRole, settings?.AllowedRoles))
                {
                    outcome.Blocking.Add(
                        $"{rosterEntry.DisplayName} jugó con el rol '{player.MainRole}', que no está admitido en el torneo.");
                    continue;
                }

                if (winner != null && player.Won != string.Equals(team, winner, StringComparison.Ordinal))
                {
                    outcome.Blocking.Add(
                        $"{rosterEntry.DisplayName} figura como {(player.Won ? "ganador" : "perdedor")} " +
                        $"siendo {team} en una victoria de {winner}.");
                    continue;
                }

                players.Add(new PlayerResult
                {
                    ParticipantId = rosterEntry.ParticipantId,
                    FriendCode = FriendCodeFingerprint.Normalize(player.FriendCode),
                    Name = player.Name,
                    PlayerId = player.PlayerId,
                    Team = team,
                    Role = team,
                    RawRole = player.MainRole,
                    RawCountType = player.CountType,
                    DeathReason = player.IsDead ? player.DeathReason : null,
                    Won = player.Won,
                    Kills = TournamentRules.CountKills(player.PlayerId, snapshot.Players),
                    RawKills = player.RawKillCount,
                    TasksCompleted = player.TasksCompleted,
                    TasksTotal = player.TasksTotal,
                    AllTasksCompleted = TournamentRules.CompletedAllTasks(player),
                    Disconnected = player.Disconnected
                });
            }

            if (players.Count < 2)
            {
                outcome.Blocking.Add(
                    $"Sólo se han podido identificar {players.Count} jugadores inscritos; el resultado no se envía.");
            }

            var absent = context?.Roster
                .Where(entry => players.All(player => player.ParticipantId != entry.ParticipantId))
                .Select(entry => entry.DisplayName)
                .ToList();
            if (absent != null && absent.Count > 0)
            {
                outcome.Warnings.Add($"No han jugado esta partida: {string.Join(", ", absent)}.");
            }

            if (context != null && context.RosterWithoutFriendCode > 0)
            {
                outcome.Warnings.Add(
                    $"{context.RosterWithoutFriendCode} inscritos no tienen Friend Code registrado en /admin " +
                    "y nunca podrán identificarse automáticamente.");
            }

            outcome.Result = new MatchResult
            {
                ReportId = reportId,
                HostId = settings?.HostId ?? context?.HostIdentifier,
                StageId = context?.StageId ?? 0,
                GroupId = context?.GroupId,
                MatchNumber = context?.MatchNumber ?? 0,
                PlayedAt = playedAtUtc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                Winner = winner,
                Map = snapshot.Map,
                GameMode = "standard",
                DurationSeconds = snapshot.DurationSeconds,
                SubmitPath = context?.SubmitPath,
                Reporter = new ReporterStamp
                {
                    Plugin = pluginVersion,
                    Ehr = snapshot.EhrVersion,
                    EhrTestBuild = snapshot.EhrTestBuild,
                    AmongUs = snapshot.AmongUsVersion
                },
                Players = players
            };

            return outcome;
        }

        public static string NewReportId(string hostId, Guid identifier) =>
            $"{hostId}-{identifier.ToString("D", CultureInfo.InvariantCulture)}";

        private static string Describe(EhrPlayerSnapshot player) =>
            string.IsNullOrWhiteSpace(player.Name) ? $"El jugador {player.PlayerId}" : player.Name;
    }
}
