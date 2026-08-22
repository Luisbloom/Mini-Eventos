using System;
using System.Collections.Generic;
using System.Linq;
using Jartiland.TournamentReporter.Model;

namespace Jartiland.TournamentReporter.Reporting
{
    public static class TournamentRules
    {
        public const string Crew = "crew";
        public const string Impostor = "impostor";

        /// <summary>
        /// Equipo competitivo a partir de <c>PlayerState.countTypes</c>, que es la
        /// decisión de equipo que EHR ya mantiene. Cualquier otro valor (Neutral,
        /// Coven, CustomTeam, OutOfGame…) devuelve null: el torneo sólo admite
        /// tripulante e impostor y nunca convertimos en crew lo que no lo es.
        /// </summary>
        public static string NormalizeTeam(string countType)
        {
            if (string.IsNullOrWhiteSpace(countType)) return null;
            if (string.Equals(countType, "Crew", StringComparison.OrdinalIgnoreCase)) return Crew;
            if (string.Equals(countType, "Impostor", StringComparison.OrdinalIgnoreCase)) return Impostor;
            return null;
        }

        /// <summary>
        /// Equipo ganador a partir de <c>CustomWinnerHolder.WinnerTeam</c>.
        /// Draw, None, Error, Neutrals y cualquier final neutral devuelven null:
        /// esa partida no es puntuable en este torneo.
        /// </summary>
        public static string NormalizeWinner(string winnerTeam)
        {
            if (string.IsNullOrWhiteSpace(winnerTeam)) return null;
            if (string.Equals(winnerTeam, "Crewmate", StringComparison.OrdinalIgnoreCase)) return Crew;
            if (string.Equals(winnerTeam, "Impostor", StringComparison.OrdinalIgnoreCase)) return Impostor;
            return null;
        }

        /// <summary>
        /// Muertes que EHR atribuye a un jugador pero que el torneo no cuenta como
        /// kill: expulsión por voto (EHR guarda 255 como asesino), desconexión,
        /// suicidio, disparo fallido del Sheriff y AFK. Todo lo demás con un
        /// RealKiller distinto de la víctima sí es una kill atribuible.
        /// </summary>
        public static readonly IReadOnlyCollection<string> NonAttributableDeathReasons = new[]
        {
            "Vote",
            "Disconnected",
            "Suicide",
            "FollowingSuicide",
            "Misfire",
            "AFK",
            "Fall",
            "etc"
        };

        public static bool IsAttributableKill(EhrPlayerSnapshot victim, byte killerId)
        {
            if (victim == null) return false;
            if (!victim.IsDead) return false;
            if (victim.PlayerId == killerId) return false;
            if (victim.RealKillerId != killerId) return false;
            if (victim.RealKillerId == EhrPlayerSnapshot.NoKiller) return false;
            return !NonAttributableDeathReasons.Contains(victim.DeathReason ?? string.Empty, StringComparer.OrdinalIgnoreCase);
        }

        public static int CountKills(byte killerId, IEnumerable<EhrPlayerSnapshot> players)
        {
            return players?.Count(victim => IsAttributableKill(victim, killerId)) ?? 0;
        }

        /// <summary>
        /// Un jugador muerto puede seguir completando tareas como fantasma, así que
        /// esto no mira nunca <c>IsDead</c>: sólo el contador de EHR.
        /// </summary>
        public static bool CompletedAllTasks(EhrPlayerSnapshot player)
        {
            if (player == null || !player.HasTasks) return false;
            if (player.TasksTotal <= 0) return false;
            return player.IsTaskFinished || player.TasksCompleted >= player.TasksTotal;
        }

        public static bool IsRoleAllowed(string mainRole, IReadOnlyCollection<string> allowedRoles)
        {
            if (allowedRoles == null || allowedRoles.Count == 0) return true;
            return allowedRoles.Contains(mainRole ?? string.Empty, StringComparer.OrdinalIgnoreCase);
        }
    }
}
