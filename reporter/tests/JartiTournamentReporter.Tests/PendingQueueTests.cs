using System;
using System.IO;
using System.Linq;
using Jartiland.TournamentReporter.Queue;
using Xunit;

namespace Jartiland.TournamentReporter.Tests
{
    public class PendingQueueTests : IDisposable
    {
        private readonly string _root;
        private readonly PendingQueue _queue;
        private static readonly DateTime Now = new DateTime(2026, 8, 22, 18, 30, 0, DateTimeKind.Utc);

        public PendingQueueTests()
        {
            _root = TestPaths.CreateTemporaryDirectory();
            _queue = new PendingQueue(_root);
        }

        public void Dispose()
        {
            try { Directory.Delete(_root, true); } catch (IOException) { }
        }

        [Fact]
        public void Writes_the_result_before_anything_is_sent()
        {
            var item = _queue.Enqueue("HOST_1-abc", "/api/events/x/matches", "{\"reportId\":\"HOST_1-abc\"}", Now);

            Assert.True(File.Exists(item.BodyFile));
            Assert.Equal("{\"reportId\":\"HOST_1-abc\"}", File.ReadAllText(item.BodyFile));
            Assert.Equal("/api/events/x/matches", item.SubmitPath);
            Assert.True(_queue.IsPending("HOST_1-abc"));
            Assert.Empty(Directory.GetFiles(_queue.PendingDirectory, "*.tmp"));
        }

        [Fact]
        public void Keeps_the_original_body_if_the_same_report_is_queued_twice()
        {
            _queue.Enqueue("HOST_1-abc", "/api/events/x/matches", "{\"primero\":true}", Now);
            var second = _queue.Enqueue("HOST_1-abc", "/api/events/otro/matches", "{\"segundo\":true}", Now);

            Assert.Equal("{\"primero\":true}", second.Body);
            Assert.Equal("/api/events/x/matches", second.SubmitPath);
        }

        [Fact]
        public void Recovers_everything_pending_after_a_restart()
        {
            _queue.Enqueue("HOST_1-uno", "/api/events/x/matches", "{\"n\":1}", Now);
            _queue.Enqueue("HOST_1-dos", "/api/events/x/matches", "{\"n\":2}", Now);

            var reopened = new PendingQueue(_root).Load(Now);

            Assert.Equal(2, reopened.Count);
            Assert.Equal(new[] { "HOST_1-dos", "HOST_1-uno" }, reopened.Select(item => item.ReportId).OrderBy(id => id).ToArray());
            Assert.All(reopened, item => Assert.Equal("/api/events/x/matches", item.SubmitPath));
        }

        [Fact]
        public void Moves_an_accepted_result_out_of_pending_only_after_confirmation()
        {
            var item = _queue.Enqueue("HOST_1-abc", "/api/events/x/matches", "{\"n\":1}", Now);

            _queue.MarkSent(item);

            Assert.False(_queue.IsPending("HOST_1-abc"));
            Assert.True(_queue.WasAlreadySent("HOST_1-abc"));
            Assert.True(File.Exists(Path.Combine(_queue.SentDirectory, "HOST_1-abc.json")));
            Assert.True(File.Exists(Path.Combine(_queue.SentDirectory, "HOST_1-abc.path")));
            Assert.Empty(new PendingQueue(_root).Load(Now));
        }

        [Fact]
        public void Files_a_conflict_with_a_note_for_the_administrator()
        {
            var item = _queue.Enqueue("HOST_1-abc", "/api/events/x/matches", "{\"n\":1}", Now);

            _queue.MarkConflict(item, "HTTP 409 MATCH_SLOT_OCCUPIED");

            var note = Path.Combine(_queue.ConflictDirectory, "HOST_1-abc.note");
            Assert.True(File.Exists(Path.Combine(_queue.ConflictDirectory, "HOST_1-abc.json")));
            Assert.Contains("MATCH_SLOT_OCCUPIED", File.ReadAllText(note));
            Assert.False(_queue.IsPending("HOST_1-abc"));
        }

        [Fact]
        public void Keeps_an_unsendable_result_for_manual_review()
        {
            var file = _queue.SaveBlocked("HOST_1-raro", "{\"winner\":null}", "final neutral");

            Assert.True(File.Exists(file));
            Assert.Contains("final neutral", File.ReadAllText(Path.ChangeExtension(file, ".note")));
            Assert.False(_queue.IsPending("HOST_1-raro"));
            Assert.True(_queue.WasAlreadySent("HOST_1-raro"));
        }

        [Fact]
        public void Refuses_to_let_a_report_identifier_escape_its_folder()
        {
            Assert.Equal("_______evil", PendingQueue.Sanitize("/../../evil"));

            var item = _queue.Enqueue("../../evil", "/api/events/x/matches", "{}", Now);

            Assert.Equal(_queue.PendingDirectory, Path.GetDirectoryName(item.BodyFile));
        }

        [Fact]
        public void Survives_a_pending_file_without_its_path_sidecar()
        {
            File.WriteAllText(Path.Combine(_queue.PendingDirectory, "HOST_1-huerfano.json"), "{\"n\":1}");

            var restored = new PendingQueue(_root).Load(Now).Single();

            Assert.Equal("HOST_1-huerfano", restored.ReportId);
            Assert.Null(restored.SubmitPath);
        }
    }
}
