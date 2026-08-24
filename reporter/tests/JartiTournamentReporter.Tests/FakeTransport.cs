using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jartiland.TournamentReporter.Http;
using Jartiland.TournamentReporter.Logging;

namespace Jartiland.TournamentReporter.Tests
{
    internal sealed class RecordedRequest
    {
        public string Method { get; set; }
        public Uri Uri { get; set; }
        public IDictionary<string, string> Headers { get; set; }
        public string Body { get; set; }
    }

    internal sealed class FakeTransport : IReporterTransport
    {
        private readonly Queue<TransportResponse> _postResponses = new Queue<TransportResponse>();
        private readonly Queue<TransportResponse> _contextResponses = new Queue<TransportResponse>();

        public List<RecordedRequest> Requests { get; } = new List<RecordedRequest>();
        public TransportResponse ContextResponse { get; set; }
        public TransportResponse DefaultPostResponse { get; set; } = TransportResponse.Http(201, "{}");

        public IEnumerable<RecordedRequest> Posts => Requests.Where(request => request.Method == "POST");

        public void EnqueuePost(params TransportResponse[] responses)
        {
            foreach (var response in responses) _postResponses.Enqueue(response);
        }

        /// <summary>Para probar un servidor que falla y luego se recupera.</summary>
        public void EnqueueContext(params TransportResponse[] responses)
        {
            foreach (var response in responses) _contextResponses.Enqueue(response);
        }

        public Task<TransportResponse> GetAsync(Uri uri, IDictionary<string, string> headers, CancellationToken cancellation)
        {
            Requests.Add(new RecordedRequest { Method = "GET", Uri = uri, Headers = headers });
            if (_contextResponses.Count > 0) return Task.FromResult(_contextResponses.Dequeue());
            return Task.FromResult(ContextResponse ?? TransportResponse.Failure("sin respuesta configurada"));
        }

        public Task<TransportResponse> PostJsonAsync(Uri uri, IDictionary<string, string> headers, string json, CancellationToken cancellation)
        {
            Requests.Add(new RecordedRequest { Method = "POST", Uri = uri, Headers = headers, Body = json });
            var response = _postResponses.Count > 0 ? _postResponses.Dequeue() : DefaultPostResponse;
            return Task.FromResult(response);
        }
    }

    internal sealed class RecordingLog : IReporterLog
    {
        public List<string> Lines { get; } = new List<string>();

        public void Info(string message) => Lines.Add(message);
        public void Warning(string message) => Lines.Add(message);
        public void Error(string message) => Lines.Add(message);

        public string All => string.Join("\n", Lines);
        public bool Contains(string fragment) => Lines.Any(line => line.Contains(fragment, StringComparison.OrdinalIgnoreCase));
    }

    internal sealed class TestClock
    {
        public DateTime UtcNow { get; set; } = new DateTime(2026, 8, 22, 18, 30, 0, DateTimeKind.Utc);

        public DateTime Read() => UtcNow;
        public void Advance(TimeSpan amount) => UtcNow = UtcNow.Add(amount);
    }
}
