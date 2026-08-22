using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jartiland.TournamentReporter.Http;
using Jartiland.TournamentReporter.Logging;
using Jartiland.TournamentReporter.Queue;
using Xunit;

namespace Jartiland.TournamentReporter.Tests
{
    public class ReporterServiceTests : IDisposable
    {
        private readonly string _root;
        private readonly PendingQueue _queue;
        private readonly FakeTransport _transport = new FakeTransport();
        private readonly RecordingLog _sink = new RecordingLog();
        private readonly SecretSafeLog _log;
        private readonly TestClock _clock = new TestClock();
        private readonly ReporterService _service;

        public ReporterServiceTests()
        {
            _root = TestPaths.CreateTemporaryDirectory();
            _queue = new PendingQueue(_root);
            _log = new SecretSafeLog(_sink);
            _service = new ReporterService(SampleGame.Settings(), _queue, _transport, _log, _clock.Read);
        }

        public void Dispose()
        {
            try { Directory.Delete(_root, true); } catch (IOException) { }
        }

        private Jartiland.TournamentReporter.Model.MatchResult SampleMatch() => SampleGame.Build().Result;

        [Fact]
        public async Task Sends_the_result_and_files_it_as_sent()
        {
            var match = SampleMatch();
            _service.Enqueue(match);

            await _service.PumpAsync(CancellationToken.None);

            var post = Assert.Single(_transport.Posts);
            Assert.Equal(
                "https://mini-eventos-jartiland.tail9d0334.ts.net:10000/api/events/among-us-agosto-2026/matches",
                post.Uri.ToString());
            Assert.Equal($"Bearer {SampleGame.Token}", post.Headers["Authorization"]);
            Assert.Equal("HOST_1", post.Headers["X-Host-Id"]);
            Assert.False(_queue.IsPending(match.ReportId));
            Assert.True(_queue.WasAlreadySent(match.ReportId));
            Assert.Equal(0, _service.PendingCount);
            Assert.True(_sink.Contains("Resultado aceptado HTTP 201"));
        }

        [Fact]
        public async Task Treats_a_replayed_result_answered_with_200_as_success()
        {
            _transport.EnqueuePost(TransportResponse.Http(200, "{}"));
            var match = SampleMatch();
            _service.Enqueue(match);

            await _service.PumpAsync(CancellationToken.None);

            Assert.True(_queue.WasAlreadySent(match.ReportId));
            Assert.True(_sink.Contains("Resultado aceptado HTTP 200"));
        }

        [Fact]
        public async Task Keeps_the_result_and_retries_with_the_same_identifier_when_the_network_fails()
        {
            _transport.EnqueuePost(
                TransportResponse.Failure("no route to host"),
                TransportResponse.Failure("no route to host"),
                TransportResponse.Http(201, "{}"));
            var match = SampleMatch();
            _service.Enqueue(match);

            await _service.PumpAsync(CancellationToken.None);
            Assert.True(_queue.IsPending(match.ReportId));
            Assert.True(_sink.Contains("conservado en pending"));

            _clock.Advance(TimeSpan.FromSeconds(6));
            await _service.PumpAsync(CancellationToken.None);
            Assert.True(_queue.IsPending(match.ReportId));

            _clock.Advance(TimeSpan.FromSeconds(16));
            await _service.PumpAsync(CancellationToken.None);

            Assert.False(_queue.IsPending(match.ReportId));
            Assert.Equal(3, _transport.Posts.Count());
            Assert.Single(_transport.Posts.Select(post => post.Body).Distinct());
            Assert.All(_transport.Posts, post => Assert.Contains(match.ReportId, post.Body));
        }

        [Fact]
        public async Task Does_not_retry_before_its_turn()
        {
            _transport.EnqueuePost(TransportResponse.Failure("timeout"));
            _service.Enqueue(SampleMatch());

            await _service.PumpAsync(CancellationToken.None);
            _clock.Advance(TimeSpan.FromSeconds(1));
            await _service.PumpAsync(CancellationToken.None);

            Assert.Single(_transport.Posts);
        }

