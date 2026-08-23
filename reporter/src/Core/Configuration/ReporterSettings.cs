using System;
using System.Collections.Generic;

namespace Jartiland.TournamentReporter.Configuration
{
    public sealed class ReporterSettings
    {
        public string ServerUrl { get; set; }
        public string HostId { get; set; }
        public string ReporterToken { get; set; }

        /// <summary>Archivo .ini del que salió la configuración, para diagnóstico.</summary>
        public string SourceFile { get; set; }

        /// <summary>Sólo para pruebas locales contra http://127.0.0.1. Nunca en el torneo.</summary>
        public bool AllowInsecureHttp { get; set; }

        /// <summary>
        /// Roles de EHR admitidos por el torneo. Cualquier otro rol principal marca
        /// la partida como incompatible en lugar de convertirla en tripulante.
        ///
        /// Se admiten **todos los roles vanilla de Among Us** (ingeniero,
        /// científico, ángel guardián, cambiaformas…) porque cada uno sigue
        /// siendo tripulante o impostor y la puntuación no cambia. Lo que la
        /// lista bloquea son los roles propios de EHR y los neutrales, que sí
        /// romperían el modelo del torneo.
        ///
        /// De cada rol hacen falta sus dos nombres: EHR tiene el vanilla puro
        /// (<c>Engineer</c>) y su "Vanilla Remake" (<c>EngineerEHR</c>), y el
        /// que reparte de verdad en partida es el segundo.
        /// </summary>
        public IReadOnlyCollection<string> AllowedRoles { get; set; } = new[]
        {
            // Impostores vanilla y sus remakes
            "Impostor", "Phantom", "Shapeshifter", "Viper",
            "ImpostorEHR", "PhantomEHR", "ShapeshifterEHR", "ViperEHR",
            // Tripulantes vanilla y sus remakes
            "Crewmate", "Engineer", "GuardianAngel", "Noisemaker",
            "Scientist", "Tracker", "Detective", "Judge",
            "CrewmateEHR", "EngineerEHR", "GuardianAngelEHR", "NoisemakerEHR",
            "ScientistEHR", "TrackerEHR", "DetectiveEHR", "JudgeEHR"
        };

        public string TokenFingerprint => Logging.SecretSafeLog.Fingerprint(ReporterToken);

        public Uri BuildUri(string path)
        {
            return new Uri(new Uri(ServerUrl.TrimEnd('/') + "/"), path.TrimStart('/'));
        }
    }

    public enum ReporterConfigStatus
    {
        Loaded,
        NoConfigurationFile,
        MultipleConfigurationFiles,
        Invalid
    }

    public sealed class ReporterConfigResult
    {
        private ReporterConfigResult(ReporterConfigStatus status, ReporterSettings settings, string message)
        {
            Status = status;
            Settings = settings;
            Message = message;
        }

        public ReporterConfigStatus Status { get; }
        public ReporterSettings Settings { get; }
        public string Message { get; }
        public bool IsLoaded => Status == ReporterConfigStatus.Loaded;

        public static ReporterConfigResult Loaded(ReporterSettings settings, string message) =>
            new ReporterConfigResult(ReporterConfigStatus.Loaded, settings, message);

        public static ReporterConfigResult Failed(ReporterConfigStatus status, string message) =>
            new ReporterConfigResult(status, null, message);
    }
}
