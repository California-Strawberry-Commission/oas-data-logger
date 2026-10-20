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
  isPublished: boolean;
  createdAt: Date;
  publishedAt: Date | null;
};

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

export default function FirmwareList({ firmwares }: { firmwares: Firmware[] }) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-lg">Firmware</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {firmwares.length === 0 ? (
          <p className="text-sm text-muted-foreground">No firmware yet.</p>
        ) : (
          firmwares.map((fw) => (
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
                  {fw.isPublished && fw.publishedAt ? (
                    <>Published {formatDate(fw.publishedAt)}</>
                  ) : (
                    <span className="text-destructive">unpublished</span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent
                className="px-3 text-xs font-mono text-muted-foreground truncate"
                title={fw.sha256}
              >
                sha256: {fw.sha256}
              </CardContent>
            </Card>
          ))
        )}
      </CardContent>
    </Card>
  );
}
