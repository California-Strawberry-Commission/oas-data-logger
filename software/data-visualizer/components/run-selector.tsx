"use client";

import Combobox from "@/components/ui/combobox";
import { useEffect, useState } from "react";

type Run = {
  uuid: string;
  epochTimeS: number;
};

function truncate(str: string, maxLength: number) {
  return str.length > maxLength ? str.slice(0, maxLength - 3) + "..." : str;
}

export default function RunSelector({
  onSelect,
}: {
  onSelect?: (runUuid: string) => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((data: Run[]) => {
        const sorted = data.sort(
          (a: Run, b: Run) => b.epochTimeS - a.epochTimeS
        );
        setRuns(sorted);
      });
  }, []);

  const runItems = runs.map((run: Run) => {
    const label = `${truncate(run.uuid, 16)} (${new Date(
      run.epochTimeS * 1000
    ).toLocaleString()})`;
    return { value: run.uuid, label };
  });

  return (
    <Combobox
      items={runItems}
      placeholder={"Select run..."}
      searchPlaceholder={"Search run..."}
      onSelect={onSelect}
      defaultSelected={runItems[0]?.value}
    />
  );
}
