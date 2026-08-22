using System.Collections.Generic;
using System.Linq;

namespace Jartiland.TournamentReporter.Model
{
    public sealed class RosterEntry
    {
        public int ParticipantId { get; set; }
        public string DisplayName { get; set; }

        /// <summary>SHA-256 del Friend Code normalizado. El código nunca sale del servidor.</summary>
        public string FriendCodeFingerprint { get; set; }
    }

    /// <summary>
    /// Contexto competitivo que el backend asigna a este host. El Reporter nunca
    /// deduce fase, grupo ni número de partida: si esto no llega o llega
    /// deshabilitado, el resultado se guarda pero no se envía.
    /// </summary>
    public sealed class CompetitionContext
    {
        public int EventId { get; set; }
        public string EventSlug { get; set; }
        public string EventName { get; set; }
        public string HostIdentifier { get; set; }
        public int StageId { get; set; }
        public string StageName { get; set; }
        public string StageType { get; set; }
        public int? GroupId { get; set; }
        public string GroupName { get; set; }
        public int MatchNumber { get; set; }
        public bool ReportingEnabled { get; set; }
        public string Reason { get; set; }
        public string Message { get; set; }
        public string SubmitPath { get; set; }
        public int RosterWithoutFriendCode { get; set; }
        public List<RosterEntry> Roster { get; set; } = new List<RosterEntry>();

        public RosterEntry FindByFingerprint(string fingerprint)
        {
            if (string.IsNullOrEmpty(fingerprint)) return null;
            return Roster.FirstOrDefault(entry =>
                string.Equals(entry.FriendCodeFingerprint, fingerprint, System.StringComparison.OrdinalIgnoreCase));
        }
    }
}
