using System.Collections.Generic;

namespace Jartiland.TournamentReporter.Model
{
    public sealed class PlayerResult
    {
        public int? ParticipantId { get; set; }
        public string FriendCode { get; set; }
        public string Name { get; set; }
        public int PlayerId { get; set; }

        /// <summary>Normalizado: <c>crew</c> o <c>impostor</c>.</summary>
        public string Team { get; set; }

        /// <summary>Igual que <see cref="Team"/>: el backend puntúa por rol competitivo.</summary>
        public string Role { get; set; }

        public string RawRole { get; set; }
        public string RawCountType { get; set; }
        public string DeathReason { get; set; }
        public bool Won { get; set; }

        /// <summary>Kills válidas del torneo según <see cref="Reporting.TournamentRules"/>.</summary>
        public int Kills { get; set; }

        /// <summary>Kills que EHR atribuye sin filtrar, para auditar discrepancias.</summary>
        public int RawKills { get; set; }

        public int TasksCompleted { get; set; }
        public int TasksTotal { get; set; }
        public bool AllTasksCompleted { get; set; }
        public bool Disconnected { get; set; }
    }

    public sealed class ReporterStamp
    {
        public string Plugin { get; set; }
        public string Ehr { get; set; }
        public int EhrTestBuild { get; set; }
        public string AmongUs { get; set; }
    }

    /// <summary>
    /// Resultado listo para enviar. Se serializa una sola vez y se guarda en disco
    /// antes del primer intento: los reintentos reenvían exactamente esos bytes,
    /// de modo que la huella de idempotencia del backend siempre coincide.
    /// </summary>
    public sealed class MatchResult
    {
        public string ReportId { get; set; }
        public string HostId { get; set; }
        public int StageId { get; set; }
        public int? GroupId { get; set; }
        public int MatchNumber { get; set; }
        public string PlayedAt { get; set; }
        public string Winner { get; set; }
        public string Map { get; set; }
        public string GameMode { get; set; }
        public int DurationSeconds { get; set; }
        public ReporterStamp Reporter { get; set; }
        public List<PlayerResult> Players { get; set; } = new List<PlayerResult>();

        /// <summary>Ruta relativa de envío que indicó el backend. No viaja en el cuerpo.</summary>
        public string SubmitPath { get; set; }

        public string Describe()
        {
            var group = GroupId.HasValue ? $"grupo {GroupId.Value}" : "sin grupo";
            return $"{HostId} · fase {StageId} · {group} · partida {MatchNumber} · ganador {Winner} · {Players.Count} jugadores";
        }
    }
}
