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
        /// </summary>
        public IReadOnlyCollection<string> AllowedRoles { get; set; } =
            new[] { "Crewmate", "Impostor" };

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
