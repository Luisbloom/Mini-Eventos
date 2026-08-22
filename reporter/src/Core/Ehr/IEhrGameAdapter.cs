using System.Collections.Generic;
using Jartiland.TournamentReporter.Model;

namespace Jartiland.TournamentReporter.Ehr
{
    /// <summary>
    /// Única superficie por la que el Reporter toca EHR. Cuando cambie la versión
    /// de EHR (8.0.0 TB3 → 8.0.0 estable → 8.1.0) sólo debería hacer falta tocar
    /// la implementación de esta interfaz, nunca el resto del proyecto.
    /// </summary>
    public interface IEhrGameAdapter
    {
        /// <summary>False si EHR no está cargado o su API no coincide con lo esperado.</summary>
        bool IsAvailable { get; }

        EhrVersionInfo GetVersionInfo();

        /// <summary>True cuando EHR ya ha decidido y publicado el resultado final.</summary>
        bool IsGameFinished();

        /// <summary>True si este PC es el host de la partida. Sólo el host reporta.</summary>
        bool IsHost();

        IReadOnlyList<byte> GetPlayers();

        /// <summary>Valor crudo de <c>PlayerState.countTypes</c>.</summary>
        string GetPlayerTeam(byte playerId);

        /// <summary>Valor crudo de <c>PlayerState.MainRole</c>.</summary>
        string GetPlayerRole(byte playerId);

        EhrTaskState GetTaskState(byte playerId);

        /// <summary>Valor crudo de <c>PlayerState.GetKillCount()</c>, sin filtrar por causa de muerte.</summary>
        int GetKillCount(byte playerId);

        EhrWinner GetWinner();

        /// <summary>
        /// Copia completa y coherente del estado final. Debe llamarse en el hilo de
        /// Unity, en cuanto EHR termina de calcular el ganador y antes de que la
        /// secuencia de fin de partida reviva jugadores o cambie roles fantasma.
        /// </summary>
        EhrGameSnapshot CaptureSnapshot();
    }
}
