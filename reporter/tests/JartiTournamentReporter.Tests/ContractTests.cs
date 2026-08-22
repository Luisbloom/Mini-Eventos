using System.IO;
using System.Linq;
using System.Text;
using Jartiland.TournamentReporter.Json;
using Jartiland.TournamentReporter.Reporting;
using Xunit;

namespace Jartiland.TournamentReporter.Tests
{
    /// <summary>
    /// Contrato compartido con el backend. Los dos archivos de reporter/contract
    /// los produce y consume también la suite de Node: si una mitad cambia el
    /// formato sin avisar a la otra, uno de los dos lados falla.
    /// </summary>
    public class ContractTests
    {
        [Fact]
        public void Parses_the_context_the_backend_really_returns()
        {
            var context = SampleGame.Context();

            Assert.True(context.ReportingEnabled);
            Assert.Null(context.Reason);
            Assert.Equal("among-us-agosto-2026", context.EventSlug);
            Assert.Equal("HOST_1", context.HostIdentifier);
            Assert.Equal(1, context.StageId);
            Assert.Equal("group_stage", context.StageType);
            Assert.Equal(1, context.GroupId);
            Assert.Equal("Grupo A", context.GroupName);
            Assert.Equal(1, context.MatchNumber);
            Assert.Equal("/api/events/among-us-agosto-2026/matches", context.SubmitPath);
            Assert.Equal(4, context.Roster.Count);
            Assert.Equal(0, context.RosterWithoutFriendCode);
        }

        [Fact]
        public void Resolves_a_participant_from_the_friend_code_it_sees_in_the_lobby()
        {
            var context = SampleGame.Context();

            var entry = context.FindByFingerprint(FriendCodeFingerprint.Compute("LUIS#1001"));

            Assert.NotNull(entry);
            Assert.Equal(1, entry.ParticipantId);
            Assert.Equal("Luis", entry.DisplayName);
            Assert.Null(context.FindByFingerprint(FriendCodeFingerprint.Compute("nadie#0000")));
        }

        [Fact]
        public void Reads_the_error_code_of_a_rejected_request()
        {
            const string body = "{\"error\":{\"code\":\"MATCH_SLOT_OCCUPIED\",\"message\":\"Ese número de partida...\"}}";

            Assert.Equal("MATCH_SLOT_OCCUPIED", ContextJson.ReadErrorCode(body));
            Assert.Null(ContextJson.ReadErrorCode("no es json"));
            Assert.Null(ContextJson.ReadErrorCode(null));
        }

        [Fact]
        public void Produces_exactly_the_payload_the_backend_test_replays()
        {
            var outcome = SampleGame.Build();
            Assert.True(outcome.Success);
            var json = MatchJson.Serialize(outcome.Result);

            var file = TestPaths.Contract("reporter-payload.json");
            if (TestPaths.ShouldUpdateContract)
            {
                File.WriteAllText(file, json + "\n", new UTF8Encoding(false));
            }

            Assert.True(File.Exists(file),
                "Falta reporter/contract/reporter-payload.json. Regenéralo con UPDATE_CONTRACT=1.");
            Assert.Equal(File.ReadAllText(file).Trim(), json);
        }

        [Fact]
        public void Serializes_the_same_bytes_every_time_so_a_retry_stays_idempotent()
        {
            var first = MatchJson.Serialize(SampleGame.Build().Result);
            var second = MatchJson.Serialize(SampleGame.Build().Result);

            Assert.Equal(first, second);
        }

        [Fact]
        public void Never_puts_a_score_in_the_payload()
        {
            var json = MatchJson.Serialize(SampleGame.Build().Result);

            Assert.DoesNotContain("\"points\"", json);
            Assert.DoesNotContain("\"score\"", json);
            Assert.Contains("\"kills\":2", json);
            Assert.Contains("\"won\":true", json);
        }

        [Fact]
        public void Sends_a_null_group_for_a_final_instead_of_omitting_the_field()
        {
            var match = SampleGame.Build().Result;
            match.GroupId = null;

            Assert.Contains("\"groupId\":null", MatchJson.Serialize(match));
        }

        [Fact]
        public void Escapes_a_player_name_with_quotes_and_accents()
        {
            var match = SampleGame.Build().Result;
            match.Players.First().Name = "Niño \"El Jefe\"";

            var json = MatchJson.Serialize(match);

            Assert.DoesNotContain("Niño \"El Jefe\"", json);
            using (var document = System.Text.Json.JsonDocument.Parse(json))
            {
                var name = document.RootElement.GetProperty("players")[0].GetProperty("name").GetString();
                Assert.Equal("Niño \"El Jefe\"", name);
            }
        }
    }
}
