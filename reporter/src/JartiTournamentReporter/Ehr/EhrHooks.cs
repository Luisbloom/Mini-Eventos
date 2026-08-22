using System;
using System.Reflection;
using HarmonyLib;
using Jartiland.TournamentReporter.Logging;
using Jartiland.TournamentReporter.Runtime;

namespace Jartiland.TournamentReporter.Ehr
{
    /// <summary>
    /// Dos únicos parches. No hace falta ninguno más:
    ///
    ///  · <c>AmongUsClient.CoStartGame</c> (vanilla) marca el comienzo de partida y
    ///    limpia el estado de la sesión anterior.
    ///  · <c>EHR.GameEndChecker.CheckCustomEndCriteria</c> es el método donde EHR
    ///    decide el final: al salir de él, WinnerTeam y WinnerIds ya son definitivos
    ///    y todavía no ha corrido la corrutina que revive jugadores. Es el punto
    ///    correcto para fotografiar el resultado.
    ///
    /// <c>GameEndChecker</c> es una clase interna de EHR, así que se localiza por
    /// nombre con AccessTools; el resto del proyecto usa la API pública compilada.
    /// </summary>
    public static class EhrHooks
    {
        public const string GameEndCheckerType = "EHR.GameEndChecker";
        public const string GameEndCheckerMethod = "CheckCustomEndCriteria";

        public static bool Apply(Harmony harmony, SecretSafeLog log)
        {
            var startPatched = PatchGameStart(harmony, log);
            var endPatched = PatchGameEnd(harmony, log);
            return startPatched && endPatched;
        }

        private static bool PatchGameStart(Harmony harmony, SecretSafeLog log)
        {
            try
            {
                var target = AccessTools.Method(typeof(AmongUsClient), nameof(AmongUsClient.CoStartGame));
                if (target == null)
                {
                    log.Error("No se ha encontrado AmongUsClient.CoStartGame. El inicio de partida no se detectará.");
                    return false;
                }

                harmony.Patch(target, postfix: new HarmonyMethod(Hook(nameof(AfterGameStart))));
                return true;
            }
            catch (Exception error)
            {
                log.Error($"No se ha podido enganchar el inicio de partida: {error.Message}");
                return false;
            }
        }

        private static bool PatchGameEnd(Harmony harmony, SecretSafeLog log)
        {
            try
            {
                var type = AccessTools.TypeByName(GameEndCheckerType);
                if (type == null)
                {
                    log.Error($"No se ha encontrado {GameEndCheckerType}. " +
                              "¿Está EHR instalado y es la versión esperada? Tournament Reporter desactivado.");
                    return false;
                }

                var target = AccessTools.Method(type, GameEndCheckerMethod);
                if (target == null)
                {
                    log.Error($"{GameEndCheckerType}.{GameEndCheckerMethod} ya no existe en esta versión de EHR. " +
                              "Hay que actualizar el adaptador del Reporter antes de usarlo.");
                    return false;
                }

                harmony.Patch(target, postfix: new HarmonyMethod(Hook(nameof(AfterGameEndCheck))));
                return true;
            }
            catch (Exception error)
            {
                log.Error($"No se ha podido enganchar el final de partida de EHR: {error.Message}");
                return false;
            }
        }

        private static MethodInfo Hook(string name) =>
            typeof(EhrHooks).GetMethod(name, BindingFlags.Public | BindingFlags.Static);

        public static void AfterGameStart()
        {
            try { ReporterSession.OnGameStarted(); }
            catch (Exception error) { ReporterSession.Log?.Error($"Hook de inicio: {error.Message}"); }
        }

        public static void AfterGameEndCheck()
        {
            try { ReporterSession.OnGameEndDetected(); }
            catch (Exception error) { ReporterSession.Log?.Error($"Hook de final: {error.Message}"); }
        }
    }
}
