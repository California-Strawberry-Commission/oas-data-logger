import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Firmware = {
  id: string;
  deviceType: "V0" | "V1";
  channel: "STABLE" | "BETA";
  buildNumber: number;
  version: string;
  sha256: string;
  size: number;
  gitHash: string | null;
  isPublished: boolean;
  createdAt: Date;
  publishedAt: Date | null;
};

const GITHUB_COMMIT_URL =
  "https://github.com/California-Strawberry-Commission/oas-data-logger/commit";

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * Compares semver-like version names (e.g. 0.0.2, 0.0.2-beta.3,
 * 0.0.2-dev.abc1234.dirty) following semver precedence: numeric core first,
 * then a release ranks above its prereleases, then prerelease identifiers are
 * compared one by one (numeric < alphanumeric).
 */
function compareVersions(a: string, b: string): number {
  const [aCore, ...aPre] = a.split("-");
  const [bCore, ...bPre] = b.split("-");

  const aNums = aCore.split(".").map(Number);
  const bNums = bCore.split(".").map(Number);
  for (let i = 0; i < Math.max(aNums.length, bNums.length); i++) {
    const diff = (aNums[i] ?? 0) - (bNums[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  const aPreIds = aPre.length > 0 ? aPre.join("-").split(".") : [];
  const bPreIds = bPre.length > 0 ? bPre.join("-").split(".") : [];
  if (aPreIds.length === 0 || bPreIds.length === 0) {
    return bPreIds.length - aPreIds.length;
  }
  for (let i = 0; i < Math.max(aPreIds.length, bPreIds.length); i++) {
    const x = aPreIds[i];
    const y = bPreIds[i];
    if (x === undefined || y === undefined) {
      return x === undefined ? -1 : 1;
    }
    const xIsNum = /^\d+$/.test(x);
    const yIsNum = /^\d+$/.test(y);
    if (xIsNum && yIsNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) {
        return diff;
      }
    } else if (xIsNum !== yIsNum) {
      return xIsNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export default function FirmwareList({ firmwares }: { firmwares: Firmware[] }) {
  // Newest version first
  const sortedFirmwares = [...firmwares].sort(
    (a, b) =>
      compareVersions(b.version, a.version) ||
      a.deviceType.localeCompare(b.deviceType) ||
      a.channel.localeCompare(b.channel),
  );

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-lg">Firmware</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {sortedFirmwares.length === 0 ? (
          <p className="text-sm text-muted-foreground">No firmware yet.</p>
        ) : (
          sortedFirmwares.map((fw) => (
            <Card key={fw.id} className="gap-1 py-3">
              <CardHeader className="px-3">
                <CardTitle className="font-medium">
                  {fw.version}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (build {fw.buildNumber})
                  </span>
                </CardTitle>
                <CardAction className="text-xs uppercase text-muted-foreground">
                  {fw.deviceType} · {fw.channel}
                </CardAction>
                <CardDescription>
                  {formatSize(fw.size)} ·{" "}
                  {fw.gitHash && (
                    <>
                      <a
                        href={`${GITHUB_COMMIT_URL}/${fw.gitHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono underline"
                      >
                        {fw.gitHash.slice(0, 7)}
                      </a>{" "}
                      ·{" "}
                    </>
                  )}
                  {fw.isPublished && fw.publishedAt ? (
                    <>Published {formatDate(fw.publishedAt)}</>
                  ) : (
                    <span className="text-destructive">unpublished</span>
                  )}
                </CardDescription>
              </CardHeader>
            </Card>
          ))
        )}
      </CardContent>
    </Card>
  );
}
