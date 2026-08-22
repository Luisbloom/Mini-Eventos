using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Jartiland.TournamentReporter.Http;

namespace Jartiland.TournamentReporter.Runtime
{
    /// <summary>
    /// HttpClient normal de .NET, siempre fuera del hilo de Unity. No se toca la
    /// validación TLS: si el certificado de Tailscale no valida, el envío falla y
    /// el resultado se queda en pending, que es lo correcto.
    /// </summary>
    public sealed class HttpTransport : IReporterTransport, IDisposable
    {
        private readonly HttpClient _client;

        public HttpTransport(string userAgent, TimeSpan? timeout = null)
        {
            _client = new HttpClient { Timeout = timeout ?? TimeSpan.FromSeconds(20) };
            _client.DefaultRequestHeaders.Add("User-Agent", userAgent);
        }

        public Task<TransportResponse> GetAsync(Uri uri, IDictionary<string, string> headers, CancellationToken cancellation) =>
            SendAsync(new HttpRequestMessage(HttpMethod.Get, uri), headers, cancellation);

        public Task<TransportResponse> PostJsonAsync(Uri uri, IDictionary<string, string> headers, string json, CancellationToken cancellation)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, uri)
            {
                Content = new StringContent(json, new UTF8Encoding(false), "application/json")
            };
            return SendAsync(request, headers, cancellation);
        }

        private async Task<TransportResponse> SendAsync(
            HttpRequestMessage request,
            IDictionary<string, string> headers,
            CancellationToken cancellation)
        {
            using (request)
            {
                if (headers != null)
                {
                    foreach (var header in headers) request.Headers.TryAddWithoutValidation(header.Key, header.Value);
                }

                try
                {
                    using (var response = await _client.SendAsync(request, cancellation).ConfigureAwait(false))
                    {
                        var body = response.Content == null
                            ? string.Empty
                            : await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                        return TransportResponse.Http((int)response.StatusCode, body);
                    }
                }
                catch (TaskCanceledException) when (!cancellation.IsCancellationRequested)
                {
                    return TransportResponse.Failure("el servidor no ha respondido a tiempo");
                }
                catch (HttpRequestException error)
                {
                    return TransportResponse.Failure(Describe(error));
                }
            }
        }

        private static string Describe(HttpRequestException error)
        {
            var inner = error.InnerException;
            return inner == null ? error.Message : $"{error.Message} ({inner.Message})";
        }

        public void Dispose() => _client.Dispose();
    }
}
