using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jartiland.TournamentReporter.Configuration;
using Jartiland.TournamentReporter.Http;
using Jartiland.TournamentReporter.Json;
using Jartiland.TournamentReporter.Logging;
using Jartiland.TournamentReporter.Model;
using Jartiland.TournamentReporter.Queue;

namespace Jartiland.TournamentReporter
{
    /// <summary>
    /// Todo lo que ocurre fuera del hilo de Unity: pedir contexto, guardar el
    /// resultado, enviarlo y reintentarlo. No conoce ningún tipo de Among Us ni de
    /// EHR, de modo que se puede probar entero sin abrir el juego.
    /// </summary>
    public sealed class ReporterService
    {
        public const string ContextPath = "/api/reporter/context";

        private readonly ReporterSettings _settings;
        private readonly PendingQueue _queue;
        private readonly IReporterTransport _transport;
        private readonly SecretSafeLog _log;
        private readonly Func<DateTime> _clock;
        private readonly Func<TimeSpan, CancellationToken, Task> _delay;
        private readonly List<PendingItem> _items = new List<PendingItem>();
        private readonly object _gate = new object();

        // El bucle de reintentos de fondo y el envío inmediato de una partida
        // recién terminada pueden coincidir. Sin esto, los dos podrían coger el
        // mismo pendiente y enviarlo por duplicado.
        private readonly SemaphoreSlim _pump = new SemaphoreSlim(1, 1);

