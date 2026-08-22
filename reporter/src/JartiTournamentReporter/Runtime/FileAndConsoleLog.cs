using System;
using System.Globalization;
using System.IO;
using System.Text;
using BepInEx.Logging;
using Jartiland.TournamentReporter.Logging;

namespace Jartiland.TournamentReporter.Runtime
{
    /// <summary>
    /// Escribe en la consola de BepInEx y además en logs/reporter.log, para que el
    /// administrador pueda revisar lo ocurrido sin pelearse con LogOutput.log.
    /// Los secretos ya vienen borrados por <see cref="SecretSafeLog"/>.
    /// </summary>
    public sealed class FileAndConsoleLog : IReporterLog
    {
        private readonly ManualLogSource _console;
        private readonly string _file;
        private readonly object _gate = new object();

        public FileAndConsoleLog(ManualLogSource console, string logDirectory)
        {
            _console = console;
            try
            {
                Directory.CreateDirectory(logDirectory);
                _file = Path.Combine(logDirectory, "reporter.log");
            }
            catch (Exception)
            {
                _file = null;
            }
        }

        public void Info(string message) => Write("INFO", message, _console.LogInfo);
        public void Warning(string message) => Write("WARN", message, _console.LogWarning);
        public void Error(string message) => Write("ERROR", message, _console.LogError);

        private void Write(string level, string message, Action<object> console)
        {
            try { console(message); }
            catch (Exception) { /* la consola no debe tumbar nunca el juego */ }

            if (_file == null) return;
            var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
            try
            {
                lock (_gate)
                {
                    File.AppendAllText(_file, $"{stamp} {level} {message}{Environment.NewLine}", new UTF8Encoding(false));
                }
            }
            catch (Exception) { /* si el disco falla, al menos queda la consola */ }
        }
    }
}
