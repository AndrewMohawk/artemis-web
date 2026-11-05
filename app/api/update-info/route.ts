import catalog from "../../data/catalog.json";

const GITHUB_API = "https://api.github.com/repos/AresValley";

type ReleaseResponse = {
  tag_name?: string;
  published_at?: string;
  html_url?: string;
  name?: string;
};

async function fetchRelease(repository: "Artemis" | "Artemis-Database") {
  const response = await fetch(`${GITHUB_API}/${repository}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Artemis-Web-Reference",
    },
  });
  if (!response.ok) throw new Error(`Unable to retrieve ${repository} release`);
  const release = await response.json() as ReleaseResponse;
  return {
    version: release.tag_name || release.name || "Unknown",
    publishedAt: release.published_at || null,
    url: release.html_url || `https://github.com/AresValley/${repository}/releases`,
  };
}

export async function GET() {
  try {
    const [application, database] = await Promise.all([
      fetchRelease("Artemis"),
      fetchRelease("Artemis-Database"),
    ]);
    return Response.json(
      {
        checkedAt: new Date().toISOString(),
        webApplication: { version: "web-1.0", delivery: "Automatic deployment" },
        bundledDatabase: catalog,
        upstreamApplication: application,
        database,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    return Response.json({ error: "Release information unavailable" }, { status: 502 });
  }
}
