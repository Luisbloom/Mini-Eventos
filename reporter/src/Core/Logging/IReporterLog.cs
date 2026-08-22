using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

namespace Jartiland.TournamentReporter.Logging
{
    public interface IReporterLog
    {
        void Info(string message);
        void Warning(string message);
        void Error(string message);
    }

    /// <summary>
    /// Envuelve cualquier log y borra los secretos conocidos antes de escribir.
    /// La credencial nunca debe aparecer entera en BepInEx/LogOutput.log ni en el
    /// archivo propio del Reporter, ni siquiera dentro del mensaje de una excepción.
    /// </summary>
    public sealed class SecretSafeLog : IReporterLog
    {
        public const string Prefix = "[JartiTournamentReporter]";

        private readonly IReporterLog _inner;
        private readonly List<string> _secrets = new List<string>();

        public SecretSafeLog(IReporterLog inner)
        {
            _inner = inner ?? throw new ArgumentNullException(nameof(inner));
        }

        public void ProtectSecret(string secret)
        {
            if (string.IsNullOrWhiteSpace(secret) || secret.Length < 6) return;
            if (!_secrets.Contains(secret)) _secrets.Add(secret);
        }

        public string Scrub(string message)
        {
            if (string.IsNullOrEmpty(message)) return message;
            var scrubbed = message;
            foreach (var secret in _secrets) scrubbed = scrubbed.Replace(secret, "***");
            return scrubbed;
        }

        public void Info(string message) => _inner.Info($"{Prefix} {Scrub(message)}");
        public void Warning(string message) => _inner.Warning($"{Prefix} {Scrub(message)}");
        public void Error(string message) => _inner.Error($"{Prefix} {Scrub(message)}");

        /// <summary>
        /// Huella corta e irreversible de una credencial. Permite comprobar en el
        /// log que un host usa la clave esperada sin revelar ni un fragmento de ella.
        /// </summary>
        public static string Fingerprint(string secret)
        {
            if (string.IsNullOrEmpty(secret)) return "sin-credencial";
            using (var sha = SHA256.Create())
            {
                var digest = sha.ComputeHash(Encoding.UTF8.GetBytes(secret));
                var builder = new StringBuilder(8);
                for (var index = 0; index < 4; index++) builder.Append(digest[index].ToString("x2"));
                return builder.ToString();
            }
        }
    }
}
