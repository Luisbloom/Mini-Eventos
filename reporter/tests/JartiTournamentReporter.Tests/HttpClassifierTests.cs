using System;
using Jartiland.TournamentReporter.Http;
using Xunit;

namespace Jartiland.TournamentReporter.Tests
{
    public class HttpClassifierTests
    {
        [Theory]
        [InlineData(201, SubmitDisposition.Accepted)]
        [InlineData(200, SubmitDisposition.Accepted)]
        [InlineData(400, SubmitDisposition.Rejected)]
        [InlineData(401, SubmitDisposition.CredentialProblem)]
        [InlineData(403, SubmitDisposition.HostRejected)]
        [InlineData(404, SubmitDisposition.Rejected)]
        [InlineData(408, SubmitDisposition.RetryLater)]
        [InlineData(409, SubmitDisposition.Conflict)]
        [InlineData(413, SubmitDisposition.Rejected)]
        [InlineData(429, SubmitDisposition.RetryLater)]
        [InlineData(500, SubmitDisposition.RetryLater)]
        [InlineData(502, SubmitDisposition.RetryLater)]
        [InlineData(503, SubmitDisposition.RetryLater)]
        public void Classifies_every_answer_the_backend_can_give(int status, SubmitDisposition expected)
        {
            Assert.Equal(expected, HttpClassifier.Classify(TransportResponse.Http(status, "{}")));
        }

        [Fact]
        public void Treats_a_network_or_tls_failure_as_temporary()
        {
            Assert.Equal(SubmitDisposition.RetryLater,
                HttpClassifier.Classify(TransportResponse.Failure("no route to host")));
            Assert.Equal(SubmitDisposition.RetryLater, HttpClassifier.Classify(null));
        }

        [Fact]
        public void Keeps_retrying_only_what_can_still_succeed()
        {
            Assert.True(HttpClassifier.KeepsRetrying(SubmitDisposition.RetryLater));
            Assert.True(HttpClassifier.KeepsRetrying(SubmitDisposition.CredentialProblem));
            Assert.True(HttpClassifier.KeepsRetrying(SubmitDisposition.HostRejected));
            Assert.False(HttpClassifier.KeepsRetrying(SubmitDisposition.Accepted));
            Assert.False(HttpClassifier.KeepsRetrying(SubmitDisposition.Conflict));
            Assert.False(HttpClassifier.KeepsRetrying(SubmitDisposition.Rejected));
        }

        [Fact]
        public void Backs_off_five_fifteen_thirty_and_sixty_seconds_before_settling()
        {
            var delays = new[] { 1, 2, 3, 4, 5, 9 };
            var expected = new[] { 5, 15, 30, 60, 300, 300 };

            for (var index = 0; index < delays.Length; index++)
            {
                Assert.Equal(
                    TimeSpan.FromSeconds(expected[index]),
                    RetrySchedule.Next(delays[index], SubmitDisposition.RetryLater));
            }
        }

        [Fact]
        public void Waits_much_longer_when_the_problem_is_the_credential()
        {
            Assert.Equal(TimeSpan.FromMinutes(15), RetrySchedule.Next(1, SubmitDisposition.CredentialProblem));
            Assert.Equal(TimeSpan.FromMinutes(15), RetrySchedule.Next(8, SubmitDisposition.HostRejected));
        }
    }
}
