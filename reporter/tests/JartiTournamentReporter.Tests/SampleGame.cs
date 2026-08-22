using System;
using System.Collections.Generic;
using System.IO;
using Jartiland.TournamentReporter.Configuration;
using Jartiland.TournamentReporter.Json;
using Jartiland.TournamentReporter.Model;
using Jartiland.TournamentReporter.Reporting;

namespace Jartiland.TournamentReporter.Tests
{
    /// <summary>
    /// Partida de referencia: cuatro jugadores del Grupo A, victoria de impostores
    /// con dos kills, un tripulante que termina sus tareas después de morir y otro
    /// que se desconecta. Se usa en varios tests y para generar el contrato.
    /// </summary>
    internal static class SampleGame
    {
        public const string HostId = "HOST_1";
        public const string Token = "jtr_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
        public const string PluginVersion = "0.1.0";
        public static readonly DateTime PlayedAt = new DateTime(2026, 8, 22, 18, 30, 0, DateTimeKind.Utc);
        public static readonly string ReportId = MatchReportBuilder.NewReportId(
            HostId, new Guid("550e8400-e29b-41d4-a716-446655440000"));

        public static ReporterSettings Settings() => new ReporterSettings
        {
            ServerUrl = "https://mini-eventos-jartiland.tail9d0334.ts.net:10000",
            HostId = HostId,
            ReporterToken = Token,
            SourceFile = "HOST_1-reporter.ini"
        };

        public static EhrGameSnapshot Snapshot() => new EhrGameSnapshot
        {
            Finished = true,
            WinnerTeam = "Impostor",
            GameMode = "Standard",
            Map = "Skeld",
            DurationSeconds = 512,
            EhrVersion = "8.0.0",
            EhrTestBuild = 3,
            AmongUsVersion = "2026.8.18",
            Players = new List<EhrPlayerSnapshot>
            {
                // Impostor con dos kills válidas.
                new EhrPlayerSnapshot
                {
                    PlayerId = 0, Name = "Luis", FriendCode = "luis#1001",
                    MainRole = "Impostor", CountType = "Impostor",
                    IsDead = false, DeathReason = "etc", RealKillerId = EhrPlayerSnapshot.NoKiller,
                    HasTasks = false, TasksTotal = 0, TasksCompleted = 0, IsTaskFinished = false,
                    RawKillCount = 2, Won = true
                },
                // Tripulante asesinada que completa sus tareas como fantasma.
                new EhrPlayerSnapshot
                {
                    PlayerId = 1, Name = "Marta", FriendCode = "marta#1002",
                    MainRole = "Crewmate", CountType = "Crew",
                    IsDead = true, DeathReason = "Kill", RealKillerId = 0,
                    HasTasks = true, TasksTotal = 4, TasksCompleted = 4, IsTaskFinished = true,
                    RawKillCount = 0, Won = false
                },
                // Tripulante asesinado sin terminar sus tareas.
                new EhrPlayerSnapshot
                {
                    PlayerId = 2, Name = "Nacho", FriendCode = "nacho#1003",
                    MainRole = "Crewmate", CountType = "Crew",
                    IsDead = true, DeathReason = "Kill", RealKillerId = 0,
                    HasTasks = true, TasksTotal = 4, TasksCompleted = 1, IsTaskFinished = false,
                    RawKillCount = 0, Won = false
                },
                // Tripulante desconectada: no cuenta como kill de nadie.
                new EhrPlayerSnapshot
                {
                    PlayerId = 3, Name = "Sara", FriendCode = "SARA:1004",
                    MainRole = "Crewmate", CountType = "Crew",
                    IsDead = true, DeathReason = "Disconnected", RealKillerId = EhrPlayerSnapshot.NoKiller,
                    HasTasks = true, TasksTotal = 4, TasksCompleted = 2, IsTaskFinished = false,
                    RawKillCount = 0, Won = false, Disconnected = true
                }
            }
        };

        public static CompetitionContext Context() =>
            ContextJson.Parse(File.ReadAllText(TestPaths.Contract("reporter-context.json")));

        public static MatchReportOutcome Build() => MatchReportBuilder.Build(
            Snapshot(), Context(), Settings(), PluginVersion, ReportId, PlayedAt);
    }
}
