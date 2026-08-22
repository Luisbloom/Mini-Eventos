using System;
using System.Text.Json;
using Jartiland.TournamentReporter.Model;

namespace Jartiland.TournamentReporter.Json
{
    public static class ContextJson
    {
        public static CompetitionContext Parse(string body)
        {
            using (var document = JsonDocument.Parse(body))
            {
                var root = document.RootElement;
                var context = new CompetitionContext
                {
                    ReportingEnabled = Bool(root, "reportingEnabled"),
                    Reason = String(root, "reason"),
                    Message = String(root, "message"),
                    SubmitPath = String(root, "submitPath"),
                    MatchNumber = Int(root, "matchNumber") ?? 0,
                    RosterWithoutFriendCode = Int(root, "rosterWithoutFriendCode") ?? 0
                };

                if (root.TryGetProperty("event", out var eventElement) && eventElement.ValueKind == JsonValueKind.Object)
                {
                    context.EventId = Int(eventElement, "id") ?? 0;
                    context.EventSlug = String(eventElement, "slug");
                    context.EventName = String(eventElement, "name");
                }

                if (root.TryGetProperty("host", out var hostElement) && hostElement.ValueKind == JsonValueKind.Object)
                {
                    context.HostIdentifier = String(hostElement, "identifier");
                }

                if (root.TryGetProperty("stage", out var stageElement) && stageElement.ValueKind == JsonValueKind.Object)
                {
                    context.StageId = Int(stageElement, "id") ?? 0;
                    context.StageName = String(stageElement, "name");
                    context.StageType = String(stageElement, "type");
                }

                if (root.TryGetProperty("group", out var groupElement) && groupElement.ValueKind == JsonValueKind.Object)
                {
                    context.GroupId = Int(groupElement, "id");
                    context.GroupName = String(groupElement, "name");
                }

                if (root.TryGetProperty("roster", out var roster) && roster.ValueKind == JsonValueKind.Array)
                {
                    foreach (var entry in roster.EnumerateArray())
                    {
                        context.Roster.Add(new RosterEntry
                        {
                            ParticipantId = Int(entry, "participantId") ?? 0,
                            DisplayName = String(entry, "displayName"),
                            FriendCodeFingerprint = String(entry, "friendCodeFingerprint")
                        });
                    }
                }

                return context;
            }
        }

        /// <summary>Extrae <c>error.code</c> de una respuesta de error del backend.</summary>
        public static string ReadErrorCode(string body)
        {
            if (string.IsNullOrWhiteSpace(body)) return null;
            try
            {
                using (var document = JsonDocument.Parse(body))
                {
                    if (document.RootElement.ValueKind != JsonValueKind.Object) return null;
                    if (!document.RootElement.TryGetProperty("error", out var error)) return null;
                    if (error.ValueKind != JsonValueKind.Object) return null;
                    return String(error, "code");
                }
            }
            catch (JsonException)
            {
                return null;
            }
        }

        private static string String(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;

        private static int? Int(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
                ? value.GetInt32()
                : (int?)null;

        private static bool Bool(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
    }
}
