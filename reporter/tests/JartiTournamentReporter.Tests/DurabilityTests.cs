using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jartiland.TournamentReporter.Http;
using Jartiland.TournamentReporter.Json;
using Jartiland.TournamentReporter.Logging;
using Jartiland.TournamentReporter.Model;
using Jartiland.TournamentReporter.Queue;
using Jartiland.TournamentReporter.Reporting;
using Xunit;

namespace Jartiland.TournamentReporter.Tests
{
    /// <summary>
    /// La partida se guarda antes de hablar con nadie. Cuando Among Us vuelve al
    /// lobby el estado de EHR ya no existe, así que todo lo que dependa de la red
    /// tiene que ocurrir después de que el resultado esté en disco.
    /// </summary>
    public class DurabilityTests
    {
        private static readonly IReadOnlyList<TimeSpan> NoWaits = new TimeSpan[0];

        private readonly string _root = TestPaths.CreateTemporaryDirectory();
        private readonly FakeTransport _transport = new FakeTransport();
        private readonly RecordingLog _sink = new RecordingLog();

        private PendingQueue Queue() => new PendingQueue(_root);

        private ReporterService Service(PendingQueue queue = null) => new ReporterService(
            SampleGame.Settings(), queue ?? Queue(), _transport, new SecretSafeLog(_sink),
            () => SampleGame.PlayedAt);

        private static CapturedMatch Captured(string reportId = null) => new CapturedMatch
        {
            ReportId = reportId ?? SampleGame.ReportId,
            HostId = "HOST_1",
            PlayedAt = "2026-08-22T18:30:00.000Z",
            PluginVersion = SampleGame.PluginVersion,
            Snapshot = SampleGame.Snapshot()
        };

        private string ValidContext() =>
            File.ReadAllText(TestPaths.Contract("reporter-context.json"));

        // ---------- A ----------
        [Fact]
        public void Writes_the_match_to_disk_without_touching_the_network()
        {
            var queue = Queue();
            var service = Service(queue);

            var file = service.Capture(Captured());

            Assert.True(File.Exists(file));
            Assert.True(queue.HasCaptured(SampleGame.ReportId));
            Assert.Empty(_transport.Requests);
        }

        // ---------- B ----------
        [Fact]
        public async Task Keeps_the_match_on_disk_when_the_server_never_answers()
        {
            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Failure("tailscale caído");

            service.Capture(Captured());
            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);

            Assert.True(queue.HasCaptured(SampleGame.ReportId));
            Assert.False(queue.WasAlreadySent(SampleGame.ReportId));
        }

        // ---------- C ----------
        [Fact]
        public async Task Recovers_a_match_captured_before_the_game_was_closed()
        {
            // Se captura y el proceso muere aquí: no llega a ejecutarse nada más.
            Service().Capture(Captured());

            // Arranque siguiente: instancias nuevas sobre la misma carpeta.
            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Http(200, ValidContext());
            _transport.DefaultPostResponse = TransportResponse.Http(201, "{}");

            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);
            await service.PumpAsync(CancellationToken.None);

