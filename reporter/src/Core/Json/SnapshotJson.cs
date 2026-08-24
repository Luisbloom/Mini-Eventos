using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using Jartiland.TournamentReporter.Model;

namespace Jartiland.TournamentReporter.Json
{
    /// <summary>
    /// Guarda y recupera la foto de la partida. A diferencia de MatchJson esto no
    /// viaja al backend: es un archivo nuestro, así que el formato sólo tiene que
    /// ser estable entre versiones del Reporter.
    /// </summary>
    public static class SnapshotJson
    {
        public static string Serialize(CapturedMatch captured)
        {
            if (captured == null) throw new ArgumentNullException(nameof(captured));
            var snapshot = captured.Snapshot ?? new EhrGameSnapshot();

            using (var buffer = new MemoryStream())
            {
                using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = false }))
                {
                    writer.WriteStartObject();
                    writer.WriteString("reportId", captured.ReportId);
                    writer.WriteString("hostId", captured.HostId);
                    writer.WriteString("playedAt", captured.PlayedAt);
                    writer.WriteString("pluginVersion", captured.PluginVersion);

                    writer.WriteStartObject("snapshot");
                    writer.WriteBoolean("finished", snapshot.Finished);
                    writer.WriteString("winnerTeam", snapshot.WinnerTeam);
                    writer.WriteString("gameMode", snapshot.GameMode);
                    writer.WriteString("map", snapshot.Map);
                    writer.WriteNumber("durationSeconds", snapshot.DurationSeconds);
                    writer.WriteString("ehrVersion", snapshot.EhrVersion);
                    writer.WriteNumber("ehrTestBuild", snapshot.EhrTestBuild);
                    writer.WriteString("amongUsVersion", snapshot.AmongUsVersion);

                    writer.WriteStartArray("players");
                    foreach (var player in snapshot.Players ?? new List<EhrPlayerSnapshot>())
                    {
                        writer.WriteStartObject();
                        writer.WriteNumber("playerId", player.PlayerId);
                        writer.WriteString("name", player.Name);
                        writer.WriteString("friendCode", player.FriendCode);
                        writer.WriteString("mainRole", player.MainRole);
                        writer.WriteString("countType", player.CountType);
                        writer.WriteBoolean("isDead", player.IsDead);
                        writer.WriteString("deathReason", player.DeathReason);
                        writer.WriteNumber("realKillerId", player.RealKillerId);
                        writer.WriteBoolean("hasTasks", player.HasTasks);
                        writer.WriteNumber("tasksTotal", player.TasksTotal);
                        writer.WriteNumber("tasksCompleted", player.TasksCompleted);
                        writer.WriteBoolean("isTaskFinished", player.IsTaskFinished);
                        writer.WriteNumber("rawKillCount", player.RawKillCount);
                        writer.WriteBoolean("won", player.Won);
                        writer.WriteBoolean("disconnected", player.Disconnected);
                        writer.WriteEndObject();
                    }
                    writer.WriteEndArray();
                    writer.WriteEndObject();
                    writer.WriteEndObject();
                }

                return Encoding.UTF8.GetString(buffer.ToArray());
            }
        }

        /// <summary>Devuelve null si el archivo está a medias o no es nuestro.</summary>
        public static CapturedMatch Parse(string body)
        {
            if (string.IsNullOrWhiteSpace(body)) return null;
            try
            {
                using (var document = JsonDocument.Parse(body))
                {
                    var root = document.RootElement;
                    if (root.ValueKind != JsonValueKind.Object) return null;
                    var reportId = Text(root, "reportId");
                    if (string.IsNullOrWhiteSpace(reportId)) return null;

                    var captured = new CapturedMatch
                    {
                        ReportId = reportId,
                        HostId = Text(root, "hostId"),
                        PlayedAt = Text(root, "playedAt"),
                        PluginVersion = Text(root, "pluginVersion"),
                        Snapshot = new EhrGameSnapshot()
                    };

                    if (!root.TryGetProperty("snapshot", out var s) || s.ValueKind != JsonValueKind.Object)
                        return captured;

                    captured.Snapshot.Finished = Flag(s, "finished");
                    captured.Snapshot.WinnerTeam = Text(s, "winnerTeam");
                    captured.Snapshot.GameMode = Text(s, "gameMode");
                    captured.Snapshot.Map = Text(s, "map");
                    captured.Snapshot.DurationSeconds = Number(s, "durationSeconds");
                    captured.Snapshot.EhrVersion = Text(s, "ehrVersion");
                    captured.Snapshot.EhrTestBuild = Number(s, "ehrTestBuild");
                    captured.Snapshot.AmongUsVersion = Text(s, "amongUsVersion");

                    if (s.TryGetProperty("players", out var players) && players.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var p in players.EnumerateArray())
                        {
                            captured.Snapshot.Players.Add(new EhrPlayerSnapshot
                            {
                                PlayerId = (byte)Number(p, "playerId"),
                                Name = Text(p, "name"),
                                FriendCode = Text(p, "friendCode"),
                                MainRole = Text(p, "mainRole"),
                                CountType = Text(p, "countType"),
                                IsDead = Flag(p, "isDead"),
                                DeathReason = Text(p, "deathReason"),
                                RealKillerId = (byte)Number(p, "realKillerId", EhrPlayerSnapshot.NoKiller),
                                HasTasks = Flag(p, "hasTasks"),
                                TasksTotal = Number(p, "tasksTotal"),
                                TasksCompleted = Number(p, "tasksCompleted"),
                                IsTaskFinished = Flag(p, "isTaskFinished"),
                                RawKillCount = Number(p, "rawKillCount"),
                                Won = Flag(p, "won"),
                                Disconnected = Flag(p, "disconnected")
                            });
                        }
                    }

                    return captured;
                }
            }
            catch (JsonException)
            {
                // Un archivo cortado por un cierre a destiempo no debe tumbar la cola.
                return null;
            }
        }

        private static string Text(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString() : null;

        private static int Number(JsonElement element, string name, int fallback = 0) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
                ? value.GetInt32() : fallback;

        private static bool Flag(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
    }
}