        [Fact]
        public async Task Files_a_slot_conflict_for_the_administrator_without_retrying()
        {
            _transport.EnqueuePost(TransportResponse.Http(409,
                "{\"error\":{\"code\":\"MATCH_SLOT_OCCUPIED\",\"message\":\"ocupado\"}}"));
            var match = SampleMatch();
            _service.Enqueue(match);

            await _service.PumpAsync(CancellationToken.None);
            _clock.Advance(TimeSpan.FromHours(1));
            await _service.PumpAsync(CancellationToken.None);

            Assert.Single(_transport.Posts);
            Assert.False(_queue.IsPending(match.ReportId));
            Assert.True(File.Exists(Path.Combine(_queue.ConflictDirectory, $"{match.ReportId}.json")));
            Assert.True(_sink.Contains("MATCH_SLOT_OCCUPIED"));
            Assert.True(_sink.Contains("conflict/"));
        }

        [Fact]
        public async Task Keeps_a_rejected_body_untouched_for_diagnosis()
        {
            _transport.EnqueuePost(TransportResponse.Http(400,
                "{\"error\":{\"code\":\"INVALID_REPORT\",\"message\":\"faltan datos\"}}"));
            var match = SampleMatch();
            _service.Enqueue(match);

            await _service.PumpAsync(CancellationToken.None);
            _clock.Advance(TimeSpan.FromHours(1));
            await _service.PumpAsync(CancellationToken.None);

            Assert.Single(_transport.Posts);
            var stored = File.ReadAllText(Path.Combine(_queue.RejectedDirectory, $"{match.ReportId}.json"));
            Assert.Equal(_transport.Posts.Single().Body, stored);
        }

        [Fact]
        public async Task Stops_hammering_the_server_when_the_credential_is_rejected()
        {
            _transport.DefaultPostResponse = TransportResponse.Http(401,
                "{\"error\":{\"code\":\"REPORTER_TOKEN_INVALID\",\"message\":\"no vale\"}}");
            var match = SampleMatch();
            _service.Enqueue(match);

            await _service.PumpAsync(CancellationToken.None);
            _clock.Advance(TimeSpan.FromMinutes(5));
            await _service.PumpAsync(CancellationToken.None);

            Assert.Single(_transport.Posts);
            Assert.True(_queue.IsPending(match.ReportId));
            Assert.True(_sink.Contains("Credencial rechazada"));
            Assert.True(_sink.Contains("conserva en pending"));

            _clock.Advance(TimeSpan.FromMinutes(16));
            await _service.PumpAsync(CancellationToken.None);
            Assert.Equal(2, _transport.Posts.Count());
            Assert.Single(_sink.Lines, line => line.Contains("Credencial rechazada"));
        }

        [Fact]
        public async Task Reports_a_disabled_host_as_a_configuration_problem()
        {
            _transport.DefaultPostResponse = TransportResponse.Http(403,
                "{\"error\":{\"code\":\"REPORTER_HOST_DISABLED\",\"message\":\"desactivado\"}}");
            _service.Enqueue(SampleMatch());

            await _service.PumpAsync(CancellationToken.None);

            Assert.True(_sink.Contains("no acepta a este host"));
            Assert.True(_sink.Contains("REPORTER_HOST_DISABLED"));
        }

        [Fact]
        public async Task Never_writes_the_credential_in_any_log_line()
        {
            _transport.DefaultPostResponse = TransportResponse.Http(401,
                $"{{\"error\":{{\"code\":\"REPORTER_TOKEN_INVALID\",\"message\":\"{SampleGame.Token} no vale\"}}}}");
            _transport.ContextResponse = TransportResponse.Http(401, $"token {SampleGame.Token}");

            await _service.RefreshContextAsync(CancellationToken.None);
            _service.Enqueue(SampleMatch());
            await _service.PumpAsync(CancellationToken.None);

            Assert.NotEmpty(_sink.Lines);
            Assert.DoesNotContain(SampleGame.Token, _sink.All);
            Assert.DoesNotContain(SampleGame.Token.Substring(4, 12), _sink.All);
            Assert.Contains(SecretSafeLog.Fingerprint(SampleGame.Token), _sink.All);
            Assert.All(_sink.Lines, line => Assert.StartsWith("[JartiTournamentReporter]", line));
        }

