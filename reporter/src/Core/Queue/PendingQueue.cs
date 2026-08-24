using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace Jartiland.TournamentReporter.Queue
{
    public sealed class PendingItem
    {
        public string ReportId { get; set; }
        public string Body { get; set; }
        public string SubmitPath { get; set; }
        public string BodyFile { get; set; }
        public int Attempts { get; set; }
        public DateTime NextAttemptUtc { get; set; }
        public string LastProblem { get; set; }
        public bool CredentialProblemReported { get; set; }
    }

    /// <summary>
    /// Cola de resultados en disco. Una partida se escribe entera y de forma
    /// atómica ANTES del primer intento de envío, así que un corte de red, un
    /// cierre de Among Us o un reinicio del PC no pueden perderla. El archivo
    /// guarda los bytes exactos que se enviaron: cada reintento repite ese cuerpo
    /// y el mismo reportId, que es lo que hace idempotente el reenvío.
    /// </summary>
    /// <summary>Una partida capturada, con la ruta para poder apartarla.</summary>
    public sealed class CapturedEntry
    {
        public string File { get; set; }
        public string Body { get; set; }
    }

    public sealed class PendingQueue
    {
        public const string PendingFolder = "pending";
        public const string SentFolder = "sent";
        public const string ConflictFolder = "conflict";
        public const string RejectedFolder = "rejected";
        public const string BlockedFolder = "blocked";
        public const string CapturedFolder = "captured";
        private const string PathExtension = ".path";

        private readonly string _root;

        public PendingQueue(string rootDirectory)
        {
            _root = rootDirectory ?? throw new ArgumentNullException(nameof(rootDirectory));
            foreach (var folder in new[] { PendingFolder, SentFolder, ConflictFolder, RejectedFolder, BlockedFolder, CapturedFolder })
            {
                Directory.CreateDirectory(Path.Combine(_root, folder));
            }
        }

        public string Root => _root;
        public string CapturedDirectory => Path.Combine(_root, CapturedFolder);

        public bool HasCaptured(string reportId) =>
            File.Exists(Path.Combine(CapturedDirectory, FileName(reportId)));

        /// <summary>
        /// Deja la partida en disco antes de que nadie toque la red. Es lo primero
        /// que ocurre al terminar, porque el estado de EHR desaparece en cuanto el
        /// juego vuelve al lobby.
        /// </summary>
        public string SaveCaptured(string reportId, string body)
        {
            var target = Path.Combine(CapturedDirectory, FileName(reportId));
            WriteAtomic(target, body);
            return target;
        }

        /// <summary>
        /// Devuelve lo capturado y todavia sin procesar, con su ruta, para poder
        /// apartar un archivo ilegible en vez de reintentarlo eternamente.
        /// </summary>
        public IReadOnlyList<CapturedEntry> LoadCaptured()
        {
            var entries = new List<CapturedEntry>();
            foreach (var file in Directory.GetFiles(CapturedDirectory, "*.json"))
            {
                var body = SafeRead(file);
                if (body == null) continue;
                entries.Add(new CapturedEntry { File = file, Body = body });
            }
            return entries;
        }

        /// <summary>Aparta lo que no se puede interpretar, sin borrarlo.</summary>
        public void QuarantineCaptured(string file)
        {
            try
            {
                var target = Path.Combine(BlockedDirectory, Path.GetFileName(file) + ".unreadable");
                File.Move(file, target, true);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        /// <summary>Solo se llama cuando la partida ya vive en otro estado.</summary>
        public void DiscardCaptured(string reportId)
        {
            var target = Path.Combine(CapturedDirectory, FileName(reportId));
            try { if (File.Exists(target)) File.Delete(target); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        public string PendingDirectory => Path.Combine(_root, PendingFolder);
        public string SentDirectory => Path.Combine(_root, SentFolder);
        public string ConflictDirectory => Path.Combine(_root, ConflictFolder);
        public string RejectedDirectory => Path.Combine(_root, RejectedFolder);
        public string BlockedDirectory => Path.Combine(_root, BlockedFolder);

        public bool WasAlreadySent(string reportId) =>
            File.Exists(Path.Combine(SentDirectory, FileName(reportId)))
            || File.Exists(Path.Combine(ConflictDirectory, FileName(reportId)))
            || File.Exists(Path.Combine(RejectedDirectory, FileName(reportId)))
            || File.Exists(Path.Combine(BlockedDirectory, FileName(reportId)));

        public bool IsPending(string reportId) =>
            File.Exists(Path.Combine(PendingDirectory, FileName(reportId)));

        /// <summary>
        /// Escribe el resultado en pending/ y devuelve la ruta. Si ese reportId ya
        /// existe no se sobrescribe nada: el cuerpo original manda siempre.
        /// </summary>
        public PendingItem Enqueue(string reportId, string submitPath, string body, DateTime nowUtc)
        {
            if (string.IsNullOrWhiteSpace(reportId)) throw new ArgumentException("reportId obligatorio", nameof(reportId));
            var bodyFile = Path.Combine(PendingDirectory, FileName(reportId));

            if (!File.Exists(bodyFile))
            {
                WriteAtomic(bodyFile, body);
                if (!string.IsNullOrWhiteSpace(submitPath))
                {
                    WriteAtomic(Path.ChangeExtension(bodyFile, PathExtension), submitPath);
                }
            }

            return new PendingItem
            {
                ReportId = reportId,
                Body = File.ReadAllText(bodyFile, Encoding.UTF8),
                SubmitPath = ReadSubmitPath(bodyFile) ?? submitPath,
                BodyFile = bodyFile,
                Attempts = 0,
                NextAttemptUtc = nowUtc
            };
        }

        public IReadOnlyList<PendingItem> Load(DateTime nowUtc)
        {
            if (!Directory.Exists(PendingDirectory)) return Array.Empty<PendingItem>();
            return Directory.GetFiles(PendingDirectory, "*.json", SearchOption.TopDirectoryOnly)
                .OrderBy(file => file, StringComparer.OrdinalIgnoreCase)
                .Select(file => new PendingItem
                {
                    ReportId = Path.GetFileNameWithoutExtension(file),
                    Body = SafeRead(file),
                    SubmitPath = ReadSubmitPath(file),
                    BodyFile = file,
                    Attempts = 0,
                    NextAttemptUtc = nowUtc
                })
                .Where(item => !string.IsNullOrWhiteSpace(item.Body))
                .ToList();
        }

        /// <summary>
        /// Guarda un resultado que el torneo no admite (final neutral, rol no
        /// permitido, sin contexto…). No se envía nunca, pero queda en disco para
        /// que el administrador pueda revisarlo o introducirlo a mano.
        /// </summary>
        public string SaveBlocked(string reportId, string body, string note)
        {
            var target = Path.Combine(BlockedDirectory, FileName(reportId));
            WriteAtomic(target, body);
            if (!string.IsNullOrWhiteSpace(note))
            {
                var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
                WriteAtomic(Path.ChangeExtension(target, ".note"), $"{stamp} {note}{Environment.NewLine}");
            }
            return target;
        }

        public void MarkSent(PendingItem item) => Move(item, SentDirectory, null);

        public void MarkConflict(PendingItem item, string note) => Move(item, ConflictDirectory, note);

        public void MarkRejected(PendingItem item, string note) => Move(item, RejectedDirectory, note);

        private void Move(PendingItem item, string destination, string note)
        {
            if (item?.BodyFile == null) return;
            var target = Path.Combine(destination, Path.GetFileName(item.BodyFile));
            if (File.Exists(item.BodyFile)) File.Move(item.BodyFile, target, true);

            var pathFile = Path.ChangeExtension(item.BodyFile, PathExtension);
            if (File.Exists(pathFile))
            {
                File.Move(pathFile, Path.ChangeExtension(target, PathExtension), true);
            }

            if (!string.IsNullOrWhiteSpace(note))
            {
                var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
                WriteAtomic(Path.ChangeExtension(target, ".note"), $"{stamp} {note}{Environment.NewLine}");
            }
        }

        private static string ReadSubmitPath(string bodyFile)
        {
            var pathFile = Path.ChangeExtension(bodyFile, PathExtension);
            if (!File.Exists(pathFile)) return null;
            var value = SafeRead(pathFile);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private static string SafeRead(string file)
        {
            try { return File.ReadAllText(file, Encoding.UTF8); }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
        }

        private static void WriteAtomic(string target, string content)
        {
            var temporary = target + ".tmp";
            var bytes = new UTF8Encoding(false).GetBytes(content);
            using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(true);
            }
            File.Move(temporary, target, true);
        }

        private static string FileName(string reportId) => $"{Sanitize(reportId)}.json";

        /// <summary>El reportId viaja al nombre del archivo, así que no puede escaparse de la carpeta.</summary>
        public static string Sanitize(string reportId)
        {
            var builder = new StringBuilder(reportId.Length);
            foreach (var character in reportId)
            {
                builder.Append(char.IsLetterOrDigit(character) || character == '-' || character == '_' ? character : '_');
            }
            return builder.ToString();
        }
    }
}
