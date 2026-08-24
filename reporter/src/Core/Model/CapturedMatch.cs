using System;

namespace Jartiland.TournamentReporter.Model
{
    /// <summary>
    /// Lo que se guarda en disco nada mas terminar la partida, antes de hablar con
    /// nadie. Contiene todo lo irrepetible: cuando Among Us vuelve al lobby el
    /// estado de EHR ya no existe, asi que si esto no esta escrito la partida se
    /// pierde para siempre.
    ///
    /// El ReportId se genera aqui y no al enviar: asi una partida conserva su
    /// identidad aunque el juego se cierre y el envio ocurra en otro arranque, y el
    /// backend la sigue reconociendo como la misma.
    /// </summary>
    public sealed class CapturedMatch
    {
        public string ReportId { get; set; }
        public string HostId { get; set; }
        public string PlayedAt { get; set; }
        public string PluginVersion { get; set; }
        public EhrGameSnapshot Snapshot { get; set; }
    }
}
