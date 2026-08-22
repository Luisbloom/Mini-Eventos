using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using BepInEx;
using BepInEx.Unity.IL2CPP;
using HarmonyLib;
using Jartiland.TournamentReporter.Configuration;
using Jartiland.TournamentReporter.Ehr;
using Jartiland.TournamentReporter.Logging;
using Jartiland.TournamentReporter.Queue;
using Jartiland.TournamentReporter.Runtime;

namespace Jartiland.TournamentReporter
{
    [BepInPlugin(PluginGuid, "Jarti Tournament Reporter", PluginVersion)]
    [BepInDependency(EhrGuid, BepInDependency.DependencyFlags.HardDependency)]
    [BepInProcess("Among Us.exe")]
    public sealed class JartiReporterPlugin : BasePlugin
    {
        public const string PluginGuid = "es.jartiland.tournamentreporter";
        public const string PluginVersion = "0.1.0";
        public const string EhrGuid = "com.gurge44.endlesshostroles";

        public const string SupportedEhrVersion = "8.0.0";
        public const string SupportedAmongUsVersion = "2026.8.18";
        public const string DataFolderName = "JartiTournamentReporter";

        private readonly CancellationTokenSource _cancellation = new CancellationTokenSource();
        private Harmony _harmony;
        private HttpTransport _transport;
        private SecretSafeLog _log;

        public override void Load()
        {
            var pluginDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)
                                  ?? Paths.PluginPath;
            var dataDirectory = Path.Combine(pluginDirectory, DataFolderName);
            _log = new SecretSafeLog(new FileAndConsoleLog(Log, Path.Combine(dataDirectory, "logs")));
            _log.Info($"Tournament Reporter {PluginVersion} iniciando. Datos en {dataDirectory}");

            var configuration = ReporterConfigLoader.Discover(pluginDirectory);
            if (!configuration.IsLoaded)
            {
                _log.Error(configuration.Message);
                return;
            }

            var settings = configuration.Settings;
            _log.ProtectSecret(settings.ReporterToken);
            _log.Info(configuration.Message);

            var adapter = new Ehr800Adapter(_log);
            if (!adapter.IsAvailable)
            {
                _log.Error("EHR no encontrado o incompatible. Tournament Reporter desactivado.");
                return;
            }

            var version = adapter.GetVersionInfo();
            _log.Info($"Detectado {version}. El Reporter está probado contra EHR {SupportedEhrVersion} " +
                      $"y Among Us {SupportedAmongUsVersion}.");
            if (!string.Equals(version.PluginVersion, SupportedEhrVersion, StringComparison.Ordinal)
                || !string.Equals(version.SupportedAmongUsVersion, SupportedAmongUsVersion, StringComparison.Ordinal))
            {
                _log.Warning("La versión de EHR o de Among Us no es la probada. " +
                             "Revisa docs/reporter/ehr-integration.md antes de usarlo en un torneo real.");
            }

            PendingQueue queue;
            try
            {
                queue = new PendingQueue(dataDirectory);
            }
            catch (Exception error)
            {
                _log.Error($"No se ha podido preparar la carpeta de resultados: {error.Message}. " +
                           "Tournament Reporter desactivado para no perder partidas en silencio.");
                return;
            }

            _transport = new HttpTransport($"JartiTournamentReporter/{PluginVersion}");
            var service = new ReporterService(settings, queue, _transport, _log);

            ReporterSession.Log = _log;
            ReporterSession.Settings = settings;
            ReporterSession.Adapter = adapter;
            ReporterSession.Service = service;
            ReporterSession.PluginVersion = PluginVersion;
            ReporterSession.Cancellation = _cancellation.Token;

            service.RestorePending();

            _harmony = new Harmony(PluginGuid);
            if (!EhrHooks.Apply(_harmony, _log))
            {
                ReporterSession.Service = null;
                _log.Error("No se han podido instalar los hooks. El Reporter no enviará nada, " +
                           "pero Among Us y EHR siguen funcionando con normalidad.");
                return;
            }

            StartRetryLoop(service);
            _log.Info($"Tournament Reporter listo. {service.DescribeQueue()}");
        }

        /// <summary>
        /// Bucle de reintentos en segundo plano. Nunca toca el hilo de Unity, así
        /// que una caída de Tailscale no congela la partida.
        /// </summary>
        private void StartRetryLoop(ReporterService service)
        {
            var token = _cancellation.Token;
            Task.Run(async () =>
            {
                while (!token.IsCancellationRequested)
                {
                    try
                    {
                        await service.PumpAsync(token).ConfigureAwait(false);
                        await Task.Delay(TimeSpan.FromSeconds(2), token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) { return; }
                    catch (Exception error)
                    {
                        _log.Error($"Fallo del bucle de reintentos: {error.Message}");
                        try { await Task.Delay(TimeSpan.FromSeconds(30), token).ConfigureAwait(false); }
                        catch (OperationCanceledException) { return; }
                    }
                }
            });
        }

        public override bool Unload()
        {
            _cancellation.Cancel();
            _harmony?.UnpatchSelf();
            _transport?.Dispose();
            _cancellation.Dispose();
            return base.Unload();
        }
    }
}