        public ReporterService(
            ReporterSettings settings,
            PendingQueue queue,
            IReporterTransport transport,
            SecretSafeLog log,
            Func<DateTime> clock = null,
            Func<TimeSpan, CancellationToken, Task> delay = null)
        {
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));
            _queue = queue ?? throw new ArgumentNullException(nameof(queue));
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _log = log ?? throw new ArgumentNullException(nameof(log));
            _clock = clock ?? (() => DateTime.UtcNow);
            _delay = delay ?? Task.Delay;
            _log.ProtectSecret(_settings.ReporterToken);
        }


        /// <summary>
        /// Espera entre intentos cuando el servidor no contesta. Son segundos, no
        /// minutos: la partida ya ha terminado y esto corre fuera del hilo del juego.
        /// </summary>
        public static readonly IReadOnlyList<TimeSpan> DefaultContextRetries = new[]
        {
            TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(15)
        };

        /// <summary>
        /// Resuelve el contexto reintentando mientras no haya ninguno. Sin esto, una
        /// caída pasajera del backend justo al terminar la partida convertía un
        /// resultado perfectamente válido en uno bloqueado, que hay que rescatar a
        /// mano. Si el torneo sí responde y dice que no se puede reportar, eso no se
        /// reintenta: es una respuesta, no un fallo.
        /// </summary>
        public async Task<CompetitionContext> ResolveContextAsync(
            CancellationToken cancellation,
            IReadOnlyList<TimeSpan> retryDelays = null)
        {
            var delays = retryDelays ?? DefaultContextRetries;
            var context = await RefreshContextAsync(cancellation).ConfigureAwait(false);

            for (var attempt = 0; context == null && attempt < delays.Count; attempt++)
            {
                _log.Warning(
                    $"Sin contexto competitivo todavía; reintento {attempt + 1} de {delays.Count}.");
                try
                {
                    await _delay(delays[attempt], cancellation).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                context = await RefreshContextAsync(cancellation).ConfigureAwait(false);
            }

            return context;
        }

        public CompetitionContext LastContext { get; private set; }

        public int PendingCount { get { lock (_gate) return _items.Count; } }

        /// <summary>Recupera al arrancar todo lo que quedó sin confirmar.</summary>
        public int RestorePending()
        {
            var restored = _queue.Load(_clock());
            lock (_gate)
            {
                foreach (var item in restored)
                {
                    if (_items.Any(existing => existing.ReportId == item.ReportId)) continue;
                    _items.Add(item);
                }
            }
            if (restored.Count > 0)
            {
                _log.Info($"{restored.Count} resultado(s) pendientes recuperados de disco. Se reintentarán en segundo plano.");
            }
            return restored.Count;
        }

        public async Task<CompetitionContext> RefreshContextAsync(CancellationToken cancellation)
        {
            TransportResponse response;
            try
            {
                response = await _transport.GetAsync(_settings.BuildUri(ContextPath), Headers(), cancellation)
                    .ConfigureAwait(false);
            }
            catch (Exception error)
            {
                _log.Warning($"No se ha podido consultar el contexto competitivo: {error.Message}");
                return LastContext;
            }

            if (!response.HasResponse)
            {
                _log.Warning($"No se ha podido consultar el contexto competitivo: {response.TransportError}");
                return LastContext;
            }

            if (response.StatusCode != 200)
            {
                var code = ContextJson.ReadErrorCode(response.Body) ?? $"HTTP {response.StatusCode}";
                _log.Error($"El servidor ha rechazado la consulta de contexto ({code}). " +
                           $"HostId={_settings.HostId} · credencial={_settings.TokenFingerprint}. " +
                           "Revisa el host y su clave en /admin.");
                return LastContext;
            }

            CompetitionContext context;
            try
            {
                context = ContextJson.Parse(response.Body);
            }
            catch (Exception error)
            {
                _log.Error($"La respuesta de contexto no se ha podido interpretar: {error.Message}");
                return LastContext;
            }

            LastContext = context;
            if (context.ReportingEnabled)
            {
                _log.Info($"Contexto asignado: {context.Message} ({context.Roster.Count} inscritos identificables).");
            }
            else
            {
                _log.Error($"Este host no puede enviar resultados ahora mismo: {context.Message} [{context.Reason}]");
            }
            return context;
        }

        /// <summary>
        /// Guarda el resultado en disco y lo pone en cola. Nunca envía antes de
        /// haber escrito el archivo: si el envío falla, el resultado ya está a salvo.
        /// </summary>
        public PendingItem Enqueue(MatchResult match)
        {
            var body = MatchJson.Serialize(match);
            var submitPath = match.SubmitPath ?? LastContext?.SubmitPath;
            if (string.IsNullOrWhiteSpace(submitPath))
            {
                _log.Error($"El resultado {match.ReportId} no sabe a qué evento pertenece y se guarda sin ruta de envío.");
            }

            if (_queue.WasAlreadySent(match.ReportId))
            {
                _log.Warning($"El resultado {match.ReportId} ya estaba resuelto en disco; no se vuelve a encolar.");
                return null;
            }

            var item = _queue.Enqueue(match.ReportId, submitPath, body, _clock());
            lock (_gate)
            {
                if (_items.Any(existing => existing.ReportId == item.ReportId))
                {
                    _log.Warning($"El resultado {match.ReportId} ya estaba en la cola; no se duplica.");
                    return null;
                }
                _items.Add(item);
            }

            _log.Info($"Resultado guardado: {match.ReportId} · {match.Describe()}");
            return item;
        }

        /// <summary>
        /// Conserva en disco un resultado que el torneo no admite. No se envía
        /// nunca, pero tampoco se pierde: el administrador puede revisarlo.
        /// </summary>
        public string SaveBlocked(string reportId, MatchResult match, string note)
        {
            var body = match == null ? "{}" : MatchJson.Serialize(match);
            return _queue.SaveBlocked(reportId, body, note);
        }

        public async Task PumpAsync(CancellationToken cancellation)
        {
            await _pump.WaitAsync(cancellation).ConfigureAwait(false);
            try
            {
                List<PendingItem> due;
                var now = _clock();
                lock (_gate)
                {
                    due = _items.Where(item => item.NextAttemptUtc <= now).ToList();
                }

                foreach (var item in due)
                {
                    if (cancellation.IsCancellationRequested) return;
                    await SendAsync(item, cancellation).ConfigureAwait(false);
                }
            }
            finally
            {
                _pump.Release();
            }
        }

        private async Task SendAsync(PendingItem item, CancellationToken cancellation)
        {
            if (string.IsNullOrWhiteSpace(item.SubmitPath))
            {
                var fallback = LastContext?.SubmitPath;
                if (string.IsNullOrWhiteSpace(fallback))
                {
                    Reschedule(item, SubmitDisposition.RetryLater, "sin ruta de envío conocida");
                    return;
                }
                item.SubmitPath = fallback;
            }

            item.Attempts++;
            TransportResponse response;
            try
            {
                _log.Info($"Enviando resultado {item.ReportId} (intento {item.Attempts})...");
                response = await _transport
                    .PostJsonAsync(_settings.BuildUri(item.SubmitPath), Headers(), item.Body, cancellation)
                    .ConfigureAwait(false);
            }
            catch (Exception error)
            {
                response = TransportResponse.Failure(error.Message);
            }

            var disposition = HttpClassifier.Classify(response);
            var code = response.HasResponse ? ContextJson.ReadErrorCode(response.Body) : null;
            var detail = response.HasResponse
                ? $"HTTP {response.StatusCode}{(code == null ? string.Empty : $" {code}")}"
                : response.TransportError;

            switch (disposition)
            {
                case SubmitDisposition.Accepted:
                    Remove(item);
                    _queue.MarkSent(item);
                    _log.Info($"Resultado aceptado {detail}: {item.ReportId}.");
                    break;

                case SubmitDisposition.Conflict:
                    Remove(item);
                    _queue.MarkConflict(item, detail);
                    _log.Error($"El servidor ya tiene un resultado distinto para ese hueco ({detail}). " +
                               $"El archivo queda en conflict/ para que lo revise el administrador: {item.ReportId}.");
                    break;

                case SubmitDisposition.Rejected:
                    Remove(item);
                    _queue.MarkRejected(item, detail);
                    _log.Error($"El servidor ha rechazado el resultado ({detail}). " +
                               $"Se conserva en rejected/ sin modificarlo: {item.ReportId}.");
                    break;

                case SubmitDisposition.CredentialProblem:
                    if (!item.CredentialProblemReported)
                    {
                        item.CredentialProblemReported = true;
                        _log.Error($"Credencial rechazada ({detail}). HostId={_settings.HostId} · " +
                                   $"credencial={_settings.TokenFingerprint}. Pide un .ini nuevo en /admin. " +
                                   "El resultado se conserva en pending.");
                    }
                    Reschedule(item, disposition, detail);
                    break;

                case SubmitDisposition.HostRejected:
                    if (!item.CredentialProblemReported)
                    {
                        item.CredentialProblemReported = true;
                        _log.Error($"El servidor no acepta a este host ({detail}). " +
                                   "Comprueba en /admin que está activo y que el .ini es el suyo. " +
                                   "El resultado se conserva en pending.");
                    }
                    Reschedule(item, disposition, detail);
                    break;

                default:
                    Reschedule(item, disposition, detail);
                    _log.Warning($"Resultado conservado en pending ({detail}). " +
                                 $"Reintento número {item.Attempts + 1} de {item.ReportId} programado.");
                    break;
            }
        }

        private void Reschedule(PendingItem item, SubmitDisposition disposition, string problem)
        {
            item.LastProblem = problem;
            item.NextAttemptUtc = _clock().Add(RetrySchedule.Next(item.Attempts, disposition));
        }

        private void Remove(PendingItem item)
        {
            lock (_gate) _items.RemoveAll(existing => existing.ReportId == item.ReportId);
        }

        private IDictionary<string, string> Headers() => new Dictionary<string, string>
        {
            ["Authorization"] = $"Bearer {_settings.ReporterToken}",
            ["X-Host-Id"] = _settings.HostId,
            ["Accept"] = "application/json"
        };

        public string DescribeQueue()
        {
            lock (_gate)
            {
                if (_items.Count == 0) return "Sin resultados pendientes.";
                var next = _items.Min(item => item.NextAttemptUtc);
                return string.Format(
                    CultureInfo.InvariantCulture,
                    "{0} resultado(s) pendientes. Próximo intento {1:HH:mm:ss} UTC.",
                    _items.Count, next);
            }
        }
    }
}
