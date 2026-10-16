import { after } from "next/server";
import { handleWaitlistRequest } from "@/lib/waitlistService";
import { processOutbox } from "@/lib/outbox";

export const maxDuration = 30;

// POST /api/camp-waitlist
// Joins the optional waiting list for a full camp week. It never registers a child or holds a
// place. All the logic is in src/lib/waitlistService.ts.
export async function POST(request: Request) {
  return handleWaitlistRequest(request, {
    defer: (task) => after(task),
    onJoined: ({ entryId, origin }) => processOutbox({ waitlistEntryId: entryId, origin }),
  });
}
