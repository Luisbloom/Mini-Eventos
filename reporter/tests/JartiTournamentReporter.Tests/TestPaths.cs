using System;
using System.IO;

namespace Jartiland.TournamentReporter.Tests
{
    internal static class TestPaths
    {
        /// <summary>Carpeta reporter/ del repositorio, localizada desde el ensamblado de test.</summary>
        public static string ReporterRoot
        {
            get
            {
                var directory = new DirectoryInfo(AppContext.BaseDirectory);
                while (directory != null)
                {
                    if (Directory.Exists(Path.Combine(directory.FullName, "contract"))
                        && Directory.Exists(Path.Combine(directory.FullName, "src")))
                    {
                        return directory.FullName;
                    }
                    directory = directory.Parent;
                }
                throw new DirectoryNotFoundException("No se encuentra la carpeta reporter/ del repositorio.");
            }
        }

        public static string Contract(string fileName) => Path.Combine(ReporterRoot, "contract", fileName);

        /// <summary>Con UPDATE_CONTRACT=1 se regeneran los archivos de contrato compartidos.</summary>
        public static bool ShouldUpdateContract =>
            string.Equals(Environment.GetEnvironmentVariable("UPDATE_CONTRACT"), "1", StringComparison.Ordinal);

        public static string CreateTemporaryDirectory()
        {
            var path = Path.Combine(Path.GetTempPath(), "jarti-reporter-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(path);
            return path;
        }
    }
}
