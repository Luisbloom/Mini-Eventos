using System;
using System.Linq;
using Jartiland.TournamentReporter.Model;
using Jartiland.TournamentReporter.Reporting;
using Xunit;

namespace Jartiland.TournamentReporter.Tests
{
    public class MatchReportBuilderTests
    {
        [Fact]
        public void Turns_the_end_of_game_state_into_the_backend_contract()
        {
            var outcome = SampleGame.Build();

            Assert.True(outcome.Success);
            var match = outcome.Result;
            Assert.Equal(SampleGame.ReportId, match.ReportId);
            Assert.Equal("HOST_1", match.HostId);
            Assert.Equal(1, match.StageId);
            Assert.Equal(1, match.GroupId);
            Assert.Equal(1, match.MatchNumber);
            Assert.Equal("impostor", match.Winner);
            Assert.Equal("standard", match.GameMode);
            Assert.Equal("2026-08-22T18:30:00.000Z", match.PlayedAt);
            Assert.Equal("/api/events/among-us-agosto-2026/matches", match.SubmitPath);
            Assert.Equal(4, match.Players.Count);
        }

        [Fact]
        public void Reports_raw_data_only_and_never_a_score()
        {
            var match = SampleGame.Build().Result;

            var impostor = match.Players.Single(player => player.Team == "impostor");
            Assert.Equal(1, impostor.ParticipantId);
            Assert.Equal("impostor", impostor.Role);
            Assert.Equal("Impostor", impostor.RawRole);
            Assert.True(impostor.Won);
            Assert.Equal(2, impostor.Kills);
            Assert.Equal(0, impostor.TasksTotal);
            Assert.False(impostor.AllTasksCompleted);

            var ghost = match.Players.Single(player => player.Name == "Marta");
            Assert.Equal("crew", ghost.Team);
            Assert.False(ghost.Won);
            Assert.Equal(0, ghost.Kills);
            Assert.Equal(4, ghost.TasksCompleted);
            Assert.True(ghost.AllTasksCompleted);

            var unfinished = match.Players.Single(player => player.Name == "Nacho");
            Assert.False(unfinished.AllTasksCompleted);

            var disconnected = match.Players.Single(player => player.Name == "Sara");
            Assert.True(disconnected.Disconnected);
            Assert.Equal("Disconnected", disconnected.DeathReason);
        }

        [Fact]
        public void Normalizes_a_friend_code_that_uses_a_colon()
        {
            var match = SampleGame.Build().Result;

            Assert.Equal("sara#1004", match.Players.Single(player => player.Name == "Sara").FriendCode);
            Assert.Equal(4, match.Players.Single(player => player.Name == "Sara").ParticipantId);
        }

        [Fact]
        public void Leaves_out_a_player_who_is_not_registered_in_this_group()
        {
            var snapshot = SampleGame.Snapshot();
            snapshot.Players.Add(new EhrPlayerSnapshot
            {
                PlayerId = 9, Name = "Moderador", FriendCode = "moderador#9999",
                MainRole = "Crewmate", CountType = "Crew", Won = false
            });

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.True(outcome.Success);
            Assert.Equal(4, outcome.Result.Players.Count);
            Assert.Contains(outcome.Warnings, warning => warning.Contains("Moderador"));
        }

        [Fact]
        public void Refuses_a_neutral_ending_instead_of_inventing_a_winner()
        {
            var snapshot = SampleGame.Snapshot();
            snapshot.WinnerTeam = "Jester";

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.False(outcome.Success);
            Assert.Contains(outcome.Blocking, problem => problem.Contains("Jester"));
        }

        [Fact]
        public void Refuses_a_player_who_is_neither_crew_nor_impostor()
        {
            var snapshot = SampleGame.Snapshot();
            snapshot.Players[1].CountType = "Jackal";
            snapshot.Players[1].MainRole = "Jackal";

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.False(outcome.Success);
            Assert.Contains(outcome.Blocking, problem => problem.Contains("Marta") && problem.Contains("Jackal"));
        }

        [Fact]
        public void Refuses_a_role_outside_the_tournament_even_if_its_team_is_valid()
        {
            var snapshot = SampleGame.Snapshot();
            snapshot.Players[2].MainRole = "Sheriff";

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.False(outcome.Success);
            Assert.Contains(outcome.Blocking, problem => problem.Contains("Sheriff"));
        }

        [Fact]
        public void Refuses_a_game_mode_that_is_not_the_standard_one()
        {
            var snapshot = SampleGame.Snapshot();
            snapshot.GameMode = "FFA";

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.False(outcome.Success);
            Assert.Contains(outcome.Blocking, problem => problem.Contains("FFA"));
        }

        [Fact]
        public void Refuses_a_win_flag_that_contradicts_the_winning_team()
        {
            var snapshot = SampleGame.Snapshot();
            snapshot.Players[1].Won = true;

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.False(outcome.Success);
            Assert.Contains(outcome.Blocking, problem => problem.Contains("Marta"));
        }

        [Fact]
        public void Refuses_to_send_anything_without_an_assigned_context()
        {
            var disabled = new CompetitionContext
            {
                ReportingEnabled = false,
                Reason = "HOST_NOT_ASSIGNED",
                Message = "El host no tiene fase asignada."
            };

            var outcome = MatchReportBuilder.Build(
                SampleGame.Snapshot(), disabled, SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.False(outcome.Success);
            Assert.Contains(outcome.Blocking, problem => problem.Contains("fase asignada"));
        }

        [Fact]
        public void Refuses_a_game_EHR_has_not_finished_yet()
        {
            var snapshot = SampleGame.Snapshot();
            snapshot.Finished = false;

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.False(outcome.Success);
            Assert.Contains(outcome.Blocking, problem => problem.Contains("terminada"));
        }

        [Fact]
        public void Refuses_a_match_where_almost_nobody_could_be_identified()
        {
            var snapshot = SampleGame.Snapshot();
            foreach (var player in snapshot.Players) player.FriendCode = "desconocido#0000";

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.False(outcome.Success);
            Assert.Contains(outcome.Blocking, problem => problem.Contains("0 jugadores inscritos"));
        }

        [Fact]
        public void Warns_about_registered_players_who_did_not_play()
        {
            var snapshot = SampleGame.Snapshot();
            snapshot.Players.RemoveAt(3);

            var outcome = MatchReportBuilder.Build(
                snapshot, SampleGame.Context(), SampleGame.Settings(),
                SampleGame.PluginVersion, SampleGame.ReportId, SampleGame.PlayedAt);

            Assert.True(outcome.Success);
            Assert.Contains(outcome.Warnings, warning => warning.Contains("Sara"));
        }

        [Fact]
        public void Builds_a_stable_report_identifier_per_host()
        {
            var identifier = new Guid("550e8400-e29b-41d4-a716-446655440000");

            Assert.Equal("HOST_1-550e8400-e29b-41d4-a716-446655440000",
                MatchReportBuilder.NewReportId("HOST_1", identifier));
            Assert.NotEqual(
                MatchReportBuilder.NewReportId("HOST_1", Guid.NewGuid()),
                MatchReportBuilder.NewReportId("HOST_1", Guid.NewGuid()));
        }
    }
}
