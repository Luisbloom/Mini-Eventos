using System.Collections.Generic;
using Jartiland.TournamentReporter.Model;
using Jartiland.TournamentReporter.Reporting;
using Xunit;

namespace Jartiland.TournamentReporter.Tests
{
    public class TournamentRulesTests
    {
        [Theory]
        [InlineData("Crew", "crew")]
        [InlineData("Impostor", "impostor")]
        public void Maps_the_two_teams_the_tournament_accepts(string countType, string expected)
        {
            Assert.Equal(expected, TournamentRules.NormalizeTeam(countType));
        }

        [Theory]
        [InlineData("Jackal")]
        [InlineData("Coven")]
        [InlineData("CustomTeam")]
        [InlineData("OutOfGame")]
        [InlineData("None")]
        [InlineData("")]
        [InlineData(null)]
        public void Never_turns_anything_else_into_a_crewmate(string countType)
        {
            Assert.Null(TournamentRules.NormalizeTeam(countType));
        }

        [Theory]
        [InlineData("Crewmate", "crew")]
        [InlineData("Impostor", "impostor")]
        public void Maps_the_two_endings_the_tournament_scores(string winner, string expected)
        {
            Assert.Equal(expected, TournamentRules.NormalizeWinner(winner));
        }

        [Theory]
        [InlineData("Draw")]
        [InlineData("None")]
        [InlineData("Error")]
        [InlineData("Default")]
        [InlineData("Neutrals")]
        [InlineData("Jester")]
        public void Refuses_to_score_any_other_ending(string winner)
        {
            Assert.Null(TournamentRules.NormalizeWinner(winner));
        }

        private static EhrPlayerSnapshot Victim(byte id, byte killer, string reason) => new EhrPlayerSnapshot
        {
            PlayerId = id,
            IsDead = true,
            RealKillerId = killer,
            DeathReason = reason
        };

        [Fact]
        public void Counts_only_deaths_that_EHR_attributes_to_the_impostor()
        {
            var players = new List<EhrPlayerSnapshot>
            {
                new EhrPlayerSnapshot { PlayerId = 0, IsDead = false },
                Victim(1, 0, "Kill"),
                Victim(2, 0, "Kill"),
                Victim(3, EhrPlayerSnapshot.NoKiller, "Vote"),
                Victim(4, 4, "Suicide"),
                Victim(5, EhrPlayerSnapshot.NoKiller, "Disconnected")
            };

            Assert.Equal(2, TournamentRules.CountKills(0, players));
            Assert.Equal(0, TournamentRules.CountKills(4, players));
        }

        [Fact]
        public void Does_not_count_an_ejection_even_if_a_voter_is_recorded()
        {
            // EHR guarda al votante como RealKiller cuando expulsa un Dictator.
            var players = new List<EhrPlayerSnapshot> { Victim(2, 0, "Vote") };

            Assert.Equal(0, TournamentRules.CountKills(0, players));
        }

        [Fact]
        public void Does_not_count_a_misfire_against_the_shooter()
        {
            var players = new List<EhrPlayerSnapshot> { Victim(2, 0, "Misfire") };

            Assert.Equal(0, TournamentRules.CountKills(0, players));
        }

        [Fact]
        public void Ignores_a_living_player_wrongly_marked_with_a_killer()
        {
            var players = new List<EhrPlayerSnapshot>
            {
                new EhrPlayerSnapshot { PlayerId = 2, IsDead = false, RealKillerId = 0, DeathReason = "Kill" }
            };

            Assert.Equal(0, TournamentRules.CountKills(0, players));
        }

        [Fact]
        public void Credits_tasks_finished_after_dying_as_a_ghost()
        {
            var ghost = new EhrPlayerSnapshot
            {
                IsDead = true,
                DeathReason = "Kill",
                HasTasks = true,
                TasksTotal = 4,
                TasksCompleted = 4,
                IsTaskFinished = true
            };

            Assert.True(TournamentRules.CompletedAllTasks(ghost));
        }

        [Fact]
        public void Does_not_credit_an_impostor_without_tasks()
        {
            var impostor = new EhrPlayerSnapshot { HasTasks = false, TasksTotal = 0, TasksCompleted = 0 };

            Assert.False(TournamentRules.CompletedAllTasks(impostor));
        }

        [Fact]
        public void Does_not_credit_unfinished_tasks()
        {
            var crew = new EhrPlayerSnapshot { HasTasks = true, TasksTotal = 5, TasksCompleted = 4 };

            Assert.False(TournamentRules.CompletedAllTasks(crew));
        }

        [Fact]
        public void Accepts_only_the_configured_roles()
        {
            var allowed = new[] { "Crewmate", "Impostor" };

            Assert.True(TournamentRules.IsRoleAllowed("Impostor", allowed));
            Assert.True(TournamentRules.IsRoleAllowed("crewmate", allowed));
            Assert.False(TournamentRules.IsRoleAllowed("Sheriff", allowed));
        }
    }
}
