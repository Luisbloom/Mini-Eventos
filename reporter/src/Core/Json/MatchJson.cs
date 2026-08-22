using System.IO;
using System.Text;
using System.Text.Json;
using Jartiland.TournamentReporter.Model;

namespace Jartiland.TournamentReporter.Json
{
    /// <summary>
    /// Serializa el resultado con un orden de campos fijo. El backend calcula la
    /// huella de idempotencia sobre el cuerpo recibido, así que dos envíos del
    /// mismo <c>reportId</c> tienen que producir exactamente los mismos bytes.
    /// </summary>
    public static class MatchJson
    {
        public static string Serialize(MatchResult match)
        {
            using (var buffer = new MemoryStream())
            {
                using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = false }))
                {
                    writer.WriteStartObject();
                    writer.WriteString("reportId", match.ReportId);
                    writer.WriteString("hostId", match.HostId);
                    writer.WriteNumber("stageId", match.StageId);
                    if (match.GroupId.HasValue) writer.WriteNumber("groupId", match.GroupId.Value);
                    else writer.WriteNull("groupId");
                    writer.WriteNumber("matchNumber", match.MatchNumber);
                    writer.WriteString("playedAt", match.PlayedAt);
                    writer.WriteString("winner", match.Winner);
                    if (string.IsNullOrEmpty(match.Map)) writer.WriteNull("map");
                    else writer.WriteString("map", match.Map);
                    writer.WriteString("gameMode", match.GameMode);
                    writer.WriteNumber("durationSeconds", match.DurationSeconds);

                    writer.WriteStartObject("reporter");
                    writer.WriteString("plugin", match.Reporter?.Plugin ?? string.Empty);
                    writer.WriteString("ehr", match.Reporter?.Ehr ?? string.Empty);
                    writer.WriteNumber("ehrTestBuild", match.Reporter?.EhrTestBuild ?? 0);
                    writer.WriteString("amongUs", match.Reporter?.AmongUs ?? string.Empty);
                    writer.WriteEndObject();

                    writer.WriteStartArray("players");
                    foreach (var player in match.Players)
                    {
                        writer.WriteStartObject();
                        if (player.ParticipantId.HasValue) writer.WriteNumber("participantId", player.ParticipantId.Value);
                        writer.WriteString("friendCode", player.FriendCode ?? string.Empty);
                        writer.WriteString("name", player.Name ?? string.Empty);
                        writer.WriteNumber("playerId", player.PlayerId);
                        writer.WriteString("team", player.Team);
                        writer.WriteString("role", player.Role);
                        writer.WriteString("rawRole", player.RawRole ?? string.Empty);
                        writer.WriteString("rawCountType", player.RawCountType ?? string.Empty);
                        if (string.IsNullOrEmpty(player.DeathReason)) writer.WriteNull("deathReason");
                        else writer.WriteString("deathReason", player.DeathReason);
                        writer.WriteBoolean("won", player.Won);
                        writer.WriteNumber("kills", player.Kills);
                        writer.WriteNumber("rawKills", player.RawKills);
                        writer.WriteNumber("tasksCompleted", player.TasksCompleted);
                        writer.WriteNumber("tasksTotal", player.TasksTotal);
                        writer.WriteBoolean("allTasksCompleted", player.AllTasksCompleted);
                        writer.WriteBoolean("disconnected", player.Disconnected);
                        writer.WriteEndObject();
                    }
                    writer.WriteEndArray();
                    writer.WriteEndObject();
                }

                return Encoding.UTF8.GetString(buffer.ToArray());
            }
        }
    }
}
