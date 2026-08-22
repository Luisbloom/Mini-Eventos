using System;
using System.Collections.Generic;
using System.Linq;
using Jartiland.TournamentReporter.Configuration;
using Jartiland.TournamentReporter.Logging;
using Xunit;

namespace Jartiland.TournamentReporter.Tests
{
    public class ReporterConfigLoaderTests
    {
        private const string Token = "jtr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

        private static string[] ValidIni() => new[]
        {
            "# Configuración entregada por el administrador",
            "ServerUrl=https://mini-eventos-jartiland.tail9d0334.ts.net:10000",
            "HostId=HOST_1",
            $"ReporterToken={Token}"
        };

        [Fact]
        public void Reads_the_three_required_values()
        {
            var result = ReporterConfigLoader.Parse("HOST_1-reporter.ini", ValidIni());

            Assert.True(result.IsLoaded);
            Assert.Equal("https://mini-eventos-jartiland.tail9d0334.ts.net:10000", result.Settings.ServerUrl);
            Assert.Equal("HOST_1", result.Settings.HostId);
            Assert.Equal(Token, result.Settings.ReporterToken);
        }

        [Fact]
        public void Never_puts_the_credential_in_the_summary()
        {
            var result = ReporterConfigLoader.Parse("HOST_1-reporter.ini", ValidIni());

            Assert.DoesNotContain(Token, result.Message);
            Assert.DoesNotContain(Token.Substring(4, 10), result.Message);
            Assert.Contains("HOST_1", result.Message);
            Assert.Contains(SecretSafeLog.Fingerprint(Token), result.Message);
        }

        [Fact]
        public void Stays_disabled_when_no_file_is_present()
        {
            var result = ReporterConfigLoader.Discover(new List<string>(), _ => Array.Empty<string>());

            Assert.Equal(ReporterConfigStatus.NoConfigurationFile, result.Status);
            Assert.Contains("*-reporter.ini", result.Message);
            Assert.Contains("desactivado", result.Message);
        }

        [Fact]
        public void Refuses_to_choose_between_two_configuration_files()
        {
            var files = new List<string> { "HOST_1-reporter.ini", "HOST_2-reporter.ini" };

            var result = ReporterConfigLoader.Discover(files, _ => ValidIni());

            Assert.Equal(ReporterConfigStatus.MultipleConfigurationFiles, result.Status);
            Assert.Contains("HOST_1-reporter.ini", result.Message);
            Assert.Contains("HOST_2-reporter.ini", result.Message);
            Assert.Null(result.Settings);
        }

        [Theory]
        [InlineData("ServerUrl", "ServerUrl")]
        [InlineData("HostId", "HostId")]
        [InlineData("ReporterToken", "ReporterToken")]
        public void Rejects_a_configuration_missing_any_required_value(string key, string expected)
        {
            var lines = ValidIni().Where(line => !line.StartsWith(key + "=", StringComparison.Ordinal)).ToArray();

            var result = ReporterConfigLoader.Parse("HOST_1-reporter.ini", lines);

            Assert.Equal(ReporterConfigStatus.Invalid, result.Status);
            Assert.Contains(expected, result.Message);
        }

        [Fact]
        public void Rejects_plain_http_unless_it_is_explicitly_a_local_test()
        {
            var insecure = new[] { "ServerUrl=http://127.0.0.1:3100", "HostId=HOST_1", $"ReporterToken={Token}" };

            Assert.Equal(ReporterConfigStatus.Invalid, ReporterConfigLoader.Parse("x-reporter.ini", insecure).Status);

            var allowed = insecure.Concat(new[] { "AllowInsecureHttp=true" }).ToArray();
            Assert.True(ReporterConfigLoader.Parse("x-reporter.ini", allowed).IsLoaded);
        }

        [Fact]
        public void Rejects_a_url_carrying_credentials()
        {
            var lines = new[] { "ServerUrl=https://user:pass@example.invalid", "HostId=HOST_1", $"ReporterToken={Token}" };

            var result = ReporterConfigLoader.Parse("x-reporter.ini", lines);

            Assert.Equal(ReporterConfigStatus.Invalid, result.Status);
            Assert.DoesNotContain("pass", result.Message);
        }

        [Fact]
        public void Requires_a_per_host_credential_instead_of_the_legacy_one()
        {
            var lines = new[]
            {
                "ServerUrl=https://mini-eventos-jartiland.tail9d0334.ts.net:10000",
                "HostId=HOST_1",
                "ReporterToken=token-general-heredado"
            };

            var result = ReporterConfigLoader.Parse("x-reporter.ini", lines);

            Assert.Equal(ReporterConfigStatus.Invalid, result.Status);
            Assert.Contains("jtr_", result.Message);
            Assert.DoesNotContain("token-general-heredado", result.Message);
        }

        [Fact]
        public void Rejects_a_host_identifier_that_could_escape_a_header_or_a_path()
        {
            var lines = new[]
            {
                "ServerUrl=https://example.test",
                "HostId=HOST_1/../HOST_2",
                $"ReporterToken={Token}"
            };

            Assert.Equal(ReporterConfigStatus.Invalid, ReporterConfigLoader.Parse("x-reporter.ini", lines).Status);
        }

        [Fact]
        public void Allows_overriding_the_tournament_roles_without_rebuilding_the_dll()
        {
            var lines = ValidIni().Concat(new[] { "AllowedRoles=Crewmate, Impostor, Sheriff" }).ToArray();

            var result = ReporterConfigLoader.Parse("HOST_1-reporter.ini", lines);

            Assert.Equal(new[] { "Crewmate", "Impostor", "Sheriff" }, result.Settings.AllowedRoles);
        }

        [Fact]
        public void Builds_request_urls_without_losing_the_private_port()
        {
            var settings = ReporterConfigLoader.Parse("HOST_1-reporter.ini", ValidIni()).Settings;

            Assert.Equal(
                "https://mini-eventos-jartiland.tail9d0334.ts.net:10000/api/reporter/context",
                settings.BuildUri("/api/reporter/context").ToString());
            Assert.Equal(
                "https://mini-eventos-jartiland.tail9d0334.ts.net:10000/api/events/among-us/matches",
                settings.BuildUri("api/events/among-us/matches").ToString());
        }
    }
}