            Assert.False(queue.HasCaptured(SampleGame.ReportId));
            Assert.True(queue.WasAlreadySent(SampleGame.ReportId));
        }

        // ---------- D ----------
        [Fact]
        public async Task Sends_the_match_once_the_server_comes_back()
        {
            var queue = Queue();
            var service = Service(queue);
            service.Capture(Captured());

            _transport.ContextResponse = TransportResponse.Failure("todavía caído");
            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);
            Assert.True(queue.HasCaptured(SampleGame.ReportId));

            _transport.ContextResponse = TransportResponse.Http(200, ValidContext());
            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);
            await service.PumpAsync(CancellationToken.None);

            Assert.False(queue.HasCaptured(SampleGame.ReportId));
            Assert.True(queue.WasAlreadySent(SampleGame.ReportId));
        }

        // ---------- E y F ----------
        [Theory]
        [InlineData(500)]
        [InlineData(503)]
        public async Task Keeps_the_match_pending_when_the_server_errors(int status)
        {
            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Http(200, ValidContext());
            _transport.EnqueuePost(TransportResponse.Http(status, "{}"));

            service.Capture(Captured());
            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);
            await service.PumpAsync(CancellationToken.None);

            Assert.True(queue.IsPending(SampleGame.ReportId));
            Assert.False(queue.WasAlreadySent(SampleGame.ReportId));
        }

        [Fact]
        public async Task Keeps_the_match_pending_when_the_request_times_out()
        {
            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Http(200, ValidContext());
            _transport.EnqueuePost(TransportResponse.Failure("tiempo de espera agotado"));

            service.Capture(Captured());
            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);
            await service.PumpAsync(CancellationToken.None);

            Assert.True(queue.IsPending(SampleGame.ReportId));
        }

        // ---------- G ----------
        [Fact]
        public async Task Never_blocks_a_match_just_because_the_context_is_unreachable()
        {
            // Perder la red no es un veredicto del torneo: es esperar.
            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Failure("sin red");

            service.Capture(Captured());
            for (var i = 0; i < 5; i++)
                await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);

            Assert.True(queue.HasCaptured(SampleGame.ReportId));
            Assert.Empty(Directory.GetFiles(queue.BlockedDirectory));
        }

        // ---------- H ----------
        [Fact]
        public async Task Blocks_the_match_when_the_tournament_answers_that_it_cannot_be_reported()
        {
            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Http(
                200, "{\"reportingEnabled\":false,\"reason\":\"HOST_NOT_ASSIGNED\",\"message\":\"El host no tiene fase asignada.\"}");

            service.Capture(Captured());
            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);

            Assert.False(queue.HasCaptured(SampleGame.ReportId));
            Assert.NotEmpty(Directory.GetFiles(queue.BlockedDirectory, "*.json"));
        }

        // ---------- I ----------
        [Fact]
        public async Task A_corrupt_capture_does_not_take_the_rest_of_the_queue_down()
        {
            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Http(200, ValidContext());
            _transport.DefaultPostResponse = TransportResponse.Http(201, "{}");

            queue.SaveCaptured("HOST_1-roto", "{\"reportId\":\"HOST_1-roto\",\"snapshot\":{\"play");
            service.Capture(Captured());

            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);
            await service.PumpAsync(CancellationToken.None);

            Assert.True(queue.WasAlreadySent(SampleGame.ReportId));
            Assert.False(queue.HasCaptured("HOST_1-roto"));
            Assert.NotEmpty(Directory.GetFiles(queue.BlockedDirectory, "*.unreadable"));
        }

        // ---------- J ----------
        [Fact]
        public async Task Two_simultaneous_passes_do_not_send_the_same_match_twice()
        {
            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Http(200, ValidContext());
            _transport.DefaultPostResponse = TransportResponse.Http(201, "{}");

            service.Capture(Captured());
            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);

            await Task.WhenAll(
                service.PumpAsync(CancellationToken.None),
                service.PumpAsync(CancellationToken.None));

            Assert.Single(_transport.Posts);
        }

        // ---------- K ----------
        [Fact]
        public async Task Keeps_the_same_report_id_across_a_restart()
        {
            // El identificador nace al capturar, no al enviar: por eso el backend
            // reconoce la misma partida aunque el envío ocurra en otro arranque.
            Service().Capture(Captured("HOST_1-identidad-estable"));

            var queue = Queue();
            var service = Service(queue);
            _transport.ContextResponse = TransportResponse.Http(200, ValidContext());
            _transport.DefaultPostResponse = TransportResponse.Http(201, "{}");

            await service.ProcessCapturedAsync(CancellationToken.None, NoWaits);
            await service.PumpAsync(CancellationToken.None);

            var enviado = _transport.Posts.Single();
            Assert.Contains("HOST_1-identidad-estable", enviado.Body);
        }

        [Fact]
        public void Survives_a_round_trip_through_disk_without_losing_a_single_field()
        {
            var original = Captured();
            var recuperado = SnapshotJson.Parse(SnapshotJson.Serialize(original));

            Assert.Equal(original.ReportId, recuperado.ReportId);
            Assert.Equal(original.HostId, recuperado.HostId);
            Assert.Equal(original.PlayedAt, recuperado.PlayedAt);
            Assert.Equal(original.Snapshot.WinnerTeam, recuperado.Snapshot.WinnerTeam);
            Assert.Equal(original.Snapshot.Map, recuperado.Snapshot.Map);
            Assert.Equal(original.Snapshot.Players.Count, recuperado.Snapshot.Players.Count);

            for (var i = 0; i < original.Snapshot.Players.Count; i++)
            {
                var esperado = original.Snapshot.Players[i];
                var real = recuperado.Snapshot.Players[i];
                Assert.Equal(esperado.FriendCode, real.FriendCode);
                Assert.Equal(esperado.PlayerId, real.PlayerId);
                Assert.Equal(esperado.MainRole, real.MainRole);
                Assert.Equal(esperado.CountType, real.CountType);
                Assert.Equal(esperado.Won, real.Won);
                Assert.Equal(esperado.TasksCompleted, real.TasksCompleted);
                Assert.Equal(esperado.TasksTotal, real.TasksTotal);
                Assert.Equal(esperado.RawKillCount, real.RawKillCount);
                Assert.Equal(esperado.Disconnected, real.Disconnected);
                Assert.Equal(esperado.DeathReason, real.DeathReason);
            }
        }
    }
}