        [Fact]
        public async Task Recovers_and_resends_a_pending_result_after_a_restart()
        {
            var match = SampleMatch();
            _service.Enqueue(match);
            _transport.EnqueuePost(TransportResponse.Failure("tailscale apagado"));
            await _service.PumpAsync(CancellationToken.None);
            Assert.True(_queue.IsPending(match.ReportId));

            var reopenedQueue = new PendingQueue(_root);
            var afterRestart = new ReporterService(
                SampleGame.Settings(), reopenedQueue, _transport, new SecretSafeLog(_sink), _clock.Read);

            Assert.Equal(1, afterRestart.RestorePending());
            await afterRestart.PumpAsync(CancellationToken.None);

            Assert.False(reopenedQueue.IsPending(match.ReportId));
            Assert.True(reopenedQueue.WasAlreadySent(match.ReportId));
            Assert.Equal(match.ReportId, ReadReportId(_transport.Posts.Last().Body));
        }

        [Fact]
        public async Task Refuses_to_queue_the_same_result_twice()
        {
            var match = SampleMatch();
            Assert.NotNull(_service.Enqueue(match));
            Assert.Null(_service.Enqueue(match));
            Assert.Equal(1, _service.PendingCount);

            await _service.PumpAsync(CancellationToken.None);
            Assert.Null(_service.Enqueue(match));
            Assert.Single(_transport.Posts);
        }

        [Fact]
        public async Task Reads_the_competitive_context_from_the_backend()
        {
            _transport.ContextResponse = TransportResponse.Http(
                200, File.ReadAllText(TestPaths.Contract("reporter-context.json")));

            var context = await _service.RefreshContextAsync(CancellationToken.None);

            Assert.True(context.ReportingEnabled);
            Assert.Equal(1, context.MatchNumber);
            var get = Assert.Single(_transport.Requests, request => request.Method == "GET");
            Assert.Equal(
                "https://mini-eventos-jartiland.tail9d0334.ts.net:10000/api/reporter/context",
                get.Uri.ToString());
            Assert.True(_sink.Contains("Contexto asignado"));
        }

        [Fact]
        public async Task Keeps_the_last_known_context_when_the_server_is_unreachable()
        {
            _transport.ContextResponse = TransportResponse.Http(
                200, File.ReadAllText(TestPaths.Contract("reporter-context.json")));
            await _service.RefreshContextAsync(CancellationToken.None);

            _transport.ContextResponse = TransportResponse.Failure("tailscale apagado");
            var context = await _service.RefreshContextAsync(CancellationToken.None);

            Assert.NotNull(context);
            Assert.Equal(1, context.StageId);
            Assert.True(_sink.Contains("No se ha podido consultar el contexto"));
        }

        [Fact]
        public async Task Explains_clearly_when_the_host_has_no_assignment()
        {
            _transport.ContextResponse = TransportResponse.Http(200,
                "{\"reportingEnabled\":false,\"reason\":\"HOST_NOT_ASSIGNED\"," +
                "\"message\":\"El host no tiene fase asignada. Asígnasela desde /admin.\"}");

            var context = await _service.RefreshContextAsync(CancellationToken.None);

            Assert.False(context.ReportingEnabled);
            Assert.Equal("HOST_NOT_ASSIGNED", context.Reason);
            Assert.True(_sink.Contains("no puede enviar resultados"));
            Assert.True(_sink.Contains("HOST_NOT_ASSIGNED"));
        }

        [Fact]
        public async Task Holds_a_result_that_does_not_know_which_event_it_belongs_to()
        {
            var match = SampleMatch();
            match.SubmitPath = null;
            _service.Enqueue(match);

            await _service.PumpAsync(CancellationToken.None);

            Assert.Empty(_transport.Posts);
            Assert.True(_queue.IsPending(match.ReportId));
        }

        [Fact]
        public async Task Does_not_send_the_same_result_twice_when_two_pumps_overlap()
        {
            var match = SampleMatch();
            _service.Enqueue(match);

            // El bucle de fondo y el envío inmediato del final de partida.
            await Task.WhenAll(
                _service.PumpAsync(CancellationToken.None),
                _service.PumpAsync(CancellationToken.None));

            Assert.Single(_transport.Posts);
            Assert.True(_queue.WasAlreadySent(match.ReportId));
        }

        private static string ReadReportId(string body)
        {
            using (var document = System.Text.Json.JsonDocument.Parse(body))
            {
                return document.RootElement.GetProperty("reportId").GetString();
            }
        }
    }
}
