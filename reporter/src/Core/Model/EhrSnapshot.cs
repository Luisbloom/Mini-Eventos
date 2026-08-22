using System.Collections.Generic;

namespace Jartiland.TournamentReporter.Model
{
    /// <summary>
    /// Copia inmutable de lo que EHR sabe de un jugador en el instante en que la
    /// partida termina. Se captura en el hilo de Unity y a partir de ahí todo el
    /// trabajo (normalizar, serializar, enviar) ocurre sobre estos datos, nunca
    /// sobre objetos vivos del juego.
    /// </summary>
    public sealed class EhrPlayerSnapshot
    {
        public byte PlayerId { get; set; }
        public string Name { get; set; }
        public string FriendCode { get; set; }

        /// <summary>Nombre crudo de <c>PlayerState.MainRole</c>.</summary>
        public string MainRole { get; set; }

        /// <summary>Nombre crudo de <c>PlayerState.countTypes</c>: la decisión de equipo de EHR.</summary>
        public string CountType { get; set; }

        public bool IsDead { get; set; }

        /// <summary>Nombre crudo de <c>PlayerState.deathReason</c>.</summary>
        public string DeathReason { get; set; }

        /// <summary><c>PlayerState.GetRealKiller()</c>; 255 cuando no hay asesino atribuido.</summary>
        public byte RealKillerId { get; set; } = NoKiller;

        public bool HasTasks { get; set; }
        public int TasksTotal { get; set; }
        public int TasksCompleted { get; set; }
        public bool IsTaskFinished { get; set; }

        /// <summary><c>PlayerState.GetKillCount()</c> sin filtrar, sólo para diagnóstico.</summary>
        public int RawKillCount { get; set; }

        /// <summary>Verdadero si <c>CustomWinnerHolder</c> incluye a este jugador.</summary>
        public bool Won { get; set; }

        public bool Disconnected { get; set; }

        public const byte NoKiller = 255;
    }

    public sealed class EhrGameSnapshot
    {
        public bool Finished { get; set; }

        /// <summary>Nombre crudo de <c>CustomWinnerHolder.WinnerTeam</c>.</summary>
        public string WinnerTeam { get; set; }

        public string GameMode { get; set; }
        public string Map { get; set; }
        public int DurationSeconds { get; set; }
        public string EhrVersion { get; set; }
        public int EhrTestBuild { get; set; }
        public string AmongUsVersion { get; set; }
        public List<EhrPlayerSnapshot> Players { get; set; } = new List<EhrPlayerSnapshot>();
    }

    public sealed class EhrTaskState
    {
        public bool HasTasks { get; set; }
        public int AllTasksCount { get; set; }
        public int CompletedTasksCount { get; set; }
        public bool IsTaskFinished { get; set; }
    }

    public sealed class EhrWinner
    {
        public string Team { get; set; }
        public IReadOnlyCollection<byte> WinnerIds { get; set; } = new byte[0];
    }

    public sealed class EhrVersionInfo
    {
        public string PluginVersion { get; set; }
        public int TestBuildNumber { get; set; }
        public string SupportedAmongUsVersion { get; set; }

        public override string ToString() =>
            TestBuildNumber > 0
                ? $"EHR {PluginVersion} Test Build {TestBuildNumber} (Among Us {SupportedAmongUsVersion})"
                : $"EHR {PluginVersion} (Among Us {SupportedAmongUsVersion})";
    }
}
