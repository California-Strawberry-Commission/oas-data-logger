import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const runs = await prisma.run.findMany({
      select: {
        uuid: true,
        epochTimeS: true,
      },
    });
    return NextResponse.json(runs);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 }
    );
  }
}
