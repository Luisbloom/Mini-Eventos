using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using Jartiland.TournamentReporter.Configuration;
using Jartiland.TournamentReporter.Ehr;
using Jartiland.TournamentReporter.Logging;
using Jartiland.TournamentReporter.Reporting;

namespace Jartiland.TournamentReporter.Runtime
{
    public enum SessionState
    {
        Idle,
        Playing,
        Finalizing,
        Queued
    }

    /// <summary>
    /// Máquina de estados de una partida. Los hooks de Harmony sólo llaman aquí y
    /// aquí se garantiza que un final se procesa exactamente una vez, por muy
    /// repetido que sea el hook de EHR.
    /// </summary>
    public static class ReporterSession
    {
        private static readonly object Gate = new object();
        private static SessionState _state = SessionState.Idle;
        private static bool _finalHandled;

        public static ReporterService Service { get; set; }
        public static Ehr800Adapter Adapter { get; set; }
        public static SecretSafeLog Log { get; set; }
        public static ReporterSettings Settings { get; set; }
        public static string PluginVersion { get; set; } = "0.0.0";
        public static CancellationToken Cancellation { get; set; } = CancellationToken.None;

        public static SessionState State { get { lock (Gate) return _state; } }

        public static bool IsEnabled => Service != null && Adapter != null && Settings != null;

        public static void OnGameStarted()
        {
            if (!IsEnabled) return;

            lock (Gate)
            {
                _state = SessionState.Playing;
                _finalHandled = false;
            }

            try
            {
                Adapter.SessionStartedUtc = DateTime.UtcNow;
                Adapter.CaptureLobbyIdentities();
            }
            catch (Exception error)
            {
                Log.Warning($"No se ha podido preparar la sesión: {error.Message}");
            }

            if (!Adapter.IsHost())
            {
                Log.Info("Partida iniciada. Este PC no es el host, así que no reportará nada.");
                return;
            }

            Log.Info("Partida iniciada.");
            Run(async () => await Service.RefreshContextAsync(Cancellation).ConfigureAwait(false));
        }

        /// <summary>
        /// Se invoca desde el postfix del cálculo de final de EHR. Cuando llega
        /// aquí, EHR ya ha fijado WinnerTeam y WinnerIds; la foto se toma en este
        /// mismo hilo, antes de que la secuencia de cierre reviva a los muertos o
        /// les cambie el rol a fantasma.
        /// </summary>
        public static void OnGameEndDetected()
        {
            if (!IsEnabled) return;

            lock (Gate)
            {
                if (_finalHandled || _state != SessionState.Playing) return;
                if (!Adapter.IsHost()) return;
                if (!Adapter.IsGameFinished()) return;
                _finalHandled = true;
                _state = SessionState.Finalizing;
            }

            Model.EhrGameSnapshot snapshot;
            try
            {
                snapshot = Adapter.CaptureSnapshot();
            }
            catch (Exception error)
            {
                Log.Error($"No se ha podido capturar el estado final: {error.Message}");
                lock (Gate) _state = SessionState.Idle;
                return;
            }

            Log.Info($"Final detectado ({snapshot.WinnerTeam}). {snapshot.Players.Count} jugadores capturados.");

            // Escribir AHORA, en este hilo y antes de tocar la red. Es un archivo
            // pequeño con flush a disco: si el jugador cierra Among Us un segundo
            // después, el resultado ya está a salvo y se recoge al arrancar.
            var reportId = MatchReportBuilder.NewReportId(Settings.HostId, Guid.NewGuid());
            try
            {
                Service.Capture(new Model.CapturedMatch
                {
                    ReportId = reportId,
                    HostId = Settings.HostId,
                    PlayedAt = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                    PluginVersion = PluginVersion,
                    Snapshot = snapshot
                });
            }
            catch (Exception error)
            {
                Log.Error($"No se ha podido guardar la partida en disco: {error.Message}");
                lock (Gate) _state = SessionState.Idle;
                return;
            }

            lock (Gate) _state = SessionState.Queued;
            Run(async () =>
            {
                await Service.ProcessCapturedAsync(Cancellation).ConfigureAwait(false);
                await Service.PumpAsync(Cancellation).ConfigureAwait(false);
            });
        }


        private static void Run(Func<Task> work)
        {
            Task.Run(async () =>
            {
                try { await work().ConfigureAwait(false); }
                catch (OperationCanceledException) { /* Among Us se está cerrando */ }
                catch (Exception error) { Log.Error($"Fallo en segundo plano: {error.Message}"); }
            });
        }
    }
}
