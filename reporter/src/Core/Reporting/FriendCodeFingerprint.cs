using System.Security.Cryptography;
using System.Text;

namespace Jartiland.TournamentReporter.Reporting
{
    /// <summary>
    /// Debe coincidir exactamente con <c>src/services/reporter-context.js</c> del
    /// backend: se sustituyen los dos puntos por almohadilla, se recorta y se pasa
    /// a minúsculas antes de calcular SHA-256 en hexadecimal.
    /// </summary>
    public static class FriendCodeFingerprint
    {
        public static string Normalize(string friendCode)
        {
            if (string.IsNullOrWhiteSpace(friendCode)) return string.Empty;
            return friendCode.Replace(':', '#').Trim().ToLowerInvariant();
        }

        public static string Compute(string friendCode)
        {
            var normalized = Normalize(friendCode);
            if (normalized.Length == 0) return null;
            using (var sha = SHA256.Create())
            {
                var digest = sha.ComputeHash(Encoding.UTF8.GetBytes(normalized));
                var builder = new StringBuilder(digest.Length * 2);
                foreach (var value in digest) builder.Append(value.ToString("x2"));
                return builder.ToString();
            }
        }
    }
}
