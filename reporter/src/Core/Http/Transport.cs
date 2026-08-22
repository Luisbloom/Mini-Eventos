using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Jartiland.TournamentReporter.Http
{
    public sealed class TransportResponse
    {
        public int? StatusCode { get; set; }
        public string Body { get; set; }

        /// <summary>Mensaje de un fallo de red o de TLS. Null si hubo respuesta HTTP.</summary>
        public string TransportError { get; set; }

        public bool HasResponse => StatusCode.HasValue;

        public static TransportResponse Http(int statusCode, string body) =>
            new TransportResponse { StatusCode = statusCode, Body = body };

        public static TransportResponse Failure(string message) =>
            new TransportResponse { TransportError = message };
    }

    public interface IReporterTransport
    {
        Task<TransportResponse> GetAsync(Uri uri, IDictionary<string, string> headers, CancellationToken cancellation);
        Task<TransportResponse> PostJsonAsync(Uri uri, IDictionary<string, string> headers, string json, CancellationToken cancellation);
    }

    public enum SubmitDisposition
    {
        /// <summary>201 nuevo o 200 reintento aceptado: los dos son éxito.</summary>
        Accepted,

        /// <summary>Red caída, Tailscale apagado o error del servidor: se reintenta.</summary>
        RetryLater,

        /// <summary>401: la credencial no vale. No tiene sentido insistir deprisa.</summary>
        CredentialProblem,

        /// <summary>403: host deshabilitado o suplantación. Requiere al administrador.</summary>
        HostRejected,

        /// <summary>409: choque con otro resultado. Se conserva para revisión manual.</summary>
        Conflict,

        /// <summary>El servidor rechaza el contenido. Se conserva pero no se reintenta.</summary>
        Rejected
    }

    public static class HttpClassifier
    {
        public static SubmitDisposition Classify(TransportResponse response)
        {
            if (response == null || !response.HasResponse) return SubmitDisposition.RetryLater;
            var status = response.StatusCode.Value;
            if (status == 200 || status == 201) return SubmitDisposition.Accepted;
            if (status == 401) return SubmitDisposition.CredentialProblem;
            if (status == 403) return SubmitDisposition.HostRejected;
            if (status == 409) return SubmitDisposition.Conflict;
            if (status == 408 || status == 429) return SubmitDisposition.RetryLater;
            if (status >= 500) return SubmitDisposition.RetryLater;
            if (status >= 400) return SubmitDisposition.Rejected;
            return SubmitDisposition.RetryLater;
        }

        public static bool KeepsRetrying(SubmitDisposition disposition) =>
            disposition == SubmitDisposition.RetryLater
            || disposition == SubmitDisposition.CredentialProblem
            || disposition == SubmitDisposition.HostRejected;
    }

    /// <summary>
    /// Espera entre reintentos: 5 s, 15 s, 30 s, 60 s y a partir de ahí cada 5
    /// minutos. Un problema de credencial o de host desactivado espera 15 minutos
    /// desde el primer intento: hay que arreglarlo en /admin, no insistiendo.
    /// </summary>
    public static class RetrySchedule
    {
        public static readonly IReadOnlyList<TimeSpan> Delays = new[]
        {
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(15),
            TimeSpan.FromSeconds(30),
            TimeSpan.FromSeconds(60)
        };

        public static readonly TimeSpan MaximumDelay = TimeSpan.FromMinutes(5);
        public static readonly TimeSpan CredentialDelay = TimeSpan.FromMinutes(15);

        public static TimeSpan Next(int attempts, SubmitDisposition disposition)
        {
            if (disposition == SubmitDisposition.CredentialProblem || disposition == SubmitDisposition.HostRejected)
                return CredentialDelay;
            if (attempts <= 0) return Delays[0];
            return attempts <= Delays.Count ? Delays[attempts - 1] : MaximumDelay;
        }
    }
}
