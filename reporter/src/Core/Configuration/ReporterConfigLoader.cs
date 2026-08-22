using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Jartiland.TournamentReporter.Configuration
{
    /// <summary>
    /// Carga el único archivo <c>*-reporter.ini</c> que debe acompañar a la DLL.
    /// Cero archivos deja el Reporter desactivado; más de uno también, porque no
    /// hay forma segura de saber si este PC es HOST_1 o HOST_2.
    /// </summary>
    public static class ReporterConfigLoader
    {
        public const string SearchPattern = "*-reporter.ini";
        private static readonly Regex HostIdPattern = new Regex("^[A-Za-z0-9_-]{1,40}$", RegexOptions.Compiled);

        public static ReporterConfigResult Discover(string directory)
        {
            if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            {
                return ReporterConfigResult.Failed(
                    ReporterConfigStatus.NoConfigurationFile,
                    $"No existe la carpeta de configuración '{directory}'.");
            }

            var files = Directory.GetFiles(directory, SearchPattern, SearchOption.TopDirectoryOnly)
                .OrderBy(file => file, StringComparer.OrdinalIgnoreCase)
                .ToList();

            return Discover(files, File.ReadAllLines);
        }

        public static ReporterConfigResult Discover(IReadOnlyList<string> files, Func<string, string[]> readLines)
        {
            if (files == null || files.Count == 0)
            {
                return ReporterConfigResult.Failed(
                    ReporterConfigStatus.NoConfigurationFile,
                    "No se ha encontrado ningún archivo *-reporter.ini junto a la DLL. " +
                    "Pide al administrador el archivo de este host y colócalo en BepInEx/plugins. " +
                    "Tournament Reporter desactivado.");
            }

            if (files.Count > 1)
            {
                var names = string.Join(", ", files.Select(Path.GetFileName));
                return ReporterConfigResult.Failed(
                    ReporterConfigStatus.MultipleConfigurationFiles,
                    $"Hay {files.Count} archivos *-reporter.ini ({names}). Deja sólo el de este PC: " +
                    "con varios no se puede saber qué host es éste y no se enviará ningún resultado.");
            }

            var file = files[0];
            string[] lines;
            try
            {
                lines = readLines(file);
            }
            catch (Exception error)
            {
                return ReporterConfigResult.Failed(
                    ReporterConfigStatus.Invalid,
                    $"No se ha podido leer {Path.GetFileName(file)}: {error.Message}");
            }

            return Parse(file, lines);
        }

        public static ReporterConfigResult Parse(string file, IEnumerable<string> lines)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var rawLine in lines ?? Enumerable.Empty<string>())
            {
                var line = (rawLine ?? string.Empty).Trim();
                if (line.Length == 0 || line[0] == '#' || line[0] == ';' || line[0] == '[') continue;
                var separator = line.IndexOf('=');
                if (separator <= 0) continue;
                var key = line.Substring(0, separator).Trim();
                var value = line.Substring(separator + 1).Trim();
                if (key.Length > 0) values[key] = value;
            }

            var name = Path.GetFileName(file);
            var settings = new ReporterSettings
            {
                ServerUrl = Value(values, "ServerUrl"),
                HostId = Value(values, "HostId"),
                ReporterToken = Value(values, "ReporterToken"),
                SourceFile = file,
                AllowInsecureHttp = ParseBool(Value(values, "AllowInsecureHttp"))
            };

            var allowedRoles = Value(values, "AllowedRoles");
            if (!string.IsNullOrWhiteSpace(allowedRoles))
            {
                var roles = allowedRoles.Split(',')
                    .Select(role => role.Trim())
                    .Where(role => role.Length > 0)
                    .ToArray();
                if (roles.Length > 0) settings.AllowedRoles = roles;
            }

            if (string.IsNullOrWhiteSpace(settings.ServerUrl))
                return Invalid(name, "falta ServerUrl");
            if (string.IsNullOrWhiteSpace(settings.HostId))
                return Invalid(name, "falta HostId");
            if (string.IsNullOrWhiteSpace(settings.ReporterToken))
                return Invalid(name, "falta ReporterToken");

            if (!Uri.TryCreate(settings.ServerUrl, UriKind.Absolute, out var uri))
                return Invalid(name, "ServerUrl no es una URL absoluta");
            if (!string.IsNullOrEmpty(uri.UserInfo))
                return Invalid(name, "ServerUrl no puede llevar usuario ni contraseña");
            if (uri.Scheme == Uri.UriSchemeHttp && !settings.AllowInsecureHttp)
                return Invalid(name, "ServerUrl debe usar HTTPS (añade AllowInsecureHttp=true sólo para pruebas locales)");
            if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
                return Invalid(name, "ServerUrl debe usar HTTPS");

            if (!HostIdPattern.IsMatch(settings.HostId))
                return Invalid(name, "HostId sólo admite letras, dígitos, guiones y guiones bajos");

            if (!settings.ReporterToken.StartsWith("jtr_", StringComparison.Ordinal))
            {
                return Invalid(name,
                    "ReporterToken debe ser la credencial por host generada desde /admin (empieza por jtr_)");
            }

            var summary = string.Format(
                CultureInfo.InvariantCulture,
                "Configuración {0} cargada desde {1}. ServerUrl={2} · credencial={3}",
                settings.HostId, name, uri.GetLeftPart(UriPartial.Authority), settings.TokenFingerprint);
            return ReporterConfigResult.Loaded(settings, summary);
        }

        private static ReporterConfigResult Invalid(string name, string reason) =>
            ReporterConfigResult.Failed(
                ReporterConfigStatus.Invalid,
                $"{name} no es válido: {reason}. Tournament Reporter desactivado.");

        private static string Value(IDictionary<string, string> values, string key) =>
            values.TryGetValue(key, out var value) ? value : null;

        private static bool ParseBool(string value) =>
            string.Equals(value, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "1", StringComparison.Ordinal)
            || string.Equals(value, "yes", StringComparison.OrdinalIgnoreCase);
    }
}
