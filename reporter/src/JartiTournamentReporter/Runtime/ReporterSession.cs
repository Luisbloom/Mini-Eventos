using System;
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
            Run(async () => await FinalizeAsync(snapshot).ConfigureAwait(false));
        }

        private static async Task FinalizeAsync(Model.EhrGameSnapshot snapshot)
        {
            var playedAt = DateTime.UtcNow;
            var reportId = MatchReportBuilder.NewReportId(Settings.HostId, Guid.NewGuid());

            var context = await Service.ResolveContextAsync(Cancellation).ConfigureAwait(false);
            var outcome = MatchReportBuilder.Build(snapshot, context, Settings, PluginVersion, reportId, playedAt);

            foreach (var warning in outcome.Warnings) Log.Warning(warning);

            if (!outcome.Success)
            {
                var note = string.Join(" | ", outcome.Blocking);
                foreach (var problem in outcome.Blocking) Log.Error(problem);
                try
                {
                    var file = Service.SaveBlocked(reportId, outcome.Result, note);
                    Log.Error($"Resultado no enviable guardado para revisión manual en {file}.");
                }
                catch (Exception error)
                {
                    Log.Error($"Tampoco se ha podido guardar el resultado no enviable: {error.Message}");
                }
                lock (Gate) _state = SessionState.Idle;
                return;
            }

            Service.Enqueue(outcome.Result);
            lock (Gate) _state = SessionState.Queued;
            await Service.PumpAsync(Cancellation).ConfigureAwait(false);
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
